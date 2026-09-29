/**
 * ── ESNEK AD EŞLEŞTİRME (FUZZY MATCH) ────────────────────────────────────────
 *
 * NEDEN VAR (kullanıcı kararı, 27.09.2026): kaynaklar aynı animeyi farklı yazıyor —
 * biri `Mushoku Tensei`, öteki `Mushoku Tensei: Jobless Reincarnation`, bir başkası
 * `Boku dake ga Inai Machi` (bizim ekranda `Erased`). Katı `a === b` karşılaştırması
 * bu yüzden sürekli "bulunamadı" veriyordu. Bu dosya, adları PUANLAYARAK eşleştirir;
 * tam ad tutmazsa eşanlamlılar (romaji/İngilizce/synonym) sırayla denenir ve HATA
 * FIRLATILMAZ — en iyi aday döner, hiç uygun aday yoksa `null`.
 *
 * TASARIM KARARI — SIRA BAĞIMSIZ PUAN: sözcük kümesi karşılaştırılır (F1), çünkü
 * kaynaklar sözcük sırasını ve noktalama işaretlerini değiştiriyor
 * ("Re:Zero kara Hajimeru Isekai Seikatsu" ↔ "Re Zero kara Hajimeru Isekai Seikatsu").
 * TEK SÖZCÜKLÜ sorgularda ek şart vardır: sözcük adayın BAŞINDA olmalı, yoksa
 * "the" gibi bir sözcük yüzlerce diziyle eşleşirdi.
 *
 * ⚠️ BAĞIMSIZLIK: bu dosya HİÇBİR ŞEY İTHAL ETMEZ; saf metin matematiğidir. Böylece
 * hem tarayıcıda (panel) hem sunucuda (rotalar) hem de Node testinde aynı şekilde
 * çalışır ve `lib/puffy.ts` gibi yerler tek kaynaktan beslenir.
 */

/** Türkçe/aksanlı harfleri ASCII'ye indirger (karşılaştırma için). */
const FOLD: [RegExp, string][] = [
  [/[İIı]/g, "i"],
  [/[Şş]/g, "s"],
  [/[Ğğ]/g, "g"],
  [/[Üü]/g, "u"],
  [/[Öö]/g, "o"],
  [/[Çç]/g, "c"],
  [/[Ââ]/g, "a"],
  [/[Îî]/g, "i"],
  [/[Ûû]/g, "u"],
];

/** Karşılaştırma için sadeleştirilmiş metin (küçük harf + aksansız). */
export function foldText(value: unknown): string {
  let out =
    typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
  for (const [re, ch] of FOLD) out = out.replace(re, ch);
  return out.toLowerCase();
}

/**
 * Karşılaştırmada YOK SAYILAN sözcükler.
 *
 * Yalnızca araya girip puanı bozan bağlaçlar/ekler: İngilizce tanımlıklar ve
 * Türkçe "ve/ile". Anime adlarındaki anlamlı parçacıklar (no, ga, wa, de) BİLEREK
 * listede DEĞİL — onlar adın parçası ve ayırt edici.
 */
const STOPWORDS = new Set(["the", "a", "an", "and", "of", "ve", "ile", "to", "in", "on"]);

/** Metni anlamlı sözcüklere indirger (`Mushoku III: …` → [mushoku, iii, …]). */
export function tokenize(value: unknown): string[] {
  return foldText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => Boolean(token) && !STOPWORDS.has(token));
}

/**
 * İki metin arasındaki düzenleme (Levenshtein) benzerliği: `1 - mesafe/uzunluk`.
 *
 * NEDEN GEREKLİ: kaynak adlarında harf farkı çok oluyor ("Kılıç Ustası" ↔
 * "Kilinc Ustasi", "Jujutsu" ↔ "Jujustu"). Sözcük bazlı karşılaştırma bunları
 * "tamamen farklı" sayıyordu; bu yardımcı yalnızca YAKIN yazımları eşler.
 */
export function editSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const left = foldText(a);
  const right = foldText(b);
  if (!left || !right) return 0;
  const longest = Math.max(left.length, right.length);
  if (longest === 0) return 0;

  // Kısa dizilerde klasik DP (metinler kısa: ad sözcükleri).
  const previous = new Array<number>(right.length + 1).fill(0);
  const current = new Array<number>(right.length + 1).fill(0);
  for (let j = 0; j <= right.length; j += 1) previous[j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j] ?? 0;
  }
  return 1 - (previous[right.length] ?? longest) / longest;
}

/** İki sözcük eşleşiyor mu? (birebir ya da yeterince yakın yazım) */
const TOKEN_FUZZ_MIN_LENGTH = 5;
const TOKEN_FUZZ_MIN_SCORE = 0.8;

export function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  // Kısa sözcüklerde yakınlık tehlikeli ("the" ↔ "then"); yalnızca uzunlarda.
  if (a.length < TOKEN_FUZZ_MIN_LENGTH || b.length < TOKEN_FUZZ_MIN_LENGTH) return false;
  return editSimilarity(a, b) >= TOKEN_FUZZ_MIN_SCORE;
}

/**
 * İki ad arasındaki benzerlik (0..1).
 *
 * PUANLAMA SIRASI:
 *   1) Tam eşleşme (aynı sözcük kümesi) → 1
 *   2) Sorgunun TÜM sözcükleri adayda var → 0.95
 *      ("Mushoku Tensei" ⊆ "Mushoku Tensei: Jobless Reincarnation")
 *   3) F1 skoru (sözcük kesişimi; sıra ve noktalama farkına dayanıklı)
 * TEK SÖZCÜKLÜ sorgu: adayın ilk sözcüğü olmalı, yoksa 0.
 */
export function titleSimilarity(query: unknown, candidate: unknown): number {
  const queryTokens = tokenize(query);
  const candidateTokens = tokenize(candidate);
  if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;

  const querySet = new Set(queryTokens);
  const candidateSet = new Set(candidateTokens);

  // TEK SÖZCÜK KORUMASI: "erased" sorgusu "Boku dake ga Inai Machi" ile eşleşmesin.
  if (querySet.size === 1) {
    const queryToken = queryTokens[0] as string;
    const candidateFirst = candidateTokens[0] as string;
    if (candidateFirst === queryToken) return 1;
    return tokensMatch(queryToken, candidateFirst) ? 0.95 : 0;
  }

  // Kesişim: birebir eşleşenler + YAKIN yazımlar (`tokensMatch`) sayılır.
  let shared = 0;
  for (const token of querySet) {
    if (candidateSet.has(token) || candidateTokens.some((item) => tokensMatch(token, item))) {
      shared += 1;
    }
  }

  const exact = shared === querySet.size && shared === candidateSet.size;
  if (exact) return 1;

  const recall = shared / querySet.size;
  const precision = shared / candidateSet.size;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // Sorgunun tamamı adayda geçiyorsa güçlü kabul edilir.
  const covers = recall === 1 ? 0.95 : 0;
  return Math.max(covers, f1);
}

/** En düşük kabul edilebilir benzerlik. Altındaki adaylar "eşleşme" sayılmaz. */
export const MIN_MATCH_SCORE = 0.6;

/** Aday kaydı: değer + o kaydın BİLİNEN TÜM adları (eşanlamlılar dâhil). */
export type MatchCandidate<T> = {
  value: T;
  /** Adlar sırayla denenir: romaji, İngilizce, eşanlamlı, bizim başlık… */
  titles: (string | null | undefined)[];
};

/** Puanlanmış eşleşme. */
export type ScoredMatch<T> = {
  value: T;
  /** 0..1 — yüksek daha iyi. */
  score: number;
  /** Hangi ad üzerinden eşleşti (kayda geçer, şeffaflık için). */
  matchedTitle: string;
  /** Kaçıncı sorgu terimiyle bulundu (0 = ilk terim; fallback sırası görünsün). */
  termIndex: number;
};

/**
 * Sorgu TERİMLERİNİ sırayla dener ve adayları PUANLAR (en iyi eşleşme başta).
 *
 * NEDEN TERİM LİSTESİ (tek metin değil): kullanıcı isteği — "tam isimle bulamıyorsa
 * alternatif isimleri (synonyms) de deneyecek bir fallback". Çağıran; bizim başlık,
 * romaji ad, İngilizce ad, eşanlamlılar ve slug sözcüklerini sırayla verir; erken
 * terimler (daha güvenilir olanlar) eşitlikte öne geçer.
 *
 * @param terms      denenecek adlar (sırayla; boş/yinelenen olanlar elenir)
 * @param candidates adaylar ve onların adları
 * @param options    `minScore` (varsayılan `MIN_MATCH_SCORE`), `limit`
 */
export function rankMatches<T>(
  terms: readonly (string | null | undefined)[],
  candidates: readonly MatchCandidate<T>[],
  options: { minScore?: number; limit?: number } = {},
): ScoredMatch<T>[] {
  const minScore = Number.isFinite(options.minScore) ? Number(options.minScore) : MIN_MATCH_SCORE;
  const cleanTerms: string[] = [];
  for (const term of terms ?? []) {
    const text = typeof term === "string" ? term.trim() : "";
    if (text && !cleanTerms.includes(text)) cleanTerms.push(text);
  }
  if (cleanTerms.length === 0) return [];

  const best = new Map<T, ScoredMatch<T>>();
  for (const candidate of candidates ?? []) {
    const titles = (candidate?.titles ?? []).filter(
      (title): title is string => typeof title === "string" && title.trim().length > 0,
    );
    if (titles.length === 0) continue;

    for (let termIndex = 0; termIndex < cleanTerms.length; termIndex += 1) {
      const term = cleanTerms[termIndex] as string;
      for (const title of titles) {
        const score = titleSimilarity(term, title);
        if (score < minScore) continue;
        // ERKEN TERİM ÖNCELİĞİ: terim sırası puana küçük bir katkı yapar
        // (aynı skorda daha güvenilir terim kazansın), ama skoru bozmaz.
        const weighted = score + (cleanTerms.length - termIndex) * 0.001;
        const previous = best.get(candidate.value);
        if (!previous || weighted > previous.score) {
          best.set(candidate.value, {
            value: candidate.value,
            score: weighted,
            matchedTitle: title,
            termIndex,
          });
        }
      }
    }
  }

  const ranked = [...best.values()].sort(
    (a, b) => b.score - a.score || a.matchedTitle.length - b.matchedTitle.length,
  );
  return Number.isFinite(options.limit) && Number(options.limit) > 0
    ? ranked.slice(0, Number(options.limit))
    : ranked;
}

/** En iyi eşleşme (yoksa `null`) — "hata fırlatmak yerine" davranışın kendisi. */
export function bestMatch<T>(
  terms: readonly (string | null | undefined)[],
  candidates: readonly MatchCandidate<T>[],
  options: { minScore?: number } = {},
): ScoredMatch<T> | null {
  return rankMatches(terms, candidates, options)[0] ?? null;
}

/**
 * Slug'ı aranabilir ada çevirir (`mushoku-tensei-iii` → `mushoku tensei iii`).
 * Kaynak slug'ları adlardan üretildiği için arama terimi olarak çok işe yarar.
 */
export function slugToText(slug: unknown): string {
  return foldText(slug).replace(/[-_]+/g, " ").trim();
}
