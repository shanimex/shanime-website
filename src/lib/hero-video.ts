/**
 * ── VİTRİN VİDEOSU: DOSYA ya da GÖMÜLÜ LİNK ───────────────────────────────────
 *
 * NEDEN VAR (kullanıcı isteği, 30.09.2026): "embed ile max kalitede yükleyebilir
 * miyim… embed sayesinde Cloudflare'e gitmez, depolama artmaz." Kullanıcı haklı:
 * gömülü (embed) videoda dosya bizim depomuza HİÇ girmez — ne R2 doluluğu ne
 * Cloudflare trafiği. Ayrıca mp4 yükleme yolu 8 MB ile sınırlıydı ve gerçek bir
 * video sığmıyordu.
 *
 * Bu dosya, `shows.banner_video_path` alanına yazılan DEĞERİN ne olduğunu söyler:
 *   · `.mp4` dosyası (R2 yolu / tam adres)  → `<video src>` ile oynatılır,
 *   · YouTube / Vimeo linki                 → `<iframe>` ile gömülür.
 *
 * SAF TUTULDU (import yok): hem panel hem vitrin kullanıyor, hem de tek başına
 * derlenip test edilebiliyor.
 */

/** Çözümleme sonucu. `kind: "none"` → vitrin videosu yok. */
export type HeroVideoSource =
  | { kind: "none"; url: ""; embedUrl: "" }
  | { kind: "file"; url: string; embedUrl: "" }
  | { kind: "embed"; url: string; embedUrl: string };

/** YouTube video kimliği (11 karakter). */
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Metinden YouTube video kimliğini çıkarır. Desteklenen yazımlar — kullanıcı
 * hangi biçimi yapıştırırsa yapıştırsın çalışsın diye hepsi denenir:
 *   watch?v=ID · youtu.be/ID · /embed/ID · /shorts/ID · /live/ID · çıplak ID
 */
function youtubeId(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube(?:-nocookie)?\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/live\/([A-Za-z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(raw);
    if (match?.[1]) return match[1];
  }
  return YT_ID_RE.test(raw) ? raw : "";
}

/** Vimeo video kimliği. */
function vimeoId(value: string): string {
  return /vimeo\.com\/(?:video\/)?(\d{6,})/.exec(value.trim())?.[1] ?? "";
}

/**
 * Vitrin için YouTube gömme adresi.
 *
 * Parametrelerin HEPSİ gerekli:
 *   `autoplay=1&mute=1` → otomatik oynatma YALNIZCA sessiz çalışır (tarayıcı kuralı),
 *   `controls=0`        → kumanda çubuğu gizlenir,
 *   `loop=1&playlist=ID`→ tek video döngüsü (YouTube'da döngü için playlist şart),
 *   `modestbranding=1&rel=0&iv_load_policy=3` → marka/öneri/etiket katmanları kısılır,
 *   `playsinline=1`     → telefonda tam ekrana zorlamaz.
 * `youtube-nocookie.com`: gizlilik dostu alan adı (izleme çerezi yazmaz).
 */
function youtubeEmbedUrl(id: string): string {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    controls: "0",
    loop: "1",
    playlist: id,
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    iv_load_policy: "3",
    disablekb: "1",
    fs: "0",
    // Kumandaların kendiliğinden gizlenmesi ve başlık şeridinin gösterilmemesi.
    // (YouTube bu parametreleri yıllar içinde etkisizleştirdi; yine de gönderiyoruz
    // ve ASIL çözümü oynatıcıyı gizli ön-yükleme ile yapıyoruz — bkz. `routes/index.tsx`.)
    autohide: "1",
    showinfo: "0",
  });
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

/** Vitrin için Vimeo gömme adresi (`background=1` tam arka plan modu). */
function vimeoEmbedUrl(id: string): string {
  const params = new URLSearchParams({
    autoplay: "1",
    muted: "1",
    loop: "1",
    background: "1",
    controls: "0",
  });
  return `https://player.vimeo.com/video/${id}?${params.toString()}`;
}

/**
 * Kayıtlı değeri çözümler. Tanınan bir video sitesi linki değilse DOSYA kabul edilir
 * (ör. R2 mp4 adresi ya da `/static/anime-data/<slug>/anime-header.mp4`).
 */
export function heroVideoSource(value: unknown): HeroVideoSource {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return { kind: "none", url: "", embedUrl: "" };
  const yt = youtubeId(raw);
  if (yt) return { kind: "embed", url: raw, embedUrl: youtubeEmbedUrl(yt) };
  const vimeo = vimeoId(raw);
  if (vimeo) return { kind: "embed", url: raw, embedUrl: vimeoEmbedUrl(vimeo) };
  return { kind: "file", url: raw, embedUrl: "" };
}
