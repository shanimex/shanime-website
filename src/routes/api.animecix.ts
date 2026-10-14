// /api/animecix — Sunucu rotası: animecix'te seri arar, bölüm kaynağını (TauVideo) çözer.
import { createFileRoute } from "@tanstack/react-router";

/**
 * `/api/animecix` — animecix.tv'nin **Türkçe (hardsub) kaynağını** çözer.
 *
 * NEDEN SUNUCU ROTASI: animecix bir Angular SPA'sıdır; bölüm sayfasının HTML'inde
 * oynatıcı adresi YOKTUR (68 KB'lik kabuk döner). Adresler JSON uçlarından gelir.
 * Tarayıcıdan çağırmak CORS'a takılır; bu yüzden panel adına sunucu çağırır.
 *
 * ÖLÇÜM (27.09.2026, doğrudan HTTP ile doğrulandı — çerez GEREKMEZ, yalnızca
 * masaüstü User-Agent yeterli):
 *
 *   1) ARAMA  (seriyi bulmak için)
 *      GET /secure/search/<urlencoded terim>?limit=20
 *      → { results: [ { id, name, name_english, name_romanji, season_count, episode_count } ] }
 *      ÖNEMLİ: terim QUERY PARAMETRESİ DEĞİL, YOLUN SON PARÇASIDIR. `?query=` yazılırsa
 *      sunucu terimi yok sayıp alâkasız bir kayıt döndürüyordu (ölçüldü: "jujutsu kaisen"
 *      araması "Yuru Camp△" (id 7346) döndürdü). Doğrusu `/secure/search/jujutsu%20kaisen`.
 *
 *   2) BÖLÜM VİDEOLARI
 *      GET /secure/episode-videos?titleId=<id>&season=<s>&episode=<e>
 *      → JSON DİZİSİ; her öğe bir çevirmen/kalite:
 *        { id: 389615, name: "Tau Video", url: "https://tau-video.xyz/embed/<hash>",
 *          quality: "regular", language: "tr", category: "full", approved: true, order: 0 }
 *
 *   3) GÖMÜLECEK ADRES = `url` + "?vid=" + `id`
 *      (sitenin kendi kodu da böyle kurar: `buildTauUrl` → "?vid" yoksa ekler.)
 *      Doğrulanan örnek: JJK S1B1 → tau-video.xyz/embed/6335c9e6d03cb090cb4c58c1?vid=389615
 *
 * Gömülebilirlik: tau-video.xyz'te X-Frame-Options / CSP `frame-ancestors` YOK
 * (docs/SAGLAYICI-VE-KAPAK-ARASTIRMASI.md §17.8); gömülü oynatıcıda reklam/pop-up yok,
 * altyazı videoya gömülü Türkçe (hardsub).
 *
 * İKİ MOD:
 *   · `?search=<seri adı>`  → panelin seriyi eşlemesi için aday listesi
 *   · `?titleId=&season=&episode=` → bölümün oynatıcı adayları (`best` = sitenin seçtiği)
 */

const ANIMECIX = "https://animecix.tv";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Gömülebilir tau-video oynatıcı adresi (hash 16+ hex).
 *
 * DİKKAT — sondaki `?vid=<sayı>` İSTEĞE BAĞLI kabul edilir: adres `buildEmbedUrl`
 * ile kurulunca sorgu eklenir. İlk yazımda desen `$` ile sabitlendiği için
 * `?vid=…` eklenmiş adres eşleşmiyor ve rota "gömülebilir kayıt yok" diyordu
 * (ölçüldü: /api/animecix?titleId=7352&season=1&episode=1).
 */
const TAU_EMBED_RE = /^https:\/\/tau-video\.xyz\/embed\/[0-9a-f]{16,}(?:\?vid=\d+)?$/i;

/** animecix'in video kaydı (yalnızca kullandığımız alanlar). */
type AnimecixVideo = {
  id?: number;
  name?: string;
  url?: string;
  quality?: string;
  language?: string;
  category?: string;
  approved?: boolean;
  order?: number;
  /**
   * BÖLÜME ÖZEL kapak görseli — animecix bunu her bölüm kaydında döndürüyor.
   *
   * ÖLÇÜM (29.09.2026, canlı HTTP): `titleId=10535&season=1&episode=1` →
   * `https://cdn.mangacix.net/file/tau-video/thb/64c714d7d7eea72649594c49-32.jpg`;
   * `episode=2` → FARKLI bir hash (yani bölüme özel). Bazı serilerde dizi
   * görseli (ör. `image.tmdb.org/...`) döner ama yine de geçerli bir kapaktır.
   *
   * Not: `cdn.mangacix.net` görselleri referer'sız HTTP 200 + `image/jpeg`
   * veriyor (hotlink engeli YOK), bu yüzden `<img src>` ile doğrudan gösterilebilir.
   */
  thumbnail?: string;
};

/** Panelin seçim sunacağı tek oynatıcı adayı. */
type Candidate = {
  /** Çevirmen/oynatıcı adı (ör. "Tau Video"). */
  name: string;
  /** Kalite etiketi ("regular", "1080p"…). */
  quality: string;
  /** Dil kodu (genelde "tr"). */
  language: string;
  /** Bölüme yazılacak TAM embed adresi (`?vid=` eklenmiş hâli). */
  url: string;
  /** animecix'in onaylı işaretlediği kayıt mı. */
  approved: boolean;
  /**
   * Kaydın kapak görseli (bkz. `AnimecixVideo.thumbnail`). Gömülemez (tau-video
   * dışı) adaylar süzüldüğü için panel YALNIZCA gömülebilir adayları görür;
   * kapak da o adayın kaydından gelir. Boşsa kayıtta kapak yok.
   */
  thumbnail: string;
};

/**
 * animecix kaydındaki kapak adresini güvenli biçimde çıkarır.
 *
 * Yalnızca `https:` adresler kabul edilir; bozuk/eksik alan boş dizgeye düşer
 * (uydurma adres üretilmez).
 */
function safeThumbnail(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const value = raw.trim();
  return /^https:\/\//i.test(value) ? value : "";
}

/** Sitenin kendi seçimi: önce onaylı + "full" + Türkçe, sonra `order`. */
export function pickBest(list: AnimecixVideo[]): AnimecixVideo | null {
  const usable = list.filter((item) => typeof item.url === "string" && item.url.length > 0);
  if (usable.length === 0) return null;
  const score = (item: AnimecixVideo) =>
    (item.approved ? 0 : 4) +
    (item.category === "full" ? 0 : 2) +
    (item.language && item.language !== "tr" ? 1 : 0);
  return (
    [...usable].sort(
      (a, b) =>
        score(a) - score(b) || (a.order ?? 99) - (b.order ?? 99) || (a.id ?? 0) - (b.id ?? 0),
    )[0] ?? null
  );
}

/** `url` + `?vid=<id>` — site bunu böyle kurar; `?vid` zaten varsa dokunulmaz. */
export function buildEmbedUrl(video: AnimecixVideo): string {
  const url = (video.url ?? "").trim();
  if (!url) return "";
  if (url.includes("?vid")) return url;
  return video.id ? `${url}?vid=${video.id}` : url;
}

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      Referer: `${ANIMECIX}/`,
    },
    redirect: "follow",
  });
  if (!res.ok) return { status: res.status, body: null };
  try {
    return { status: res.status, body: await res.json() };
  } catch {
    return { status: res.status, body: null };
  }
}

export const Route = createFileRoute("/api/animecix")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const params = new URL(request.url).searchParams;
        /**
         * Hata yanıtı.
         *
         * `temporary` NEDEN VAR (ölçüm 27.09.2026): animecix aynı bölüm için bazen
         * Cloudflare **502** döndürüp hemen ardından tam veriyi veriyor (Erased S1B2
         * ve S1B4: ilk istek 502, ikinci istek 200). Eskiden bu durum 200 + `ok:false`
         * olarak dönüyordu; panel de her `ok:false`ı "kaynakta yok" saydığı için
         * kullanıcı "TauVideo bu bölümde yok" sanıyordu ve istek TEKRAR DENENMİYORDU.
         * Artık: geçici hata `temporary: true` + gerçek HTTP durumu (5xx) döner;
         * panel bunu yeniden dener ve kırmızı "başarısız" olarak gösterir.
         * "Gerçekten yok" (bu bölüm için kayıt yok) ise `temporary: false` kalır.
         */
        const fail = (reason: string, status = 200, temporary = false) =>
          Response.json(
            { ok: false, reason, temporary },
            { status, headers: { "Cache-Control": "no-store" } },
          );
        /** 408/429/5xx → geçici (yeniden denenebilir). */
        const isTemporaryStatus = (status: number) =>
          status === 408 || status === 429 || (status >= 500 && status < 600);

        // --- MOD 1: seri arama -------------------------------------------------
        const term = (params.get("search") ?? "").trim();
        if (term) {
          if (term.length < 2) return fail("Arama için en az 2 karakter gerekli");
          try {
            const { status, body } = await getJson(
              `${ANIMECIX}/secure/search/${encodeURIComponent(term)}?limit=20`,
            );
            if (status !== 200) return fail(`TauVideo araması ${status} döndü`);
            const rows = (body as { results?: unknown } | null)?.results;
            const results = (Array.isArray(rows) ? rows : []).map((row) => {
              const item = row as Record<string, unknown>;
              return {
                id: Number(item["id"] ?? 0),
                name: String(item["name"] ?? ""),
                english: String(item["name_english"] ?? ""),
                romanji: String(item["name_romanji"] ?? ""),
                seasons: Number(item["season_count"] ?? 0),
                episodes: Number(item["episode_count"] ?? 0),
              };
            });
            return Response.json(
              { ok: true, term, results },
              { headers: { "Cache-Control": "public, max-age=600" } },
            );
          } catch (error) {
            return fail(
              `arama hatası: ${error instanceof Error ? error.message : String(error)}`,
              500,
            );
          }
        }

        // --- MOD 2: bölümün oynatıcı adresleri ---------------------------------
        const titleId = Number((params.get("titleId") ?? "").trim());
        const season = (params.get("season") ?? "").trim();
        const episode = (params.get("episode") ?? "").trim();
        if (!Number.isFinite(titleId) || titleId <= 0 || !season || !episode) {
          return fail("titleId, season ve episode parametreleri gerekli", 400);
        }

        try {
          const { status, body } = await getJson(
            `${ANIMECIX}/secure/episode-videos?titleId=${titleId}` +
              `&season=${encodeURIComponent(season)}&episode=${encodeURIComponent(episode)}`,
          );
          if (status !== 200) {
            // 5xx/429: kaynak şu an sallantılı → GEÇİCİ (panel yeniden dener).
            return fail(
              `TauVideo bölüm kaydı ${status} döndü${isTemporaryStatus(status) ? " (geçici)" : ""}`,
              isTemporaryStatus(status) ? status : 200,
              isTemporaryStatus(status),
            );
          }
          const raw = Array.isArray(body)
            ? (body as AnimecixVideo[])
            : ((body as { videos?: AnimecixVideo[]; data?: AnimecixVideo[] } | null)?.videos ??
              (body as { data?: AnimecixVideo[] } | null)?.data ??
              []);
          if (raw.length === 0) return fail("bu bölüm için TauVideo kaydı yok");

          const candidates: Candidate[] = raw
            .map((video) => ({
              name: (video.name ?? "").trim() || "TauVideo",
              quality: (video.quality ?? "").trim(),
              language: (video.language ?? "").trim(),
              url: buildEmbedUrl(video),
              approved: video.approved === true,
              thumbnail: safeThumbnail(video.thumbnail),
            }))
            // Yalnızca gömülebilir tau-video adresleri: diğer hostlar (reklamlı
            // oynatıcılar) sessizce listelenip kullanıcıyı yanıltmasın.
            .filter((item) => TAU_EMBED_RE.test(item.url));

          if (candidates.length === 0) {
            return fail("gömülebilir tau-video kaydı yok (yalnızca reklamlı oynatıcılar var)");
          }

          const best = pickBest(raw);
          const bestUrl = best ? buildEmbedUrl(best) : "";
          /**
           * KAPAK (`poster` / `thumbnail`) — seçilen kaydın kapak görseli.
           *
           * NEDEN İKİ ANAHTAR: `poster` projedeki genel ad (bkz. bölümün `poster`
           * alanı), `thumbnail` ise animecix'in alan adı. İkisi de AYNI değeri taşır;
           * eski çağıranlar bozulmasın diye geriye dönük uyumlu tutulur.
           *
           * Seçilen kayıtta kapak yoksa ilk kapaklı adaya düşülür; hiç yoksa boş
           * dizge döner (uydurma yok).
           */
          const cover =
            safeThumbnail(best?.thumbnail) ||
            candidates.find((item) => item.thumbnail)?.thumbnail ||
            "";
          return Response.json(
            {
              ok: true,
              titleId,
              season,
              episode,
              best: TAU_EMBED_RE.test(bestUrl) ? bestUrl : (candidates[0]?.url ?? ""),
              poster: cover,
              thumbnail: cover,
              candidates,
            },
            // Hash bölüm başına sabit: kısa süre CDN'de tutulabilir.
            { headers: { "Cache-Control": "public, max-age=600" } },
          );
        } catch (error) {
          // Ağ/timeout: GEÇİCİ — panel yeniden dener, kırmızı "başarısız" gösterir.
          return fail(
            `TauVideo'ya ulaşılamadı: ${error instanceof Error ? error.message : String(error)}`,
            504,
            true,
          );
        }
      },
    },
  },
});
