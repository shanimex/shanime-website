/**
 * Sunucu tarafı okuma önbelleği — TTL'li, ufak bir yardımcı.
 *
 * NEDEN VAR (kota/egress): site SUNUCUDA render ediliyor (Cloudflare Workers,
 * nitro/wrangler) ve her istek Supabase'i yeniden okuyordu: ana sayfa
 * (`fetchShows`), seri detayı (`fetchShowDetail`), site ayarları/reklam slotları,
 * benzer seriler ve son bölümler. Bu, ziyaretçi başına değil İSTEK başına okuma
 * demektir; kullanıcının Supabase kotası neredeyse tükendi ve site binlerce anime
 * barındıracak. Aynı içerik kısa süreliğine hatırlanarak okuma sayısı düşürülür.
 *
 * NEDEN BİRKAÇ DAKİKA YETERLİ: burada önbelleğe alınan verilerin hiçbiri
 * kullanıcıya özel değil — hepsi herkese açık içerik kataloğudur. Panelden
 * yapılan bir düzenlemenin ziyaretçiye birkaç dakika gecikmeyle yansıması
 * zararsızdır (site bir "canlı sohbet" değil, bölüm listesi/ayar gösterir);
 * buna karşılık kazanç (kota/egress) çok büyüktür. TTL'ler bu dengeyi yansıtır
 * (bkz. aşağıdaki `TTL_*` sabitleri).
 *
 * NEDEN HATA ÖNBELLEĞE YAZILMAZ: bir okuma hatası GEÇİCİ olabilir (ağ, kotanın
 * o an dolması). Hata sonucu önbelleğe yazılsaydı, tek bir geçici hatadan sonra
 * site TTL boyunca boş/eksik içerik gösterirdi — üstelik sorun düzelmiş olsa
 * bile. Bu yüzden yalnızca BAŞARILI sonuç saklanır; `load()` reddederse hata
 * olduğu gibi çağırana geçer ve önbelleğe HİÇBİR ŞEY yazılmaz.
 *
 * İKİ KATMAN:
 *   1) Workers Cache API (`globalThis.caches.default`) — ısıtıcı (isolate)
 *      değişse veya yeniden başlasa bile önbellek yaşar; asıl kazanç burada.
 *   2) Modül düzeyi `Map` — Cache API bulunmayan ortam (Node, `vite dev`,
 *      tarayıcı) için yedek.
 *
 * GÜVENLİ İÇE AKTARMA: bu modül hem sunucuda hem istemcide import edilebilir
 * olmalı. Bu yüzden her önbellek erişimi korumalıdır (`try/catch`) ve modül
 * yüklenirken hiçbir platform API'sine dokunulmaz. Önbellek yüzünden bir sayfa
 * ASLA patlamamalıdır: okuma/yazma hatasında sessizce `load()`'a düşülür.
 */

/** Girdi: son kullanma zamanı (ms) + değer. `Map` yedeğinde tutulur. */
type Entry = { expiresAt: number; value: unknown };

/** Cache API yoksa kullanılan modül düzeyi yedek. İsteğe göre TTL ile süzülür. */
const memory = new Map<string, Entry>();

/**
 * Bellek yedeğinin üst sınırı.
 *
 * NEDEN SINIR: uzun ömürlü bir isolate'te (Worker) seri detayları gibi anahtar
 * başına bir girdi birikirse bellek sınırsız büyür. Sınır aşılırsa önce süresi
 * geçmiş girdiler, hâlâ doluysa en eski girdiler atılır.
 */
const MEMORY_MAX_ENTRIES = 500;

/** Anahtarları geçerli bir mutlak URL'ye çevirmek için sabit önek (yalnızca yerel anahtar). */
const KEY_PREFIX = "https://server-cache.local/";

/** Workers Cache API nesnesi (`caches.default`). Yoksa `null`. */
function workersCache(): Cache | null {
  try {
    const storage = globalThis.caches as CacheStorage | undefined;
    const cache = (storage as unknown as { default?: Cache } | undefined)?.default;
    return cache ?? null;
  } catch {
    // `caches` erişimi bazı ortamlarda (SSR/Node) atabilir; yedek Map'e düşülür.
    return null;
  }
}

/** Süresi geçmiş girdileri atar; hâlâ sınırın üstündeyse en eskileri siler. */
function pruneMemory(now: number): void {
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }
  while (memory.size >= MEMORY_MAX_ENTRIES) {
    const oldest = memory.keys().next();
    if (oldest.done) break;
    memory.delete(oldest.value);
  }
}

/**
 * GELİŞTİRME (dev) KISAYOLU — bu fonksiyon önbelleğin TAMAMEN atlanıp
 * atlanmayacağını söyler.
 *
 * NEDEN VAR: geliştirmede panelden içerik düzenlenip hemen siteye bakılıyor; 2-5
 * dakikalık bayat önbellek "kaydettim ama görünmüyor" karmaşası yaratıyordu. Dev'de
 * önbellek tamamen kapatılır: ne okunur ne yazılır, her istek doğrudan `load()`
 * çalıştırır → düzenleme ANINDA görünür.
 *
 * NEDEN ÜRETİMDE AÇIK: üretimde amaç tersidir — Supabase kotası/egress koruması
 * (bkz. dosya başı notu ve `TTL_*` sabitleri). Bu yüzden üretimde davranış
 * bugünküyle birebir aynı kalır (aynı TTL, aynı anahtar, aynı yedek semantiği).
 *
 * ÖNEMLİ: bu koşul bir üretim derlemesinde ASLA `true` OLMAMALIDIR. `Vite` üretim
 * derlemesinde `import.meta.env.DEV` değerini derleme zamanında `false` ile
 * değiştirir; yani bu dal üretim çıktısında ölü koddur.
 *
 * SAVUNMACI DAVRANIŞ: `import.meta.env` erişilemezse (Vite dışı bir çalıştırma,
 * beklenmedik ortam) `false` döner ve MEVCUT davranış korunur — üretimde önbelleği
 * yanlışlıkla kapatıp kotayı riske atmayız.
 */
function isDevelopmentBuild(): boolean {
  try {
    return import.meta.env?.DEV === true;
  } catch {
    // Ortam bilgisi okunamadı: güvenli taraf üretim davranışıdır (önbellek açık).
    return false;
  }
}

/**
 * Bir okumayı `ttlSeconds` boyunca önbelleğe alır.
 *
 * Akış:
 *   1. Cache API'de bak (varsa). Bulunursa döndür — Supabase'e HİÇ gidilmez.
 *   2. Bellek yedeğinde bak. Taze ise döndür.
 *   3. Önbellek boş → `load()` çağrılır. Başarılıysa sonuç hem Cache API'ye hem
 *      bellek yedeğine yazılır. `load()` reddederse hata dışarı verilir ve
 *      önbelleğe yazılmaz (bkz. dosya başı notu).
 *
 * @param key Önbellek anahtarı (okuma başına benzersiz, kullanıcıdan bağımsız).
 * @param ttlSeconds Tazelik süresi (saniye). `<= 0` ise önbellek kullanılmaz.
 * @param load Önbellek boşken çalışacak gerçek okuma.
 */
export async function cachedRead<T>(
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  // GELİŞTİRME: önbellek tümüyle devre dışı — ne okuma ne yazma, doğrudan `load()`.
  // Böylece panelden yapılan değişiklik anında görünür. Üretimde bu dal ölüdür ve
  // aşağıdaki davranış (TTL'ler, anahtarlar, yedek Map) birebir korunur.
  if (isDevelopmentBuild()) return load();

  const cacheKey = `${KEY_PREFIX}${encodeURIComponent(key)}`;
  const now = Date.now();
  const cache = workersCache();

  // 1) Workers Cache API: ısıtıcıdan bağımsız, asıl paylaşımlı katman.
  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit) return (await hit.json()) as T;
    } catch {
      // Önbellek OKUNAMADI: sayfa önbellek yüzünden asla patlamamalı → load()'a düş.
    }
  }

  // 2) Bellek yedeği (Node/dev/tarayıcı ya da Cache API erişilemezse).
  const mem = memory.get(cacheKey);
  if (mem && mem.expiresAt > now) return mem.value as T;

  // 3) Önbellek boş: gerçek okuma. Reddederse hata yukarı çıkar, önbelleğe yazılmaz.
  const value = await load();

  const ttlMs = Math.max(0, ttlSeconds) * 1000;
  if (ttlMs > 0) {
    if (memory.size >= MEMORY_MAX_ENTRIES) pruneMemory(now);
    memory.set(cacheKey, { expiresAt: now + ttlMs, value });

    if (cache) {
      try {
        await cache.put(
          cacheKey,
          new Response(JSON.stringify(value), {
            headers: {
              "Content-Type": "application/json",
              // TTL tek yerden: hem Cache API hem ara katmanlar aynı süreyi görsün.
              "Cache-Control": `s-maxage=${ttlSeconds}`,
            },
          }),
        );
      } catch {
        // Yazma başarısız olduysa bellek kopyası yeterli; işlev bozulmaz.
      }
    }
  }

  return value;
}

/**
 * Katalog/liste okumaları: 120 sn.
 *
 * NEDEN 120: ana sayfa vitrini ve seri listesi her istekte okunuyordu. 2 dakika,
 * panelden yeni seri/bölüm eklendiğinde içeriğin "neredeyse anında" görünmesini
 * sağlarken istek başına okumayı büyük ölçüde eler. Daha uzun TTL, paneli
 * "kaydettim ama görünmüyor" durumuna düşürürdü.
 */
export const TTL_CATALOG_SECONDS = 120;

/**
 * Seri detayı okumaları: 120 sn.
 *
 * NEDEN 120: detay çağrısı DÖRT tablo sorgusu + Storage imzalaması demektir
 * (`shows`, `show_episodes`, `show_seasons`, `site_settings`). Bir seriyi çok
 * açan ziyaretçi trafiğinde bu okuma kısa süreliğine hatırlanır. Bölüm/kapak
 * düzenlemelerinin 2 dakika içinde görünmesi yeterlidir.
 */
export const TTL_DETAIL_SECONDS = 120;

/**
 * Site ayarları / reklam slotları: 300 sn.
 *
 * NEDEN 300: bu satırlar (`site_settings`) tüm sayfalarda ortak okunur ve küçük
 * gövdelidir; panelde SEYREK düzenlenir (reklam kodu, kapak haritası). 5 dakika,
 * "pencere başına tek okuma" hedefini gerçekleştirir ve paneli rahatsız etmez.
 * İstemci tarafındaki tazelik de aynı mertebededir (bkz. lib/query-client.ts).
 */
export const TTL_SETTINGS_SECONDS = 300;

/**
 * "Son bölümler" akışı: 120 sn.
 *
 * NEDEN 120: yeni bölümler siteye düzenli eklenir ama ziyaretçinin "en yeni"
 * listesinin 2 dakika gecikmesi fark edilmez; buna karşılık bu okuma her ana
 * sayfa isteğinde tekrarlanıyordu.
 */
export const TTL_LATEST_SECONDS = 120;

/**
 * "Benzer seriler": 120 sn.
 *
 * NEDEN 120: seri başına tür eşleşmesiyle yapılan ek okuma. Aynı seriyi açan
 * ziyaretçiler için içerik değişmez; 2 dakika yeterli tazelik sağlar.
 */
export const TTL_SIMILAR_SECONDS = 120;

/**
 * "GELECEK ANİMLER" (AniList upcoming sorgusu): 6 saat.
 *
 * NEDEN 6 SAAT: bu veri BİZİM kataloğumuz değil, dış bir API'nin (AniList)
 * yanıtıdır. AniList yanıtları **CDN'de önbelleklenmez**
 * (`Cache-Control: no-cache, private`) ve 30 istek/dk sınırı vardır; yani
 * önbelleği BİZ kurmazsak her sayfa görüntülemesi bir upstream isteği demek
 * olurdu. Yaklaşan animelerin başlangıç tarihleri gün mertebesinde değişir; bir
 * seri aynı gün içinde başlasa bile kartta yalnızca tarih/biçim/bölüm sayısı
 * yazdığı için 6 saatlik gecikme fark edilmez. Sonuç: upstream'e GÜNDE 4 istek
 * (saatte ~0,17) — "saatte birkaç istek" hedefinin çok altında.
 */
export const TTL_ANILIST_UPCOMING_SECONDS = 6 * 60 * 60;

/**
 * "Estimated Schedule" (AniList haftalık yayın takvimi): 3 saat.
 *
 * NEDEN 3 SAAT: takvim 7 günlük bir pencereyi TEK seferde çeker (gün başına
 * değil) ve en fazla birkaç sayfa isteği yapar. Saat değerleri gün içinde
 * değişebildiği (yayın saati kayabilir) ve "bugün" penceresi ancak önbellek
 * dolumu kadar taze kalabildiği için TTL upcoming'den daha kısa seçildi;
 * 3 saat, sayfa görüntülemesi başına upstream isteğini tamamen kaldırırken
 * (her istek önbellekten karşılanır) saatte en fazla ~2 istek bırakır.
 */
export const TTL_ANILIST_SCHEDULE_SECONDS = 3 * 60 * 60;

/**
 * Sağlayıcı embed ÇÖZÜMÜ (`@megaplay` doğrulaması): 300 sn.
 *
 * NEDEN 300: burada önbelleğe alınan şey \"bu bölüm için MAL yolu mu AniList yolu mu
 * oynuyor\" sorusunun yanıtıdır. Üç ısrar (megaplay MAL, megaplay AniList, AniList
 * GraphQL) bu süre boyunca tekrar EDİLMEZ — hem dış servislere istek yağmuru olmaz
 * hem sayfa açılışı beklemez. Sağlayıcı eşlemesi gün mertebesinde değiştiği için
 * 5 dakikalık gecikme yeterli; daha uzun TTL, ölü bir eşleme düzeldiğinde \"kaynak
 * yok\" durumunu gereksiz uzatırdı.
 */
export const TTL_EMBED_SECONDS = 300;
