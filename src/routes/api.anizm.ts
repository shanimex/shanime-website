// /api/anizm — Sunucu rotası: anizm/puffytr zincirinden bölüm oynatıcı adresi çözer.
import { createFileRoute } from "@tanstack/react-router";
import {
  ANIZM_PLAYER_RE,
  episodeNumberCandidates,
  networkSeasonCandidates,
  puffySlugCandidates,
  type NetworkEntry,
} from "@/lib/puffy";
import { cachedRead } from "@/lib/server-cache";

/**
 * `/api/anizm` — bir bölümün **Anizm (puffytr) oynatıcı adresini** çözer.
 *
 * NEDEN SUNUCU GEREKLİ: hash bölüme özel ve puffytr'ın sarmalayıcısı
 * (`puffytr.com/player/<id>`) **referer korumalı** — referer'sız 404, yalnızca
 * `Referer: https://puffytr.com/` ile 302. `Referer` tarayıcıda ayarlanamayan bir
 * başlık olduğu için bu iş tarayıcıdan YAPILAMIYOR (CORS da ayrıca kapalı).
 * Panel "Anizm kaydı YOK" diyordu; kök sebep buydu — kayıt yoktu, ÇÖZEN yoktu.
 * Artık çözen sunucu tarafı var: panel bu rotayı çağırıp gerçek adresi alıyor.
 *
 * AKIŞ (betikteki zincirin birebir aynısı — `scripts/resolve-anizm-hashes.mjs`):
 *   1) GET /{slug}                          → bölüm linkleri ({slug}-{n}-bolum…-izle)
 *   2) GET <bölüm sayfası>                  → episode/<id> + translator/<tid>
 *   3) GET /episode/<id>/translator/<tid>   → sunucu listesi (video/<vid>)
 *   4) HEAD /player/<vid>  (Referer)        → 302 → anizmplayer.com/video/<hash>
 *
 * ÖNEMLİ AYRINTILAR (hepsi sahada yaşanmış hatalardan):
 *   · Bölüm linki deseni DAR OLMAMALI: son bölümler `-bolum-final-izle` biçiminde.
 *   · Adres YENİDEN KURULMAMALI: yakalanan yol olduğu gibi kullanılır (`-final` düşmesin).
 *   · `-final-izle` sayfaları 302 ile kanonik adrese gider → yönlendirme TAKİP EDİLİR.
 *   · 3. adımın gövdesi JSON'dur ve HTML'i kaçışlıdır → önce `JSON.parse`, sonra desen.
 *   · Numara tam sayı olmayabilir (puffytr "1a", "1b" kullanıyor) → `number` metin.
 *
 * ── BÖLÜM NUMARASI KAYMASI (27.09.2026 düzeltmesi) ─────────────────────────────
 * puffytr bir sezonu HER ZAMAN 1'den numaralandırır; bizim numaramız ise katalogdan
 * (ani.zip) geldiği için bazen seri geneli (mutlak) olur. Canlı ölçüm: Re:Zero
 * 2. sezon sayfası (`…-2-sezon`) 200 döndü ve bölümleri 1..13; bizim ekranda ise
 * aynı sezon 12…23 idi. Çözücü HAM numarayı istediği için 13..23 çözülemiyor ve
 * sebep her bölüm için tekrarlanıyordu. Artık çağıran `min` (sezonun en küçük
 * bölüm numarası) gönderir; sunucu SEZONA GÖRE numarayı (12…23 → 1…12) ve ham
 * numarayı ADAY olarak sırayla dener (`lib/puffy.ts` → `episodeNumberCandidates`).
 * `min` verilmezse 1 varsayılır → 1 tabanlı sezonlarda davranış BİREBİR aynı kalır.
 *
 * ── ADRES ÇÖZÜLEMEZSE SESSİZ KALMAZ (27.09.2026 düzeltmesi) ────────────────────
 * `puffySlugForSeason` tek bir kalıp üretir (`-2nd-season`) ama puffytr sezon
 * adlandırmasını seriden seriye değiştiriyor: Re:Zero'da `-2nd-season` sayfası
 * YOK (302 → /notfound). Bu yüzden artık:
 *   · `base` + `season` verilirse ADAY adresler denenir (`puffySlugCandidates`) ve
 *     İSTENEN BÖLÜM NUMARASINI veren ilk adres kullanılır; yanıtta `slug` alanı
 *     gerçekte kullanılan adresi söyler,
 *   · `number` boş bırakılabilir: yalnızca adres geçerliliği denetlenir (panel
 *     adresi SEZON BAŞINA BİR KEZ doğrular, 26 bölüm için 26 kez denemez),
 *   · başarısızlıkta `reason` + `tried` döner. Böylece çağıran taraf "hangi
 *     adresler denendi, neden olmadı" bilgisini kullanıcıya AYNEN gösterebilir;
 *     hata yutulmaz (eskiden panel bunu yalnızca TOAST'a yazıp siliyordu).
 *
 * ── AĞ DİZİNİ: "HER SEFERİNDE ADRES Mİ YAPIŞTIRACAĞIM?" (27.09.2026) ───────────
 * Kullanıcı haklıydı: kalıp adresler tutmadığında panel elle puffytr adresi
 * istiyordu ve bu HER YENİ SEZONDA tekrarlanıyordu. Kalıpla bulunamayan gerçek
 * örnek: Mushoku Tensei 3. sezon → ağdaki adres `mushoku-tensei-iii-isekai-ittara-
 * honki-dasu` (kalıp `…-3rd-season` vb. deniyor, hepsi 302).
 *
 * Artık kalıp adreslerden sonra İKİ SİNYAL daha denenir (hepsi opsiyonel parametre):
 *   · `show` : bizim slug'ımız → AĞ DİZİNİNDE adres ailesi (`lib/puffy.ts` →
 *     `networkSeasonCandidates`); ağ sezon işaretini adresin ortasına koyabiliyor.
 *   · `title` + `mal` : bizim başlığımız ve MAL kimliği → AniList romaji/eşanlamlı
 *     adları ağın dizi ADIYLA eşleştirilir. Ölçüm: bizim `erased` ↔ ağın
 *     `boku-dake-ga-inai-machi` (slug'lar tamamen alakasız; yalnızca ad eşleşmesi
 *     bulur — 27.09.2026 canlı testte doğrulandı).
 *
 * Dizin `puffytr.com/sitemaps` → `sitemap/seriler/0` (4849 kayıt, ~2 MB) 24 saat
 * önbelleklenir ve YALNIZCA kalıp adresler tükendiğinde okunur; böylece her
 * çözümleme için 2 MB indirilmez. Bulunan aday YİNE bölüm sayfası çekilerek
 * doğrulanır — yani "bulundu" demek "bölümü gerçekten var" demektir.
 */

/** Üst kaynak isteği için üst sınır süre (ms) — askıda kalan istek olmasın. */
const UPSTREAM_TIMEOUT_MS = 12_000;

const PUFFY = "https://puffytr.com";
const REFERER = `${PUFFY}/`;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

type Fetched = { status: number; location: string; body: string };

/** Yönlendirmeyi elle takip eden istek (302'nin `location`'ı okunabilsin). */
async function get(
  url: string,
  options: { method?: string; referer?: string; follow?: number } = {},
): Promise<Fetched> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    "User-Agent": UA,
    Accept: "text/html,application/json,*/*",
  };
  if (options.referer) headers["Referer"] = options.referer;
  /**
   * ÜST SINIR SÜRE (zorunlu). NEDEN: kaynak sunucu bir isteği askıda bırakırsa
   * bizim isteğimiz de süresiz açık kalıyordu; panelde "hiç bitmeyen yükleme" ve
   * iptal edilen isteklerden doğan gürültü (dev'de `read ECONNRESET` katmanı) böyle
   * oluşuyordu. 12 sn, gerçek bir yanıt için bolca yeter; aşılırsa hata AÇIKÇA
   * raporlanır ve akış durmaz (çağıran aday adayı sırayla denemeye devam eder).
   */
  const res = await fetch(url, {
    method,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const location = res.headers.get("location") ?? "";
  const redirected = [301, 302, 303, 307, 308].includes(res.status) && location !== "";
  if ((options.follow ?? 0) > 0 && redirected) {
    return get(new URL(location, url).toString(), {
      ...options,
      follow: (options.follow ?? 0) - 1,
    });
  }
  return { status: res.status, location, body: method === "HEAD" ? "" : await res.text() };
}

/**
 * ── AĞ DİZİNİ (KALICI ÇÖZÜM, 27.09.2026) ──────────────────────────────────────
 *
 * NEDEN: sezon adresleri kalıpla türetilemiyor ve kullanıcı haklı olarak "her yeni
 * anime/sezon için adresi ben mi yapıştıracağım?" diye sordu. Ağ kendi dizinini
 * yayınlıyor; adresi TAHMİN ETMEK yerine dizinden BULUYORUZ.
 *
 * ÖLÇÜM (27.09.2026, canlı):
 *   GET /sitemaps                    → sitemap dizini (254 kayıt) içinde
 *                                      `sitemap/seriler/0` var
 *   GET /sitemap/seriler/0           → 4849 <url>, her birinde `<loc>` (adres) ve
 *                                      `<image:title>` (ağın dizi adı) — ~2 MB
 *   Örnek: /mushoku-tensei-iii-isekai-ittara-honki-dasu
 *          "Mushoku Tensei III: Isekai Ittara Honki Dasu"
 *
 * TTL 24 saat: dizi listesi gün içinde anlamlı değişmez; 2 MB'lık indirme günde bir
 * kez yapılır ve sonuç (ayrıştırılmış hâlde) önbellekte tutulur.
 */
const SITEMAP_INDEX_URL = `${PUFFY}/sitemaps`;
const INDEX_TTL_SECONDS = 24 * 60 * 60;

/** AniList GraphQL: MAL kimliğinden dizi adları (romaji/İngilizce/eşanlamlı). */
const ANILIST_ENDPOINT = "https://graphql.anilist.co";
const ANILIST_TITLE_TTL_SECONDS = 30 * 24 * 60 * 60;

/** XML varlıklarını çözer (`&amp;` gibi ad kalıntıları). */
function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** Ağ dizinini (sitemap) indirir ve `{slug, title}` listesine çevirir. */
async function fetchNetworkIndex(): Promise<NetworkEntry[]> {
  const indexPage = await get(SITEMAP_INDEX_URL, { referer: REFERER });
  if (indexPage.status !== 200) throw new Error(`sitemap dizini ${indexPage.status}`);
  const files = [...indexPage.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)]
    .map((match) => match[1] ?? "")
    .filter((url) => /\/sitemap\/seriler\/\d+$/.test(url));

  const out: NetworkEntry[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const page = await get(file, { referer: REFERER });
    if (page.status !== 200) continue;
    for (const match of page.body.matchAll(/<url>[\s\S]*?<\/url>/g)) {
      const block = match[0];
      const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/.exec(block)?.[1] ?? "";
      const slug = loc.replace(`${PUFFY}/`, "").trim();
      // Bölüm/kategori adresleri burada İSTENMEZ; yalnızca dizi kök adresleri.
      if (!slug || slug.includes("/") || seen.has(slug)) continue;
      seen.add(slug);
      const title = decodeXml(/<image:title>([\s\S]*?)<\/image:title>/.exec(block)?.[1] ?? "");
      out.push({ slug, title });
    }
  }
  if (out.length === 0) throw new Error("ağ dizini boş döndü");
  return out;
}

/**
 * Ağ dizini — 24 saat önbellekli (hata önbelleğe yazılmaz, bkz. server-cache).
 *
 * ── NEDEN AYRICA ISITICI İÇİ MEMO (ölçüm 30.09.2026) ─────────────────────────
 * `cachedRead` GELİŞTİRME modunda bilerek tamamen atlanır (panelden yapılan
 * değişiklik anında görünsün diye). Bu kural BİZİM veritabanımız için doğru; ama bu
 * dizin DIŞ bir kaynaktan geliyor ve 2 MB. Sonuç: panelde başka bir sezon açıldığında
 * dev sunucusu dizini YENİDEN indiriyordu — ölçüm: tek çağrı 4,3 sn. Uzun süren bu
 * istekler tarayıcı tarafından iptal edilince dev sunucusunda `read ECONNRESET`
 * hatası (kırmızı hata katmanı) çıkıyordu — kullanıcının bildirdiği ekran. Tazelik
 * kaygısı OLMAYAN bu dış veri artık ortamdan bağımsız olarak ısıtıcı içinde kısa süre
 * hatırlanır: davranış değişmez, aynı dizin tekrar tekrar indirilmez.
 */
const INDEX_MEMO_MS = 30 * 60 * 1000;
let indexMemo: { value: NetworkEntry[]; expiresAt: number } | null = null;

async function readNetworkIndex(): Promise<NetworkEntry[]> {
  const now = Date.now();
  if (indexMemo && indexMemo.expiresAt > now) return indexMemo.value;
  const value = await cachedRead("puffy:network-index", INDEX_TTL_SECONDS, fetchNetworkIndex);
  // Hata hâlinde buraya gelinmez (cachedRead reddeder) → bozuk sonuç hatırlanmaz.
  indexMemo = { value, expiresAt: now + INDEX_MEMO_MS };
  return value;
}

/**
 * MAL kimliğinden dizi ADLARINI alır (romaji/İngilizce/eşanlamlı).
 *
 * NEDEN GEREKLİ: ağdaki adlar romaji ("Boku dake ga Inai Machi"), bizim paneldeki
 * başlık ise İngilizce olabiliyor ("Erased"). Romaji adı bilmeden ad eşleşmesi
 * kurulamaz. AniList `idMal` ile bu adları veriyor; sonuç 30 gün hatırlanır
 * (başlıklar değişmez) ve hata durumunda boş liste döner — çözümleme DURMAZ,
 * yalnızca ad eşleşmesi yolu kapanır.
 */
async function fetchAniListTitles(malId: number): Promise<string[]> {
  const res = await fetch(ANILIST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      query: "query($id:Int){Media(idMal:$id,type:ANIME){title{romaji english native} synonyms}}",
      variables: { id: malId },
    }),
  });
  if (res.status !== 200) return [];
  const json = (await res.json()) as {
    data?: { Media?: { title?: Record<string, string>; synonyms?: string[] } };
  };
  const media = json.data?.Media;
  if (!media) return [];
  const titles = media.title ?? {};
  return [titles["romaji"], titles["english"], titles["native"], ...(media.synonyms ?? [])]
    .map((value) => (value ?? "").trim())
    .filter(Boolean);
}

/** Dizi sayfasından `bölüm anahtarı → bölüm adresi` haritası. */
function episodeLinks(html: string, slug: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = new RegExp(
    `href="(?:https://puffytr\\.com)?/(${slug}-(\\d+[a-z]?)-bolum(?:-[a-z0-9]+)*?-izle)"`,
    "g",
  );
  for (const match of html.matchAll(re)) map.set(match[2] ?? "", `${PUFFY}/${match[1]}`);
  return map;
}

/** Tek bir adres denemesinin sonucu. */
type Attempt =
  | { ok: true; url: string; server: string }
  | {
      ok: false;
      reason: string;
      /** Kaynakta aranan numara adayları (yalnızca "bölüm yok" hâlinde dolar). */
      numbers?: string[];
    };

/**
 * Verilen puffytr dizi adresinden tek bir bölümü çözer.
 *
 * `number === ""` ise YALNIZCA adresin geçerliliği denetlenir (dizi sayfası 200 ve
 * en az bir bölüm linki var mı) — panel adresi bir kez doğrulayıp tüm sezonu o
 * adresle yazmak istiyor; 26 bölüm için 26 kez aday denemesi yapılmasın diye.
 *
 * `seasonMin`: sezonun en küçük bölüm numarası (bizim verimizden). Kaymış
 * numaralandırmayı (12…23) kaynağın 1 tabanlı numarasına çevirebilmek için gerekir;
 * verilmezse 1 varsayılır ve 1 tabanlı sezonlarda davranış aynı kalır.
 */
async function resolveFromSlug(slug: string, number: string, seasonMin: number): Promise<Attempt> {
  // 1) Dizi sayfası → bölüm adresi
  const series = await get(`${PUFFY}/${slug}`, { referer: REFERER, follow: 2 });
  if (series.status !== 200)
    return { ok: false, reason: `dizi sayfası ${series.status} (slug: ${slug})` };
  const links = episodeLinks(series.body, slug);
  if (links.size === 0) return { ok: false, reason: `bölüm linki bulunamadı (slug: ${slug})` };
  if (!number) return { ok: true, url: "", server: `${links.size} bölüm` };

  const keys = [...links.keys()].sort(
    (a, b) => Number.parseFloat(a) - Number.parseFloat(b) || a.localeCompare(b),
  );
  // Sayfanın İLK bölüm numarası: "aynı numaralandırma mı" kararı SEZON GENELİ için
  // buradan verilir (bkz. episodeNumberCandidates).
  const pageFirst = Number.parseFloat(keys[0] ?? "");
  // `keys.length` (sayfanın bölüm SAYISI) → önceki-cour eleme sinyali (bkz. puffy.ts
  // → "ÖNCEKİ COUR TUZAĞI"). Böylece bir part sezonunda yanlış cour sayfası erken
  // "başarılı" sayılıp mutlak 12 → 1. bölüm hatası (29.09.2026 regresyonu) oluşmaz.
  const candidates = episodeNumberCandidates(number, seasonMin, pageFirst, keys.length);

  let episodeUrl = "";
  for (const candidate of candidates) {
    episodeUrl = links.get(candidate) ?? "";
    if (episodeUrl) break;
    // İstenen numara yoksa: sıralı konum üzerinden dene (puffytr bazı dizilerde
    // "1a/1b" kullanıyor, tam eşleşme tutmayabilir).
    const index = Number.parseInt(candidate, 10) - 1;
    if (Number.isFinite(index) && index >= 0 && index < keys.length) {
      episodeUrl = links.get(keys[index] ?? "") ?? "";
      if (episodeUrl) break;
    }
  }
  if (!episodeUrl)
    return { ok: false, reason: `puffytr'da ${number}. bölüm yok`, numbers: candidates };

  // 2) Bölüm sayfası → episode/translator kimlikleri
  const page = await get(episodeUrl, { referer: REFERER, follow: 2 });
  if (page.status !== 200) return { ok: false, reason: `bölüm sayfası ${page.status}` };
  const episodeId = /episode\/(\d+)/.exec(page.body)?.[1];
  const translatorId = /translator\/(\d+)/.exec(page.body)?.[1];
  if (!episodeId || !translatorId)
    return { ok: false, reason: "episode/translator kimliği bulunamadı" };

  // 3) Sunucu listesi (JSON, içindeki HTML kaçışlı)
  const list = await get(`${PUFFY}/episode/${episodeId}/translator/${translatorId}`, {
    referer: REFERER,
  });
  if (list.status !== 200) return { ok: false, reason: `sunucu listesi ${list.status}` };
  const markup = (() => {
    try {
      return String((JSON.parse(list.body) as { data?: unknown }).data ?? "");
    } catch {
      return "";
    }
  })();
  const servers = [
    ...markup.matchAll(
      /video="https:\/\/puffytr\.com\/video\/(\d+)"[^>]*?data-video-name="([^"]*)"/g,
    ),
  ].map((match) => ({ id: match[1] ?? "", name: match[2] ?? "" }));
  if (servers.length === 0) return { ok: false, reason: "sunucu bulunamadı" };

  // 4) Sunucu → anizmplayer hash'i ("Aincrad" önce denenir: reklamsız sunucu)
  const ordered = [
    ...servers.filter((server) => /aincrad/i.test(server.name)),
    ...servers.filter((server) => !/aincrad/i.test(server.name)),
  ];
  for (const server of ordered) {
    const head = await get(`${PUFFY}/player/${server.id}`, {
      method: "HEAD",
      referer: REFERER,
    });
    const match = /anizmplayer\.com\/video\/([0-9a-f]{16,})/i.exec(head.location);
    const url = match ? `https://anizmplayer.com/video/${match[1]}` : "";
    // ⚠️ Sağlayıcı bu adresi YALNIZCA `Referer: anizm.net/puffytr.com` ile verir;
    // bizim origin'imizden 403 döner (ölçüm 08.10.2026 — hem oynatıcı hem `/cdn/`).
    // Bu yüzden DOĞRUDAN oynatıcı adresi döneriz; istemci onu ters proxy'ye çevirir
    // (`lib/anizm-proxy.ts` → `/api/anizm-player?hash=…`), sunucu da doğru Referer'ı
    // koyar. Sağlayıcının reklamlı "bölüm sayfası" iframe'e ARTIK GÖMÜLMEZ
    // (kullanıcı bildirimi: "oynatıcıda tarayıcı sayfası açılıyor").
    if (url && ANIZM_PLAYER_RE.test(url)) return { ok: true, url, server: server.name };
  }
  return { ok: false, reason: "anizmplayer sunucusu yok" };
}

/**
 * Dizin aramasında kullanılacak ADRES AİLESİ tabanları.
 *
 * NEDEN KISA ÖNEK DE GEREKLİ: ağ sezon işaretini başlığın ORTASINA koyabiliyor
 * (`mushoku-tensei-ii-isekai-ittara-honki-dasu`). Elimizdeki tam taban
 * (`mushoku-tensei-isekai-ittara-honki-dasu`) o adresin ÖNEKİ DEĞİLDİR; aile
 * eşleşmesi tutmaz. Ölçüm (27.09.2026): bu yüzden kısa önek (`mushoku-tensei`) da
 * denenir. Adaylar yine bölüm sayfası çekilerek DOĞRULANIR → yanlış sezon yazılmaz.
 */
function familyBases(base: string, slug: string, show = ""): string[] {
  const out: string[] = [];
  const add = (value: string) => {
    const clean = value.trim().replace(/-izle$/i, "");
    if (clean && !out.includes(clean)) out.push(clean);
  };
  // Bizim KENDİ slug'ımız en değerli adaydır: ağ bazen dizinin adresini olduğu gibi
  // kullanıyor ve sezon işaretini sonuna/ortasına ekliyor (`mushoku-tensei` →
  // `mushoku-tensei-iii-…`). Ölçüm: bu eşleşme 27.09.2026'da 3. sezonu çözdü.
  add(show);
  add(base);
  add(slug);
  const tokens = base.trim().split("-").filter(Boolean);
  // Çok sözcüklü tabanlarda ilk 2 ve ilk 3 sözcük de denenir (sezon işareti ortada).
  if (tokens.length >= 3) add(tokens.slice(0, 2).join("-"));
  if (tokens.length >= 4) add(tokens.slice(0, 3).join("-"));
  return out;
}

/** Denenen aday adresleri (hata mesajında kullanıcıya gösterilir). */
function candidateList(slug: string, base: string, season: number): string[] {
  // Adaylar SEZONSUZ tabandan türetilir; `puffy` her zaman EN ÖNCE denenir (kullanıcı
  // elle yazdıysa onun adresi önceliklidir).
  const derived = base ? puffySlugCandidates(base, season) : [];
  const list = slug ? [slug, ...derived] : derived;
  return list.filter((value, index) => Boolean(value) && list.indexOf(value) === index);
}

export const Route = createFileRoute("/api/anizm")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const slug = (params.get("puffy") ?? "").trim();
        /**
         * `base`: sezonsuz puffytr slug'ı. Verilirse sezon adayları bundan üretilir
         * (`lib/puffy.ts` → `puffySlugCandidates`); `puffy` yine ilk sırada denenir.
         */
        const base = (params.get("base") ?? "").trim();
        const season = Number.parseInt((params.get("season") ?? "1").trim(), 10);
        const number = (params.get("number") ?? "").trim();
        /**
         * `min`: sezonun en küçük bölüm numarası (bizim verimizden). Kaymış
         * numaralandırmayı (ör. 12…23) kaynağın 1 tabanlı numarasına çevirmek için.
         * Verilmezse 1 kabul edilir → 1 tabanlı sezonlarda davranış DEĞİŞMEZ.
         */
        const seasonMinRaw = Number.parseInt((params.get("min") ?? "1").trim(), 10);
        const seasonMin = Number.isFinite(seasonMinRaw) && seasonMinRaw > 0 ? seasonMinRaw : 1;

        const fail = (reason: string, tried: string[], status = 200, numbers: string[] = []) =>
          Response.json(
            { ok: false, reason, tried, numbers },
            { status, headers: { "Cache-Control": "no-store" } },
          );

        const seasonValue = Number.isFinite(season) && season > 0 ? season : 1;
        /** Bizim seri başlığımız (varsa) — ağ dizininde ad eşleşmesi için. */
        const title = (params.get("title") ?? "").trim();
        /** Bizim seri slug'ımız (varsa) — ağ dizininde ADRES AİLESİ eşleşmesi için. */
        const show = (params.get("show") ?? "").trim();
        /** MAL kimliği: AniList'ten romaji/eşanlamlı adlar alınsın diye (opsiyonel). */
        const malRaw = Number.parseInt((params.get("mal") ?? "").trim(), 10);
        const malId = Number.isFinite(malRaw) && malRaw > 0 ? malRaw : 0;

        const tried: string[] = [];
        /** Adayların NEDEN denendiği (panel kullanıcıya gösterir; sıra `tried` ile aynı). */
        const reasons: string[] = [];
        // `number` OPSİYONEL: yalnızca adres doğrulaması için boş bırakılabilir.
        if (!slug && !base) return fail("puffy (ya da base) parametresi gerekli", tried);

        const ladder = candidateList(slug, base, seasonValue);
        if (ladder.length === 0 && !title && !malId) return fail("denenecek adres yok", tried);

        try {
          let lastReason = "adres çözülemedi";
          let lastNumbers: string[] = [];

          /**
           * Tek bir adayı dener. Başarılıysa YANITI döndürür (çağıran onu döndürür),
           * başarısızsa `null` döner ve sebep `lastReason`a yazılır.
           */
          const attemptCandidate = async (
            candidate: string,
            reason: string,
          ): Promise<Response | null> => {
            tried.push(candidate);
            reasons.push(reason);
            const attempt = await resolveFromSlug(candidate, number, seasonMin);
            if (attempt.ok) {
              return Response.json(
                // `slug`: gerçekte kullanılan adres (panel bunu kullanıcıya gösterir).
                {
                  ok: true,
                  number,
                  slug: candidate,
                  url: attempt.url,
                  server: attempt.server,
                  tried,
                  reasons,
                },
                // Hash bölüm başına sabit: kısa süre CDN'de tutulabilir.
                { headers: { "Cache-Control": "public, max-age=600" } },
              );
            }
            lastReason = attempt.reason;
            lastNumbers = attempt.numbers ?? [];
            return null;
          };

          // ---- 1) KALIP ADRESLER (ölçülmüş yazımlar) --------------------------
          // Mevcut davranış korunur: İLK aday doğrudan denenir (tutarsa tek istekle
          // biter — 1. sezonların çoğu böyle).
          //
          // ── ÖN FİLTRE (ölçüm 30.09.2026) ─────────────────────────────────────
          // İlk aday tutmazsa kalan kalıp adayları neredeyse hep YOKTUR ve her biri
          // ~0,4 sn sürer: ölçüm — 6 boşa deneme = 2,4 sn, oysa adresleri içeren
          // dizinin tamamı yalnızca 0,42 sn. Kullanıcı şikâyeti (uzun süren istek
          // iptal edilince dev'de `read ECONNRESET`) tam olarak bu boşa denemelerden
          // çıkıyordu. Bu yüzden: ilk denemeden SONRA dizin bir kez okunur ve
          // DİZİNDE OLMAYAN adaylar hiç denenmez (sebep `reasons`a yazılır — sessizce
          // atlanmaz). Dizin okunamazsa filtre kurulmaz, davranış bugünküyle aynıdır.
          let knownSlugs: Set<string> | null = null;
          for (const candidate of ladder) {
            if (knownSlugs && !knownSlugs.has(candidate)) {
              reasons.push(`atlandı (ağ dizininde yok): ${candidate}`);
              continue;
            }
            const hit = await attemptCandidate(candidate, "adres kalıbı");
            if (hit) return hit;
            if (!knownSlugs) {
              try {
                knownSlugs = new Set((await readNetworkIndex()).map((entry) => entry.slug));
              } catch {
                // Dizin alınamadı → süzme yok, eski davranış (tüm adaylar denenir).
                knownSlugs = null;
                break;
              }
            }
          }

          // ---- 2) AĞ DİZİNİ (kalıp tutmadıysa) -------------------------------
          // NEDEN: sezon adresleri seriden seriye değişiyor; kalıpla bulunamayan
          // sezonlar (ör. Mushoku 3 → `…-iii-…`) yalnızca ağın KENDİ dizininden
          // bulunabilir. Dizin/adlar alınamazsa bu adım ATLANIR: sebep `reasons`a
          // yazılır, çözümleme "veri yok" diye uydurmaz.
          if (number || ladder.length > 0 || title || malId) {
            try {
              const index = await readNetworkIndex();
              const extraTitles = malId
                ? await cachedRead(`anilist:titles:${malId}`, ANILIST_TITLE_TTL_SECONDS, () =>
                    fetchAniListTitles(malId),
                  )
                : [];
              /**
               * Sorgu ADLARI — sırayla denenir, en güvenilir önce:
               *   1) bizim başlığımız, 2) bizim slug'ımız (tire → boşluk),
               *   3) puffytr eşlemesi, 4) AniList romaji/İngilizce/eşanlamlı adlar.
               * KATI EŞİTLİK ARANMAZ: benzerlik puanlanır (bkz. `lib/title-match.ts`).
               */
              const titles = [title, show, base, base.replace(/-izle$/i, ""), ...extraTitles]
                .map((value) => (value ?? "").replace(/-/g, " ").trim())
                .filter(Boolean);
              const indexCandidates = networkSeasonCandidates(index, {
                season: seasonValue,
                bases: familyBases(base, slug, show),
                titles,
              });
              for (const candidate of indexCandidates) {
                if (tried.includes(candidate.slug)) continue;
                const hit = await attemptCandidate(candidate.slug, candidate.reason);
                if (hit) return hit;
              }
              if (indexCandidates.length === 0)
                reasons.push("ağ dizininde bu sezona uyan adres bulunamadı");
            } catch (error) {
              reasons.push(
                `ağ dizini okunamadı: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }

          return fail(lastReason, tried, 200, lastNumbers);
        } catch (error) {
          return fail(
            `çözümleme hatası: ${error instanceof Error ? error.message : String(error)}`,
            tried,
            500,
          );
        }
      },
    },
  },
});
