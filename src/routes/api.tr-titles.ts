// /api/tr-titles — Sunucu rotası: acheriya.com'dan bölümlerin TÜRKÇE adlarını çeker.
import { createFileRoute } from "@tanstack/react-router";
import { episodeNumberCandidates, puffySlugCandidates, puffySlugFor } from "@/lib/puffy";
import { cachedRead } from "@/lib/server-cache";
import {
  TR_TITLE_CONCURRENCY,
  TR_TITLE_DELAY_MS,
  TR_TITLE_MAX_EPISODES,
  TR_TITLE_SOURCE,
  TR_TITLE_TTL_SECONDS,
  cleanTurkishEpisodeName,
  episodeNameFromHtml,
  seasonIndexCandidates,
  slugIndexCandidates,
  slugIndexFromSitemap,
  turkishEpisodeUrl,
} from "@/lib/tr-titles";

/**
 * `/api/tr-titles` — bir dizinin/sezonun bölümleri için **Türkçe bölüm adlarını** çözer.
 *
 * NEDEN SUNUCU ROTASI: panel bölümleri ani.zip kataloğundan çekiyor ve katalog adları
 * İNGİLİZCE. Türkçe ad başka bir sitede (acheriya.com) duruyor; o sayfalar tarayıcıdan
 * CORS'suz okunamaz ve panelin işi bu değil — bu yüzden ad çekme işi sunucuda yapılır
 * (aynı desen: `routes/api.anizm.ts`, `routes/api.animecix.ts`).
 *
 * İSTEK: `GET /api/tr-titles?slug=<bizim slug>&numbers=1,2,3[&season=1][&min=1][&puffy=<slug>]`
 * YANIT: bulunanlar `{ number, title }`, bulunamayanlar `{ number, reason }` — uydurma YOK.
 *
 * ── ÖLÇÜM (27.09.2026, bu oturumda CANLI HTTP) ────────────────────────────────
 *   /izle/re-zero-kara-hajimeru-isekai-seikatsu/bolum-1  → 200
 *     "Re:Zero kara Hajimeru Isekai Seikatsu - 1. Bölüm: Başlangıcın Sonu ve Sonun Başlangıcı"
 *   /izle/jujutsu-kaisen/bolum-1                        → 200  ("Jujutsu Kaisen - 1. Bölüm")
 *   /izle/mushoku-tensei-jobless-reincarnation/bolum-2   → 200  ("… - 2. Bölüm: Usta")
 *   /izle/erased/bolum-1                                → 200 ama TVEpisode YOK
 *   /izle/jujutsu-kaisen/bolum-999                      → 200 ama TVEpisode YOK
 *
 * ── KRİTİK: DURUM KODU KANIT DEĞİL ────────────────────────────────────────────
 * acheriya olmayan adreslerde de 200 döndürüyor (sayfa başlığı "Bölüm Bulunamadı").
 * Bu yüzden bir aday/numara yalnızca **JSON-LD'de `TVEpisode` adı varsa** geçerli
 * sayılır; ad çıkmıyorsa "Türkçe ad yok" denir ve İngilizce ada DOKUNULMAZ.
 *
 * ── GİRDİ / ÇIKTI SÖZLEŞMESİ ──────────────────────────────────────────────────
 *
 * ── ADRES (SLUG) MERDİVENİ ────────────────────────────────────────────────────
 * Bizim slug kısa (`re-zero`), kaynağın adresi uzun
 * (`re-zero-kara-hajimeru-isekai-seikatsu`). Sıra:
 *   1) bizim slug, 2) puffytr eşlemesi (`lib/puffy.ts` → `puffySlugFor`), 3) `-tv` eki,
 *   4) sitenin KENDİ dizini (`/sitemap/animes-1.xml`) — bizim slug ile başlayan kayıtlar.
 * 4. adım zorunlu çıktı: `mushoku-tensei` → `mushoku-tensei-jobless-reincarnation`
 * (İngilizce ad) tahminle BULUNAMAZ; ölçüldü. Her aday `bolum-1` çekilerek DOĞRULANIR ve
 * çözülen eşleme BELLEKTE tutulur (aynı seri için merdiven bir kez yürünür).
 *
 * ── NEDEN ÖNBELLEK `cachedRead` ───────────────────────────────────────────────
 * Panel aynı sezonu tekrar tekrar aktarabiliyor; önbellek olmasa her aktarım bölüm
 * başına bir istek demek olurdu. `cachedRead` sayesinde **bölüm başına TTL'de bir**
 * upstream isteği yapılır (sayfa görüntülemesiyle ALAKASI yok). TTL seçimi ve neden:
 * `lib/tr-titles.ts` → `TR_TITLE_TTL_SECONDS` (30 gün; adlar değişmez).
 * HTTP ≠ 200'de `load()` HATA FIRLATIR: `server-cache` hataları önbelleğe yazmaz,
 * yani geçici bir kesinti 30 gün boyunca "ad yok" olarak donmaz.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Sitenin kendi dizi dizini (uydurma değil, kaynağın kendi listesi). */
const SITEMAP_URL = `${TR_TITLE_SOURCE}/sitemap/animes-1.xml`;

/** Bellek notu ömrü: ağ isteği tekrarlanmasın, ama kalıcı yanlış da donmasın. */
const MEMO_MS = 24 * 60 * 60 * 1000;

/** Dizi → çözülen taban adres (1. sezonun adresi) + denenen adaylar. */
const baseSlugMemo = new Map<string, { slug: string; tried: string[]; expiresAt: number }>();

/** (Dizi + sezon) → çözülen sezon adresi. */
const seasonSlugMemo = new Map<string, { slug: string; tried: string[]; expiresAt: number }>();

/** Site dizini (sitemap) bellek kopyası — isolate başına en fazla bir istek. */
let slugIndexMemo: { slugs: string[]; expiresAt: number } | null = null;

/** Tek bir sayfayı (önbellekli) çeker. HTTP ≠ 200 ise hata fırlatır → önbelleğe yazılmaz. */
async function episodePageHtml(slug: string, number: string): Promise<string> {
  return cachedRead(`tr-titles:ep:${slug}:${number}`, TR_TITLE_TTL_SECONDS, async () => {
    const res = await fetch(turkishEpisodeUrl(slug, number), {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      redirect: "follow",
    });
    // HATA ÖNBELLEĞE YAZILMASIN: `cachedRead` yalnızca BAŞARILI sonucu saklar (bkz.
    // `lib/server-cache.ts`); bu yüzden geçici 5xx için `throw` etmek İSTENEN davranıştır.
    if (res.status !== 200) throw new Error(`bölüm sayfası ${res.status}`);
    return await res.text();
  });
}

/**
 * Sayfadaki JSON-LD `TVEpisode` adı (yoksa `""`).
 *
 * `""` = "bu adreste bölüm kaydı yok": hem geçersiz adres hem gerçekten olmayan bölüm
 * hem de bölüm sayfası olup TVEpisode taşımayan hâl buraya düşer. Karar bu yüzden
 * DURUM KODUNA değil İÇERİĞE dayanır (kritik ölçüm: yukarıdaki dosya notu).
 */
async function probeEpisodeName(slug: string, number: string): Promise<string> {
  return episodeNameFromHtml(await episodePageHtml(slug, number));
}

/** Site dizinini (sitemap) okur; bellek kopyası tazeyse ağa GİDİLMEZ. */
async function readSlugIndex(): Promise<string[]> {
  const now = Date.now();
  if (slugIndexMemo && slugIndexMemo.expiresAt > now) return slugIndexMemo.slugs;
  const res = await fetch(SITEMAP_URL, {
    headers: { "User-Agent": UA, Accept: "application/xml,text/xml,*/*" },
    redirect: "follow",
  });
  if (res.status !== 200) throw new Error(`site dizini ${res.status}`);
  const slugs = slugIndexFromSitemap(await res.text());
  slugIndexMemo = { slugs, expiresAt: now + MEMO_MS };
  return slugs;
}

/** Aday listesindeki İLK geçerli adresi döner (her aday `bolum-1` ile doğrulanır). */
async function firstWorkingSlug(tried: string[], candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    if (tried.includes(candidate)) continue;
    tried.push(candidate);
    try {
      if (await probeEpisodeName(candidate, "1")) return candidate;
    } catch {
      // Ağ/HTTP hatası: aday elenir, sıradakine geçilir (sebep çağırana `tried` ile gider).
    }
  }
  return "";
}

/**
 * Dizinin KENDİ adresini (düz kayıt = 1. sezon) çözer ve bellekten hatırlar.
 *
 * NEDEN 1. SEZON: sezon ekleri seriden seriye değişiyor; düz kayıt ise her zaman
 * dizinin temel adresidir. Sezon > 1 için bu temelden türetilen ekler denenir
 * (`puffySlugCandidates`, ölçülmüş yazımlar).
 */
async function resolveBaseSlug(
  showSlug: string,
  puffySlug: string,
): Promise<{ slug: string; tried: string[]; bases: string[] }> {
  const now = Date.now();
  const memo = baseSlugMemo.get(showSlug);
  /**
   * `bases` ÖNBELLEKTEN DE döner: sezon adresi çözücüsü (`resolveSeasonSlug`) dizin
   * aramasını bu tabanlar üzerinden yapar; önbellekten dönerken boş liste vermek
   * sezon çözümünü ilk çağrıdan sonra sessizce bozardı.
   */
  const explicit = explicitBases(showSlug, puffySlug);
  if (memo && memo.expiresAt > now) {
    return { slug: memo.slug, tried: memo.tried, bases: explicit };
  }

  const tried: string[] = [];
  // 1-3) Açık adaylar: bizim slug → puffytr eşlemesi → `-tv` eki.
  let slug = await firstWorkingSlug(tried, explicit);

  // 4) Sitenin kendi dizini: adres tahminle bulunamıyorsa (ölçüm: mushoku-tensei).
  if (!slug) {
    try {
      slug = await firstWorkingSlug(tried, slugIndexCandidates(await readSlugIndex(), explicit));
    } catch {
      // Dizin okunamadı: aday yok sayılır, çağıran `tried` ile durumu raporlar.
    }
  }

  baseSlugMemo.set(showSlug, { slug, tried, expiresAt: now + MEMO_MS });
  return { slug, tried, bases: explicit };
}

/**
 * Adres merdiveninin TABAN adayları: bizim slug → puffytr eşlemesi → `-tv` eki.
 *
 * TEK YERDE: hem düz kaydın çözümü (`resolveBaseSlug`) hem de SEZON adresinin dizin
 * araması (`resolveSeasonSlug`) aynı tabanları kullanır. İki kopya yazılınca biri
 * güncellenip öteki unutuluyordu.
 */
function explicitBases(showSlug: string, puffySlug: string): string[] {
  return [showSlug, puffySlug, `${showSlug}-tv`]
    .map((value) => value.trim())
    .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
}

/**
 * Hedef SEZONUN adresini çözer.
 *
 * NEDEN AYRI: kaynak her sezonu ayrı sayfada tutuyor (ölçüldü:
 * `…-2nd-season/bolum-1` = 2. sezonun 1. bölümü). Sezon 1'de taban adresin kendisi
 * kullanılır; sezon > 1'de `puffySlugCandidates` ile üretilen sezon ekleri denenir ve
 * İSTENEN bölümü veren ilk adres kabul edilir. Hiçbiri doğrulanmazsa çağıran sezon
 * adresi yok der → o sezona Türkçe ad YAZILMAZ (yanlış sezonun adı yazılmaz).
 *
 * @param probeNumber isteğin en küçük bölüm numarasının KAYNAKTAKİ karşılığı (1 tabanlı).
 * @param bases       dizin aramasında kullanılacak TABAN adaylar (`explicitBases`).
 *                    NEDEN GEREKLİ: sezon eki tabanın SONUNA gelmiyor olabilir — ölçüm:
 *                    `mushoku-tensei-ii-isekai-ittara-honki-dasu-shugo-jutsushi-fitz`
 *                    (taban `mushoku-tensei`). Yalnızca çözülen tabanı (`…-jobless-
 *                    reincarnation`) kullanmak bu kaydı hiç göremezdi.
 */
async function resolveSeasonSlug(
  showSlug: string,
  baseSlug: string,
  season: number,
  probeNumber: string,
  bases: string[],
): Promise<{ slug: string; tried: string[] }> {
  if (!Number.isFinite(season) || season <= 1) return { slug: baseSlug, tried: [] };

  const memoKey = `${showSlug}:s${season}`;
  const now = Date.now();
  const memo = seasonSlugMemo.get(memoKey);
  if (memo && memo.expiresAt > now) return { slug: memo.slug, tried: memo.tried };

  const tried: string[] = [];
  let slug = "";
  /** Kalıpla türetilen adaylar (kanıtlanmış sıra: `-2nd-season`, `-2-sezon`…). */
  for (const candidate of puffySlugCandidates(baseSlug, season)) {
    tried.push(candidate);
    try {
      if (await probeEpisodeName(candidate, probeNumber)) {
        slug = candidate;
        break;
      }
    } catch {
      // Aday elendi (ağ/HTTP); sıradaki denenir.
    }
  }

  /**
   * Kalıp tutmadıysa KAYNAĞIN KENDİ dizinine bakılır (bkz. `lib/tr-titles.ts`
   * → `seasonIndexCandidates`). ÖLÇÜM (27.09.2026): `mushoku-tensei` 2. sezon
   * kaynakta `…-ii-…`, 3. sezon `…-s3`; hiçbiri kalıpla üretilemiyordu ve Türkçe
   * adlar bu yüzden sessizce boş kalıyordu. Dizin 121 KB'lık dizi listesidir ve
   * 24 saat bellekte tutulur; bölüm dizinleri (~12 MB) BİLEREK kullanılmaz.
   */
  if (!slug) {
    try {
      const index = await readSlugIndex();
      for (const candidate of seasonIndexCandidates(index, bases, season)) {
        if (tried.includes(candidate)) continue;
        tried.push(candidate);
        try {
          if (await probeEpisodeName(candidate, probeNumber)) {
            slug = candidate;
            break;
          }
        } catch {
          // Aday elendi (ağ/HTTP); sıradaki denenir.
        }
      }
    } catch {
      // Dizin okunamadı: kalıp denemeleriyle yetinilir, çağıran `tried` ile raporlar.
    }
  }

  seasonSlugMemo.set(memoKey, { slug, tried, expiresAt: now + MEMO_MS });
  return { slug, tried };
}

/** Küçük yardımcı: pozitif tam sayı parametresi (geçersizse varsayılan). */
function positiveInt(raw: string | null, fallback: number): number {
  const value = Number.parseInt((raw ?? "").trim(), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Kısa bekleme (kaynağı yormamak için gruplar arasında). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const Route = createFileRoute("/api/tr-titles")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const showSlug = (params.get("slug") ?? "").trim();
        const season = positiveInt(params.get("season"), 1);
        const seasonMin = positiveInt(params.get("min"), 1);
        /**
         * `puffy`: panelin kullandığı puffytr adresi. Verilmezse `lib/puffy.ts`
         * eşlemesinden türetilir — böylece rota tek başına da çağrılabilir.
         */
        const puffySlug = (params.get("puffy") ?? "").trim() || puffySlugFor(showSlug);

        const fail = (reason: string, tried: string[] = [], status = 200) =>
          Response.json(
            { ok: false, reason, tried },
            { status, headers: { "Cache-Control": "no-store" } },
          );

        if (!showSlug) return fail("slug parametresi gerekli (bizim seri adresimiz)");

        // Bölüm numaraları: virgül/boşlukla ayrılmış liste; etkin (filtrele) ve sıralı.
        const numbers = [
          ...new Set(
            (params.get("numbers") ?? "")
              .split(/[,;\s]+/)
              .map((value) => Number.parseFloat(value.trim()))
              .filter((value) => Number.isFinite(value) && value > 0),
          ),
        ].sort((a, b) => a - b);

        if (numbers.length === 0) return fail("numbers parametresi gerekli (bölüm numaraları)");
        if (numbers.length > TR_TITLE_MAX_EPISODES)
          return fail(
            `en fazla ${TR_TITLE_MAX_EPISODES} bölüm sorulabilir (istenen: ${numbers.length})`,
          );

        try {
          // 1) Dizinin kaynaktaki adresi (merdiven + bellek).
          const base = await resolveBaseSlug(showSlug, puffySlug);
          if (!base.slug)
            return fail(
              `${TR_TITLE_SOURCE} üzerinde bu dizinin adresi bulunamadı (denenen adayların hiçbiri bölüm sayfası vermedi)`,
              base.tried,
            );

          /**
           * 2) Sezon adresi. Doğrulama numarası İSTENEN en küçük bölümün kaynaktaki
           * karşılığıdır: kaynak sezonları 1'den numaralandırıyor (ölçüldü), bizim
           * numaramız ise katalogdan bazen seri geneli geliyor (12…23 gibi) → `min`
           * ile kaydırılır; kaydırma yoksa (`min = 1`) sayı birebir aynı kalır.
           */
          const first = numbers[0] ?? 1;
          const probeNumber =
            episodeNumberCandidates(String(first), seasonMin, Number.NaN)[0] ?? String(first);
          const seasonSlug = await resolveSeasonSlug(
            showSlug,
            base.slug,
            season,
            probeNumber,
            base.bases,
          );
          if (!seasonSlug.slug)
            return fail(
              `${season}. sezonun adresi bulunamadı (kaynak her sezonu ayrı sayfada tutuyor)`,
              [...base.tried, ...seasonSlug.tried],
            );

          /**
           * 3) Bölüm başına Türkçe ad. Eşzamanlılık `TR_TITLE_CONCURRENCY`, gruplar
           * arasında `TR_TITLE_DELAY_MS` bekleme: sıralı çekim HTTP rotasını zaman
           * aşımına yaklaştırıyordu, sınırsız paralellik kaynağa vurgun olurdu.
           */
          const found: { number: number; title: string }[] = [];
          const missing: { number: number; reason: string }[] = [];

          /** Tek bölüm: aday numaralar SIRAYLA denenir (hepsi AYNI sezon sayfasına bakar). */
          async function one(number: number): Promise<void> {
            let reason = "bölüm sayfası yok (kaynakta bu numara bulunamadı)";
            for (const candidate of episodeNumberCandidates(
              String(number),
              seasonMin,
              Number.NaN,
            )) {
              try {
                const raw = await probeEpisodeName(seasonSlug.slug, candidate);
                if (!raw) {
                  // Sayfa var ama bölüm kaydı yok: sıradaki numara adayı denenir.
                  reason = "bölüm sayfası yok (kaynakta bu numara bulunamadı)";
                  continue;
                }
                const title = cleanTurkishEpisodeName(raw);
                if (title) {
                  found.push({ number, title });
                  return;
                }
                // Ad var ama içinde bölüm adı YOK (ör. "Jujutsu Kaisen - 1. Bölüm"):
                // uydurulmaz, dürüstçe bildirilir.
                missing.push({
                  number,
                  reason: 'kaynakta bölüm adı yazılmamış (ad yalnızca "N. Bölüm")',
                });
                return;
              } catch (error) {
                reason = error instanceof Error ? error.message : String(error);
              }
            }
            missing.push({ number, reason });
          }

          for (let index = 0; index < numbers.length; index += TR_TITLE_CONCURRENCY) {
            const chunk = numbers.slice(index, index + TR_TITLE_CONCURRENCY);
            await Promise.all(chunk.map((number) => one(number)));
            if (index + TR_TITLE_CONCURRENCY < numbers.length) await sleep(TR_TITLE_DELAY_MS);
          }

          found.sort((a, b) => a.number - b.number);
          missing.sort((a, b) => a.number - b.number);

          return Response.json(
            {
              ok: true,
              source: TR_TITLE_SOURCE,
              // Çözülen adresler: panel "hangi adresten okundu" bilgisini gösterebilsin.
              baseSlug: base.slug,
              slug: seasonSlug.slug,
              tried: [...base.tried, ...seasonSlug.tried],
              requested: numbers.length,
              found,
              missing,
            },
            // Adlar bölüm başına sabittir; kısa süre CDN'de tutulabilir.
            { headers: { "Cache-Control": "public, max-age=3600" } },
          );
        } catch (error) {
          return fail(
            `Türkçe adlar alınamadı: ${error instanceof Error ? error.message : String(error)}`,
            [],
            // Kaynak erişilemezse çağıran bunu "hata" olarak görür; 500 döndürmek yerine
            // 200 + ok:false tercih edilir (mevcut rotalarla aynı sözleşme).
            200,
          );
        }
      },
    },
  },
});
