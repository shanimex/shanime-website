/**
 * TÜRKÇE BÖLÜM ADLARI — acheriya.com bölüm sayfalarından ad çıkarmak için SAF yardımcılar.
 *
 * NEDEN VAR: panel bölümleri ani.zip kataloğundan çekiyor ve katalog adları İNGİLİZCE.
 * Kullanıcı bölümlerin TÜRKÇE adlarıyla kaydedilmesini istedi. Türkçe ad kaynağı
 * acheriya.com; sayfa `…/izle/<slug>/bolum-<n>` biçiminde ve JSON-LD'sinde `TVEpisode`
 * kaydı var.
 *
 * ÖLÇÜM (27.09.2026, bu oturumda CANLI HTTP — istekler bu oturumda atıldı):
 *   GET /izle/re-zero-kara-hajimeru-isekai-seikatsu/bolum-1 → 200
 *     JSON-LD name: "Re:Zero kara Hajimeru Isekai Seikatsu - 1. Bölüm: Başlangıcın Sonu ve Sonun Başlangıcı"
 *   GET /izle/jujutsu-kaisen/bolum-1 → 200
 *     JSON-LD name: "Jujutsu Kaisen - 1. Bölüm"  ← buradan TEMİZ ad ÇIKMAZ (uydurulmaz)
 *   GET /izle/mushoku-tensei-jobless-reincarnation/bolum-2 → 200
 *     JSON-LD name: "Mushoku Tensei: Jobless Reincarnation - 2. Bölüm: Usta"
 *
 * ── NEDEN DURUM KODU YETMİYOR (KRİTİK ÖLÇÜM) ───────────────────────────────────
 * acheriya OLMAYAN adreslerde de **HTTP 200** döndürüyor; sayfanın başlığı
 * "Bölüm Bulunamadı" oluyor ve JSON-LD'sinde `TVEpisode` BULUNMUYOR (ölçüldü:
 * `/izle/erased/bolum-1` → 200 ama TVEpisode yok). Bu yüzden bir adayın geçerli
 * sayılması için **JSON-LD'de `TVEpisode` adı bulunması** şarttır; `res.ok` kanıt değil.
 *
 * BU DOSYA SAFTIR: ağ erişimi ve önbellek YOK (rota: `routes/api.tr-titles.ts`).
 * Böylece ayrıştırma/temizleme kuralları tek yerde durur ve test edilebilir kalır.
 */

// Sezon işareti çözümü TEK YERDE tutulur (`lib/puffy.ts`): hem bu dosya (acheriya
// dizini) hem Anizm kaynağının sezon adresi (puffytr dizini) aynı kuralı kullanır.
import { seasonMarkOf } from "@/lib/puffy";

export { seasonMarkOf };

/** Türkçe ad kaynağının kökü. */
export const TR_TITLE_SOURCE = "https://acheriya.com";

/**
 * Önbellek TTL'i (saniye) — 30 gün.
 *
 * NEDEN 30 GÜN: bölüm adları yayımlandıktan sonra DEĞİŞMEZ (geçmiş veri); buna
 * karşılık panel aynı sezonu tekrar tekrar aktarabiliyor ve her aktarım bölüm başına
 * bir istek demek olurdu. Uzun TTL sayesinde hedef "bölüm başına AYDA en fazla bir
 * upstream isteği" olur; tekrar aktarmalar tamamen önbellekten karşılanır. Adı
 * sonradan eklenen bir bölüm en kötü ihtimalle 30 gün gecikir — bu, kaynağa istek
 * yağdırmaktan yeğdir (site bizim değil, nazik davranmak zorundayız).
 */
export const TR_TITLE_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Eşzamanlılık sınırı — aynı anda en fazla 3 bölüm sayfası.
 *
 * NEDEN 3: sıralı çekim 25 bölümde ~25 istek boyu sürer ve HTTP rotasını zaman
 * aşımına yaklaştırır; sınırsız paralellik ise kaynağa "vurgun" olur. 3, ikisinin
 * arasında bilinçli bir denge: bir sezon (~25 bölüm) birkaç saniyede biter, kaynak
 * site de aynı anda 3 istekten fazlasını görmez.
 */
export const TR_TITLE_CONCURRENCY = 3;

/**
 * Gruplar arasında beklenecek süre (ms).
 *
 * NEDEN: eşzamanlılık sınırı tek başına yeterli değil — istekler bitişik gruplar
 * hâlinde sürekli akarsa kaynak site yine yük görür. 250 ms, insan fark etmeyecek
 * kadar kısa ama kaynağa "nefes" veren bir aralık.
 */
export const TR_TITLE_DELAY_MS = 250;

/** Tek çağrıda istenebilecek en fazla bölüm (kötüye kullanım/sonsuz döngü koruması). */
export const TR_TITLE_MAX_EPISODES = 300;

/** Sayfadaki JSON-LD bloklarını yakalar (Next.js `<script type="application/ld+json">`). */
const LD_RE = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** JSON-LD içindeki HTML varlıkları — ad alanında `&amp;` gibi kalıntılar olabilir. */
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

/** `&amp;` → `&` gibi temel varlıkları çözer (bilinmeyenler olduğu gibi kalır). */
function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|quot|#39|apos|lt|gt|nbsp);/g, (match) => ENTITIES[match] ?? match);
}

/**
 * JSON-LD ağacında `TVEpisode` düğümünü arar ve `name` alanını döndürür.
 *
 * NEDEN ÖZYİNELEMELİ: acheriya JSON-LD'yi bazen dizi, bazen `@graph` sarmalı olarak
 * veriyor (ölçüldü: iki biçim de görüldü). Düğüm biçimini sabit varsaymak adı
 * kaybettirirdi; bu yüzden ağaç yürünür ve `@type` içinde "TVEpisode" geçen İLK
 * düğümün `name`i alınır.
 */
function findEpisodeName(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findEpisodeName(item);
      if (found) return found;
    }
    return "";
  }
  const record = node as Record<string, unknown>;
  const rawType = record["@type"];
  const types = Array.isArray(rawType) ? rawType.map(String) : [String(rawType ?? "")];
  if (types.some((type) => type.includes("TVEpisode"))) {
    const name = record["name"];
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  for (const value of Object.values(record)) {
    const found = findEpisodeName(value);
    if (found) return found;
  }
  return "";
}

/**
 * Sayfa HTML'inden JSON-LD `TVEpisode` adını çıkarır; yoksa `""` döner.
 *
 * `""` dönmesi "sayfada bölüm kaydı yok" demektir (ya adres geçersizdir ya bölüm
 * gerçekten yoktur) — çağıran bunu "Türkçe ad bulunamadı" olarak raporlar.
 */
export function episodeNameFromHtml(html: string): string {
  for (const match of html.matchAll(LD_RE)) {
    const block = match[1];
    if (!block) continue;
    try {
      const found = findEpisodeName(JSON.parse(block.trim()) as unknown);
      if (found) return found;
    } catch {
      // Blok bozuk JSON: sıradaki bloğa geçilir (tek blok yüzünden ad kaybedilmesin).
    }
  }
  return "";
}

/**
 * Adlandırmadaki "bölüm" işareti: `1. Bölüm`, `1.Bölüm`, `12. Bölüm`…
 * Kaynak bu işareti her bölüm adında kullanıyor (ölçüldü), bu yüzden işaretin
 * bulunmaması "elimizdeki ad bölüm adı değil" demektir ve ad UYDURULMAZ.
 */
const BOLUM_RE = /(\d+(?:[.,]\d+)?)\s*\.?\s*B[oö]l[uü]m\b/i;

/**
 * Kaynağın ham adından SAF bölüm adını çıkarır.
 *
 * Girdi örneği: "Re:Zero kara Hajimeru Isekai Seikatsu - 1. Bölüm: Başlangıcın Sonu ve Sonun Başlangıcı"
 * Çıktı       : "Başlangıcın Sonu ve Sonun Başlangıcı"
 *
 * Yani BİZE GÖRE GEREKSİZ OLAN ŞU İKİ PARÇA ATILIR: (1) baştaki dizi adı,
 * (2) "N. Bölüm:" işareti. Geriye kalan tek şey bölümün kendi Türkçe adıdır.
 *
 * Girdi örneği: "Jujutsu Kaisen - 1. Bölüm" → `""`
 * NEDEN BOŞ: işaretten sonra HİÇBİR ŞEY yok; bu bölümün Türkçe adı kaynakta
 * yazılmamış. Bu durumda "Türkçe ad yok" denir — dizi adını bölüm adı diye yazmak
 * ya da uydurmak YASAK.
 */
export function cleanTurkishEpisodeName(raw: string): string {
  const name = decodeEntities(raw).replace(/\s+/g, " ").trim();
  if (!name) return "";
  const match = BOLUM_RE.exec(name);
  // "Bölüm" işareti yoksa güvenilir bir bölüm adı çıkaramayız: ad UYDURULMAZ.
  if (!match) return "";

  let rest = name.slice((match.index ?? 0) + match[0].length);
  // İşaretten sonra gelen ayırıcılar (": ", " - ", " | ") atılır.
  rest = rest.replace(/^[\s:.\-–—|]+/, "");
  // Sondaki site ekleri ("- İzle", "| Acheriya") adın parçası değildir.
  rest = rest.replace(/\s*[|–—-]\s*(?:izle|acheriya)\s*$/i, "");
  rest = rest
    .replace(/[\s:.\-–—|]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!rest) return "";
  // Harf içermeyen kalıntı ("1", "2." gibi sayı tekrarları) ad sayılmaz.
  if (!/\p{L}/u.test(rest)) return "";
  return rest;
}

/** Sezon/numaralandırma işareti sayılan parçalar (`-2nd-season`, `-s3`, `-ii`, `-part-2`…). */
const SEASON_MARK_RE = /^(?:s\d+|\d+(?:st|nd|rd|th)|\d+|[ivxl]{1,4}|final|part|season|sezon)$/i;

/**
 * Site dizininden (sitemap) aday adres üretir.
 *
 * NEDEN GEREKLİ: bazı dizilerde acheriya adresi bizim slug'dan TÜRETİLEMİYOR.
 * ÖLÇÜM (27.09.2026): bizim `mushoku-tensei` → acheriya
 * `mushoku-tensei-jobless-reincarnation` (İngilizce ad!) ve `re-zero` →
 * `re-zero-kara-hajimeru-isekai-seikatsu`. Bu adları tahmin etmek mümkün değil;
 * ama sitemap (`/sitemap/animes-1.xml`) sitenin KENDİ dizinidir, uydurma değildir.
 * Adaylar "bizim slug ile BAŞLAYAN" dizin kayıtlarından seçilir ve sezon eki
 * taşımayanlar (1. sezon) öne alınır; her aday yine sayfa çekilerek DOĞRULANIR.
 *
 * @param index  sitemap'ten çıkarılmış `izle` slug'ları
 * @param bases  denenen taban adaylar (bizim slug, puffy slug, `-tv` eki…)
 */
export function slugIndexCandidates(index: string[], bases: string[]): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    if (value && !out.includes(value)) out.push(value);
  };
  for (const base of bases) {
    const clean = base.trim().replace(/-izle$/i, "");
    if (!clean) continue;
    const matches: string[] = [];
    for (const slug of index) {
      if (slug !== clean && !slug.startsWith(`${clean}-`)) continue;
      // Sezon işareti TAŞIMAYAN kayıt "düz" kayıttır (1. sezon).
      const rest = slug === clean ? "" : slug.slice(clean.length + 1);
      const hasSeasonMark = rest.split("-").some((token) => SEASON_MARK_RE.test(token));
      if (!hasSeasonMark) matches.push(slug);
    }
    // Kısa olan önce: `mushoku-tensei-jobless-reincarnation`, `…-isekai-ittara-…`ten önce.
    // NEDEN: uzun ekler genelde sezon/alt başlık ekidir, düz kayıt ise 1. sezonun ta kendisi.
    matches.sort((a, b) => a.length - b.length);
    for (const slug of matches) push(slug);
  }
  return out;
}

/** Sitemap XML'inden `…/izle/<slug>` kayıtlarını çıkarır (site dizini). */
export function slugIndexFromSitemap(xml: string): string[] {
  const out: string[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
    const loc = match[1] ?? "";
    const slug = /\/izle\/([^/?#]+)/.exec(loc)?.[1];
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return out;
}

/**
 * ── SEZON ADRESİ DİZİNDEN ÇIKARILAMAYINCA (KÖK SEBEP DÜZELTMESİ, 27.09.2026) ────
 *
 * Yukarıdaki `slugIndexCandidates` yalnızca DÜZ kaydı (1. sezon) bulmak için
 * yazılmıştı: sezon işareti TAŞIYAN dizin kayıtlarını bilerek eliyor. Ama ölçüm
 * gösterdi ki sezon adresleri de seriden seriye değişiyor ve kalıpla türetilemiyor:
 *
 *   puffytr kalıbı (`…-2nd-season`, `…-2-sezon`) → re-zero 2. sezon ✔ ÇALIŞIYOR
 *   `mushoku-tensei` 2. sezon → kaynakta `mushoku-tensei-ii-isekai-ittara-honki-dasu-shugo-jutsushi-fitz`
 *   `mushoku-tensei` 3. sezon → kaynakta `mushoku-tensei-s3`
 *   (ikisi de `…-2nd-season` gibi bir kalıpla ÜRETİLEMEZ; 27.09.2026 canlı ölçüm)
 *
 * Yani Türkçe ad, "adres bulunamadı" diye sessizce boş kalıyordu. ÇÖZÜM: istenen
 * sezonu AÇIKÇA söyleyen dizin kayıtlarını (kaynağın KENDİ listesi — uydurma değil)
 * aday olarak eklemek.
 *
 * ── NEDEN YALNIZCA "AÇIK" İŞARETLER (yanlış sezona yazma riski) ────────────────
 * Yanlış sezon sayfasından ad okumak, olmayan bir adı yazmak kadar kötüdür; bu
 * yüzden yalnızca sezon numarasını TARTIŞMASIZ söyleyen işaretler kabul edilir:
 * `2nd-season` / `3rd-season`, `2-sezon`, `s2` / `s3`, `season-2`, roma rakamı
 * (`ii`, `iii`, `iv`). Buna karşılık `part-2` KABUL EDİLMEZ: kaynakta
 * `mushoku-tensei-isekai-ittara-honki-dasu-part-2` 1. sezonun 2. kısmıdır, 2. sezon
 * değildir — "part" işareti belirsizdir ve `0` döner (yani elenir).
 *
 * Ölçüm (27.09.2026, canlı): kaynağın dizi dizini `sitemap/animes-1.xml` — 914 kayıt,
 * ~121 KB, 24 saat bellekte tutulur. Bölüm dizinleri (`episodes-1..17.xml`, ~12 MB)
 * BİLEREK kullanılmaz: rota başına 12 MB indirmek kabul edilemez.
 */

/**
 * Dizinden, İSTENEN SEZONA ait aday adresler — kısa olandan uzuna.
 *
 * @param index   dizin kayıtları (`slugIndexFromSitemap`)
 * @param bases   denenecek taban adaylar (bizim slug, çözülen taban, `-tv`…)
 * @param season  istenen sezon numarası (> 1; 1. sezon için dizin gerekmez)
 */
export function seasonIndexCandidates(index: string[], bases: string[], season: number): string[] {
  const wanted = Math.floor(season);
  if (!Number.isFinite(wanted) || wanted <= 1) return [];
  const out: string[] = [];
  for (const base of bases) {
    const matches: string[] = [];
    for (const slug of index) {
      if (seasonMarkOf(slug, base) === wanted) matches.push(slug);
    }
    // Kısa olan önce: `…-2nd-season`, `…-2nd-season-part-2`ten önce gelir.
    matches.sort((a, b) => a.length - b.length);
    for (const slug of matches) if (!out.includes(slug)) out.push(slug);
  }
  return out;
}

/** Kaynağın bölüm adresi. */
export function turkishEpisodeUrl(slug: string, number: string): string {
  return `${TR_TITLE_SOURCE}/izle/${encodeURIComponent(slug)}/bolum-${encodeURIComponent(number)}`;
}
