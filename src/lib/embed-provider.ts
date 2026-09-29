/**
 * Global yayın sağlayıcıları için TEK giriş noktası.
 *
 * Neden ayrı modül: sağlayıcı adresleri sık değişir ve alan adları çöker.
 * URL biçimi burada tek yerde durur; sağlayıcı değişince oynatıcı kodu değişmez.
 *
 * ⚠️ KURAL: Buraya **yalnızca doğrulanmış** şablon yazılır. Doğrulanmamış bir
 * adres videoyu tamamen kırar ve fark edilmesi zor olur. Doğrulanmamış sağlayıcı
 * `template: null` ile durur ve `buildUrl` her zaman `null` döner.
 *
 * ── 25.09.2026 doğrulama günlüğü (hepsi ölçümle) ──────────────────────────
 *
 * 1) `animesrc.me` → **DNS'te YOK.** Ölçüm: `animesrc.me`, `animesrc.pro`,
 *    `animesrc.to`, `animesrc.com`, `animesrc.net` → hepsi "Uzak ad çözülemedi".
 *    `animesrc.xyz` yanıt veriyor ama GoDaddy'de **satılık park alanı**
 *    ("The domain name animesrc.xyz is for sale", $599). Yani kullanılamaz.
 *
 * 2) `vidsrc.pro` → **erişilemiyor** (kök: bağlantı yok, `/40748/1/1`: HTTP 522).
 *    Canlı vidsrc.to SSS'inden birebir: "Can i use this API for anime?" →
 *    "Currently we do not support anime, we may do that in the future."
 *    Belgelenen biçimler yalnızca `/embed/movie/{id}` ve
 *    `/embed/tv/{id}/{season}/{episode}` — **anime yolu yok**.
 *
 * 3) `megaplay.buzz` → **GERÇEK sağlayıcı.** Kendi dokümanında birebir:
 *      "Endpoint (MAL id + episode): https://megaplay.buzz/stream/mal/{mal-id}/{ep-num}/{language}"
 *      "Endpoint (AniList id + episode): https://megaplay.buzz/stream/ani/{anilist-id}/{ep-num}/{language}"
 *      "Note: Direct Access to Embed Links are Disabled. Links only work as Embed on your Websites"
 *    ⚠️ Ama MAL eşlemesi TAM DEĞİL. `https://megaplay.buzz/stream/mal/40748/1/sub`
 *    (Jujutsu Kaisen S1B1) → **HTTP 410**: "We can't find the file you are looking
 *    for. It maybe got deleted by the owner or was removed due a copyright violation."
 *    Doküman da bunu kabul ediyor: "not every show is synced or mapped to MAL and
 *    AniList IDs yet."
 *    Şablon DİKKAT: **sezon parametresi YOK** — sezon, MAL kimliğinin kendisinde
 *    kodludur (her sezonun ayrı MAL kaydı vardır).
 */

import { anizmPlayerUrl } from "@/lib/anizm";

export type EmbedProviderId = "none" | "megaplay" | "vidsrc" | "videasy" | "anizm";

/** Sağlayıcıya enjekte edilecek harici altyazı izi. */
export interface EmbedSubtitleTrack {
  /** Doğrudan .vtt adresi. CORS başlığı `Access-Control-Allow-Origin: *` olmalı. */
  file: string;
  /** Altyazı menüsünde görünecek ad (ör. "Türkçe"). */
  label: string;
}

/**
 * `show_seasons.parts` (jsonb) satırı — çok part'lı sezonlarda bölüm kimliğini çözer.
 *
 * Şekil (AnizipSyncPanel yazar): `{ malId, start, count, animecixId? }`.
 *   · `malId`  → part'ın KENDİ MAL kimliği (ör. Mushoku Tensei Cour 2 = 45576)
 *   · `start`  → part'ın SEZON İÇİ mutlak başlangıç bölümü (1 tabanlı)
 *   · `count`  → part'taki bölüm sayısı
 * Ölçüm (29.09.2026): `megaplay.buzz/stream/mal/45576/1/sub` → `File 27753` (VAR),
 * yani part kataloğu megaplay'de **1 tabanlı göreli** numaralandırılır; mutlak
 * bölüm `absolute - start + 1` ile part içi numaraya çevrilir.
 */
export interface SeasonPartEntry {
  /** Part'ın kendi MAL kimliği. Geçersizse satır yok sayılır. */
  malId?: number | null;
  /** Part'ın sezon içi mutlak başlangıç bölümü (1 tabanlı). */
  start?: number | null;
  /** Part'taki bölüm sayısı. */
  count?: number | null;
  /** animecix kimliği (varsa; burada kullanılmaz). */
  animecixId?: number | null;
}

/** MegaPlay sorgusunun hedefi: hangi kayıt (MAL) + hangi (göreli) bölüm. */
export interface MegaplayTarget {
  /** Sorguda kullanılacak MAL kimliği (part varsa part'ın kendisi). */
  malId: number;
  /** Part içi GÖRELİ bölüm numarası (part yoksa mutlak numara). */
  episode: number;
  /** Eşleşen part satırı; part yoksa `null`. */
  part: { malId: number; start: number; count: number } | null;
}

export interface EmbedProviderRequest {
  /** MyAnimeList kimliği. Şemada yoksa null. */
  malId: number | null;
  /** AniList kimliği (megaplay `ani` yolu için). */
  anilistId?: number | null;
  /**
   * TMDB kimliği. vidsrc.to gibi **TMDB tabanlı** sağlayıcılar bu kimliği ister;
   * MAL kimliği o şablonlarda çalışmaz. `scripts/sync-anizip-covers.mjs` aynı
   * ani.zip yanıtından üretip `src/data/mal-tmdb.json` dosyasına yazar
   * (`tmdbIdForMal()` ile okunur).
   */
  tmdbId?: number | null;
  /** Sezon numarası (1 tabanlı) — megaplay'de KULLANILMAZ, vidsrc'te zorunlu. */
  season: number;
  /** Bölüm numarası (1 tabanlı). Çok part'lı sezonda MUTLAK (sezon içi) numaradır. */
  episode: number;
  /** Altyazı ("sub") veya dublaj ("dub"). */
  language?: "sub" | "dub";
  /**
   * Sezonun `show_seasons.parts` kayıtları. Bölüm bir part aralığına düşüyorsa
   * sorgu part'ın kendi kimliği + göreli numarasıyla yapılır (bkz. `megaplayTarget`).
   * Boş/yoksa mevcut davranış korunur (sezonun kendi kimliği, mutlak numara).
   */
  parts?: SeasonPartEntry[] | null;
  /**
   * Harici altyazı izleri. Sağlayıcı destekliyorsa embed adresine eklenir.
   *
   * vidsrc.to `?sub.info=<json>` parametresini kabul eder (kendi API dokümanı):
   *   [{ file: "https://.../tr.vtt", label: "Türkçe", kind: "captions" }]
   * Böylece KENDİ Türkçe altyazı dosyamız sağlayıcının menüsüne girer.
   */
  subtitles?: EmbedSubtitleTrack[];
}

export interface EmbedProvider {
  id: EmbedProviderId;
  label: string;
  /**
   * Doğrulanmış adres şablonu. `{mal}`, `{ep}`, `{lang}` yer tutucularını kullanır.
   * `null` = doğrulanmadı → bu sağlayıcı adres ÜRETMEZ.
   */
  template: string | null;
  /** Şablonun çalışması için mal_id zorunlu mu? */
  requiresMalId: boolean;
  /** Şablonun nereden doğrulandığı (denetlenebilir kaynak notu). */
  evidence: string;
  buildUrl(request: EmbedProviderRequest): string | null;
}

/** Yer tutucuları doldurur ve sonucun geçerli bir https adresi olduğunu doğrular. */
function fillTemplate(template: string, request: EmbedProviderRequest): string | null {
  const lang = request.language ?? "sub";
  const url = template
    .replace("{mal}", String(request.malId ?? ""))
    .replace("{ani}", String(request.anilistId ?? ""))
    .replace("{tmdb}", String(request.tmdbId ?? ""))
    .replace("{season}", String(request.season))
    .replace("{ep}", String(request.episode))
    .replace("{lang}", lang);

  // Boş yer tutucu kalmışsa (ör. mal_id yok) üretme.
  if (url.includes("//") && /\/\/(?=\/|$)/.test(url)) return null;
  if (/[{}]/.test(url)) return null;
  if (!/^https:\/\/[^\s]+$/.test(url)) return null;
  if (/\/(null|undefined|nan)(\/|$)/i.test(url)) return null;
  return url;
}

/**
 * MegaPlay embed şablonları — TEK kaynak.
 *
 * `mal` yolu birincil (istenen: MAL kimliği elimizde var), `ani` yolu **yedek**.
 * NEDEN YEDEK GEREKLİ: megaplay dokümanı \"not every show is synced or mapped to
 * MAL\" diyor; MAL eşlemesi olmayan bölümde (`mal/` adresi oynatıcı yerine hata
 * sayfası döndürür) aynı bölüm AniList kimliğiyle `ani/` yolunda bulunabiliyor.
 * Ölçüm (29.09.2026): `mal/40748/1/sub` ve `ani/113415/1/sub` aynı dosyayı
 * (File 116363) verdi → iki yol aynı kataloğu gösteriyor, yani yedek gerçek.
 *
 * ⚠️ Şablonlar burada ÜRETİLMEZ, yalnızca doğrulanır: hangi adresin oynadığına
 * sunucu rotası karar verir (bkz. `src/routes/api.embed.ts`).
 */
export const MEGAPLAY_MAL_TEMPLATE = "https://megaplay.buzz/stream/mal/{mal}/{ep}/{lang}";

/** Yedek şablon — AniList kimliğiyle (bkz. yukarıdaki not). */
export const MEGAPLAY_ANI_TEMPLATE = "https://megaplay.buzz/stream/ani/{ani}/{ep}/{lang}";

export const EMBED_PROVIDERS: Record<EmbedProviderId, EmbedProvider> = {
  /**
   * Kapalı. Bölüm adresi veritabanındaki `watch_url`'den gelir (bugünkü davranış).
   */
  none: {
    id: "none",
    label: "Sağlayıcı yok (watch_url kullanılır)",
    template: null,
    requiresMalId: false,
    evidence: "Varsayılan. Mevcut davranışı korur.",
    buildUrl: () => null,
  },

  /**
   * megaplay.buzz — MAL/AniList kimliğiyle embed. **AKTİF SAĞLAYICI.**
   *
   * Şablon megaplay'in kendi `/api` dokümanından alındı (tahmin değil, bkz. dosya
   * başındaki doğrulama günlüğü).
   *
   * Embed'de ÇALIŞTIĞI doğrulandı (4/4 dizi, iframe içinde). Yeni bir dizi
   * eklerken adresi tarayıcıda TEK BAŞINA açma — sağlayıcı top-level isteklerde
   * hata sayfası döndürür. Bunun yerine adresi bir iframe içine gömüp oynatıcının
   * gelip gelmediğine bak.
   */
  megaplay: {
    id: "megaplay",
    label: "MegaPlay (MAL kimliği)",
    template: MEGAPLAY_MAL_TEMPLATE,
    requiresMalId: true,
    evidence:
      "megaplay.buzz /api dokümanı: 'Endpoint (MAL id + episode): https://megaplay.buzz/stream/mal/{mal-id}/{ep-num}/{language}'. " +
      "Risk: MAL eşlemesi tam değil — 40748 için HTTP 410 ('removed due a copyright violation' örüntüsü).",
    buildUrl(request) {
      // ⚠️ Bölüm bir PART'a aitse (bkz. `megaplayTarget`): part kaydının kendi MAL
      // kimliği + PART İÇİ göreli numara kullanılır. Aksi davranış eski haliyle
      // aynıdır (sezonun kendi kimliği, mutlak numara).
      const target = megaplayTarget(request);
      if (!target) return null;
      const template = EMBED_PROVIDERS.megaplay.template;
      if (!template) return null;
      return fillTemplate(template, {
        ...request,
        malId: target.malId,
        episode: target.episode,
        language: normalizeEmbedLanguage(request.language),
      });
    },
  },

  /**
   * videasy — TMDB dizi kimliğiyle embed. **KALİTE SEÇİCİSİ OLAN SAĞLAYICI.**
   *
   * ÖLÇÜM (26.09.2026, kullanıcının tarayıcısı, iframe içinde, TMDB 95479 S1B1):
   *   · Oynatıcı geldi, video oynadı.
   *   · Ayarlar menüsünde **Quality** satırı var; kalite menüsü 2160p'ye kadar
   *     seçenek listeliyor (megaplay'de kalite LİSTESİ BOŞ — tek 1080p veriyor).
   *   · **Pop-up ölçümü: 0.** İzole testte (tek iframe) yeni sekme, kendiliğinden
   *     yenileme ve reklam/popunder isteği GÖZLENMEDİ.
   *   · **Oynatma zamanını parent pencereye gönderiyor** — bu yüzden kendi Türkçe
   *     altyazı katmanımız burada da çalışır:
   *       { type:"PLAYER_EVENT", data:{ event:"timeupdate",
   *         currentTime:625.19, duration:1435, id, mediaType, season, episode } }
   *     Saniyede ~10 mesaj (ölçüm: 60 sn'de 618 mesaj, 504'ü PLAYER_EVENT).
   *     Kaynakta da doğrulandı: `window.parent.postMessage(JSON.stringify({...}), "*")`.
   *
   * ⚠️ ALTYAZIYI OYNATICIYA SOKMAK MÜMKÜN DEĞİL (ölçüldü, ayrıntı §19):
   *   · "Upload subtitles" bir **dosya seçici**; `URL.createObjectURL()` ile
   *     tarayıcı belleğinde tutulur → ziyaretçi başına, sunucuya gitmez.
   *   · Altyazı için URL parametresi YOK (yalnızca `progress` ve `color`).
   *   · Dışarıdan mesaj dinlemiyor (gelen `message` API'si yok) → track enjekte edilemez.
   *   Bu yüzden Türkçe için anizm/puffy kaynağı kullanılır (altyazı videoda gömülü).
   *
   * ⚠️ Top-level açılmayı reddediyor (HTTP hata) → yalnızca iframe ile gömülür.
   */
  videasy: {
    id: "videasy",
    label: "Videasy (TMDB kimliği, kalite seçici)",
    template: "https://player.videasy.net/tv/{tmdb}/{season}/{ep}",
    requiresMalId: false,
    evidence:
      "Ölçüm 26.09.2026: iframe içinde /tv/95479/1/1 oynadı; Quality menüsü 2160p'ye kadar; " +
      "0 pop-up (izole test); parent'a `PLAYER_EVENT/timeupdate` mesajı gönderiyor → kendi altyazı katmanımız çalışır.",
    buildUrl(request) {
      if (!request.tmdbId) return null;
      const template = EMBED_PROVIDERS.videasy.template;
      if (!template) return null;
      return fillTemplate(template, request);
    },
  },

  /**
   * vidsrc.to — TMDB dizi kimliğiyle embed. **TÜRKÇE ALTYAZI VEREN SAĞLAYICI.**
   *
   * NEDEN TMDB: vidsrc.to'nun anime ucu YOK ("Currently we do not support anime",
   * kendi SSS'i + `/embed/anime/...` → 404). Ama anime dizileri TMDB'de dizi
   * olarak kayıtlı olduğu için `/embed/tv/{tmdb}/{sezon}/{bölüm}` çalışıyor.
   *
   * KULLANICI DOĞRULAMASI (25.09.2026, gerçek tarayıcı, JJK S1B1):
   * `/embed/tv/95479/1/1` → video OYNADI (1:46 / 23:55), altyazı panelinde
   * **"SEARCH BY LANGUAGE → Turkish — Türkçe"** seçili ve Türkçe altyazı dosyası
   * listelendi. Ayarlar (kalite) menüsü de var. Kendi dokümanı: "The player has a
   * range of quality options", "We source subtitles from various websites, ensuring
   * we have a wide selection available for almost every title", ayrıca
   * `?sub_file=` / `?sub.info=` ile KENDİ altyazı dosyanı yükleyebiliyorsun.
   *
   * ⚠️ OTOMASYON NOTU: Bu adres otomatik tarayıcıda oynatılamadı çünkü `vsembed.ru`
   * `disable-devtool.js` yüklüyor ve otomasyon altında sayfa boşalıyor. Yani
   * "otomatik test oynatamadı" ≠ "çalışmıyor". Kullanıcı tarayıcısında çalışıyor.
   *
   * Zincir: vidsrc.to → vsembed.ru → cloudorchestranova.com (iç içe iframe).
   */
  vidsrc: {
    id: "vidsrc",
    label: "VidSrc (TMDB kimliği, TR altyazı)",
    template: "https://vidsrc.to/embed/tv/{tmdb}/{season}/{ep}",
    requiresMalId: false,
    evidence:
      "vidsrc.to SSS: anime desteklenmiyor ama TMDB dizi kimliğiyle çalışıyor. " +
      "Kullanıcı ölçümü: /embed/tv/95479/1/1 (JJK S1B1) oynadı, altyazı panelinde Turkish — Türkçe listelendi. " +
      "Gereksinim: `mal-tmdb.json` içinde TMDB kimliği olmalı (MAL kimliği bu şablonda işe yaramaz).",
    buildUrl(request) {
      if (!request.tmdbId) return null;
      const template = EMBED_PROVIDERS.vidsrc.template;
      if (!template) return null;
      const base = fillTemplate(template, request);
      if (!base) return null;
      return appendSubInfo(base, request.subtitles);
    },
  },

  /**
   * anizm / puffytr — **Türkçe altyazı videoya GÖMÜLÜ**, 1080p, 0 pop-up.
   *
   * Ölçüm (26.09.2026, bizim origin'den iframe'de): oynadı (1080p), config
   * `"advertising": []` → **pre-roll YOK**, yani sitenin kendi reklam kapısı
   * engellenmez; 45 sn bekleme + 1 tık boyunca **0 pop-up**; kalite menüsü
   * `Otomatik/1080p/720p/480p/360p`; oynatıcının kendi watermark'ı yok.
   * Ayrıntı: docs/SAGLAYICI-VE-KAPAK-ARASTIRMASI.md §23.
   *
   * ⚠️ `template` YOK ve olmayacak: adres bölüme özel bir hash taşır
   * (`anizmplayer.com/video/<hash>`), sarmalayıcı (`puffytr.com/player/<id>`)
   * referer korumalıdır → şablonla üretilemez. Adresler derleme zamanında gömülü
   * tablodan gelir:
   *     scripts/resolve-anizm-hashes.mjs  →  src/data/anizm-hashes.json
   * Tabloda kaydı olmayan bölümde `null` döner → oynatıcı megaplay'e düşer.
   *
   * NOT: altyazı videoya gömülü olduğu için ayrı bir altyazı katmanı KULLANILMAZ
   * (yerel altyazı sistemi kaldırıldı), yoksa iki altyazı üst üste biner.
   */
  anizm: {
    id: "anizm",
    label: "Anizm (Türkçe altyazı gömülü)",
    template: null,
    requiresMalId: true,
    evidence:
      "Ölçüm 26.09.2026: anizmplayer.com/video/<hash> iframe'de oynadı (1080p), " +
      "oynatıcı config'i `advertising: []` (pre-roll yok), 45 sn bekleme + 1 tık boyunca 0 pop-up, " +
      "pop-up ve banner yok. Adresler `scripts/resolve-anizm-hashes.mjs` ile puffytr zincirinden çözülür.",
    buildUrl(request) {
      return anizmPlayerUrl(request.malId, request.season, request.episode);
    },
  },
};

/**
 * vidsrc.to'nun `?sub.info=` parametresini adrese ekler.
 *
 * BELGELENMİŞ BİÇİM (vidsrc.to API dokümanı, "Use custom subtitles"):
 *   [{ file: "https://domain.com/file1.vtt", label: "English", kind: "captions" }]
 * ve dosyanın `Access-Control-Allow-Origin: *` başlığıyla servis edilmesi şart.
 *
 * NEDEN GEREKLİ: vidsrc.to'nun yerleşik altyazı menüsünde dil seçimini
 * DIŞARIDAN varsayılan yapmanın bir yolu yok — vsembed.ru sayfası hiçbir
 * altyazı-dili parametresi okumuyor (ölçüm 25.09.2026: sayfa kodunda
 * `searchParams` yok, yalnızca sezon/bölüm `<select>`'i ve `TV_SET` postMessage
 * protokolü var). Tek yol KENDİ dosyamızı bu parametreyle vermek.
 */
function appendSubInfo(base: string, subtitles?: EmbedSubtitleTrack[]): string {
  const tracks = (subtitles ?? [])
    .map((track) => ({ file: toAbsoluteSubtitleUrl(track.file), label: track.label }))
    .filter((track) => track.file !== "")
    .map((track) => ({ file: track.file, label: track.label, kind: "captions" }));
  if (tracks.length === 0) return base;
  return `${base}?sub.info=${encodeURIComponent(JSON.stringify(tracks))}`;
}

/**
 * Göreli altyazı yolunu tam adrese çevirir.
 *
 * NEDEN: kendi altyazı dosyalarını `public/subs/` altına koyup panelde
 * `/subs/bolum-1.vtt` yazmak en kolay yol; ama sağlayıcıya verilen adres TAM
 * olmak zorunda. Sunucu tarafında `window` yok → boş döner ve o iz atlanır
 * (video etkilenmez).
 */
function toAbsoluteSubtitleUrl(value: string): string {
  const url = value.trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/") && typeof window !== "undefined") {
    return `${window.location.origin}${url}`;
  }
  return "";
}

/** Dizge kimliğinden sağlayıcı getirir (bilinmeyen kimlik → null). */
function providerById(id: string): EmbedProvider | null {
  return (EMBED_PROVIDERS as Record<string, EmbedProvider | undefined>)[id] ?? null;
}

/**
 * Aktif sağlayıcı — **"megaplay"** (25.09.2026, kullanıcı onayı).
 *
 * ÇALIŞMA SIRASI: `resolveEpisodeEmbed` önce kayıttaki `watch_url`'e bakar.
 * Sitedeki 24 bölümün tamamında `watch_url` dolu olduğu için (22 VidMoly +
 * 2 Streamtape) bugün hiçbir bölüm sağlayıcıya düşmez → mevcut yayın değişmez.
 * Sağlayıcı yalnızca `watch_url` BOŞ olan bölümlerde devreye girer.
 *
 * ✅ EMBED'DE ÇALIŞTIĞI DOĞRULANDI (25.09.2026, iframe içinde): megaplay bu 4
 * dizinin **hepsinde** gerçek oynatıcı veriyor — 40748 (Jujutsu Kaisen),
 * 31240 (Re:Zero), 39535 (Mushoku Tensei), 31043 (Erased). Oynatıcıda play/pause,
 * ±10 sn, CC (altyazı), ayarlar, PiP, tam ekran ve "Skip Intro" çalışıyor.
 *
 * ⚠️ ÖNCEKİ YANLIŞ ALARMIN DÜZELTMESİ: Daha önce "410 → eşleme yok, kullanılamaz"
 * diye not düşmüştüm. O ölçüm **doğrudan (top-level) erişim** korumasıydı, embed
 * davranışı değil: sağlayıcı iframe DIŞI isteklerde hata sayfası döndürüyor
 * (gövdede 410/404 metni, HTTP durumu yine 200). Yani adresi tarayıcıda tek başına
 * açıp "çalışmıyor" sonucu çıkarmak YANLIŞ. Doğru test: adresi bir iframe içine
 * gömüp oynatıcının gelip gelmediğine bakmak.
 *
 * Ayrıca `/embed/{mal}/{sezon}/{bölüm}` biçimi megaplay'de YOK — o yol 404 verir.
 * Doğru biçim: `/stream/mal/{mal}/{bölüm}/{dil}`.
 *
 * Kapatmak için: aşağıdaki değeri "none" yap.
 */
/**
 * Varsayılan sağlayıcı: **megaplay** (orijinal Japonca ses).
 *
 * vidsrc.to artık KULLANILMIYOR: İngilizce dublaj veriyor ve oynatıcı zinciri
 * (vsembed.ru → cloudorchestrana…) agresif pop-up açıyor. Türkçe altyazı zaten
 * anizm kaynağından geliyor — eskiden megaplay'in köprüsünden
 * aldığı oynatma zamanıyla kendi `.vtt` dosyamızı çiziyor
 * (`scripts/sync-tr-subtitles.mjs` → `public/subs/`). Bu yüzden vidsrc'e gerek
 * kalmadı; tanımı ileride `@vidsrc` direktifiyle kullanılabilsin diye duruyor.
 */
export const ACTIVE_EMBED_PROVIDER: EmbedProviderId = "megaplay";

/**
 * Belirli bir sağlayıcıdan embed adresi üretir (watch_url'i tamamen yok sayar).
 *
 * KULLANIM: izleyicinin "kaynak" seçimi. Bazı sağlayıcılar farklı şeyler
 * verdiği için (ölçüm 25.09.2026):
 *   · vidsrc.to → altyazı listesinde **Türkçe** var, ses İngilizce dublaj
 *   · megaplay  → **orijinal Japonca ses**, altyazı listesinde Türkçe YOK
 * Hiçbiri ikisini birlikte vermiyor; seçim izleyiciye bırakılır.
 */
export function buildProviderUrl(
  providerId: EmbedProviderId,
  request: EmbedProviderRequest,
): string | null {
  const provider = (EMBED_PROVIDERS as Record<string, EmbedProvider | undefined>)[providerId];
  return provider ? provider.buildUrl(request) : null;
}

/** Geçerli bir kimlik mi? (0/NaN/negatif/ondalık adres üretmez.) */
function isPositiveInt(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * Dil segmentini megaplay'in kabul ettiği iki değere indirger: `sub` | `dub`.
 *
 * NEDEN: `tr` gibi başka bir değer megaplay'de **Error** sayfası döndürür
 * (ölçüm 29.09.2026: `/stream/mal/45576/1/tr` → `Error - MegaPlay`). Bilinmeyen/
 * eksik değer güvenli varsayılan olan `sub`'a düşer.
 */
export function normalizeEmbedLanguage(language: "sub" | "dub" | undefined | null): "sub" | "dub" {
  return language === "dub" ? "dub" : "sub";
}

/**
 * MegaPlay sorgusunun HEDEFİ: hangi kayıt + hangi bölüm numarası?
 *
 * KURAL (part çözümü): bölüm bir part aralığına düşüyorsa (`start ≤ ep < start+count`)
 * sorgu **o part'ın kendi MAL kimliği** + **part içi göreli numara**
 * (`absolute - start + 1`) ile yapılır. Part yoksa mevcut davranış korunur:
 * sezonun kendi MAL kimliği + mutlak numara.
 *
 * Ölçüm (29.09.2026, Mushoku Tensei S1):
 *   · Part 1 = MAL 39535 (1–11): `/mal/39535/1/sub` → `File 31629` (VAR)
 *   · Part 2 = MAL 45576 (12–23): mutlak 15 → `/mal/45576/4/sub` → `File 27752` (VAR)
 *   · `/mal/39535/12/sub` → `Error` (Part 1'de 12. bölüm YOK) — part çözümü şart.
 */
export function megaplayTarget(
  request: Pick<EmbedProviderRequest, "malId" | "episode" | "parts">,
): MegaplayTarget | null {
  const episode = request.episode;
  if (!Number.isInteger(episode) || episode <= 0) return null;

  const part = findMegaplayPart(request.parts, episode);
  if (part) return { malId: part.malId, episode: episode - part.start + 1, part };

  if (!isPositiveInt(request.malId)) return null;
  return { malId: request.malId, episode, part: null };
}

/** Bölümü kapsayan part satırı (geçersiz satırlar sessizce atlanır). */
function findMegaplayPart(
  parts: SeasonPartEntry[] | null | undefined,
  episode: number,
): { malId: number; start: number; count: number } | null {
  if (!Array.isArray(parts)) return null;
  for (const entry of parts) {
    const malId = entry?.malId;
    const start = entry?.start;
    const count = entry?.count;
    if (!isPositiveInt(malId) || !isPositiveInt(start) || !isPositiveInt(count)) continue;
    if (episode >= start && episode < start + count) return { malId, start, count };
  }
  return null;
}

/**
 * MegaPlay için DENENECEK adresler, ÖNCELİK SIRASIYLA:
 *   1) `mal/` şablonu (MAL kimliği),
 *   2) `ani/` şablonu (AniList kimliği),
 *   3) `mal/` — DİĞER dil (yalnızca birincil dil oynatmıyorsa; `tr` asla üretilmez).
 *
 * ⚠️ NEDEN `fillTemplate`'e güvenilmiyor: `{ani}` yer tutucusu boş kalırsa
 * `.../ani//15/sub` üretilir ve `fillTemplate`'in \"boş yer tutucu\" koruması bu
 * biçimi her zaman yakalayamaz. Bu yüzden kimlik burada AÇIKÇA denetlenir;
 * bilinmeyen kimlik aday listesine hiç girmez.
 *
 * ⚠️ `season` KULLANILMAZ: megaplay'de sezon parametresi yoktur — sezon, kimliğin
 * kendisinde kodludur (her sezonun ayrı MAL/AniList kaydı vardır).
 */
export function megaplayCandidateUrls(request: EmbedProviderRequest): string[] {
  const target = megaplayTarget(request);
  if (!target) return [];

  const primary = normalizeEmbedLanguage(request.language);
  const alternate: "sub" | "dub" = primary === "sub" ? "dub" : "sub";
  const urls: string[] = [];

  // Bir dil için: önce `mal/` (birincil), sonra `ani/` (yedek). Sıra korunur.
  const add = (language: "sub" | "dub") => {
    const scoped: EmbedProviderRequest = {
      ...request,
      malId: target.malId,
      episode: target.episode,
      language,
    };
    const mal = fillTemplate(MEGAPLAY_MAL_TEMPLATE, scoped);
    if (mal && !urls.includes(mal)) urls.push(mal);
    if (isPositiveInt(request.anilistId)) {
      const ani = fillTemplate(MEGAPLAY_ANI_TEMPLATE, scoped);
      if (ani && !urls.includes(ani)) urls.push(ani);
    }
  };

  add(primary);
  // İkinci deneme YALNIZCA yedek amaçlı: birincil dil hiçbir yolda oynamazsa.
  add(alternate);
  return urls;
}

/**
 * Adres bir megaplay `stream/` çözüm adresi mi?
 *
 * NEDEN GEREKLİ: \"çözülen adres\" (sağlayıcı şablonundan ÜRETİLEN adres, ör.
 * `@megaplay`) doğrulanmalıdır; veritabanına elle yazılmış bölüme özel adresler
 * (Anizm/TauVideo) DOĞRULANMAZ — anizm referer korumalı olduğu için sunucudan
 * yapılan bir deneme YANLIŞ NEGATİF verirdi.
 */
export function isMegaplayStreamUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && /^https:\/\/megaplay\.buzz\/stream\//i.test(url);
}

/**
 * Bir bölüm için oynatılacak adresi çözer.
 *
 * Sıra:
 *  1. `watch_url` **`@saglayici`** biçimindeyse (ör. `@vidsrc`, `@megaplay`) o
 *     sağlayıcı ZORLANIR — kayıttaki eski embed adresini silmeden belirli bir
 *     dizi/bölüm için sağlayıcı seçmenin yolu budur. Veritabanı şeması gerekmez.
 *  2. `watch_url` doluysa o kazanır → mevcut çalışan davranış korunur.
 *  3. Boşsa aktif sağlayıcıdan üretilir.
 *  4. Aktif sağlayıcı adres üretemezse (ör. TMDB kimliği yok) **megaplay'e düşülür**
 *     — böylece eşlemesi olmayan dizi boş ekrana değil, çalışan bir oynatıcıya düşer.
 *  5. Hiçbiri yoksa null → oynatıcı "video yok" ekranını gösterir.
 */
export function resolveEpisodeEmbed(
  watchUrl: string | null | undefined,
  request: EmbedProviderRequest,
  providerId: EmbedProviderId = ACTIVE_EMBED_PROVIDER,
): string | null {
  const direct = (watchUrl ?? "").trim();

  // `@saglayici` direktifi: bilinmeyen kimlik → adres üretme (yanlış oynatıcıya
  // düşmektense "video yok" ekranı daha dürüst).
  if (direct.startsWith("@")) {
    const forced = providerById(direct.slice(1).trim());
    return forced ? forced.buildUrl(request) : null;
  }

  if (direct) return direct;

  const primary = EMBED_PROVIDERS[providerId].buildUrl(request);
  if (primary) return primary;
  if (providerId !== "megaplay") {
    return EMBED_PROVIDERS.megaplay.buildUrl(request);
  }
  return null;
}
