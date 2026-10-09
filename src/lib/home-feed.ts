/**
 * Ana sayfa BESLEME katmanı: "Son Bölümler" + trend sayaçları (index.tsx'ten
 * bölündü, 01.10.2026).
 *
 * NEDEN TEK DOSYA: bölüm listesini iki yer tüketiyor ("Son Bölümler" ızgarası
 * ve bandın "YENİ ÇIKANLAR" kolonu); trend sayaçlarını da sekmeler + ızgara
 * paylaşıyor. `queryKey`ler aynı olduğu için React Query sonucu PAYLAŞIR —
 * iki tüketici de çağırsa ağa TEK istek gider. Davranış birebir aynıdır.
 */
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { ShowWithImage } from "@/lib/content";
import type { I18nKey } from "@/lib/i18n";
import { cachedRead, TTL_LATEST_SECONDS } from "@/lib/server-cache";

/** Bölüm kaydı: bölüm bilgisi + ebeveyn seri + veritabanına eklenme zamanı. */
export type LatestEpisode = {
  id: string;
  show: ShowWithImage;
  season: number;
  number: number;
  title: string;
  /** `show_episodes.created_at` (ISO). Kompakt bant satırındaki tarih buradan yazılır. */
  createdAt: string;
};

/**
 * Bölüm sorgusunda okunacak en fazla satır.
 *
 * NEDEN BOL SATIR: liste seri başına TEK (en yeni) bölüme indirilir. Bir serinin
 * yeni eklenmiş 30 bölümü listenin başını doldurursa küçük bir limitle 12 farklı
 * seriye hiç ulaşılamaz (satırlar çok küçük: id, show_id, sezon, bölüm, başlık).
 */
const LATEST_QUERY_LIMIT = 300;

/** "Son Bölümler" ızgarasındaki kart sayısı (referans: yoğun 12'lik ızgara). */
export const LATEST_GRID_LIMIT = 12;

/** Kompakt bant kolonlarındaki satır sayısı (referanstaki liste: ~5 satır). */
export const COMPACT_ROW_LIMIT = 5;

const LATEST_EPISODES_QUERY_KEY = ["home-latest-episodes"] as const;

/**
 * `show_episodes` en yeniden eskiye okunur ve ebeveyn seriye bağlanır.
 * Ebeveyni listede olmayan bölüm ATLANIR (kırık bağlantı doğmaz).
 *
 * HATA YUTULUR (bilerek): sorgu patlarsa boş liste döner; yalnızca bölüm verisine
 * bağlı bölümler çizilmez, sayfanın geri kalanı etkilenmez.
 */
async function readLatestEpisodes(shows: ShowWithImage[]): Promise<LatestEpisode[]> {
  try {
    return await cachedRead<LatestEpisode[]>(
      "public:home:latest-episodes",
      TTL_LATEST_SECONDS,
      async () => {
        const { data, error } = await supabase
          .from("show_episodes")
          .select("id, show_id, season, number, title, created_at")
          .order("created_at", { ascending: false })
          .limit(LATEST_QUERY_LIMIT);
        if (error) throw error;
        const byId = new Map(shows.map((show) => [show.id, show]));
        const items: LatestEpisode[] = [];
        for (const row of data ?? []) {
          const show = byId.get(row.show_id);
          // Ebeveyni listede olmayan bölüm gösterilmez (kırık bağlantı olmaz).
          if (!show) continue;
          items.push({
            id: row.id,
            show,
            season: typeof row.season === "number" && row.season > 0 ? row.season : 1,
            number: row.number,
            title: (row.title ?? "").trim(),
            createdAt: typeof row.created_at === "string" ? row.created_at : "",
          });
        }
        return items;
      },
    );
  } catch {
    // Sorgu patlarsa yalnızca bu bölümler çizilmez; ana sayfa bozulmaz.
    return [];
  }
}

/** "Son Bölümler" ızgarası ve "YENİ ÇIKANLAR" kolonu için ORTAK sorgu kancası. */
export function useLatestEpisodes(shows: ShowWithImage[]) {
  return useQuery({
    queryKey: LATEST_EPISODES_QUERY_KEY,
    queryFn: () => readLatestEpisodes(shows),
  });
}

/**
 * KULLANICI İSTEĞİ (01.10.2026): "bendeki de bu sitedeki gibi day week month
 * olmalı" (referans: reanime.to/home "Top Trending" → DAY / WEEK / MONTH).
 *
 * ÖLÇÜT DÜRÜSTLÜĞÜ — kaynak sitede bu sekmeler GÖRÜNTÜLENME sayısına göre
 * sıralar. Bizde görüntülenme verisi YOK; uydurma "popülerlik" yerine ELDEKİ
 * gerçek sinyal kullanılır: **o pencerede eklenen bölüm sayısı**.
 */
export type RankTab = "day" | "week" | "month";

/** Sekme → pencere uzunluğu (gün). Sıralama anahtarı sekme kimliğiyle AYNI. */
export const TREND_WINDOWS: Record<RankTab, number> = { day: 1, week: 7, month: 30 };

/** Pencere hesabı için okunacak bölüm satırı üst sınırı. */
const TREND_QUERY_LIMIT = 1000;

/** Seri başına pencere sayaçları. `newest` = seriye en son eklenen bölümün tarihi. */
export type TrendActivity = { day: number; week: number; month: number; newest: string };

const TREND_ACTIVITY_QUERY_KEY = ["home", "trend-activity"] as const;

/**
 * Sorgu düşerse kullanılacak SABİT boş nesne. Her render'da yeni `{}` üretmek
 * `useMemo` bağımlılığını sürekli değiştirip sıralamayı gereksiz yeniden
 * hesaplatırdı; bu yüzden referansı sabit tek bir nesne tutulur.
 */
export const EMPTY_TREND_ACTIVITY: Record<string, TrendActivity> = {};

/**
 * Trend sekmeleri için seri başına pencere sayaçlarını TEK sorguda toplar.
 *
 * NEDEN TEK SORGU: üç pencere de aynı satırlardan türetilir; pencere başına ayrı
 * istek egress'i üçe katlardı. Sorgu yalnızca iki küçük kolon okur.
 */
async function readTrendActivity(): Promise<Record<string, TrendActivity>> {
  try {
    return await cachedRead<Record<string, TrendActivity>>(
      "public:home:trend-activity",
      TTL_LATEST_SECONDS,
      async () => {
        const { data, error } = await supabase
          .from("show_episodes")
          .select("show_id, created_at")
          .order("created_at", { ascending: false })
          .limit(TREND_QUERY_LIMIT);
        if (error) throw error;
        const now = Date.now();
        const out: Record<string, TrendActivity> = {};
        for (const row of data ?? []) {
          const id = row.show_id ? String(row.show_id) : "";
          const at = typeof row.created_at === "string" ? row.created_at : "";
          if (!id || !at) continue;
          const ts = Date.parse(at);
          if (Number.isNaN(ts)) continue;
          const ageDays = (now - ts) / 86_400_000;
          const entry = out[id] ?? (out[id] = { day: 0, week: 0, month: 0, newest: "" });
          if (ageDays <= TREND_WINDOWS.day) entry.day += 1;
          if (ageDays <= TREND_WINDOWS.week) entry.week += 1;
          if (ageDays <= TREND_WINDOWS.month) entry.month += 1;
          // Satırlar yeniden eskiye sıralı geldiği için ilk görülen EN YENİdir.
          if (!entry.newest) entry.newest = at;
        }
        return out;
      },
    );
  } catch {
    // Sorgu patlarsa sekmeler boş sayaçla çalışır; ana sayfa bozulmaz.
    return {};
  }
}

export function useTrendActivity() {
  return useQuery({ queryKey: TREND_ACTIVITY_QUERY_KEY, queryFn: readTrendActivity });
}

/**
 * Aktivite kaydından istenen pencerenin sayacını okur.
 * Kayıt yoksa 0 döner (liste sırası korunur, seri düşmez).
 */
export function trendWindowCount(activity: TrendActivity | undefined, windowDays: number): number {
  if (!activity) return 0;
  if (windowDays === TREND_WINDOWS.day) return activity.day;
  if (windowDays === TREND_WINDOWS.week) return activity.week;
  return activity.month;
}

/**
 * En yeni bölüm listesini SERİ BAŞINA TEK (en yeni) bölüme indirir.
 *
 * NEDEN: yeni eklenmiş 30 bölümü olan bir seri tek başına listeyi doldurup keşif
 * değerini yok ederdi. Kural TEK yerde durur ki ızgara ile bant aynı satırları
 * göstersin.
 */
export function latestPerShowItems(items: LatestEpisode[]): LatestEpisode[] {
  const seen = new Set<string>();
  const result: LatestEpisode[] = [];
  for (const item of items) {
    if (seen.has(item.show.id)) continue;
    seen.add(item.show.id);
    result.push(item);
  }
  return result;
}

/** Kenar çubuğundaki sıralı liste uzunluğu (ölü boşluk kalmasın diye kısa tutulur). */
export const RANKED_LIMIT = 6;

/**
 * Sekme tanımları: sekme etiketi + açıklayan ipucu (ipucu balonunda, görünür
 * satırda değil — referans panelin şeridi yalnızca "başlık + sekmeler"dir).
 */
export const RANK_TABS: { id: RankTab; labelKey: I18nKey; hintKey: I18nKey }[] = [
  { id: "day", labelKey: "home.rankDay", hintKey: "home.rankDayHint" },
  { id: "week", labelKey: "home.rankWeek", hintKey: "home.rankWeekHint" },
  { id: "month", labelKey: "home.rankMonth", hintKey: "home.rankMonthHint" },
];
