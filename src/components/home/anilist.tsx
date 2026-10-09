/**
 * AniList bölümleri: "Gelecek Animeler" + haftalık yayın takvimi (index.tsx'ten
 * bölündü, 01.10.2026).
 *
 * VERİ: AniList GraphQL (anahtar/giriş gerekmez) `/api/anilist` SUNUCU ROTASINDAN
 * alınır — tarayıcıdan doğrudan çağrı YOK. İki sebep: (1) AniList yanıtlarında
 * CDN önbelleği yoktur, önbelleği biz kurarız (upcoming 6 saat, takvim 3 saat);
 * (2) saat/tarih metinleri sunucuda İstanbul saatine göre üretilir, tarayıcı
 * saat dilimi sonucu değiştiremez. Supabase'e bu bölümler için okuma YOK:
 * eşleştirme sayfada ZATEN yüklü seri listesi üzerinden İSTEMCİDE yürür.
 *
 * SESSİZ BOZULMA: upstream ya da rota hata verirse ilgili bölüm HİÇ çizilmez
 * (boş başlık, hata kutusu, yükleme iskeleti yok) ve sayfanın geri kalanı
 * etkilenmez. Davranış birebir aynıdır.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ChevronDown, ChevronLeft, ChevronRight, Play } from "lucide-react";

import { showSlug, type ShowWithImage } from "@/lib/content";
import { plural, useLang } from "@/lib/i18n";
import { DiscoveryRowHeader } from "@/components/home/homeLists";
import { DISCOVERY_GRID, DISCOVERY_GRID_CAPPED, SECTION_GAP } from "@/components/home/homeClass";

/** Tek keşif satırı: başlık + poster kartı ızgarası. Boş satır çağıranda hiç çizilmez. */
export function DiscoveryRow({
  title,
  moreHref,
  gridClassName,
  children,
}: {
  title: string;
  // `| undefined`: `exactOptionalPropertyTypes` açık.
  moreHref?: string | undefined;
  /**
   * Izgara düzeni. Varsayılan `DISCOVERY_GRID` (6 sütun) yalnızca ana kolon
   * referans genişliğindeyken doğrudur; kenar çubuğu verisi yoksa çağıran
   * `DISCOVERY_GRID_CAPPED` geçirir — yoksa kartlar 238.66 px'e çıkıyordu.
   */
  gridClassName?: string | undefined;
  children: ReactNode;
}) {
  return (
    // Bölüm arası boşluk referanstan: `section { margin-bottom: 40px }`.
    <section aria-label={title} className={`${SECTION_GAP} last:mb-0`}>
      <DiscoveryRowHeader title={title} moreHref={moreHref} />
      <div className={gridClassName ?? DISCOVERY_GRID}>{children}</div>
    </section>
  );
}

/** "GELECEK ANİMELER" bölümünde gösterilen en fazla kart (2 satır × 6 sütun). */
const UPCOMING_CARD_LIMIT = 12;

/** React Query anahtarları: iki bölüm ayrı ayrı ve bağımsız bozulacak şekilde sorgular. */
const ANILIST_UPCOMING_QUERY_KEY = ["home-anilist-upcoming"] as const;
const ANILIST_SCHEDULE_QUERY_KEY = ["home-anilist-schedule"] as const;

/** `/api/anilist?section=upcoming` yanıtındaki kayıt. */
type UpcomingItem = {
  id: number;
  /** MyAnimeList kimliği; `null` ise eşleştirme yapılmaz. */
  malId: number | null;
  title: string;
  english: string | null;
  cover: string;
  /** `YYYY-AA-GG` ya da gün bilinmiyorsa `YYYY-AA`. */
  date: string;
  format: string;
  episodes: number | null;
};

/** `/api/anilist?section=schedule` yanıtındaki tek yayın satırı. */
type ScheduleItem = {
  id: number;
  malId: number | null;
  title: string;
  episode: number | null;
  /** `HH:MM` — İstanbul saati, SUNUCUDA biçimlendirilmiş. */
  time: string;
};

/** Takvimin bir günü. */
type ScheduleDay = { date: string; items: ScheduleItem[] };

/**
 * Sunucu rotasından TEK bir bölümü okur.
 *
 * HATA YUTULUR (bilerek): ağ hatası, 5xx, `ok:false` ya da bozuk gövde → `null`.
 */
async function readAnilist<T>(section: "upcoming" | "schedule"): Promise<T | null> {
  try {
    const response = await fetch(`/api/anilist?section=${section}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!body || typeof body !== "object") return null;
    if ((body as { ok?: unknown }).ok !== true) return null;
    return body as T;
  } catch {
    return null;
  }
}

/** "GELECEK ANİMELER" sorgusu (sunucu önbellekli rota üzerinden). */
function useUpcomingAnime() {
  return useQuery({
    queryKey: ANILIST_UPCOMING_QUERY_KEY,
    queryFn: () => readAnilist<{ ok: true; items: UpcomingItem[] }>("upcoming"),
  });
}

/** Haftalık yayın takvimi sorgusu (sunucu önbellekli rota üzerinden). */
function useWeeklySchedule() {
  return useQuery({
    queryKey: ANILIST_SCHEDULE_QUERY_KEY,
    queryFn: () => readAnilist<{ ok: true; today: string; days: ScheduleDay[] }>("schedule"),
  });
}

/**
 * `idMal` → bizim seri slug'ı indeksi.
 *
 * KAYNAK: sayfada ZATEN yüklü olan seri listesi (`shows`) — EK OKUMA YOKTUR.
 * `mal_id` sayı değilse, 0/negatifse ya da kayıt yoksa eşleştirmeye GİRMEZ.
 */
function useMalIndex(shows: ShowWithImage[]): Map<number, string> {
  return useMemo(() => {
    const index = new Map<number, string>();
    for (const show of shows) {
      const malId = show.mal_id;
      if (!show.id) continue;
      if (typeof malId !== "number" || !Number.isFinite(malId) || malId <= 0) continue;
      index.set(malId, showSlug(show));
    }
    return index;
  }, [shows]);
}

/**
 * `YYYY-AA-GG` / `YYYY-AA` metnini GÜN.AY.YIL biçimine çevirir.
 *
 * Sunucu tarihleri Türkçe kullanıma uygun yazar; bu biçim iki dil için de
 * geçerlidir. Bozuk/eksik parça hiç yazılmaz.
 */
function startDateLabel(date: string): string {
  const [year, month, day] = date.split("-");
  return [day, month, year].filter(Boolean).join(".");
}

/**
 * "GELECEK ANİMELER" kartı: poster + başlık + tarih/biçim/bölüm meta satırı.
 *
 * ÖLÇÜLER diğer poster kartlarıyla birebir aynıdır (5:7 poster, 16 px başlık,
 * 13.5 px meta). Başlık AniList İÇERİĞİDİR: romaji yazılır, arayüz İngilizceyken
 * varsa İngilizce tercih edilir. Eşleşme yoksa kart bağlantısız çizilir.
 */
function UpcomingCard({ item, slug }: { item: UpcomingItem; slug?: string | undefined }) {
  const { lang, t } = useLang();
  const cardClassName =
    "group card-hover relative block overflow-hidden rounded-2xl bg-card shadow-2xl";
  // Başlık: içerik metni (çevrilmez), yalnızca dil tercihiyle romaji/İngilizce seçilir.
  const title = lang === "en" && item.english ? item.english : item.title;
  // Meta: başlangıç tarihi · biçim · bölüm sayısı (sayı dile bağlı, sözlükten).
  const meta = [
    startDateLabel(item.date),
    item.format,
    item.episodes ? plural(t, item.episodes, "home.episodeCountOne", "home.episodeCount") : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const body = (
    <>
      <div className="aspect-[5/7] overflow-hidden bg-muted">
        <img
          src={item.cover}
          alt={t("home.coverAlt", { title })}
          width={768}
          height={1152}
          loading="lazy"
          className="size-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
      </div>
      <div className="px-3 pt-3 pb-2.5">
        <h3 className="truncate text-[16px] font-medium leading-5 text-foreground">{title}</h3>
        <p className="mt-1 line-clamp-2 text-[13.5px] leading-[18px] text-muted-foreground">
          {meta}
        </p>
      </div>
    </>
  );
  // Kataloğumuzda karşılığı yoksa gidilecek YEREL sayfa yoktur: bağlantısız çizilir.
  if (!slug) return <a className={cardClassName}>{body}</a>;
  // Yoğun ızgara → önden çekme KAPALI.
  return (
    <Link to="/anime/$slug" params={{ slug }} preload={false} className={cardClassName}>
      {body}
    </Link>
  );
}

/**
 * Ana kolondaki "GELECEK ANİMELER" bölümü. Veri gelmezse bölüm BAŞLIĞIYLA
 * birlikte hiç çizilmez.
 */
export function UpcomingSection({
  shows,
  gridClassName,
}: {
  shows: ShowWithImage[];
  /** Ana kolon genişliğine göre ızgara sınıfı. */
  gridClassName: string;
}) {
  const { t } = useLang();
  const query = useUpcomingAnime();
  const malIndex = useMalIndex(shows);
  const items = (query.data?.items ?? []).slice(0, UPCOMING_CARD_LIMIT);
  // BOŞ BAŞLIK YOK: veri yoksa/hata varsa hiçbir şey çizilmez.
  if (items.length === 0) return null;
  return (
    <DiscoveryRow title={t("home.upcomingHeading")} gridClassName={gridClassName}>
      {items.map((item) => (
        <UpcomingCard
          key={item.id}
          item={item}
          slug={item.malId === null ? undefined : malIndex.get(item.malId)}
        />
      ))}
    </DiscoveryRow>
  );
}

/**
 * Ana kolondaki "Estimated Schedule" bölümü: 7 günlük yayın takvimi, GÜNE GÖRE
 * GRUPLU.
 *
 * GÜN SEKMELERİ sunucudan gelen gün listesidir (uydurma 7 gün değil); varsayılan
 * gün sunucunun İstanbul saatine göre `today`si, listede yoksa ilk gün.
 *
 * SAAT DİLİMİ: satır saatleri ve gün sınırları SUNUCUDA Europe/Istanbul ile
 * üretilir. İstemci `Intl` ile yalnızca HAFTA GÜNÜ adını yazar.
 *
 * "Now" satırı BİLEREK ÇİZİLMEZ: önbellekli veriyle (TTL 3 saat) canlı saat yan
 * yana konunca "veri de canlı" izlenimi doğardı. YALNIZCA tarayıcının kendi
 * saati yazılır; tazelik iddiası taşımaz.
 */
export function ScheduleSection({ shows }: { shows: ShowWithImage[] }) {
  const { lang, t } = useLang();
  const query = useWeeklySchedule();
  const malIndex = useMalIndex(shows);
  // Kullanıcının seçtiği gün. `null` = seçim yok → sunucunun `today`si açılır.
  // NEDEN `useState` + türetme (effect DEĞİL): veri asenkron geldiği için effect
  // ile senkronlamak fazladan render demekti; değer render sırasında türetilir.
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const days = query.data?.days ?? [];
  const today = query.data?.today ?? "";

  /**
   * CANLI SAAT — panelin alt şeridinde `YYYY/MM/DD HH:mm:ss` (tarayıcının saati).
   */
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  /**
   * GÜN PENCERESİ — şerit 3 gün gösterir, yanlarında oklar.
   * `null` = kullanıcı ok kullanmadı; pencere AKTİF GÜNÜ SONA alacak şekilde kurulur.
   */
  const [dayWindow, setDayWindow] = useState<number | null>(null);

  /**
   * LİSTE AÇ / KAPA — ilk 9 satır gösterilir, `More` kalanı açar (panel
   * referans yüksekliğine oturur ve düğme GERÇEKTEN iş yapar).
   */
  const [expanded, setExpanded] = useState(false);
  const ROW_LIMIT = 9;
  const activeDate =
    pickedDay ?? (days.some((day) => day.date === today) ? today : (days[0]?.date ?? ""));
  const activeDay = days.find((day) => day.date === activeDate);

  // VERİ YOKSA PANEL YOK: başlık, boşluk ve hata kutusu bırakılmaz.
  if (days.length === 0 || !activeDay || activeDay.items.length === 0) return null;

  /**
   * GÜN PENCERESİ (3 kutu) + ok durumları.
   */
  const activeIndex = Math.max(
    0,
    days.findIndex((day) => day.date === activeDate),
  );
  const maxStart = Math.max(0, days.length - 3);
  const startIndex = Math.min(dayWindow ?? Math.max(0, activeIndex - 2), maxStart);
  const windowDays = days.slice(startIndex, startIndex + 3);

  /** Gün kutusunun üst satırı: hafta günü kısaltması (bugünse "Bugün"/"Today"). */
  const dayWeekday = (date: string): string => {
    if (date === today) return t("home.scheduleToday");
    const parsed = new Date(`${date}T12:00:00Z`);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed
      .toLocaleDateString(lang === "en" ? "en-US" : "tr-TR", { weekday: "short" })
      .toUpperCase();
  };

  const pad2 = (value: number): string => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}/${pad2(now.getMonth() + 1)}/${pad2(now.getDate())} ${pad2(
    now.getHours(),
  )}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;

  /**
   * PANEL — "Estimated Schedule" panelinin karşılığı (ölçüler gerçek tarayıcıdan).
   * `More` düğmesi ÇİZİLMEDİ: referansta tam takvim sayfasını açar, bizde o rota
   * yok; ölü düğme yerine hiç konmadı.
   */
  return (
    <div className="relative overflow-hidden rounded-[12px] border border-white/[0.055] bg-[repeating-linear-gradient(-82deg,rgba(255,255,255,0.008)_0px,rgba(255,255,255,0.008)_1px,transparent_1px,transparent_26px),linear-gradient(160deg,#101118,#0b0c11)] p-4 shadow-[0_16px_40px_-18px_rgba(0,0,0,0.9)]">
      {/* KÖŞE SÜSLERİ — `aria-hidden`, tıklamayı engellemez (`pointer-events-none`). */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2 top-2 z-[2] size-3.5 border-l border-t border-white/[0.14]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-2 right-2 size-3.5 border-b border-r border-white/[0.14]"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-[7px] right-[30px] h-3 w-[52px] bg-[repeating-linear-gradient(-82deg,rgba(255,255,255,0.13)_0px,rgba(255,255,255,0.13)_2px,transparent_2px,transparent_9px)]"
      />
      <div className="mb-4 flex items-center justify-between border-b border-white/[0.07] pb-4">
        <button
          type="button"
          onClick={() => setDayWindow(Math.max(0, startIndex - 1))}
          disabled={startIndex === 0}
          aria-label={t("home.schedulePrevDay")}
          className="grid size-9 shrink-0 place-items-center bg-secondary text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={16} />
        </button>
        <div
          role="tablist"
          aria-label={t("home.scheduleDayAria")}
          className="flex items-center gap-4"
        >
          {windowDays.map((day) => {
            const active = day.date === activeDate;
            return (
              <button
                key={day.date}
                type="button"
                role="tab"
                aria-selected={active}
                title={startDateLabel(day.date)}
                onClick={() => setPickedDay(day.date)}
                className="flex flex-col items-center gap-1.5"
              >
                <span
                  className={`text-[10px] font-bold uppercase tracking-[0.5px] ${
                    active ? "text-primary" : "text-muted-foreground"
                  }`}
                >
                  {dayWeekday(day.date)}
                </span>
                <span
                  className={`grid h-[30px] w-16 place-items-center text-sm font-black transition-transform ${
                    active
                      ? "scale-105 bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground/85"
                  }`}
                >
                  {day.date.slice(8, 10)}
                </span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setDayWindow(Math.min(maxStart, startIndex + 1))}
          disabled={startIndex + 3 >= days.length}
          aria-label={t("home.scheduleNextDay")}
          className="grid size-9 shrink-0 place-items-center bg-secondary text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* SATIRLAR — satır 40 px; saat sütunu 48 px sağa dayalı mono; arada 32 px
          ayırıcı hücre (1 px çizgi + çentik); başlık 13.5 px; sağda `EP n` + play
          ikonu (yalnız hover'da). TÜR ETİKETİ ÇİZİLMEDİ (yanıtta alan yok). */}
      <div>
        {(expanded ? activeDay.items : activeDay.items.slice(0, ROW_LIMIT)).map((item) => {
          const slug = item.malId === null ? undefined : malIndex.get(item.malId);
          const rowClassName =
            "group mx-2 mb-2 flex h-10 items-center px-2 transition-colors hover:bg-white/[0.04]";
          const row = (
            <>
              <span className="w-12 shrink-0 text-right font-mono text-[12.5px] font-medium tabular-nums text-foreground/35">
                {item.time}
              </span>
              <span className="relative h-10 w-8 shrink-0">
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-1/2 -ml-px w-px bg-primary/40"
                />
                <span
                  aria-hidden="true"
                  className="absolute left-1/2 top-1/2 z-10 -ml-[2.5px] -mt-px h-px w-[5px] bg-primary/60 transition-all group-hover:-ml-1.5 group-hover:w-3 group-hover:bg-primary"
                />
              </span>
              {/* Başlık AniList İÇERİĞİDİR → bilerek ÇEVRİLMEZ. */}
              <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                {item.title}
              </span>
              {item.episode ? (
                <span className="ml-4 flex shrink-0 items-center gap-1.5 text-muted-foreground">
                  <span className="font-mono text-[11px] font-medium">
                    {t("series.episodeBadge", { number: item.episode })}
                  </span>
                  <Play
                    aria-hidden="true"
                    className="size-3 opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </span>
              ) : null}
            </>
          );
          // Karşılığı olmayan kayıt bağlantısız çizilir (yerel sayfa uydurulmaz).
          return slug ? (
            <Link
              key={`${item.id}-${item.time}`}
              to="/anime/$slug"
              params={{ slug }}
              preload={false}
              className={rowClassName}
            >
              {row}
            </Link>
          ) : (
            <a key={`${item.id}-${item.time}`} className={rowClassName}>
              {row}
            </a>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
        <span className="font-mono text-xs text-muted-foreground">{stamp}</span>
        {/* `More ▾` — yanında chevron-DOWN. */}
        {activeDay.items.length > ROW_LIMIT ? (
          <button
            type="button"
            onClick={() => setExpanded((state) => !state)}
            className="flex items-center gap-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            {expanded ? t("home.scheduleLess") : t("home.scheduleMore")}
            <ChevronDown
              size={14}
              aria-hidden="true"
              className={expanded ? "rotate-180 transition-transform" : "transition-transform"}
            />
          </button>
        ) : null}
      </div>
    </div>
  );
}
