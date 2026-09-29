// /api/anilist — Sunucu rotası: AniList GraphQL'den "gelecek animeler" + haftalık takvim.
import { createFileRoute } from "@tanstack/react-router";
import {
  cachedRead,
  TTL_ANILIST_SCHEDULE_SECONDS,
  TTL_ANILIST_UPCOMING_SECONDS,
} from "@/lib/server-cache";

/**
 * `/api/anilist` — ana sayfadaki İKİ bölümün verisini üretir (blueprint §2.6 ve §2.8):
 *   · `?section=upcoming` → "GELECEK ANİMLER" kartları (yayınlanmamış animeler)
 *   · `?section=schedule` → "Estimated Schedule" (7 günlük yayın takvimi, güne göre gruplu)
 *
 * NEDEN SUNUCU ROTASI (tarayıcıdan çağrılmıyor):
 *   1) AniList anahtarsız ve girişsiz çalışır (POST https://graphql.anilist.co) ve
 *      CORS'u açıktır — yani tarayıcıdan da çağrılabilirdi. Fakat yanıtlarında
 *      **CDN önbelleği YOKTUR**: ölçüldü, `Cache-Control: no-cache, private` döner.
 *      Bu yüzden her ziyaretçi isteği doğrudan AniList'e gider ve 30 istek/dk
 *      sınırına çarpılır. Önbelleği BİZ kurmak zorundayız.
 *   2) AniList'e giden istek bu yüzden SUNUCUDA yapılır ve sonuç `cachedRead` ile
 *      TTL boyunca hatırlanır (bkz. lib/server-cache.ts → TTL_ANILIST_*): upstream
 *      isteği "sayfa görüntülemesi başına" değil "önbellek dolumu başına" olur.
 *   3) Yanıt COMPACT JSON'dur: yalnızca arayüzün çizdiği alanlar taşınır (id,
 *      idMal, başlık, kapak, tarih/biçim/bölüm ya da saat/bölüm). Ham GraphQL
 *      gövdesi istemciye gönderilmez.
 *
 * BU ROTA SUPABASE'E HİÇBİR ŞEY YAZMAZ ve Supabase'e hiç okuma yapmaz: katalog
 * eşleştirmesi (`idMal` → `shows.mal_id`) istemcide, sayfada ZATEN yüklü olan
 * seri listesinden yapılır.
 *
 * DOĞRULANMIŞ SORGU DAVRANIŞI (gerçek istekle ölçüldü, 27.09.2026):
 *   · `startDate_greater` OLMADAN `sort: START_DATE` ilk sıralara `startDate: null`
 *     kayıtları koyuyordu (yani "gelecek" değil, tarihi bilinmeyen kayıtlar). Filtre
 *     eklendiğinde ilk satırlar gerçekten ileri tarihli oluyor: `startDate_greater:
 *     20260927` ile ilk kayıtlar 2026-10-01… (artan sırada) geldi ve 50 satır döndü.
 *   · Takvim `airingAt_greater/airingAt_lesser` (epoch saniye) + `sort: TIME` ile
 *     sıralı gelir; 7 günlük pencerede toplam satır 50'yi aştığı için sayfalama
 *     YAPILIR (ölçüm: sayfa 1 = 50 satır, sayfa 2 = 27 satır, `hasNextPage: false`).
 *
 * HATA DAVRANIŞI: upstream başarısızsa `ok:false` döner ve sonuç ÖNBELLEĞE
 * YAZILMAZ (bkz. lib/server-cache.ts: yalnızca başarılı okuma saklanır). İstemci
 * `ok:false` gördüğünde ilgili bölümü HİÇ çizmez; sayfanın geri kalanı etkilenmez.
 */

const ANILIST_ENDPOINT = "https://graphql.anilist.co";

/** Takvimin tutulacağı saat dilimi. Site TR'ye yönelik: saatler İstanbul'a göre. */
const SCHEDULE_TIME_ZONE = "Europe/Istanbul";

/** Gelecek animeler sorgusunda istenen satır sayısı (tek sayfa, ölçüldü: ~36 KB). */
const UPCOMING_PER_PAGE = 50;

/**
 * Takvim sorgusunda en fazla kaç sayfa okunur.
 *
 * NEDEN SINIR: 7 günlük pencere yoğun haftalarda 50 satırı aşar (ölçüm: 77 satır).
 * Sınır olmadan sayfalama sınırsız istek açardı. 6 sayfa = en fazla 300 satır ve
 * en fazla 6 upstream isteği; TTL 3 saat olduğu için bu, saatte ~2 isteğe denk gelir.
 */
const SCHEDULE_MAX_PAGES = 6;

/** Bir güne yazılacak en fazla satır: gün sekmesi listesi okunur kalsın. */
const SCHEDULE_DAY_LIMIT = 40;

/** GraphQL yanıtının ortak zarfı. */
type GraphQLEnvelope<T> = {
  data?: T | null;
  errors?: { message?: string }[] | null;
};

/** Gelecek animeler sorgusunun ham satırı (yalnızca kullandığımız alanlar). */
type UpcomingMediaRow = {
  id: number;
  idMal: number | null;
  format: string | null;
  episodes: number | null;
  startDate: { year: number | null; month: number | null; day: number | null } | null;
  title: { romaji: string | null; english: string | null } | null;
  coverImage: { large: string | null } | null;
};

/** Takvim sorgusunun ham satırı. */
type AiringRow = {
  airingAt: number;
  episode: number | null;
  media: {
    id: number;
    idMal: number | null;
    title: { romaji: string | null } | null;
  } | null;
};

type UpcomingPage = { Page: { media: UpcomingMediaRow[] | null } | null };
type SchedulePage = {
  Page: {
    pageInfo: { hasNextPage: boolean | null } | null;
    airingSchedules: AiringRow[] | null;
  } | null;
};

/** İstemciye giden gelecek anime kaydı. */
export type UpcomingAnimeItem = {
  id: number;
  /** MyAnimeList kimliği — bizim `shows.mal_id` ile eşleşir. `null` olabilir. */
  malId: number | null;
  /** Özgün (romaji) başlık. */
  title: string;
  /** İngilizce başlık (varsa): İngilizce arayüzde bu yazılır. */
  english: string | null;
  cover: string;
  /** Başlangıç tarihi: tam tarih `YYYY-AA-GG`, gün bilinmiyorsa `YYYY-AA`. */
  date: string;
  /** Biçim (TV / ONA / MOVIE…), alt çizgiler boşluğa çevrilir. */
  format: string;
  /** Bölüm sayısı; bilinmiyorsa `null`. */
  episodes: number | null;
};

/** İstemciye giden takvim satırı. */
export type ScheduleAiringItem = {
  /** AniList medya kimliği (yalnızca React anahtarı için). */
  id: number;
  malId: number | null;
  title: string;
  episode: number | null;
  /** `HH:MM` — İstanbul saati, SUNUCUDA biçimlendirilir (istemci biçimlendirmez). */
  time: string;
};

/** Bir takvim günü: İstanbul takvimine göre tarih + o günün yayınları (saat sırası). */
export type ScheduleDay = { date: string; items: ScheduleAiringItem[] };

/**
 * AniList'e tek GraphQL isteği atar.
 *
 * HATA FIRLATIR (yutar değil): çağıran `cachedRead` bu hatayı görürse sonucu
 * önbelleğe YAZMAZ — yani geçici bir hata 3-6 saat boyunca bayat veri olarak
 * servis edilmez, ilk sonraki istekte yeniden denenir.
 */
async function anilist<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(ANILIST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`anilist ${response.status}`);
  const envelope = (await response.json()) as GraphQLEnvelope<T>;
  if (!envelope.data || (envelope.errors?.length ?? 0) > 0) {
    throw new Error(envelope.errors?.[0]?.message ?? "anilist yanıtı boş");
  }
  return envelope.data;
}

/** Bir `Intl.DateTimeFormat` çıktısını `parça adı → değer` haritasına çevirir. */
function partsOf(formatter: Intl.DateTimeFormat, ms: number): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of formatter.formatToParts(new Date(ms))) result[part.type] = part.value;
  return result;
}

/**
 * YYYY-AA-GG (İstanbul takvimi).
 *
 * NEDEN Intl ve AÇIK saat dilimi: sunucu UTC çalışır; gün sınırı `Date`in yerel
 * dilimine bırakılırsa "bugün" yanlış güne kayar ve takvim bir gün ötelenir.
 * `hourCycle: "h23"` gece yarısını "24" değil "00" yazar.
 */
function dateKeyOf(formatter: Intl.DateTimeFormat, ms: number): string {
  const parts = partsOf(formatter, ms);
  const year = parts["year"] ?? "";
  const month = parts["month"] ?? "";
  const day = parts["day"] ?? "";
  return year && month && day ? `${year}-${month}-${day}` : "";
}

/** HH:MM (İstanbul saati, 24 saat düzeni). */
function timeKeyOf(formatter: Intl.DateTimeFormat, ms: number): string {
  const parts = partsOf(formatter, ms);
  const hour = parts["hour"] ?? "";
  const minute = parts["minute"] ?? "";
  return hour && minute ? `${hour}:${minute}` : "";
}

/** İstanbul takviminde gün başı olan epoch SANİYESİ. */
function istanbulDayStartSeconds(ms: number): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: SCHEDULE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = partsOf(formatter, ms);
  const seconds =
    Number(parts["hour"] ?? "0") * 3600 +
    Number(parts["minute"] ?? "0") * 60 +
    Number(parts["second"] ?? "0");
  return Math.floor(ms / 1000) - seconds;
}

/** İki basamaklı sayı (2026-1 → 2026-01). */
function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** `startDate` alanını `YYYY-AA-GG` / `YYYY-AA` / `YYYY` biçimine çevirir. */
function startDateKey(row: UpcomingMediaRow): string {
  const year = row.startDate?.year;
  if (!year) return "";
  const month = row.startDate?.month;
  if (!month) return String(year);
  const day = row.startDate?.day;
  return day ? `${year}-${pad(month)}-${pad(day)}` : `${year}-${pad(month)}`;
}

/**
 * "GELECEK ANİMLER" sorgusu.
 *
 * `startDate_greater` ZORUNLU: filtresiz `sort: START_DATE` ilk sıralara tarihi
 * `null` olan kayıtları koyuyor (ölçüldü), yani "gelecek" garantisi olmuyordu.
 * Alt sınır bugünün İstanbul tarihidir (FuzzyDateInt = YYYYMMDD).
 */
const UPCOMING_QUERY = `query ($from: FuzzyDateInt) {
  Page(page: 1, perPage: ${UPCOMING_PER_PAGE}) {
    media(
      type: ANIME
      status: NOT_YET_RELEASED
      startDate_greater: $from
      sort: START_DATE
    ) {
      id
      idMal
      format
      episodes
      startDate { year month day }
      title { romaji english }
      coverImage { large }
    }
  }
}`;

/** Takvim sorgusu: verilen zaman aralığındaki yayınlar, saat sırasıyla. */
const SCHEDULE_QUERY = `query ($page: Int, $from: Int, $to: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
      airingAt
      episode
      media { id idMal title { romaji } }
    }
  }
}`;

/** AniList'teki "gelecek animeler" listesini compact biçimde döndürür. */
async function loadUpcoming(): Promise<UpcomingAnimeItem[]> {
  const now = Date.now();
  const todayFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = dateKeyOf(todayFormatter, now).replace(/-/g, "");
  if (!today) throw new Error("bugünün tarihi hesaplanamadı");

  const page = await anilist<UpcomingPage>(UPCOMING_QUERY, { from: Number(today) });
  const items: UpcomingAnimeItem[] = [];
  for (const row of page.Page?.media ?? []) {
    if (typeof row.id !== "number") continue;
    const date = startDateKey(row);
    // Tarihi gerçekten bilinmeyen kayıt gösterilmez: kartta yazacak tarih yoksa
    // "gelecek" iddiası da kanıtsız olur (filtre bunu zaten garanti eder).
    if (!date) continue;
    const title = (row.title?.romaji ?? row.title?.english ?? "").trim();
    if (!title) continue;
    const english = (row.title?.english ?? "").trim();
    items.push({
      id: row.id,
      malId: typeof row.idMal === "number" && row.idMal > 0 ? row.idMal : null,
      title,
      english: english && english !== title ? english : null,
      cover: (row.coverImage?.large ?? "").trim(),
      date,
      format: (row.format ?? "").replace(/_/g, " "),
      episodes: typeof row.episodes === "number" && row.episodes > 0 ? row.episodes : null,
    });
  }
  return items;
}

/**
 * 7 günlük yayın takvimini güne göre gruplayıp döndürür.
 *
 * GRUPLAMA: pencere bugünün İstanbul gün başından başlar ve 7 gün sürer; her
 * satırın `airingAt` damgası (epoch saniye) İstanbul saatine çevrilir, gün anahtarı
 * ve `HH:MM` SUNUCUDA üretilir. Böylece istemci biçimlendirme yapmaz; dil
 * değişiminde saat/tarih metni bozulmaz ve tarayıcının saat dilimi sonucu değiştirmez.
 */
async function loadSchedule(): Promise<{ today: string; days: ScheduleDay[] }> {
  const now = Date.now();
  const dayFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const timeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: SCHEDULE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const startSeconds = istanbulDayStartSeconds(now);
  const endSeconds = startSeconds + 7 * 24 * 60 * 60;

  const byDay = new Map<string, ScheduleAiringItem[]>();
  for (let page = 1; page <= SCHEDULE_MAX_PAGES; page += 1) {
    const data = await anilist<SchedulePage>(SCHEDULE_QUERY, {
      page,
      from: startSeconds,
      to: endSeconds,
    });
    const rows = data.Page?.airingSchedules ?? [];
    for (const row of rows) {
      if (typeof row.airingAt !== "number") continue;
      const ms = row.airingAt * 1000;
      const date = dateKeyOf(dayFormatter, ms);
      const time = timeKeyOf(timeFormatter, ms);
      if (!date || !time) continue;
      const title = (row.media?.title?.romaji ?? "").trim();
      if (!title) continue;
      const list = byDay.get(date) ?? [];
      list.push({
        id: typeof row.media?.id === "number" ? row.media.id : row.airingAt,
        malId: typeof row.media?.idMal === "number" && row.media.idMal > 0 ? row.media.idMal : null,
        title,
        episode:
          typeof row.episode === "number" && row.episode > 0 ? Math.trunc(row.episode) : null,
        time,
      });
      byDay.set(date, list);
    }
    if (rows.length === 0 || data.Page?.pageInfo?.hasNextPage !== true) break;
  }

  const days: ScheduleDay[] = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([date, items]) => ({
      date,
      // Sayfalar saat sırasıyla geldiği için liste zaten sıralıdır; yine de
      // sayfa sınırında karışma olmasın diye `time`a göre sabitlenir.
      items: [...items].sort((a, b) => a.time.localeCompare(b.time)).slice(0, SCHEDULE_DAY_LIMIT),
    }))
    .filter((day) => day.items.length > 0);

  return { today: dateKeyOf(dayFormatter, now), days };
}

export const Route = createFileRoute("/api/anilist")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const section = (new URL(request.url).searchParams.get("section") ?? "all").trim();

        /**
         * Hata ve bilinmeyen bölüm: HTTP 200 + `ok:false` döner ve `no-store` ile
         * işaretlenir. NEDEN 200: istemci bunu "bölümü çizme" sinyali olarak
         * okuyor; 5xx dönseydi tarayıcı konsolunda ve ara katmanlarda gereksiz
         * hata gürültüsü olurdu. NEDEN `no-store`: başarısız sonuç ASLA
         * önbelleklenmemeli — kısa süreli bir kesinti saatlerce donmasın.
         */
        const failed = (reason: string) =>
          Response.json({ ok: false, reason }, { headers: { "Cache-Control": "no-store" } });

        try {
          if (section === "upcoming") {
            const items = await cachedRead(
              "anilist:upcoming:v1",
              TTL_ANILIST_UPCOMING_SECONDS,
              loadUpcoming,
            );
            return Response.json(
              { ok: true, items },
              // Yanıtın KENDİSİ de kısa süre paylaşımlı önbelleğe alınabilir:
              // veri herkese açık ve kullanıcıdan bağımsız.
              { headers: { "Cache-Control": `public, s-maxage=${TTL_ANILIST_UPCOMING_SECONDS}` } },
            );
          }

          if (section === "schedule") {
            const schedule = await cachedRead(
              "anilist:schedule:v1",
              TTL_ANILIST_SCHEDULE_SECONDS,
              loadSchedule,
            );
            return Response.json(
              { ok: true, today: schedule.today, days: schedule.days },
              { headers: { "Cache-Control": `public, s-maxage=${TTL_ANILIST_SCHEDULE_SECONDS}` } },
            );
          }

          if (section === "all") {
            // İki bölüm AYRI AYRI önbelleklenir: biri hata verse bile diğeri
            // çizilebilsin (bağımsız bozulma).
            const [upcoming, schedule] = await Promise.all([
              cachedRead("anilist:upcoming:v1", TTL_ANILIST_UPCOMING_SECONDS, loadUpcoming).catch(
                () => null,
              ),
              cachedRead("anilist:schedule:v1", TTL_ANILIST_SCHEDULE_SECONDS, loadSchedule).catch(
                () => null,
              ),
            ]);
            return Response.json(
              {
                ok: true,
                items: upcoming ?? [],
                today: schedule?.today ?? "",
                days: schedule?.days ?? [],
                partial: !upcoming || !schedule,
              },
              { headers: { "Cache-Control": "no-store" } },
            );
          }

          return failed(`bilinmeyen section: ${section}`);
        } catch (error) {
          return failed(error instanceof Error ? error.message : String(error));
        }
      },
    },
  },
});
