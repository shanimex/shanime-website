import { supabase } from "@/integrations/supabase/client";

/**
 * `episode_sources` veri katmanı — bir bölüme BİRDEN FAZLA kaynak.
 *
 * NEDEN AYRI DOSYA: aynı tabloya hem panel (`AnizipSyncPanel`, kaynakları yazar)
 * hem izleme sayfası (oynatıcının altındaki çipleri okur) dokunuyor. Sorgular iki
 * yerde kopyalanınca biri güncellenip öteki unutuluyordu; tablo adı ve kolon listesi
 * de tek bir yerde dursun diye burası tek kaynak.
 *
 * ⚠️ Proje genelindeki supabase kaçış kapısı: `db` = `supabase as any` (bkz.
 * `lib/admin.ts`). Şema tipleri üretilmediği için gerekli.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type EpisodeSource = {
  id: string;
  episode_id: string;
  provider: string;
  language: string;
  label: string;
  url: string;
  sort_order: number;
};

/** Yazılacak kaynak satırı — kimlik ve `episode_id` çağrıda eklenir. */
export type EpisodeSourceInput = {
  provider: string;
  language: string;
  label: string;
  url: string;
  sort_order: number;
};

/**
 * `url` bir sağlayıcı DİREKTİFİ mi (`@megaplay`) yoksa gerçek gömme adresi mi?
 *
 * İki tür değer aynı kolonda yaşıyor (bkz. migration notu): adres bölüme özel
 * olmadığında direktif yazılır. İzleme sayfası bu ayrıma bakarak ya direktifi
 * oynatıcıya çevirir ya adresi doğrudan gömer. Aynı denetim `lib/embed-provider.ts`
 * içinde de var; ayrışmasın diye ikisi de `startsWith("@")` kullanır.
 */
export function isDirective(url: string): boolean {
  return url.startsWith("@");
}

/**
 * Verilen bölümlerin kaynaklarını TEK sorguda çeker ve bölüme göre gruplar.
 *
 * NEDEN TEK SORGU: izleme sayfası bir sezonu açar; bölüm başına ayrı sorgu atmak
 * N+1 demekti. Hepsi `in(...)` ile bir turda gelir; diziliş (`sort_order`) oynatıcı
 * altındaki sıra olduğu için sıralama VERİTABANINDA yapılır.
 */
export async function fetchSourcesForEpisodes(
  episodeIds: string[],
): Promise<Map<string, EpisodeSource[]>> {
  const grouped = new Map<string, EpisodeSource[]>();
  // Boş liste ile `in([])` sorgusu anlamsız olurdu; erken dönülür.
  if (episodeIds.length === 0) return grouped;

  const { data, error } = await db
    .from("episode_sources")
    .select("id, episode_id, provider, language, label, url, sort_order")
    .in("episode_id", episodeIds)
    .order("sort_order", { ascending: true });
  if (error) throw error;

  for (const row of (data ?? []) as EpisodeSource[]) {
    const list = grouped.get(row.episode_id);
    if (list) list.push(row);
    else grouped.set(row.episode_id, [row]);
  }
  return grouped;
}

/**
 * TR (Türkçe) kaynak kapsaması — paneldeki "TR a/b" rozetini besleyen CANLI veri.
 *
 * NEDEN CANLI VERİ (eski davranışın neden YANLIŞ olduğu):
 *   Rozetin payı eskiden `src/data/anizm-hashes.json` dosyasının `{malId}-s…b…`
 *   önekli anahtarları SAYILIYORDU. O dosya DERLEME ZAMANINDA üretilen bir
 *   artifact'tır (bkz. `scripts/resolve-anizm-hashes.mjs`) — panelden bölüm
 *   eklemek onu DEĞİŞTİRMEZ. Sonuç: yeni bölüm eklenince payda (`episode_count`)
 *   büyüyor, pay sabit kalıyor ve rozet hiç düzelmeyen bir "amber" durumuna
 *   saplanıp kalıyordu. Üstelik panelin yazdığı GERÇEK Türkçe kapsama
 *   (`episode_sources.language = 'tr'`) tamamen YOK SAYILIYORDU.
 *   Bu yüzden sayaç artık doğrudan bu tablodan, canlı olarak okunur.
 *
 * MALİYET — SABİT 2 İSTEK (Supabase kotası neredeyse tükendiği için N+1 KESİNLİKLE
 * YASAK; seri başına sorgu YOK):
 *   1) `show_episodes` → (id, show_id): verilen serilerin TÜM bölümleri,
 *   2) `episode_sources` → language='tr' satırlarının bölüm kimlikleri,
 *   Eşleştirme/sayım JS'te yapılır. İstek sayısı seri/bölüm sayısından BAĞIMSIZDIR.
 *
 * @returns show_id → en az bir 'tr' kaynağı olan (tekil) bölüm sayısı
 */
export async function fetchTurkishCoverage(showIds: string[]): Promise<Map<string, number>> {
  const coverage = new Map<string, number>();
  // Boş liste ile `in([])` sorgusu anlamsız olurdu; erken dönülür.
  if (showIds.length === 0) return coverage;

  const [episodesRes, trRes] = await Promise.all([
    db.from("show_episodes").select("id, show_id").in("show_id", showIds),
    db.from("episode_sources").select("episode_id").eq("language", "tr"),
  ]);
  if (episodesRes.error) throw episodesRes.error;
  if (trRes.error) throw trRes.error;

  const trEpisodeIds = new Set(
    ((trRes.data ?? []) as { episode_id: string }[]).map((row) => row.episode_id),
  );
  for (const row of (episodesRes.data ?? []) as { id: string; show_id: string }[]) {
    if (!trEpisodeIds.has(row.id)) continue;
    coverage.set(row.show_id, (coverage.get(row.show_id) ?? 0) + 1);
  }
  return coverage;
}

/**
 * Bir bölümün kaynaklarını verilen listeyle BİREBİR eşitler.
 *
 * NEDEN "sil + upsert": panelde işaretlenen kutular değiştiğinde sonuç kutularla
 * eşleşmeli. Kaldırılan sağlayıcının eski satırı SİLİNİR — yoksa kullanıcının
 * vazgeçtiği kaynak oynatıcı altında çıkmaya devam ederdi. Kalanlar
 * `(episode_id, provider)` benzersizliği üzerinden GÜNCELLENİR, böylece "tekrar yaz"
 * satır çoğaltmaz.
 */
export async function replaceEpisodeSources(
  episodeId: string,
  rows: EpisodeSourceInput[],
): Promise<void> {
  // Silinecekleri bulmak için mevcut sağlayıcılar okunur (`in` ile ters liste kurmak
  // boş liste durumunda bozuk SQL üretirdi).
  const { data, error } = await db
    .from("episode_sources")
    .select("provider")
    .eq("episode_id", episodeId);
  if (error) throw error;

  const keep = new Set(rows.map((row) => row.provider));
  const stale = ((data ?? []) as { provider: string }[])
    .map((row) => row.provider)
    .filter((provider) => !keep.has(provider));

  if (stale.length > 0) {
    const { error: deleteError } = await db
      .from("episode_sources")
      .delete()
      .eq("episode_id", episodeId)
      .in("provider", stale);
    if (deleteError) throw deleteError;
  }

  if (rows.length === 0) return;
  const { error: upsertError } = await db.from("episode_sources").upsert(
    rows.map((row) => ({ episode_id: episodeId, ...row })),
    { onConflict: "episode_id,provider" },
  );
  if (upsertError) throw upsertError;
}
