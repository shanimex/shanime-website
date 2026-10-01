/**
 * puffytr ↔ bizim slug eşlemeleri (TEK kaynak).
 *
 * NEDEN AYRI DOSYA: aynı eşleme üç yerde gerekiyor — panel (hangi adresten
 * çekileceğini göstermek için), sunucu rotası (`/api/anizm`, hash çözmek için) ve
 * toplu betik (`scripts/resolve-anizm-hashes.mjs`, tüm sezonu tek seferde üretmek
 * için). Kopyalanınca biri güncellenip öteki unutuluyordu.
 *
 * ÖLÇÜM (26.09.2026, tarayıcıyla doğrulandı): puffytr bazı dizilerde Japonca adı
 * kullanıyor, bizim slug'ımız tutmuyor.
 */
const PUFFY_SLUG_OVERRIDES: Record<string, string> = {
  erased: "boku-dake-ga-inai-machi",
  "re-zero": "rezero-kara-hajimeru-isekai-seikatsu",
  "mushoku-tensei": "mushoku-tensei-isekai-ittara-honki-dasu",
  /**
   * ÖLÇÜM (01.10.2026, puffytr ağ dizini): bizim `solo-leveling` adresimiz ağda YOK;
   * dizi `ore-dake-level-up-na-ken` olarak duruyor (S2: `…-season-2-arise-from-the-shadow`).
   * Eşleme olmadan sunucu ADRES AİLESİNİ bulamıyor ve ad benzerliğiyle BAŞKA bir diziyi
   * (`25-jigen-no-ririsa`) çözüyordu → yanlış kaynak. Bu satır o yolu kapatır.
   */
  "solo-leveling": "ore-dake-level-up-na-ken",
};

/** Bizim seri slug'ı → puffytr'daki dizi slug'ı (özel eşleme yoksa kendisi). */
export function puffySlugFor(showSlug: string): string {
  const key = showSlug.trim();
  return PUFFY_SLUG_OVERRIDES[key] ?? key;
}

/**
 * Sezonun puffytr dizi slug'ı.
 *
 * ÖLÇÜM (26.09.2026): puffytr HER SEZONU AYRI sayfada tutuyor ve sezon ekini
 * MAL/AniList adlandırmasıyla kullanıyor:
 *   jujutsu-kaisen                 → 24 bölüm (1. sezon)
 *   jujutsu-kaisen-2nd-season      → 23 bölüm (2. sezon) ✔ birebir eşleşti
 * Bu yüzden 2. sezon için AYNI slug'a bölüm numarası yazmak yanlış bölümü verir;
 * doğru yol sezon eki taşıyan adresi kullanmaktır (numaralar sayfa içinde 1'den başlar).
 */
const ORDINALS: Record<number, string> = { 2: "2nd", 3: "3rd", 4: "4th" };

/** Sezon numarasının puffytr ekini verir (2 → "2nd", 5 → "5th"). */
function ordinalFor(season: number): string {
  return ORDINALS[season] ?? `${season}th`;
}

export function puffySlugForSeason(showSlug: string, season: number): string {
  const base = puffySlugFor(showSlug);
  if (!Number.isFinite(season) || season <= 1) return base;
  return `${base}-${ordinalFor(season)}-season`;
}

/**
 * Bir sezonun puffytr adresi için DENENECEK aday adresler (ilk sıradaki mevcut
 * davranıştır, kalanlar yalnızca ilk adres tutmazsa denenir).
 *
 * NEDEN LADDER GEREKLİ (KÖK SEBEP): tek bir kalıp YETMİYOR — puffytr sezon
 * adlandırmasını seriden seriye değiştiriyor. ÖLÇÜM (27.09.2026, canlı HTTP):
 *   rezero-kara-hajimeru-isekai-seikatsu             → 200 (26 bölüm, 1. sezon)
 *   rezero-kara-hajimeru-isekai-seikatsu-3rd-season  → 200
 *   rezero-kara-hajimeru-isekai-seikatsu-4th-season  → 200
 *   rezero-kara-hajimeru-isekai-seikatsu-2nd-season  → 302 → /notfound (YOK!)
 *   rezero-kara-hajimeru-isekai-seikatsu-izle        → 200 (aynı 1. sezon sayfası)
 * Yani `puffySlugForSeason`ın ürettiği adres 2. sezonda puffytr'da BULUNMUYOR ve
 * Anizm kaynağı bu yüzden sessizce yazılamıyordu (bkz. `routes/api.anizm.ts`).
 * Site içinde "Mushoku Tensei III" sayfası da sezon ekini ORTAYA koyuyor
 * (`mushoku-tensei-iii-isekai-ittara-honki-dasu`) — yani kalıbı seri başlığından
 * genel olarak TÜRETMEK MÜMKÜN DEĞİL; bu yüzden adaylar denenir ve İSTENEN BÖLÜM
 * NUMARASINI veren İLK adres kullanılır.
 *
 * puffytr'ın SUNUCU TARAFLI ARAMASI YOK: istemci kodunun çağırdığı `/searchAnime`
 * artık 404, `/aramasonuclari` 302 → /notfound, `/arama` 500 döndürüyor (ölçüm
 * 27.09.2026). Bu yüzden başlıktan adres ARAMASI yapılamıyor; yalnızca aday
 * adresler deneyip sonucu kullanıcıya açıkça bildiriyoruz.
 */
export function puffySlugCandidates(base: string, season: number): string[] {
  const clean = base.trim();
  if (!clean) return [];
  const list: string[] = [];
  const add = (value: string) => {
    const candidate = value.trim();
    if (candidate && !list.includes(candidate)) list.push(candidate);
  };

  // 1. SEZON: baz adresin kendisi (ve `-izle` takma adı). Ölçüm: ikisi de aynı
  //    dizi sayfasıdır (26 bölüm).
  if (!Number.isFinite(season) || season <= 1) {
    add(clean);
    add(`${clean}-izle`);
    return list;
  }

  // ÇOK SEZONLU DİZİLERDE DÜZ ADRES LİSTEYE GİRMEZ: `puffytr.com/<slug>` her zaman
  // 1. sezonun sayfasıdır. Onu aday göstermek, 2. sezon için 1. sezonun videolarını
  // yazma riski demektir (bölüm numarası iki sayfada da var). Yalnızca sezon ekli
  // yazımlar denenir: sıra ÖLÇÜLEN kalıptan başlar (`-2nd-season`), sonra puffytr'da
  // görülen diğer yazımlar gelir. Hepsi tek isteklik denemedir.
  const ordinal = ordinalFor(season);
  add(`${clean}-${ordinal}-season`);

  // TÜRKÇE NUMARALANDIRMA (ÖLÇÜM 27.09.2026, canlı HTTP — kendi isteklerim):
  //   rezero-kara-hajimeru-isekai-seikatsu-2-sezon       → 200 ✔
  //   rezero-kara-hajimeru-isekai-seikatsu-2-sezon-izle  → 200 ✔
  //   rezero-kara-hajimeru-isekai-seikatsu-2nd-season    → 302 → /notfound ✘
  //   rezero-kara-hajimeru-isekai-seikatsu-3rd-season    → 200 ✔
  // Yani AYNI dizide 3. sezon İngilizce, 2. sezon TÜRKÇE yazımla duruyor — kalıbı
  // seriden türetmek imkânsız, iki yazım da denenmek zorunda. Kullanıcının
  // bildirdiği `-2-sezon-1-bolum-izle` adresi de bu kalıbı doğruluyor.
  add(`${clean}-${season}-sezon`);
  add(`${clean}-${season}-sezon-izle`);

  add(`${clean}-${ordinal}-season-izle`);
  add(`${clean}-${season}`);
  add(`${clean}-season-${season}`);
  return list;
}

/**
 * ── BÖLÜM NUMARASI KAYMASI (KÖK SEBEP DÜZELTMESİ, 27.09.2026) ──────────────────
 * puffytr bir sezonun bölümlerini HER ZAMAN 1'den numaralandırır (canlı ölçüm:
 * `rezero-kara-hajimeru-isekai-seikatsu-2-sezon` → 200, bölümler 1..13). Bizim
 * `show_episodes.number` alanımız ise katalogdan (ani.zip) geldiği için bazen
 * SERİ GENELİ (mutlak) numarayı taşır. Kullanıcının Re:Zero 2. sezon ekran
 * görüntüsünde bölümler 12…23 idi; çözücü kaynaktan bu HAM numarayı istediği için
 * hata zincir hâlinde tekrarlanıyordu: "puffytr'da 13. bölüm yok / 14. bölüm yok /
 * …" (13..23 → 11 bölüm). Oysa aynı sezon kaynakta 1…12/1…13'tür.
 *
 * ÇÖZÜM: kaynağa sorulacak numaralar ADAY listesi hâlinde üretilir ve karar SEZON
 * BAŞINA verilir (bölüm başına değil), böylece kayma sessizce çözümü bozamaz:
 *   · Sezonumuz zaten 1 tabanlıysa (min = 1) aday TEKTİR → davranış DEĞİŞMEZ.
 *   · min > 1 ise SEZONA GÖRE numara (`raw - (min - 1)`; 12…23 → 1…12) önce
 *     denenir; HAM numara aday listesinde KALIR, böylece kaynağı mutlak
 *     numaralandıran durumlar da bozulmaz.
 *   · Kaynak sayfanın İLK bölüm numarası bizim ilk bölüm numaramıza EŞİTSE ("aynı
 *     numaralandırma") HAM numara öne alınır — yanlış eşleşme riski bu kuralın
 *     SEZON GENELİNDE tutarlı olmasıyla kapatılır (tek bölüme bakıp karar verilmez).
 */

/**
 * KAYNAK KATALOĞUNA sorulacak numaranın TABANI — PART FARKINDALIKLI (01.10.2026).
 *
 * NEDEN GEREKLİ: puffytr bir sezonu PART başına 1'den numaralandırır ve her part
 * AYRI sayfadır. Ölçüm (01.10.2026, canlı): Re:Zero S2 → `…-2-sezon` sayfası 1..13
 * (Part 1), `…-2nd-season-part-2` sayfası 1..12 (Part 2); bizim sezonumuz ise 1..25
 * BİRLEŞİK. Doğru eşleme part'ın KENDİ sayfası + part içi göreli numaradır
 * (mutlak 14 → Part 2 sayfasının 1. bölümü).
 *
 * ESKİ DAVRANIŞ (hatalı): kaynağa SEZONUN en küçük numarası (`min = 1`) veriliyordu;
 * sunucu mutlak 14'ü Part 1 sayfasında (1..13) aradı, bulamadı, sonra başka bir aday
 * olarak ilk sayfaya düşüp 1. bölümü "buldu" → 14. bölüm yerine 1. bölüm oynadı
 * (canlı veri: re-zero S2B14–B25 adresleri S1B1–B12'ye işaret ediyordu).
 *
 * `min` olarak part'ın `start`'ı verilince `episodeNumberCandidates`in "ÖNCEKİ COUR
 * TUZAĞI" kuralı (sayfa uzunluğu = min−1 → göreli aday geçersiz) devreye girer:
 * Part 1 sayfası (13 = 14−1) elenir, Part 2 sayfasında göreli 1 bulunur.
 *
 * @param episode   bizim bölüm numaramız (mutlak, sezon içi)
 * @param seasonMin sezonun en küçük bölüm numarası (kayma yoksa 1)
 * @param parts     `show_seasons.parts` — `{ start, count }` aralıkları
 * @returns         istenecek numaranın tabanı (bölüm bir part'a düşüyorsa part.start)
 */
export function sourceEpisodeMinimum(
  episode: number,
  seasonMin: number,
  parts: { start?: number | null; count?: number | null }[] | null | undefined,
): number {
  if (Array.isArray(parts) && Number.isFinite(episode)) {
    for (const entry of parts) {
      const start = entry?.start;
      const count = entry?.count;
      if (typeof start !== "number" || typeof count !== "number") continue;
      if (!Number.isInteger(start) || !Number.isInteger(count) || start <= 0 || count <= 0)
        continue;
      if (episode >= start && episode < start + count) return start;
    }
  }
  return Number.isFinite(seasonMin) && seasonMin > 0 ? Math.floor(seasonMin) : 1;
}

/**
 * Kaynak diziden istenecek bölüm numarası ADAYLARI — sıralı ve tekrarsız.
 *
 * @param raw       bizim bölüm numaramız (ham; ör. "23")
 * @param seasonMin sezonun en küçük bölüm numarası (ör. 12; 1 ise sezon 1 tabanlı)
 * @param pageFirst kaynak sayfadaki İLK bölüm numarası. Sayfa okunduktan sonra
 *                  bilinir; bilinmiyorsa `NaN` verilir (o zaman sezon-relative önce).
 * @param pageCount kaynak sayfadaki bölüm SAYISI. ÖNCEKİ COUR'u eleme sinyalidir
 *                  (bkz. aşağıdaki "ÖNCEKİ COUR TUZAĞI"). Bilinmiyorsa `NaN`.
 */
export function episodeNumberCandidates(
  raw: string,
  seasonMin: number,
  pageFirst: number,
  pageCount = Number.NaN,
): string[] {
  const value = raw.trim();
  if (!value) return [];
  const rawNumber = Number.parseFloat(value);
  const min = Number.isFinite(seasonMin) && seasonMin > 1 ? Math.floor(seasonMin) : 1;
  // ZATEN 1 TABANLI (min = 1): tek aday = ham numara → HİÇBİR ŞEY DEĞİŞMEZ.
  if (!Number.isFinite(rawNumber) || min <= 1) return [value];

  /**
   * ⚠️ ÖNCEKİ COUR TUZAĞI (regresyon, 29.09.2026 — "12'den sonra 1. sezona sarıyor").
   *
   * puffytr bir sezonu COUR (part) başına 1'den numaralandırır: Mushoku S1 Part 1
   * sayfası 1–11, Part 2 sayfası (`…-2nd-season`) 1–12. Bizim sezonumuz ise cour'ları
   * BİRLEŞİK numaralar (1–23). Part 2 için `min = 12` olunca eski mantık SEZONA GÖRE
   * adayı (`12 − 11 = 1`) ÖNCE deniyordu; aday listesinin İLK adresi (1. cour sayfası)
   * "1" bölümünü İÇERDİĞİ için çözüm orada BAŞARILI sanılıp 1. cour'un 1. bölümü
   * yazılıyordu. Yani mutlak 12 → 1. bölüm oynuyordu.
   *
   * AYIRT EDİCİ SİNYAL: bir sayfanın bölüm SAYISI tam olarak `min − 1` ise o sayfa
   * ARDIMIZDAKİ cour'dur (bizim sezon o sayfanın bittiği yerden başlıyor). Böyle bir
   * sayfada GÖRELİ aday geçersizdir → yalnızca ham aday denenir; ham da yoksa aday
   * başarısız olur ve çözücü SIRADAKİ (doğru cour) sayfaya ilerler. 1 tabanlı
   * sezonlarda ve gerçek kaymalarda (`min` bizim sezonun min'i, sayfa uzunluğu
   * `min − 1` DEĞİL) davranış DEĞİŞMEZ.
   */
  if (Number.isFinite(pageCount) && pageCount === min - 1) return [value];

  const relative = rawNumber - (min - 1);
  if (relative < 1) return [value];
  const relativeText = String(relative);
  // "Aynı numaralandırma": kaynağın ilk bölümü bizim ilk bölümümüzse ham numara önce.
  const sameNumbering = Number.isFinite(pageFirst) && pageFirst === min;
  const ordered = sameNumbering ? [value, relativeText] : [relativeText, value];
  return ordered.filter((item, index) => ordered.indexOf(item) === index);
}

/**
 * ── AĞ DİZİNİYLE SEZON ADRESİ BULMA (KALICI ÇÖZÜM, 27.09.2026) ────────────────
 *
 * KÖK SEBEP: sezon adresleri KALIPLA türetilemiyor. Ölçüm (27.09.2026, canlı):
 *   Mushoku Tensei 3. sezon → ağda `mushoku-tensei-iii-isekai-ittara-honki-dasu`
 *   Mushoku Tensei 2. sezon → ağda `mushoku-tensei-ii-isekai-ittara-honki-dasu`
 *   Re:Zero 2. sezon        → ağda `rezero-kara-hajimeru-isekai-seikatsu-2-sezon`
 * Yani biri başlığın İÇİNE roma rakamı koyuyor, öteki sonuna Türkçe "2. Sezon"
 * yazıyor. Kullanıcı haklı olarak "her yeni anime/sezon eklediğimde adresi ben mi
 * yapıştıracağım?" diye sordu. ÇÖZÜM: adresi TAHMİN ETMEYİ BIRAKMAK.
 *
 * Ağ kendi dizinini yayınlıyor: `puffytr.com/sitemaps` → `sitemap/seriler/0`
 * (ÖLÇÜM: 4849 kayıt, ~2 MB, 4831'inde dizi ADI var):
 *   <loc>https://puffytr.com/mushoku-tensei-iii-…</loc>
 *   <image:title>Mushoku Tensei III: Isekai Ittara Honki Dasu</image:title>
 * Bu dizin ağın KENDİ verisidir (uydurma yok) ve sezon bulmayı iki yolla sağlar:
 *   1) ADRES AİLESİ: aday tabanla başlayan ve sezon işareti tam istenen sezon olan
 *      adresler (ör. taban `mushoku-tensei` → `…-iii-…` = 3).
 *   2) AD EŞLEŞMESİ: dizindeki dizi adı bizim başlık/slug sözcüklerimizle örtüşen
 *      ve sezon işareti tam istenen sezon olan kayıtlar. Bu yol, slug'ı ağdaki
 *      adla alakasız dizileri de kurtarır (ör. bizim `erased` ↔ ağın
 *      `boku-dake-ga-inai-machi`).
 *
 * GÜVENLİK: her aday YİNE bölüm sayfası çekilerek DOĞRULANIR (bkz. `api.anizm`).
 * "Part 2" gibi BELİRSİZ işaretler sezon sayılmaz (0 döner) — yanlış sezonun
 * bölümlerini yazmak, hiç yazmamaktan kötüdür.
 */

/** Ağ dizinindeki bir kayıt: adres + ağın verdiği dizi adı (boş olabilir). */
export type NetworkEntry = { slug: string; title: string };

/** Roma rakamı → sezon (tek başına "I" belirsiz sayılır, kullanılmaz). */
const ROMAN_SEASONS: Record<string, number> = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };

// Metin sadeleştirme/eşleştirme TEK YERDE: `lib/title-match.ts` (çağıranlar
// `foldText`/`tokenize` adlarıyla oradan çağırır).
import { MIN_MATCH_SCORE, titleSimilarity, tokenize } from "@/lib/title-match";

/** `2nd Season`, `2. Sezon`, `Season 2` gibi yazımlar. */
const TITLE_SEASON_RES: RegExp[] = [
  /\b(\d+)\s*(?:st|nd|rd|th)\s+season\b/i,
  /\b(\d+)\s*\.\s*sezon\b/i,
  /\b(\d+)\s+sezon\b/i,
  /\bseason\s*(\d+)\b/i,
  /\bsezon\s*(\d+)\b/i,
];

/** `Part 2`: kısım işareti — bu TEK BAŞINA sezon değildir, belirsiz sayılır. */
const PART_RE = /\bpart\s*\d+\b/i;

/**
 * Dizi DEĞİL sayılan ekler (film/özel bölüm/derleme/YAN ÜRÜN…).
 *
 * ── 27.09.2026 ÖLÇÜMÜ: YAN ÜRÜN ANA DİZİ SANILIYORDU ─────────────────────────
 * Re:Zero **2. sezon** isteği, ağ dizininden `rezero-kara-hajimeru-break-time-
 * 2nd-season` adresini **`ok:true`** ile döndürüyordu. "Break Time" 5 dakikalık
 * bir YAN ÜRÜNDÜR; panel bu sonucu güvenip 13 bölümün tamamına yanlış dizinin
 * videolarını yazacaktı. (`mal`, `show`, `title` verilerek de aynı sonuç alındı —
 * yani eksik parametre değil, eşleştirme hatasıydı.)
 *
 * Kök sebep iki katmanlıydı:
 *   · `\bshort\b` "Shorts" ile EŞLEŞMİYOR — ardından `s` geldiği için sözcük
 *     sınırı tutmuyor; bu yüzden `short` → `shorts?` yapıldı.
 *   · "Break Time" hiç listede yoktu; yan ürün işareti taşımadığı için ceza
 *     almıyor ve yüksek benzerlik puanıyla ana diziyi geçiyordu.
 *
 * Bu desen `seasonNumberFromTitle` içinde de kullanıldığı için buradaki işaret
 * adayı **tamamen eler** (belirsiz → sezon 0). İstenen davranış budur: yanlış
 * dizinin bölümlerini yazmaktansa hiç yazılmaz (proje kuralı: "uydurma yok").
 */
const NON_SERIES_RE =
  /\b(movie|film|specials?|ova|ona|recap|summary|live-action|picture\s+drama|trailer|pv|shorts?|break\s*time|petit|kanketsu)\b/i;

/**
 * Ağdaki bir DİZİ ADINDAN sezon numarasını çıkarır.
 *
 * `1` = sezon işareti yok (düz kayıt), `0` = BELİRSİZ (film/özel bölüm ya da
 * yalnızca "Part 2" gibi bir kısım işareti) → belirsiz olan aday gösterilmez.
 */
function seasonNumberFromTitle(title: string): number {
  const text = (title ?? "").trim();
  if (!text) return 0;
  if (NON_SERIES_RE.test(text)) return 0;
  for (const re of TITLE_SEASON_RES) {
    const match = re.exec(text);
    if (match) {
      const value = Number.parseInt(match[1] ?? "", 10);
      return Number.isFinite(value) && value >= 1 ? value : 0;
    }
  }
  // Roma rakamı BÜYÜK harf ve tek başına olmalı ("II", "III"); "I" belirsiz.
  const roman = /\b(II|III|IV|V|VI)\b/.exec(text);
  if (roman) {
    const value = ROMAN_SEASONS[(roman[1] ?? "").toLowerCase()];
    if (value) return value;
  }
  // Yalnızca "Part 2" varsa sezon bilgisi YOK: belirsiz.
  if (PART_RE.test(text)) return 0;
  return 1;
}

/**
 * Bir ADRESİN sezon işaretini çözer: `2` = "bu kayıt 2. sezon", `1` = düz kayıt,
 * `0` = işaret yok ya da BELİRSİZ (ör. `part-2`) → aday gösterilmez.
 *
 * Ölçüm örnekleri: `…-2nd-season`/`…-3rd-season` → 2/3, `…-2-sezon` → 2,
 * `-s3` → 3, `-season-2` → 2, tabanın hemen ardından roma rakamı (`…-iii-…`) → 3,
 * `…-part-2` → 0 (belirsiz).
 */
export function seasonMarkOf(slug: string, base: string): number {
  const clean = slug.trim();
  const root = base.trim().replace(/-izle$/i, "");
  if (!clean || !root) return 0;
  if (clean === root) return 1;
  if (!clean.startsWith(`${root}-`)) return 0;

  const tokens = clean
    .slice(root.length + 1)
    .split("-")
    .filter(Boolean);
  const first = (tokens[0] ?? "").toLowerCase();
  if (!first) return 0;
  const second = (tokens[1] ?? "").toLowerCase();

  const ordinal = /^(\d+)(?:st|nd|rd|th)?$/.exec(first);
  if (ordinal) {
    const value = Number.parseInt(ordinal[1] ?? "", 10);
    // Sayı yalnızca ardından "sezon"/"season" geliyorsa sezon işaretidir.
    return value > 1 && (second === "sezon" || second === "season") ? value : 0;
  }
  if (first === "season" || first === "sezon") {
    const value = Number.parseInt(second, 10);
    return Number.isFinite(value) && value > 1 ? value : 0;
  }
  const short = /^s(\d{1,2})$/.exec(first);
  if (short) {
    const value = Number.parseInt(short[1] ?? "", 10);
    return value > 1 ? value : 0;
  }
  const roman = ROMAN_SEASONS[first];
  return roman && roman > 1 ? roman : 0;
}

/** Aday: adres + neden seçildiği + puan (yüksek = daha güvenilir). */
export type NetworkCandidate = { slug: string; reason: string; score: number };

/**
 * Ağ dizininden SEZON ADAYLARI — iki yol birleştirilir ve PUANLANIR.
 *
 * @param index  ağ dizini (`slug` + ağın dizi adı)
 * @param query  `season` istenen sezon; `bases` adres ailesi tabanları;
 *               `titles` sorgu ADLARI (bizim başlık, romaji, eşanlamlılar, slug
 *               metni). Her ad ayrı denenir ve EN İYİ BENZERLİK kazanır — katı
 *               eşitlik aranmaz (bkz. `lib/title-match.ts`).
 *
 * PUAN: adres ailesi (90 + taban uzunluğu) > ad eşleşmesi (60 + benzerlik×30).
 * Aynı puanda kısa adres önce gelir ("…-ii-…", "…-ii-…-part-2"ten önce).
 */
export function networkSeasonCandidates(
  index: NetworkEntry[],
  query: { season: number; bases: string[]; titles: string[] },
): NetworkCandidate[] {
  const season = Math.floor(query.season);
  if (!Number.isFinite(season) || season < 1) return [];

  const bases = query.bases
    .map((value) => value.trim())
    .filter((value, i, list) => Boolean(value) && list.indexOf(value) === i);
  const titles = query.titles
    .map((value) => (value ?? "").trim())
    .filter((value, i, list) => Boolean(value) && list.indexOf(value) === i);

  const best = new Map<string, NetworkCandidate>();
  const put = (candidate: NetworkCandidate) => {
    const previous = best.get(candidate.slug);
    if (!previous || previous.score < candidate.score) best.set(candidate.slug, candidate);
  };

  for (const entry of index) {
    const slug = (entry.slug ?? "").trim();
    if (!slug) continue;
    const title = (entry.title ?? "").trim();

    // (1) ADRES AİLESİ: tabanla başlıyor ve sezon işareti TAM istenen sezon.
    //     UZUN taban daha güvenilirdir: çağıran kısa önek de verebiliyor (ağ sezon
    //     işaretini başlığın ortasına koyduğunda gerekir), o yüzden puan tabanın
    //     sözcük sayısıyla artar ama ad eşleşmesinin (en fazla 90) ÜSTÜNDE kalır.
    for (const base of bases) {
      if (seasonMarkOf(slug, base) === season) {
        const weight = base.split("-").filter(Boolean).length;
        put({ slug, reason: `adres ailesi (${base})`, score: 90 + Math.min(weight, 8) });
        break;
      }
    }

    // (2) AD EŞLEŞMESİ: dizin adı bizim adlarımızdan biriyle BENZER ve sezon tam.
    //     KATI EŞİTLİK ARANMAZ: "Mushoku Tensei: Jobless Reincarnation" ile
    //     "Mushoku Tensei II: Isekai Ittara Honki Dasu" gibi farklı yazımlar da
    //     puanlanır (bkz. `lib/title-match.ts`).
    if (title) {
      if (seasonNumberFromTitle(title) === season) {
        let cover = 0;
        for (const candidate of titles) cover = Math.max(cover, titleSimilarity(candidate, title));
        if (cover >= MIN_MATCH_SCORE) {
          // Film/özel bölüm işaretli kayıt ELENMEZ, son sıraya düşer.
          const penalty = NON_SERIES_RE.test(title) ? 40 : 0;
          put({
            slug,
            reason: `ad eşleşmesi (${title})`,
            score: 60 + Math.round(cover * 30) - penalty,
          });
        }
      }
    }
  }

  return [...best.values()].sort(
    (a, b) => b.score - a.score || a.slug.length - b.slug.length || a.slug.localeCompare(b.slug),
  );
}

/** Anizm oynatıcı adresi geçerli mi (hash biçimi denetimi). */
export const ANIZM_PLAYER_RE = /^https:\/\/anizmplayer\.com\/video\/[0-9a-f]{16,}$/i;

/**
 * "PART N" / "COUR N" / "KISIM N" — AYNI SEZONUN DEVAMI (yeni sezon DEĞİL).
 *
 * Kullanıcı bildirimleri (29.09.2026):
 *  - "animecix'te veya başka yerlerde part ayırmıyorlar, direkt 25 bölüm veriyorlar."
 *  - "Mushoku Tensei eklediğim 2 tanesi part'tı, 1. sezona aitti aslında,
 *     ama 2 ayrı sezon olarak yükledi."
 *
 * DOĞRULANMIŞ ÖRNEK (MAL): 39535 = Mushoku Tensei S1 (11 bölüm) ve MAL'in kendi
 * ilişkisi: Sequel → 45576 "Mushoku Tensei: ... Part 2" (12 bölüm) = S1'in ikinci
 * yarısı → toplam 23 bölüm TEK sezon. Sağlayıcılar sezonu tek parça numaralandırır.
 *
 * ── GENİŞLETİLDİ (29.09.2026, ikinci tur) ────────────────────────────────────
 * Önceki kalıp `(?:part|cour|kısım|kisim)\s*\d+` idi; bu, "Part 2"/"Cour 2"yu
 * yakalıyor ama **"2nd Cour"** (sayı ÖNCE gelir) ve **"Kōhen/Kouhen"** (Japonca
 * "ikinci yarı") ibarelerini KAÇIRIYORDU — o başlıklar yanlışlıkla "yeni sezon"
 * sayılırdı. Artık kelime sınırıyla eşleşen tek liste kullanılır:
 *   · part / cour / kısım / kisim / kōhen / kohen / kouhen
 * SIRA ÖNEMSİZ: ibare başlığın neresinde olursa olsun (başta, sonda) yakalanır.
 * `\b` sınırı "Courage" gibi kelimelerin içindeki "cour"u yakalamaz.
 */
export function isPartContinuation(title: string): boolean {
  return /\b(?:part|cour|k[ıi]s[ıi]m|k[oō]u?hen)\b/i.test(title);
}
