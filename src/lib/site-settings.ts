/**
 * `site_settings` okuma katmanı — TEK paylaşımlı okuma.
 *
 * NEDEN TEK YER (kota/egress): aynı satırlar sitede birbirinden BAĞIMSIZ okunuyordu.
 * Reklam slotlarının her biri kendi sorgusunu atıyordu (`["ad-slot", key]`), yani iki
 * reklamlı bir sayfa `site_settings`e İKİ okuma yapıyordu; seri/izleme sayfalarında
 * buna kapak haritası satırını okuyan AYRI bir sorgu da ekleniyordu. Binlerce seri
 * barındırılacak bir sitede bu tür tekrar okumalar doğrudan kotayı yakar.
 *
 * ÇÖZÜM: yapılandırma satırları ANAHTAR KÜMESİ başına TEK istekte okunur
 * (`fetchSiteSettings`) ve sonuç SUNUCUDA `TTL_SETTINGS_SECONDS` (300 sn) boyunca
 * hatırlanır (bkz. lib/server-cache.ts). React Query
 * kullanan bileşenler `siteSettingsQueryOptions` ile AYNI önbellek girdisini
 * paylaşır; hook çağıramayan düz fonksiyonlar (`fetchShowDetail`) da aynı okuma
 * fonksiyonunu kullanır ve SUNUCU önbelleğinden yararlanır. Böylece
 * sayfada kaç bileşen/kaç çağrı okursa okusun, pencere başına okuma TEKTİR.
 *
 * DİKKAT (büyük satır tuzağı): Büyük gövdeli satırlar (ör. `episode_posters` kapak
 * haritası — binlerce seride yüzlerce KB olabilir) bu paylaşımlı okumaya DAHİL
 * EDİLMEZ; yalnızca çağrının açıkça istediği anahtarlar çekilir. "Her şeyi tek
 * seferde çek" yaklaşımı sayfa başına gereksiz büyük bir gövde indirir ve egress'i
 * ARTTIRIRDI — bu yüzden küme, çağıran tarafından verilir.
 */
import { supabase } from "@/integrations/supabase/client";
import { QUERY_STALE_MS } from "@/lib/query-client";
import { cachedRead, TTL_SETTINGS_SECONDS } from "@/lib/server-cache";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/** Okunan yapılandırma satırları: `key` → `value`. */
export type SiteSettings = Record<string, string>;

/**
 * Anahtar kümesi başına önbellek anahtarı.
 *
 * NEDEN SUNUCU ÖNBELLEĞİ (kota/egress): `fetchShowDetail` bir React bileşeni
 * DEĞİLDİR, bu yüzden hook (`useQuery`) çağıramaz. Aynı satırların (kapak haritası,
 * reklam kodları) her sayfa açılışında yeniden okunmaması için sonuç
 * `lib/server-cache.ts` üzerinden `TTL_SETTINGS_SECONDS` (300 sn) boyunca
 * hatırlanır. Böylece React Query kullanan (reklam slotları) ve kullanmayan
 * (seri detayı) TÜM çağıranlar AYNI pencere içinde TEK okuma paylaşır; Workers
 * Cache API sayesinde kazanç ısıtıcı (isolate) değişse bile korunur.
 */

/** Anahtar kümesini kararlı bir imzaya çevirir: sıra farkı yeni okuma saymasın. */
function keysSignature(keys: readonly string[]): string {
  return [...new Set(keys)].filter(Boolean).sort().join("\u0000");
}

/**
 * Verilen `site_settings` anahtarlarını TEK istekte okur.
 *
 * Hata durumunda boş harita döner; çağıranların tümü zaten "değer yok" durumunu
 * (boş reklam kodu / kapaksız bölüm) tolere eder. DİKKAT: boş harita önbelleğe
 * YAZILMAZ — hata `cachedRead`'in içinde fırlatılır, yalnızca başarılı okuma
 * saklanır (bkz. lib/server-cache.ts). Aksi hâlde tek bir geçici hata, 5 dakika
 * boyunca reklamların/kapakların kaybolmasına yol açardı.
 */
export async function fetchSiteSettings(keys: readonly string[]): Promise<SiteSettings> {
  const unique = [...new Set(keys)].filter(Boolean);
  if (unique.length === 0) return {};
  const signature = keysSignature(unique);
  try {
    return await cachedRead<SiteSettings>(
      `site-settings:${signature}`,
      TTL_SETTINGS_SECONDS,
      async () => {
        const { data, error } = await db
          .from("site_settings")
          .select("key, value")
          .in("key", unique);
        // Hata sessizce yutulmaz: `cachedRead` yalnızca başarılı sonucu saklar.
        if (error) throw error;
        const map: SiteSettings = {};
        for (const row of (data ?? []) as { key: string; value: string | null }[]) {
          map[row.key] = row.value ?? "";
        }
        return map;
      },
    );
  } catch {
    return {};
  }
}

/**
 * `site_settings` okumasının ORTAK React Query tanımı.
 *
 * Aynı anahtar kümesiyle çağıran tüm bileşenler AYNI önbellek girdisini kullanır
 * (anahtar: `["site-settings", ...anahtarlar]`), yani okuma sayfada kaç bileşen
 * tarafından istenirse istensin BİR kez yapılır (bkz. dosya başı notu).
 */
export function siteSettingsQueryOptions(keys: readonly string[]) {
  const unique = [...new Set(keys)].filter(Boolean).sort();
  return {
    queryKey: ["site-settings", ...unique] as const,
    queryFn: () => fetchSiteSettings(unique),
    // Tazelik tek yerden yönetilir: bkz. lib/query-client.ts → QUERY_STALE_MS.
    staleTime: QUERY_STALE_MS,
  };
}
