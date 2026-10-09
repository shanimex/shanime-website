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
 * Sağlayıcı kaynak kapsaması — paneldeki sağlayıcı x/x rozetlerini besleyen CANLI veri.
 *
 * NEDEN CANLI VERİ (eski davranışın neden YANLIŞ olduğu):
 *   Rozetin payı eskiden `src/data/anizm-hashes.json` dosyasının `{malId}-s…b…`
 *   önekli anahtarları SAYILIYORDU. O dosya DERLEME ZAMANINDA üretilen bir
 *   artifact'tır (bkz. `scripts/resolve-anizm-hashes.mjs`) — panelden bölüm
 *   eklemek onu DEĞİŞTİRMEZ. Sonuç: yeni bölüm eklenince payda (`episode_count`)
 *   büyüyor, pay sabit kalıyor ve rozet hiç düzelmeyen bir "amber" durumuna
 *   saplanıp kalıyordu. Üstelik panelin yazdığı GERÇEK Türkçe kapsama
 *   Eski sayaç yalnızca Türkçe satırları saydığı için MegaPlay gibi sağlayıcılar
 *   panelde kayboluyordu; artık tüm sağlayıcı satırları ayrı ayrı sayılır.
 *   Bu yüzden sayaç artık doğrudan bu tablodan, canlı olarak okunur.
 *
 * MALİYET — SABİT 2 İSTEK (Supabase kotası neredeyse tükendiği için N+1 KESİNLİKLE
 * YASAK; seri başına sorgu YOK):
 *   1) `show_episodes` → (id, show_id): verilen serilerin TÜM bölümleri,
 *   2) `episode_sources` → sağlayıcı ve bölüm kimlikleri,
 *   Eşleştirme/sayım JS'te yapılır. İstek sayısı seri/bölüm sayısından BAĞIMSIZDIR.
 *
 * @returns show_id → en az bir 'tr' kaynağı olan (tekil) bölüm sayısı
 */
export async function fetchTurkishCoverage(
  showIds: string[],
): Promise<Map<string, Map<string, number>>> {
  const coverage = new Map<string, Map<string, number>>();
  if (showIds.length === 0) return coverage;

  const [episodesRes, trRes] = await Promise.all([
    db.from("show_episodes").select("id, show_id, number").in("show_id", showIds),
    db.from("episode_sources").select("episode_id, provider"),
  ]);
  if (episodesRes.error) throw episodesRes.error;
  if (trRes.error) throw trRes.error;

  const episodeToShow = new Map<string, string>();
  for (const row of (episodesRes.data ?? []) as { id: string; show_id: string; number: number }[]) {
    if (row.number > 0) episodeToShow.set(row.id, row.show_id);
  }
  const episodeProviders = new Map<string, Set<string>>();
  for (const row of (trRes.data ?? []) as { episode_id: string; provider: string }[]) {
    const showId = episodeToShow.get(row.episode_id);
    if (!showId) continue;
    const provider = row.provider.trim().toLowerCase();
    const group =
      provider === "anizm" ||
      provider === "puffy" ||
      provider === "puffytr" ||
      provider === "anizmplayer"
        ? "Anizm"
        : provider === "tauvideo" || provider === "animecix"
          ? "TauVideo"
          : provider === "megaplay"
            ? "MegaPlay"
            : row.provider.trim();
    const key = `${showId}:${group}`;
    let ids = episodeProviders.get(key);
    if (!ids) {
      ids = new Set<string>();
      episodeProviders.set(key, ids);
    }
    ids.add(row.episode_id);
  }
  for (const [key, ids] of episodeProviders) {
    const split = key.indexOf(":");
    const showId = key.slice(0, split);
    const group = key.slice(split + 1);
    let groups = coverage.get(showId);
    if (!groups) {
      groups = new Map<string, number>();
      coverage.set(showId, groups);
    }
    groups.set(group, ids.size);
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
  preserveProviders: string[] = [],
): Promise<void> {
  // Silinecekleri bulmak için mevcut sağlayıcılar okunur (`in` ile ters liste kurmak
  // boş liste durumunda bozuk SQL üretirdi).
  const { data, error } = await db
    .from("episode_sources")
    .select("provider")
    .eq("episode_id", episodeId);
  if (error) throw error;

  const keep = new Set(rows.map((row) => row.provider));
  const preserve = new Set(preserveProviders);
  const stale = ((data ?? []) as { provider: string }[])
    .map((row) => row.provider)
    // Seçili kaynak geçici olarak çözülemezse mevcut çalışan satır silinmez.
    // Kullanıcı kaynağı kaldırmak isterse kutuyu kapatıp yeniden yazabilir.
    .filter((provider) => !keep.has(provider) && !preserve.has(provider));

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
