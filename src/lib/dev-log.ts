/**
 * CANLI HATA GÜNLÜĞÜ (yalnızca geliştirme).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NEDEN VAR (kullanıcı isteği, 28.09.2026)
 *
 * "Canlı olarak her yaptığım işlemi takip edebilir misin, log alır mısın; hangi
 * işlemde bana ne oldu, hatamızı bul. Ben anında hatayı söyleyeyim, algıla."
 *
 * SORUN: Tarayıcı konsolu yalnızca SEKME AÇIK KEN okunabilir ve sayfa yenilenince
 * temizlenir. Asistan bakmadığı anda oluşan hata KAYBOLUR; ayrıca "hangi sayfada,
 * hangi istekten sonra oldu" bilgisi kaydedilmiyordu.
 *
 * ÇÖZÜM: Bu modül tarayıcıdaki önemli olayları SUNUCUDAKİ bir dosyaya yazar
 * (`.dev-log.jsonl`). Böylece:
 *   · Sayfa yenilense de kayıt durur,
 *   · Asistan dosyayı okuyup "şu anda ne oldu" sorusunu kesin cevaplar,
 *   · Hata, kullanıcı fark etmeden de kayda geçer.
 *
 * ── NE KAYDEDİLİR ─────────────────────────────────────────────────────────
 *   · `page`    — sayfa geçişi (hangi ekranda ne yapıldığı bağlamı)
 *   · `error`   — yakalanmayan JS hatası (mesaj + yığın izi + dosya:satır)
 *   · `reject`  — işlenmeyen Promise reddi (async akış hataları)
 *   · `fetch`   — 2xx OLMAYAN istek (url + durum + süre). Kaynak çözümü, Supabase
 *                 ve çeviri çağrıları burada görünür: "neden bölüm yüklenmedi"
 *                 sorusunun cevabı genellikle budur.
 *
 * ── GÜVENLİK / SINIRLAR ───────────────────────────────────────────────────
 *   · YALNIZCA GELİŞTİRMEDE çalışır (`import.meta.env.DEV`). Üretim derlemesinde
 *     bu modül hiçbir şey yapmaz; ağ isteği göndermez.
 *   · Yığın izleri kısaltılır, istek gövdesi ASLA kaydedilmez (şifre/oturum
 *     bilgisi dosyaya düşmesin).
 *   · Gönderim hataları sessizce yutulur — günlük yazılamazsa uygulama etkilenmez.
 * ═══════════════════════════════════════════════════════════════════════════
 */

type Entry = {
  t: string;
  kind: "page" | "error" | "reject" | "fetch";
  text: string;
  /**
   * `exactOptionalPropertyTypes` açık olduğu için `| undefined` AÇIKÇA yazılır:
   * aksi hâlde `{ extra: undefined }` göndermek tip hatası verir.
   */
  extra?: Record<string, unknown> | undefined;
};

/** Aynı hatanın saniyede onlarca kez yazılmasını engeller (dosya şişmesin). */
const seen = new Map<string, number>();
const DEDUPE_MS = 3000;

/** Toplu gönderim: aynı anda oluşan olaylar tek istekte gider. */
let queue: Entry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function stamp(): string {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

function flush(): void {
  timer = null;
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  // `keepalive`: sayfa kapanırken/gezinirken de istek tamamlansın.
  void fetch("/api/dev-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries: batch }),
    keepalive: true,
  }).catch(() => undefined);
}

function push(entry: Entry): void {
  const key = `${entry.kind}:${entry.text}`;
  const now = Date.now();
  const last = seen.get(key);
  if (last !== undefined && now - last < DEDUPE_MS) return;
  seen.set(key, now);
  // `seen` sınırsız büyümesin.
  if (seen.size > 500) seen.clear();

  queue.push(entry);
  /**
   * 150 ms — 400 ms idi. ÖLÇÜLEN KAYIP: kullanıcı kaydet'e bastı, bu arada
   * sayfa yenilendi (Vite tam sayfa yenilemesi) ve kuyruktaki kayıt hiç
   * gönderilemedi; sonuç satırı günlükte hiç görünmedi. Süreyi kısaltmak kayıp
   * penceresini daraltır; asıl güvence aşağıdaki `pagehide` tetikleyicisidir.
   */
  if (!timer) timer = setTimeout(flush, 150);
}

/**
 * SAYFA KAPANIRKEN/GİZLENİRKEN KUYRUĞU BOŞALT.
 *
 * Sekme yenilemesi, sekme kapatma veya başka sayfaya geçiş sırasında bekleyen
 * kayıtlar kaybolmasın. `keepalive` bayrağı (bkz. `flush`) isteğin sayfa
 * kapanırken de tamamlanmasını sağlar.
 */
function flushNow(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  flush();
}

/** Yığın izini kısaltır: dosya yolu + satır kalır, gürültü gider. */
function shortStack(stack?: string): string {
  if (!stack) return "";
  return stack
    .split("\n")
    .slice(0, 8)
    .map((line) => line.trim())
    .join(" | ")
    .slice(0, 900);
}

let installed = false;

/**
 * Günlükçüyü kurar. Kök bileşende bir kez çağrılır (istemci tarafı).
 * Geliştirme dışında hiçbir şey yapmaz.
 */
export function installDevLog(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  if (!import.meta.env.DEV) return;
  installed = true;

  push({ t: stamp(), kind: "page", text: `açıldı: ${window.location.pathname}` });

  // Sayfa kapanırken/yenilenirken bekleyen kayıtları hemen gönder.
  window.addEventListener("pagehide", flushNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushNow();
  });

  window.addEventListener("error", (event) => {
    const error = (event as ErrorEvent).error as Error | undefined;
    push({
      t: stamp(),
      kind: "error",
      text: error?.message ?? String((event as ErrorEvent).message ?? "bilinmeyen hata"),
      extra: {
        where: `${(event as ErrorEvent).filename ?? "?"}:${(event as ErrorEvent).lineno ?? "?"}`,
        stack: shortStack(error?.stack),
      },
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason as unknown;
    const message =
      reason instanceof Error
        ? reason.message
        : typeof reason === "string"
          ? reason
          : "Promise reddi";
    push({
      t: stamp(),
      kind: "reject",
      text: message,
      extra: { stack: shortStack(reason instanceof Error ? reason.stack : undefined) },
    });
  });

  /**
   * BAŞARISIZ İSTEKLER — kaynak çözümü/veritabanı sorunlarının asıl izi.
   *
   * `fetch` SARILIR ama davranışı DEĞİŞTİRİLMEZ: aynı söz aynen döner. Yalnızca
   * sonuç izlenir. Böylece "bölüm yüklenmedi" dendiğinde hangi uç noktanın kaç
   * döndüğü dosyada hazır olur.
   */
  /**
   * HER TIKLAMA KAYDEDİLİR — "işlem yaptım ama hiçbir şey olmadı" bulmacasının
   * cevabı burada.
   *
   * ── NEDEN GEREKLİ (ölçülen olay, 28.09.2026) ────────────────────────────────
   * Kullanıcı bilerek hatayı tekrarladı. Günlükte YALNIZCA sayfa yüklemesi vardı:
   * ne `save()` çağrısı, ne başarısız istek, ne hata. Yani "hiçbir şey olmadı"
   * durumunda elimizde HİÇBİR veri yoktu ve sebep tahmine kalıyordu.
   *
   * Şimdi düğme/bağlantı tıklamaları da düşer. Böylece:
   *   · `tıklandı: Kaydet` görünüp ardından hiçbir şey gelmiyorsa → tıklama
   *     işleyiciye ulaşmamış (buton devre dışı, engellenmiş ya da arayüz donmuş),
   *   · `tıklandı: Kaydet` + `kaynak kaydı denendi` → işleyici çalıştı, sonuç ayrı
   *     satırda.
   *
   * GÜRÜLTÜ KONTROLÜ: yalnızca DÜĞME/BAĞLANTI ve `role=button` öğeleri, en fazla
   * 40 karakterlik etiketle kaydedilir; aynı etiket 3 saniye içinde tekrar
   * ederse yinelenmez (mevcut `push` süzgeci). Metin girişleri kaydedilmez —
   * kullanıcının yazdığı içerik günlüğe düşmez.
   */
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const el = target?.closest?.("button, a, [role='button']");
      if (!el) return;
      const label = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!label) return;
      push({ t: stamp(), kind: "page", text: `tıklandı: ${label}` });
    },
    // Yakalama evresi: React'in kendi işleyicisi olayı durdursa bile kayıt düşer.
    true,
  );

  /**
   * YAZILAN METİNLER DE KAYDEDİLİR — kullanıcının asıl istediği buydu.
   *
   * ── NEDEN (ölçülen olay, 28.09.2026) ────────────────────────────────────────
   * Kullanıcı asistana ulaşmak için **arama kutusuna harf harf mesaj yazdı** ve
   * "sohbetten bana yaz" dedi. Asistan bunu göremedi, çünkü ilk sürümde metin
   * girişleri BİLEREK kaydedilmiyordu (güvenlik gerekçesi). Sonuç: kullanıcının
   * mesajı ekranda duruyordu ama asistan kör kaldı ve "sistem çalışmıyor" hissi
   * doğdu — kullanıcı haklıydı.
   *
   * ARTIK: `input` ve `textarea` alanlarına yazılan metin, yazma DURDUKTAN sonra
   * (700 ms) alan etiketiyle birlikte kaydedilir. Harf harf yazarken tek tek
   * satır üretilmez; her yazma kümesi TEK kayıt olur.
   *
   * ── SINIRLAR (bilinçli) ────────────────────────────────────────────────────
   *   · `type="password"` alanları ASLA kaydedilmez — şifre günlüğe düşmesin.
   *   · Değer 300 karakterde kesilir.
   *   · Yalnızca GELİŞTİRMEDE çalışır (`installDevLog` zaten öyle).
   */
  const inputTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
  /** Alanı tanıtan kısa etiket: yer tutucu → aria-label → etiket metni → ad. */
  function fieldLabel(el: Element): string {
    const input = el as HTMLInputElement;
    const holder = (input.placeholder ?? "").trim();
    if (holder) return holder.slice(0, 40);
    const aria = (el.getAttribute("aria-label") ?? "").trim();
    if (aria) return aria.slice(0, 40);
    const label = el.closest("label")?.textContent?.replace(/\s+/g, " ").trim();
    if (label) return label.slice(0, 40);
    return el.tagName === "TEXTAREA" ? "(metin alanı)" : "(girdi)";
  }

  document.addEventListener(
    "input",
    (event) => {
      const el = event.target as Element | null;
      if (!el) return;
      const tag = el.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") return;
      const input = el as HTMLInputElement;
      // ŞİFRE ASLA KAYDEDİLMEZ.
      if (input.type === "password") return;

      const previous = inputTimers.get(el);
      if (previous) clearTimeout(previous);
      inputTimers.set(
        el,
        setTimeout(() => {
          inputTimers.delete(el);
          const value = (input.value ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
          // Boşalan alanlar gürültü yapmasın (kullanıcı silerken boş kalır).
          if (!value) return;
          push({ t: stamp(), kind: "page", text: `yazdı [${fieldLabel(el)}]: ${value}` });
        }, 700),
      );
    },
    true,
  );

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args: Parameters<typeof fetch>) => {
    const started = Date.now();
    const response = await originalFetch(...args);
    if (!response.ok) {
      const input = args[0];
      const raw =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      const parsed = new URL(raw, window.location.origin);

      /**
       * ⚠️ SORGU DİZESİ VE HATA GÖVDESİ ŞART.
       *
       * İlk sürüm yalnızca yolu kaydediyordu (`400 /rest/v1/show_episodes`).
       * Gerçek olayda bu YETMEDİ: aynı yol yüzlerce farklı sorguyla çağrılıyor,
       * hangi filtrenin bozuk olduğu anlaşılamıyordu. Supabase/PostgREST hataları
       * sebebi YANIT GÖVDESİNDE söyler (ör. `invalid input syntax for type uuid`
       * ya da `column ... does not exist`). Bu yüzden:
       *   · sorgu dizesi (kısaltılmış) → hangi filtre
       *   · hata gövdesi (kısaltılmış) → neden
       * kaydedilir. İkisi olmadan teşhis tahmine kalıyordu.
       *
       * GÖVDE GÜVENLİĞİ: `response.clone()` kullanılır, böylece çağıran tarafın
       * okuduğu gövde tükenmez. Hata yanıtları yalnızca hata mesajı içerir;
       * istek gövdesi (şifre/oturum) ASLA okunmaz.
       */
      let detail = "";
      try {
        const text = await response.clone().text();
        detail = text.replace(/\s+/g, " ").trim().slice(0, 240);
      } catch {
        // Gövde okunamadı — durum kodu ve sorgu yine kayda geçer.
      }

      /**
       * HTTP YÖNTEMİ DE KAYDEDİLİR.
       *
       * NEDEN: aynı yol (`/rest/v1/show_episodes`) hem OKUMA (`GET`) hem YAZMA
       * (`POST`/`PATCH`/`DELETE`) için kullanılıyor. Yöntem olmadan "400 aldık"
       * bilgisi teşhis için yetersiz kalıyordu — kullanıcı "kaydettim, olmadı"
       * dediğinde hatanın yazma mı okuma mı olduğu anlaşılamıyordu.
       */
      const init = args[1] as RequestInit | undefined;
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();

      push({
        t: stamp(),
        kind: "fetch",
        text: `${response.status} ${method} ${parsed.pathname}${parsed.search.slice(0, 180)}`,
        extra: detail ? { ms: Date.now() - started, detail } : { ms: Date.now() - started },
      });
    }
    return response;
  };
}

/**
 * Elle işaret koyar — kullanıcı "şunu yaptım" dediğinde o anı dosyada görünür
 * kılmak için. Panel/izleme akışında kritik adımlarda çağrılabilir.
 */
export function devMark(text: string, extra?: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  push({ t: stamp(), kind: "page", text: `işlem: ${text}`, extra });
}
