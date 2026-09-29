/**
 * DeepL API — SUNUCU TARAFI çeviri istemcisi.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NEDEN SUNUCU TARAFI (ÖNEMLİ — GÜVENLİK)
 *
 * Anahtar `DEEPL_API_KEY` olarak tutulur; `VITE_` öneki YOKTUR. Vite yalnızca
 * `VITE_` ile başlayan değişkenleri istemci paketine gömer — bu önek olmadığı
 * için anahtar tarayıcıya HİÇ gitmez, yalnızca sunucu rotasında okunur.
 * (Aynı desen `STREAMTAPE_KEY` ve `OPENSUBTITLES_API_KEY` için de kullanılıyor.)
 *
 * ── UÇ NOKTA SEÇİMİ ────────────────────────────────────────────────────────
 * Anahtar `:fx` ile bitiyor = **DeepL API Free** planı. Ücretsiz anahtarlar
 * YALNIZCA `api-free.deepl.com` üzerinde çalışır; `api.deepl.com`'a giderse
 * 403 döner. Bu yüzden uç nokta anahtarın `:fx` ekine göre SEÇİLİR — kullanıcı
 * ileride ücretli plana geçerse kod değişmeden çalışsın.
 *
 * ── ÖLÇÜM (28.09.2026) ─────────────────────────────────────────────────────
 * `GET /v2/usage` → `character_count: 0`, `character_limit: 1000000`.
 * `POST /v2/translate` (EN→TR) → 200, doğru Türkçe çıktı.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** Ücretsiz plan ucu (`:fx` anahtarlar). */
const FREE_ENDPOINT = "https://api-free.deepl.com/v2/translate";
/** Ücretli plan ucu (`:fx` OLMAYAN anahtarlar). */
const PRO_ENDPOINT = "https://api.deepl.com/v2/translate";

/** Tek istekte gönderilecek en fazla metin. DeepL sınırı 50; pay bırakılır. */
export const DEEPL_MAX_TEXTS_PER_REQUEST = 40;

/**
 * DeepL'in `target_lang` kodları bizim dillerden farklıdır: BÜYÜK HARF ve
 * İngilizce için bölge kodlu (`EN-US`). DeepL `"en"` yazımını da kabul eder ama
 * bölge kodlu yazım hangi İngilizce'nin istendiğini açıkça belirtir.
 */
export type DeepLTarget = "TR" | "EN-US" | "EN-GB";

/** Hedef kodunu çevirir. */
export function deepLTarget(lang: "tr" | "en"): DeepLTarget {
  return lang === "tr" ? "TR" : "EN-US";
}

/** Anahtarın ücretsiz planda olup olmadığı (`:fx` eki). */
export function isFreeKey(apiKey: string): boolean {
  return /:fx$/i.test(apiKey.trim());
}

/**
 * Çeviri sonucu — ya çeviriler ya da SEBEP.
 *
 * NEDEN `throw` YOK: çeviri bir "süs"tür, sayfanın çalışması ona bağlı değil.
 * Kota bitmesi / ağ hatası durumunda içerik ORİJİNALİYLE gösterilmelidir;
 * rota bunu ayırt edebilmek için hatayı veriye çevirir (bkz. `api.translate.ts`).
 */
export type DeepLResult =
  { ok: true; translations: string[] } | { ok: false; reason: string; retryable: boolean };

/**
 * Verilen metinleri sırayla çevirir; dönen dizinin SIRASI girişle BİREBİR aynıdır.
 *
 * @param texts Çevrilecek metinler (boş dizeler korunur, API'ye gönderilmez).
 * @param target Hedef dil.
 */
export async function translateWithDeepL(
  texts: string[],
  target: DeepLTarget,
): Promise<DeepLResult> {
  const apiKey = (process.env["DEEPL_API_KEY"] ?? "").trim();
  if (!apiKey) {
    return {
      ok: false,
      reason: "DEEPL_API_KEY tanımlı değil (.env)",
      retryable: false,
    };
  }

  const endpoint = isFreeKey(apiKey) ? FREE_ENDPOINT : PRO_ENDPOINT;

  // Form gövdesi: DeepL çoklu metni TEKRARLANAN `text` alanıyla alır.
  const form = new URLSearchParams();
  for (const text of texts) form.append("text", text);
  form.set("target_lang", target);
  // Kaynak dili BİLDİRİLİR: bölüm adları/kısa jenerikler tek başına geldiğinde
  // otomatik algılama yanılabiliyor ("Master" gibi tek sözcükler). Kaynağımız
  // katalog olduğu için İngilizce sabit.
  form.set("source_lang", "EN");
  // Biçimlendirme korunur: özetlerde satır sonları kaybolmasın.
  form.set("preserve_formatting", "1");

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });

    if (!res.ok) {
      /**
       * 456 = kota doldu (DeepL'e özgü kod). 403 = yanlış plan ucu / geçersiz
       * anahtar. 429 = çok hızlı istek. Bunlar ayırt edilir ki panelde doğru
       * şey yazılabilsin ve gereksiz yeniden deneme yapılmasın.
       */
      const detail = await res.text().catch(() => "");
      const reason =
        res.status === 456
          ? "DeepL ücretsiz kota doldu (bu ay için karakter sınırı)"
          : res.status === 403
            ? "DeepL anahtarı reddedildi (geçersiz ya da plan ucu uyuşmuyor)"
            : res.status === 429
              ? "DeepL istek sınırı (çok hızlı) — biraz sonra tekrar dene"
              : `DeepL ${res.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}`;
      return { ok: false, reason, retryable: res.status === 429 || res.status >= 500 };
    }

    const json = (await res.json()) as { translations?: { text?: string }[] };
    const list = json.translations ?? [];
    if (list.length !== texts.length) {
      return {
        ok: false,
        reason: `DeepL ${texts.length} metne karşılık ${list.length} çeviri döndü`,
        retryable: false,
      };
    }
    return { ok: true, translations: list.map((item) => item.text ?? "") };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
      retryable: true,
    };
  }
}

/** Kotayı okur (panelde "kalan karakter" göstermek için). */
export async function deepLUsage(): Promise<
  { ok: true; used: number; limit: number } | { ok: false; reason: string }
> {
  const apiKey = (process.env["DEEPL_API_KEY"] ?? "").trim();
  if (!apiKey) return { ok: false, reason: "DEEPL_API_KEY tanımlı değil (.env)" };
  const base = isFreeKey(apiKey) ? "https://api-free.deepl.com" : "https://api.deepl.com";
  try {
    const res = await fetch(`${base}/v2/usage`, {
      headers: { Authorization: `DeepL-Auth-Key ${apiKey}` },
    });
    if (!res.ok) return { ok: false, reason: `DeepL ${res.status}` };
    const json = (await res.json()) as { character_count?: number; character_limit?: number };
    return {
      ok: true,
      used: json.character_count ?? 0,
      limit: json.character_limit ?? 0,
    };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
