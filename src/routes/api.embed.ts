// /api/embed — Sağlayıcı ("çözülen") embed adresini SUNUCUDA çözer ve
// ERİŞİLEBİLİRLİĞİNİ doğrular; oynatıcıyı getirmeyen adresi DÖNDÜRMEZ.
//
// NEDEN SUNUCU ROTASI (istemci değil):
//   · `megaplay.buzz` iframe DIŞI isteklerde oynatıcı yerine hata sayfası döndürüyor
//     ve bu isteği tarayıcıdan yapmak çapraz-kaynak (CORS) engeline takılır — yani
//     istemci "bu adres oynatıcı getiriyor mu" sorusunu ÖLÇEMEZ. Ölçüm sunucuda
//     yapılır (bkz. lib/embed-provider.ts dosya başı doğrulama günlüğü).
//   · İstek kısa timeout'ludur (bkz. VERIFY_TIMEOUT_MS) ve sonuç `cachedRead` ile
//     kısa süre hatırlanır (bkz. server-cache.ts → TTL_EMBED_SECONDS): sayfa açılışı
//     beklemez, megaplay/AniList'e istek yağmuru olmaz.
//
// ÇÖZÜM SIRASI (provider=megaplay):
//   1) `mal/` şablonu — MAL kimliğiyle (birincil; bkz. lib/embed-provider.ts).
//   2) `ani/` şablonu — AniList kimliğiyle (YEDEK). AniList kimliği MAL kimliğinden
//      AniList GraphQL (`Media(idMal:$id)`) ile bulunur (projedeki mevcut desen;
//      bkz. routes/api.anizm.ts → fetchAniListTitles). Sonuç da önbelleklenir.
//   3) İkisi de oynatıcı getirmiyorsa `url: null` döner → istemci o kaynağı listede
//      HİÇ GÖSTERMEZ (izleyici 404 ekranı görmez, sıradaki kaynak oynar).
//
// DİL SEGMENTİ: yalnızca `sub` | `dub` geçerlidir. `tr` GEÇERSİZ → Error.
//   Ölçüm: `/stream/mal/45576/1/tr` → `Error - MegaPlay`. Birincil dil `sub`;
//   `dub` yalnızca birincil dil hiçbir yolda oynamazsa denenen YEDEKTİR.
//
// PART EŞLEMESİ (asıl düzeltme): bir sezon kaydı birden çok MAL kaydına yayılabilir.
//   Mushoku Tensei S1: 1–11 Part 1 (MAL 39535) · 12–23 Part 2 (MAL 45576).
//   MegaPlay bölümü part'ın KENDİ kimliği + PART İÇİ göreli numarayla verir; mutlak
//   bölüm doğrudan sorgulanırsa 2. part kaybolur. Ölçüm (29.09.2026, canlı):
//     · `/mal/39535/1/sub`  → `File 31629` (VAR)
//     · `/mal/39535/12/sub` → `Error       (Part 1'de 12. bölüm YOK)
//     · `/mal/45576/4/sub`  → `File 27752` (VAR — mutlak 15'in karşılığı)
//   Eşleme önce istekteki `parts`'tan (`show_seasons.parts`), boşsa AniList SEQUEL
//   zincirinden türetilir (bkz. `megaplayPartsForMal`).
//
// ⚠️ HTTP DURUMU TEK BAŞINA YETMEZ: megaplay hata sayfasını da HTTP 200 ile veriyor
// (ölçüm 29.09.2026). Karar GÖVDEDEN verilir: gerçek oynatıcı sayfasının başlığı
// `File <id> - MegaPlay`, hata sayfasınınki `Error - MegaPlay`.
//   Ölçüm: /stream/mal/39535/15/sub → 200 + "Error - MegaPlay" (oynatmıyor),
//          /stream/mal/40748/1/sub → 200 + "File 116363 - MegaPlay" (oynatıyor).

import { createFileRoute } from "@tanstack/react-router";
import {
  isMegaplayStreamUrl,
  megaplayCandidateUrls,
  megaplayTarget,
  type EmbedProviderRequest,
  type SeasonPartEntry,
} from "@/lib/embed-provider";
import { cachedRead, TTL_EMBED_SECONDS } from "@/lib/server-cache";

/** AniList GraphQL ucu — projedeki mevcut desen (bkz. routes/api.anilist.ts). */
const ANILIST_ENDPOINT = "https://graphql.anilist.co";

/**
 * Tek bir doğrulama isteğinin üst sınırı.
 *
 * NEDEN KISA: bu istek sayfa açılışında (istemci) beklenir; yavaş bir upstream
 * izleyiciyi bekletmemeli. Zaman aşımı = \"oynatıcı gelmedi\" sayılır → kaynak
 * gösterilmez (yanlış bir 404 ekranı göstermektense kaynağı hiç göstermemek).
 */
const VERIFY_TIMEOUT_MS = 3000;

/**
 * MAL → AniList kimliği eşlemesi: 6 saat.
 *
 * NEDEN 6 SAAT: bu, megaplay'in kendi kataloğu değil AniList'in eşlemesidir ve gün
 * mertebesinde değişir; AniList yanıtları CDN'de önbelleklenmediği için önbelleği
 * BİZ kurmazsak her bölüm açılışında bir upstream isteği olurdu.
 */
const ANILIST_ID_TTL_SECONDS = 6 * 60 * 60;

const ANILIST_ID_QUERY = `query ($mal: Int) {
  Media(idMal: $mal, type: ANIME) {
    id
  }
}`;

/**
 * PART zinciri sorgusu — `show_seasons.parts` BOŞSA yedek türetme için.
 *
 * NEDEN: sezon kaydı birden çok MAL kaydına yayılabilir (Part 1 + Part 2). Uygulama
 * bu eşlemeyi `show_seasons.parts` (jsonb) olarak yazar; ama kayıt henüz yazılmamışsa
 * (ölçüm 29.09.2026: mushoku-tensei S1 satırında `parts = null`) mutlak bölüm yanlış
 * kayda gider ve sağlayıcı `Error` döndürür. Bu sorgu AniList SEQUEL zincirini
 * yürüyerek aynı eşlemeyi türetir: her part'ın MAL kimliği + bölüm sayısı.
 *
 * Ölçüm (29.09.2026): `Media(idMal: 39535)` → id 108465, 11 bölüm; SEQUEL →
 * idMal 45576 (AniList 127720), 12 bölüm → parts = [{ malId: 45576, start: 12, count: 12 }].
 */
const ANILIST_PART_QUERY = `query ($mal: Int) {
  Media(idMal: $mal, type: ANIME) {
    id
    episodes
    relations {
      edges {
        relationType
        node {
          idMal
          episodes
        }
      }
    }
  }
}`;

/** Türetmede en fazla kaç part zincirlenir (sonsuz döngüye karşı güvenlik sınırı). */
const MAX_DERIVED_PARTS = 5;

/** Doğrulanacak adresin biçimi (şablonların ürettiği tek biçim). */
const MEGAPLAY_STREAM_RE =
  /^https:\/\/megaplay\.buzz\/stream\/(?:mal|ani)\/[0-9]+\/[0-9]+\/(?:sub|dub)$/;

/**
 * Gerçek oynatıcı sayfası: başlık `File <id> - MegaPlay` **ve** gövdede
 * `id="megaplay-player"`. İki koşul BİRLİKTE aranır (ikisi de ölçülmüş işaretler).
 *
 * Ölçüm (29.09.2026, canlı):
 *   · VAR  : `/stream/mal/45576/4/sub` → `File 27752 - MegaPlay` + marker
 *   · YOK  : `/stream/mal/39535/12/sub` → `Error - MegaPlay`, marker YOK
 */
const PLAYER_TITLE_RE = /<title>\s*File\s+\d+\s*-\s*MegaPlay\s*<\/title>/i;
const PLAYER_MARKER_RE = /id=["']megaplay-player["']/i;

type EmbedResolution = { url: string | null; via: "mal" | "ani" | null };

/**
 * Zaman aşımı kontrollü `fetch`.
 *
 * Başlıklar: megaplay top-level isteklerde embed bağlamı bekliyor; iframe içinden
 * gelen isteği taklit eden UA/Referer ile oynatıcı sayfası dönüyor (ölçümle
 * doğrulandı). Başlıksız istekte hata sayfası dönme riski var.
 */
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: "https://anikoto.cz/",
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Adres oynatıcıyı getiriyor mu?
 *
 * HATA FIRLATMAZ: her türlü başarısızlık (ağ hatası, zaman aşımı, 404/5xx,
 * oynatıcı yerine hata sayfası) `false` demektir. Karar gövdeden verilir çünkü
 * megaplay hata sayfasını da HTTP 200 ile döndürüyor.
 */
async function isPlayable(url: string): Promise<boolean> {
  if (!MEGAPLAY_STREAM_RE.test(url)) return false;
  try {
    const response = await fetchWithTimeout(url, { method: "GET" });
    if (!response.ok) return false;
    const body = await response.text();
    // Başlık + oynatıcı işareti BİRLİKTE aranır (bkz. PLAYER_TITLE_RE notu).
    return PLAYER_TITLE_RE.test(body) && PLAYER_MARKER_RE.test(body);
  } catch {
    return false;
  }
}

/**
 * MAL kimliğinden AniList kimliği (megaplay `ani` yolu için).
 *
 * NEDEN `cachedRead` İÇİNDE ve HATA FIRLATIR: başarısız/eşlemesiz sonuç burada
 * saklanmaz — AniList geçici olarak erişilemezse ilk sonraki istek yeniden dener
 * (bkz. server-cache.ts dosya başı notu). Yalnızca BAŞARILI bir eşleme önbelleğe
 * girer; eşleme yoksa `null` (bu da başarılı bir yanıttır: \"bu MAL kaydı AniList'te
 * ayrı bir kayda karşılık gelmiyor\").
 */
async function anilistIdForMal(malId: number): Promise<number | null> {
  return cachedRead(`anilist:mal-to-id:${malId}`, ANILIST_ID_TTL_SECONDS, async () => {
    const response = await fetch(ANILIST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: ANILIST_ID_QUERY, variables: { mal: malId } }),
    });
    if (!response.ok) throw new Error(`anilist ${response.status}`);
    const envelope = (await response.json()) as {
      data?: { Media?: { id?: number } | null };
      errors?: { message?: string }[];
    };
    if (envelope.errors?.length) throw new Error(envelope.errors[0]?.message ?? "anilist hatası");
    const id = envelope.data?.Media?.id;
    return typeof id === "number" && id > 0 ? id : null;
  });
}

/**
 * Tek bir MAL kaydının AniList part düğümü: bölüm sayısı + SEQUEL ilişkileri.
 *
 * HATA FIRLATIR (bkz. `anilistIdForMal` notu): başarısız sonuç önbelleğe yazılmaz,
 * böylece AniList geçici olarak erişilemezse sonraki istek yeniden dener.
 */
async function fetchAniListPartNode(malId: number): Promise<{
  episodes: number | null;
  sequels: { malId: number | null; episodes: number | null }[];
}> {
  const response = await fetch(ANILIST_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query: ANILIST_PART_QUERY, variables: { mal: malId } }),
  });
  if (!response.ok) throw new Error(`anilist ${response.status}`);
  const envelope = (await response.json()) as {
    data?: {
      Media?: {
        episodes?: number | null;
        relations?: {
          edges?: {
            relationType?: string;
            node?: { idMal?: number | null; episodes?: number | null };
          }[];
        };
      } | null;
    };
    errors?: { message?: string }[];
  };
  if (envelope.errors?.length) throw new Error(envelope.errors[0]?.message ?? "anilist hatası");
  const media = envelope.data?.Media;
  if (!media) return { episodes: null, sequels: [] };
  const sequels = (media.relations?.edges ?? [])
    .filter((edge) => edge.relationType === "SEQUEL")
    .map((edge) => ({ malId: edge.node?.idMal ?? null, episodes: edge.node?.episodes ?? null }));
  return { episodes: media.episodes ?? null, sequels };
}

/**
 * `show_seasons.parts` BOŞSA kullanılan YEDEK: AniList SEQUEL zincirinden part
 * eşlemesini türetir ve 6 saat önbelleğe alır (AniList eşlemesiyle aynı TTL).
 *
 * NEDEN YEDEK: panel part senkronunu çalıştırmadığı sürece `parts` boştur; o
 * durumda çok part'lı sezonun 2. partı yanlış kimlikle sorgulanır ve sağlayıcı
 * `Error` döndürür (kaynak kaybolur). Türetme, kimliği KAYITTAN değil ilişkiden
 * okur; tek part'lı sezonda zincir boş kalır ve mevcut davranış birebir korunur.
 *
 * `start` = önceki part'ların bölüm sayısı toplamı + 1 (mutlak, 1 tabanlı).
 * Veritabanına YAZMAZ — yalnızca okur.
 */
async function megaplayPartsForMal(malId: number): Promise<SeasonPartEntry[]> {
  return cachedRead(`megaplay:parts:${malId}`, ANILIST_ID_TTL_SECONDS, async () => {
    const parts: SeasonPartEntry[] = [];
    const seen = new Set<number>();
    let cursor = malId;
    let accumulated: number | null = null;

    for (let hop = 0; hop < MAX_DERIVED_PARTS; hop++) {
      if (seen.has(cursor)) break;
      seen.add(cursor);

      const node = await fetchAniListPartNode(cursor);
      if (accumulated === null) {
        // Temel kaydın bölüm sayısı bilinmiyorsa part sınırı hesaplanamaz.
        if (typeof node.episodes !== "number" || node.episodes <= 0) break;
        accumulated = node.episodes;
      }

      const next = node.sequels.find(
        (sequel) =>
          typeof sequel.malId === "number" &&
          sequel.malId > 0 &&
          typeof sequel.episodes === "number" &&
          sequel.episodes > 0,
      );
      if (!next || typeof next.malId !== "number" || typeof next.episodes !== "number") break;

      parts.push({ malId: next.malId, start: accumulated + 1, count: next.episodes });
      accumulated += next.episodes;
      cursor = next.malId;
    }

    return parts;
  });
}

/**
 * Süreç içi kısa memo — TÜRETİLMİŞ part eşlemeleri.
 *
 * NEDEN `cachedRead` YETMİYOR: geliştirmede `cachedRead` bilinçli olarak TAMAMEN
 * devre dışıdır (panel düzenlemesi anında görünsün diye). O yüzden türetme dev'de
 * HER istekte AniList'e giderdi ve AniList'in 30 istek/dk sınırına takılırdı
 * (ölçüldü: `{"ok":false,"reason":"anilist 429"}`). Bu memo TTL boyunca tek
 * upstream isteği garanti eder; üretimde `cachedRead` de ayrıca devrededir.
 */
const derivedPartsMemo = new Map<number, { expiresAt: number; parts: SeasonPartEntry[] }>();
const DERIVED_PARTS_TTL_MS = ANILIST_ID_TTL_SECONDS * 1000;

/**
 * Türetmeyi YUMUŞAK yapar: AniList geçici olarak erişilemezse (429/ağ) istek
 * PATLAMAZ; part eşlemesi yok sayılır (`[]`) → mevcut (part'sız) davranış. Yalnızca
 * BAŞARILI türetme memo'ya yazılır, böylece bir sonraki istek yeniden dener.
 */
async function derivedPartsWithFallback(malId: number): Promise<SeasonPartEntry[]> {
  const now = Date.now();
  const hit = derivedPartsMemo.get(malId);
  if (hit && hit.expiresAt > now) return hit.parts;
  try {
    const parts = await megaplayPartsForMal(malId);
    derivedPartsMemo.set(malId, { expiresAt: now + DERIVED_PARTS_TTL_MS, parts });
    return parts;
  } catch {
    return [];
  }
}

/**
 * `ani/` yedeği için AniList kimliğini YUMUŞAK çözer.
 *
 * NEDEN YUMUŞAK: `mal/` doğrulaması tek başına yeterlidir; AniList geçici olarak
 * erişilemezse (429/ağ) istek patlamamalı, yalnızca `ani/` yedeği atlanmalı.
 * Part'a geçildiğinde eldeki `ani` parametresi TEMEL kayda ait olabileceği için
 * yok sayılır ve hedef kaydın kimliği yeniden çözülür.
 */
async function resolveAnilistId(
  aniParam: number,
  target: { malId: number; part: unknown },
): Promise<number | null> {
  if (target.part === null && Number.isInteger(aniParam) && aniParam > 0) return aniParam;
  try {
    return await anilistIdForMal(target.malId);
  } catch {
    return null;
  }
}

/** `?parts=` parametresini (JSON) güvenle çözer; bozuk/eksikse boş liste. */
function parsePartsParam(raw: string | null): SeasonPartEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is SeasonPartEntry => typeof entry === "object" && entry !== null,
    );
  } catch {
    return [];
  }
}

/**
 * MegaPlay adaylarını SIRAYLA dener: önce `mal/`, sonra `ani/`.
 * Hiçbiri oynatıcı getirmiyorsa `{ url: null }` → kaynak listeden çıkar.
 */
async function verifyMegaplay(request: EmbedProviderRequest): Promise<EmbedResolution> {
  const candidates = megaplayCandidateUrls(request);
  // Aday sırası zaten mal → ani (bkz. lib/embed-provider.ts → megaplayCandidateUrls).
  for (const candidate of candidates) {
    if (!isMegaplayStreamUrl(candidate)) continue;
    if (await isPlayable(candidate)) {
      const via = candidate.includes("/stream/ani/") ? "ani" : "mal";
      return { url: candidate, via };
    }
  }
  return { url: null, via: null };
}

export const Route = createFileRoute("/api/embed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        const provider = (params.get("provider") ?? "").trim();
        const malId = Number(params.get("mal") ?? "0");
        const aniParam = Number(params.get("ani") ?? "0");
        const episode = Number(params.get("episode") ?? "0");
        // DİL SEÇİMİ: yalnızca `sub` | `dub` geçerlidir. `tr` gibi başka bir değer
        // megaplay'de Error sayfası döndürür (ölçüm 29.09.2026) → güvenli `sub`'a düşülür.
        const language = params.get("lang") === "dub" ? "dub" : "sub";
        const providedParts = parsePartsParam(params.get("parts"));

        /**
         * Hata: HTTP 200 + `ok:false` + `url:null` döner ve `no-store` ile işaretlenir.
         * NEDEN 200: istemci bunu "kaynağı gösterme" sinyali olarak okur; 4xx/5xx dönseydi
         * tarayıcı konsolunda gereksiz hata gürültüsü olurdu (bkz. routes/api.anilist.ts).
         */
        const failed = (reason: string) =>
          Response.json(
            { ok: false, reason, url: null },
            { headers: { "Cache-Control": "no-store" } },
          );

        if (provider !== "megaplay") return failed(`bilinmeyen sağlayıcı: ${provider || "(boş)"}`);
        if (!Number.isInteger(malId) || malId <= 0) return failed("MAL kimliği yok");
        if (!Number.isInteger(episode) || episode <= 0) return failed("bölüm numarası yok");

        try {
          /**
           * PART EŞLEMESİ — mutlak bölümü doğru MAL kaydına çevirir.
           *
           * Kaynak sırası: (1) istekteki `parts` (uygulama `show_seasons.parts`'ı
           * gönderir), (2) boşsa AniList SEQUEL zincirinden TÜRETME (6 saat önbellek).
           * Türetme kimliği ilişkiden okur, veritabanına yazmaz.
           */
          const parts =
            providedParts.length > 0 ? providedParts : await derivedPartsWithFallback(malId);
          const target = megaplayTarget({ malId, episode, parts });
          if (!target) return failed("hedef bölüm çözülemedi");

          // AniList kimliği HEDEF MAL kaydıyla eşleşmeli (bkz. resolveAnilistId).
          const anilistId = await resolveAnilistId(aniParam, target);

          const resolution = await cachedRead(
            `embed:megaplay:${target.malId}:${anilistId ?? 0}:${target.episode}:${language}`,
            TTL_EMBED_SECONDS,
            () =>
              verifyMegaplay({
                malId: target.malId,
                anilistId,
                // megaplay'de sezon parametresi YOK (sezon, kimliğin kendisinde).
                season: 1,
                episode: target.episode,
                language,
              }),
          );

          return Response.json(
            {
              ok: true,
              url: resolution.url,
              via: resolution.via,
              // Gözlemlenebilirlik: hangi kayıt/bölüm sorgulandı ve part eşleşti mi?
              malId: target.malId,
              anilistId,
              episode: target.episode,
              part: target.part,
              requested: { malId, episode, language },
            },
            // Tazelik sunucu önbelleğinden yönetilir; ara katman istemci kopyası tutmasın.
            { headers: { "Cache-Control": "no-store" } },
          );
        } catch (error) {
          return failed(error instanceof Error ? error.message : "bilinmeyen hata");
        }
      },
    },
  },
});
