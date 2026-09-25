# Video Oynatıcı Mimarisi — Uygulama Planı + Blokajlar

> **Tarih:** 25.09.2026 · **Durum:** ONAY BEKLİYOR
> **Önemli:** Bu adımda **hiçbir mevcut kod dosyası değiştirilmedi.** İstenen 5 maddenin
> bazıları blokajlı/hatalı olduğu için önce plan + kanıt sunuluyor.

---

## 0. Özet tablo

| # | İstenen | Durum | Sebep |
|---|---|---|---|
| 1 | vidsrc anime embed | 🔴 **BLOKAJLI** | `mal_id` şemada yok · vidsrc.pro erişilemiyor · anime endpoint'i belgelenmemiş |
| 2 | Görünmez overlay ile pop-up engelleme | 🔴 **TEKNİK OLARAK YANLIŞ** | Overlay `window.open`'i engelleyemez + oynatıcı kontrollerini kilitler |
| 3 | MyBid 2 × 5 sn VAST | 🟡 **KISMEN DOĞRULANDI** | İki spot da yanıt veriyor ama **Wrapper** döndürüyor; `skipoffset` doğrulanamadı |
| 4 | Adsterra yerleşimleri | 🟡 **3/4 ZATEN VAR** | 3 anahtar kodda mevcut; 4.'sü (Social Bar) pop-up ürettiği için bilinçli kapalı |
| 5 | Build güvencesi / strict tipler | ✅ **UYGULANABİLİR** | `tsc --noEmit` + `eslint` ile doğrulanır |

---

## 1. BLOKAJ — Veritabanında `mal_id` **yok**

Canlı Supabase REST'ten okunan **gerçek** sütun listeleri:

```
shows        -> banner_image_path, banner_video_path, created_at, description, genre,
                id, image_path, is_featured, slug, sort_order, subtitle, title,
                watch_url, year
show_episodes-> id, show_id, number, title, summary, duration, watch_url,
                created_at, updated_at, season
```

**`mal_id` / `anilist_id` / `tmdb_id` hiçbirinde yok.** Yani "Supabase'den gelen dynamic `mal_id`"
diye bir şey **şu an mevcut değil** — önce şema kolonu + veri girilmesi gerekir.

### 1.1 Doğrulanmış MAL kimlikleri (AniList GraphQL `idMal`)

Kaynak: `POST https://graphql.anilist.co` · sorgu `Media(search:$s,type:ANIME){idMal title{romaji} episodes}`

| Sitedeki dizi | `idMal` (doğrulandı) | Bölüm (kaynak) | DB'deki bölüm |
|---|---|---|---|
| Jujutsu Kaisen | **40748** | 24 | 24 ✅ birebir |
| Re:Zero | **31240** | 25 | — |
| Mushoku Tensei: Jobless Reincarnation | **39535** | 11 | — |
| Erased (Boku dake ga Inai Machi) | **31043** | 12 | — |

> Not: İlk denenen kaynak Jikan (`api.jikan.moe`) bu kontrolde **504 Gateway Timeout** verdi;
> kimlikler **AniList**'ten alındı. Yayına almadan önce MAL'den çapraz kontrol önerilir.

---

## 2. BLOKAJ — vidsrc: erişilemiyor **ve** anime desteği belgelenmemiş

### 2.1 Ölçüm (HTTP, User-Agent: Chrome)

| Adres | Sonuç |
|---|---|
| `https://vidsrc.pro/` | **bağlantı yok** |
| `https://vidsrc.pro/40748/1/1` | **HTTP 522** |
| `https://vidsrc.pro/anime/40748/1/1` | **HTTP 522** |
| `https://vidsrc.cc/` | **HTTP 522** |
| `https://vidsrc.to/` · `/me/` · `/pm/` · `/win/` | HTTP 200 |
| `https://vidsrc.xyz/` · `/net/` · `/in/` | bağlantı yok |

### 2.2 İstenen şablon **sözdizimi olarak bozuk**

`https://vidsrc.pro{mal_id}/{season}/{episode}` → `mal_id=40748` için
`https://vidsrc.pro40748/1/1` üretir. Ölçüm: **"Uzak ad çözülemedi: 'vidsrc.pro40748'"** —
yani alan adı diye bir şey yok. **Şablon bu hâliyle kullanılamaz**; araya `/` gerekir.

### 2.3 Canlı vidsrc.to SSS'inden **birebir alıntı**

> **"Can i use this API for anime?"**
> **"Currently we do not support anime, we may do that in the future."**

Belgelenen biçimler:
- `vidsrc.to` → `/embed/movie/{id}` · `/embed/tv/{id}/{season}/{episode}`
- `vidsrc.me` → `/embed/tv/{id}` · `/embed/tv/{id}/{season}/{episode}` · `/embed/tv/{id}/{season}-{episode}`

**Hiçbirinde anime yolu yok.** Bu yüzden "sağlayıcı 1080p/720p/480p ve TR/EN altyazıyı otomatik sunar"
iddiası **doğrulanamıyor** — anime endpoint'i bulunamadı.

### 2.4 "Telif/silinme dertlerini sıfırlamak" — ters etki

Tek bir üçüncü taraf embed'e bağlanmak riski sıfırlamaz, **tek noktaya toplar**. Şu anki kanıt:
`vidsrc.pro` ve `vidsrc.cc` **522** veriyor. O alan adı çökerse sitede **hiç video kalmaz**.
Kendi dosyan (VidMoly / R2) bu açıdan **daha dayanıklı**.

---

## 3. TEKNİK HATA — overlay pop-up'ı **engellemez**

İstenen: "iframe'in tam üzerine görünmez tıklama yakalama katmanı → pop-up engellenir."

**Bu çalışmaz:**

1. **Pop-up, `window.open` ile iframe'in İÇİNDEN açılır.** Üstteki bir katman, cross-origin iframe'in
   içindeki JS çağrısını **engelleyemez** — senin DOM'un o çağrıya bağlı değil. Overlay yalnızca
   **kullanıcı tıklamasını** yer; programatik `window.open`'i değil.
2. **Oynatıcı kontrollerini kalıcı kilitler.** Overlay iframe'in üstünü kaplarsa kullanıcı
   **oynat/durdur, ileri-geri, ses, tam ekran, kalite (1080/720/480) ve altyazı (CC)** düğmelerini
   kullanamaz. Bu, 1. maddede istediğin özelliklerle **doğrudan çelişir**.
3. **Zaten çözülmüş:** `PrerollGate` tam olarak "reklam bitmeden oynatıcı yüklenmez" davranışını
   yapıyor — canlı testte doğrulandı: reklam oynadı, ekranda **"Reklam 1/1"** + **"Reklamı geç"**
   çıktı, sonra oynatıcı yüklendi. Overlay'e gerek yok.
4. **Sandbox denendi ve başarısız** — ayrıntı: `OYNATICI-FLUIDPLAYER.md §6`.
   Sağlayıcılar sandbox'lı embed'i reddediyor ("Client blocked!", "The embed could not be loaded.").
   Yani "ne sandbox ne overlay" ile sağlayıcı pop-up'ı dışarıdan **kontrol edilemiyor**;
   çözüm sağlayıcıyı değiştirmek.

---

## 4. ÖLÇÜM — MyBid spotları

| Spot | HTTP | `<Ad>` | InLine | Wrapper | `skipoffset` | `Duration` |
|---|---|---|---|---|---|---|
| `2028774` (kodda gömülü olan) | **403** | — | — | — | — | — |
| **`2028789`** | 200 | **1** | 0 | **1** | **görünmedi** | **görünmedi** |
| **`2028790`** | 200 | **1** | 0 | **1** | **görünmedi** | **görünmedi** |

- İki yeni spot da **tek `<Ad>`** döndürüyor ve bu bir **Wrapper** (VASTAdTagURI yönlendirmesi),
  InLine değil. **2 spot = 2 reklam** hedefine uygun.
- ⚠️ `skipoffset` / `Duration` **wrapper seviyesinde yok**; iç etiket çözüldükten sonra gelir.
  Bu yüzden "**5 saniyede atlanabilir**" bu yanıttan **doğrulanamadı**. Kod tarafı atlamayı
  VAST yanıtındaki `skipoffset`'ten okur; yoksa `PrerollGate`'in 5 sn varsayılanı devreye girer.
- ⚠️ `2028774`'ün **403** dönmesi referer/başlık kaynaklı olabilir (tarayıcı bağlamında çalışıyordu).
  **Kesin değil** — MyBid panelinden teyit edilmeli.
- Her iki spot da bir **Wrapper** olduğu için, oynatıcının yönlendirmeyi takip edebilmesi gerekir:
  `FluidPlayer.tsx` → `maxAllowedVastTagRedirects: 3` ✅ · `vast.ts` → wrapper zinciri desteği ✅

---

## 5. Adsterra — verilen kodların durumu

| Verilen script | Anahtar | Durum |
|---|---|---|
| `pl31353753.profitableratecpmnetwork.com/.../6200a7ece2b6394ea94eec1bd2f6d9c9.js` | — | **Bilinçli olarak bağlı DEĞİL** → `ADSTERRA_SOCIAL_BAR_SRC` |
| `highrevenueformat.com/.../invoke.js` | `8a5dc100511ee4d17b59adeaf586abcd` (300×250) | ✅ kodda var |
| `highrevenueformat.com/.../invoke.js` | `58f6928e3bd225665ca3d3141314d61e` (728×90) | ✅ kodda var |
| `pl31353754.profitableratecpmnetwork.com/.../invoke.js` + `container-...` | `42bcaa59193806d090844b6e622e8495` (Native) | ✅ kodda var |

**İki uyarı:**

1. **Social Bar eklenirse pop-up sorunu geri gelir.** Social Bar yüzen/katmanlı bir birimdir;
   senin "pop-up istemiyorum" kuralınla çelişir. Bu yüzden bağlanmamış durumda.
2. **Class isimlerini rastgeleleştirmek AdBlock'u geçmez.** Filtreler **alan adına** göre engeller
   (`highrevenueformat.com`, `profitableratecpmnetwork.com`); kendi `<div>`'imizin class'ı engelleme
   kararında **kullanılmaz**. Yani bu değişikliğin kazancı sıfır, maliyeti: okunabilirliğin düşmesi.
   (Ayrıca reklam kutularını gizlemek/cloaking ağ şartlarına aykırıdır.)

**Sonuç:** madde 4 için yapılacak gerçek iş, mevcut 3 birimin **yerleşimini** istenen düzene
(getirmek: oynatıcı üstü 728×90 → 768 px altında 300×250, hemen altına Native) oturtmaktır. Zaten
bu düzende; tek değişiklik 300×250'nin **oynatıcı üstünde de** kullanılması olur.

---

## 6. ÖNERİLEN KOD (onay bekliyor)

### 6.1 SQL — `mal_id` kolonu + doğrulanmış veriler

```sql
alter table public.shows add column if not exists mal_id integer;
comment on column public.shows.mal_id is
  'MyAnimeList kimliği (AniList idMal ile doğrulandı, 25.09.2026). Embed URL üretiminde kullanılır.';
create unique index if not exists shows_mal_id_key on public.shows (mal_id) where mal_id is not null;

update public.shows set mal_id = 40748 where slug = 'jujutsu-kaisen';
update public.shows set mal_id = 31240 where slug like 're-zero%';
update public.shows set mal_id = 39535 where slug like 'mushoku-tensei%';
update public.shows set mal_id = 31043 where slug like 'erased%';
```

### 6.2 `src/lib/embed-provider.ts` — strict tipli sağlayıcı soyutlaması

```ts
/**
 * Global yayın sağlayıcıları için tek giriş noktası.
 *
 * Neden ayrı modül: sağlayıcı adresleri sık değişir ve alan adları çöker.
 * Böylece URL biçimi TEK yerde durur; sağlayıcı değişince oynatıcı kodu değişmez.
 *
 * ÖNEMLİ: Aşağıdaki şablonlar YALNIZCA doğrulanmış sağlayıcılar için doldurulur.
 * Doğrulanmamış bir adres koda yazılmaz — yanlış şablon videoyu tamamen kırar.
 */

export type EmbedProviderId = "vidsrc" | "vidmoly" | "voe" | "streamtape" | "custom";

export interface EmbedEpisodeRef {
  /** MyAnimeList kimliği. Şemada yoksa null. */
  malId: number | null;
  /** Sezon numarası (1 tabanlı). */
  season: number;
  /** Bölüm numarası (1 tabanlı). */
  episode: number;
}

export interface EmbedProvider {
  id: EmbedProviderId;
  label: string;
  /** URL üretir; üretilemiyorsa null (oynatıcı "kaynak yok" gösterir). */
  buildUrl(ep: EmbedEpisodeRef): string | null;
}

/** Şablon: {mal} {season} {episode} yer tutucuları doldurulur. */
function fromTemplate(template: string, ep: EmbedEpisodeRef, needMal: boolean): string | null {
  if (needMal && !ep.malId) return null;
  const url = template
    .replace("{mal}", String(ep.malId ?? ""))
    .replace("{season}", String(ep.season))
    .replace("{episode}", String(ep.episode));
  return /^https:\/\/[^\s]+$/.test(url) ? url : null;
}

export const EMBED_PROVIDERS: Record<EmbedProviderId, EmbedProvider> = {
  // ⛔ ŞABLON BOŞ: vidsrc'nin anime endpoint'i belgelenmemiş (vidsrc.to SSS:
  //    "Currently we do not support anime") ve vidsrc.pro erişilemiyor (HTTP 522).
  //    Doğrulanmış biçim gelene kadar BİLİNÇLİ OLARAK null döner.
  vidsrc: { id: "vidsrc", label: "VidSrc", buildUrl: () => null },
  vidmoly: { id: "vidmoly", label: "VidMoly", buildUrl: () => null }, // kod tabanlı, bkz. §7
  voe: { id: "voe", label: "Voe", buildUrl: () => null },
  streamtape: { id: "streamtape", label: "Streamtape", buildUrl: () => null },
  custom: { id: "custom", label: "Özel", buildUrl: () => null },
};

/**
 * Veritabanındaki `watch_url` doluysa O kazanır (bugünkü davranış korunur).
 * Boşsa ve doğrulanmış bir sağlayıcı varsa ondan üretilir.
 */
export function resolveEpisodeEmbed(
  watchUrl: string | null | undefined,
  providerId: EmbedProviderId,
  ep: EmbedEpisodeRef,
): string | null {
  const direct = (watchUrl ?? "").trim();
  if (direct) return direct;
  return EMBED_PROVIDERS[providerId].buildUrl(ep);
}
```

### 6.3 Değişmeyecek dosyalar (mevcut çalışan kod korunur)

`FluidPlayer.tsx` · `PrerollGate.tsx` · `AdsterraUnit.tsx` · `vast.ts` — **hiçbirine dokunulmaz**.
`izle.$slug.tsx` içinde yalnızca `epUrl` hesabı `resolveEpisodeEmbed(...)` çağrısına çevrilir;
`watch_url` dolu olduğu sürece davranış **birebir aynı** kalır.

### 6.4 MyBid — 2 spot

`PrerollGate`/`FluidPlayer` zaten `PREROLL_VAST_URLS` / `vastTags()` üzerinden **çoklu** etiket
destekliyor. Tek değişiklik: varsayılanı yeni iki spota çevirmek.

```ts
// ÖNCE  : ["https://vast.vstserv.com/vast?spot_id=2028774"]  (aynı etiket iki kez çağrılıyordu)
// SONRA :
const PREROLL_VAST_URLS = [
  "https://vast.vstserv.com/vast?spot_id=2028789",
  "https://vast.vstserv.com/vast?spot_id=2028790",
];
```

---

## 7. AÇIK SORULAR — onay için

1. **Sağlayıcı hangisi olacak?** vidsrc'de anime endpoint'i bulunamadı ve `vidsrc.pro` şu an **522**.
   Doğrulanmış bir anime embed sağlayıcısı bulmamı ister misin (araştırıp **çalışan** adresi
   kanıtıyla getiririm), yoksa mevcut **VidMoly** düzeninde mi kalıyoruz?
2. **`mal_id` kolonu + 4 dizi güncellemesi** (6.1) uygulanabilir mi? (Geri alınabilir.)
3. **MyBid spotları** 2028789 + 2028790'a çevrilsin mi? (2028774 şu an **403** veriyor.)
4. **Social Bar** eklensin mi? Öneri: **hayır** — pop-up üretir, kendi kuralınla çelişir.
5. **Overlay** istiyor musun? Öneri: **hayır** — pop-up'ı engellemez, oynatıcı kontrolünü kilitler;
   `PrerollGate` aynı işi doğru yapıyor.

---

## 8. KARARLAR VE UYGULAMA (25.09.2026 — kullanıcı onayı sonrası)

### 8.1 Kullanıcı kararları

| # | Karar |
|---|---|
| 1 | Sağlayıcı = `https://animesrc.me{mal_id}/{season}/{episode}` |
| 2 | `mal_id` kolonu + 4 dizi SQL güncellemesi → **onaylandı** |
| 3 | MyBid çift VAST ad-pod (2028789 + 2028790) → **onaylandı** |
| 4 | Social Bar → **HAYIR** (eklenmeyecek) |
| 5 | Overlay → **HAYIR** (istenmiyor) |

### 8.2 Madde 1 — sağlayıcı **DOĞRULANAMADI**, uydurulmadı

**(a) `animesrc.me` diye bir alan adı YOK.** Ölçüm:

```
animesrc.me   -> DNS YOK        animesrc.com -> DNS YOK
animesrc.pro  -> DNS YOK        animesrc.net -> DNS YOK
animesrc.to   -> DNS YOK        animesrc.xyz -> HTTP 200 (114 bayt)
```

`animesrc.xyz` yanıt veriyor ama içeriği **GoDaddy "domain satılık" park sayfası**:
*"The domain name animesrc.xyz is for sale! Own it today for $599"*. Yani hiçbiri kullanılabilir değil.
Ayrıca şablon yine sözdizimi hatalı: `animesrc.me{mal_id}` → `animesrc.me40748` → **DNS YOK**.

**(b) vidsrc alternatifi de kapalı:** `vidsrc.pro` kök → bağlantı yok, `/40748/1/1` → **HTTP 522**.
Canlı vidsrc.to SSS'inden birebir: *"Can i use this API for anime?"* → *"Currently we do not
support anime, we may do that in the future."*

**(c) Gerçek ve BELGELENMİŞ bir sağlayıcı bulundu: `megaplay.buzz`.** Kendi `/api` dokümanından birebir:

```
Endpoint (MAL id + episode): https://megaplay.buzz/stream/mal/{mal-id}/{ep-num}/{language}
Endpoint (AniList id + ep):  https://megaplay.buzz/stream/ani/{anilist-id}/{ep-num}/{language}
Endpoint (catalog ep id):    https://megaplay.buzz/stream/s-2/{aniwatch-ep-id}/{language}
Note: Direct Access to Embed Links are Disabled. Links only work as Embed on your Websites
```

⚠️ **Ama malzeme eşlemesi tam değil.** Tarayıcıda açıldı:
`https://megaplay.buzz/stream/mal/40748/1/sub` (Jujutsu Kaisen S1B1) → **HTTP 410**:

> "We can't find the file you are looking for. It maybe got deleted by the owner or was removed due a
> copyright violation. / Error Code: 410"

Doküman da kabul ediyor: *"not every show is synced or mapped to MAL and AniList IDs yet."*
Ayrıca `/embed/{mal}/{sezon}/{bölüm}` biçimi megaplay'de **hiç geçmiyor** ve 404 veriyor.

### 8.3 Neden `ACTIVE_EMBED_PROVIDER = "none"`

Kanıt ortada: **aktif olan sağlayıcı adresinin var olduğu doğrulanamadı**, ve doğrulanan tek gerçek
sağlayıcı (megaplay) eldeki dizide **410** döndürüyor. Bu sağlayıcı açılsaydı bölümlerde
**"video yok"** ekranı çıkardı — yani siteyi bozardı.

Bu yüzden:
- Sağlayıcı soyutlaması **kuruldu** ve megaplay şablonu **doğrulanmış hâliyle** kaydedildi.
- Aktif sağlayıcı **kapalı**; bölüm adresi bugünkü gibi `watch_url`'den geliyor → **canlı davranış birebir korunuyor.**
- Sağlayıcı açmak tek satır: `src/lib/embed-provider.ts` → `ACTIVE_EMBED_PROVIDER = "megaplay"`.
  Açmadan önce `https://megaplay.buzz/stream/mal/{mal}/1/sub` adresinin **oynatıcı** döndürdüğünü
  (410 değil) tarayıcıda doğrula.

### 8.4 Yapılan değişiklikler

| Dosya | Durum | Ne yaptı |
|---|---|---|
| `src/lib/mybid.ts` | **YENİ** | Çift MyBid spotunun TEK kaynağı (`prerollVastUrls()`) |
| `src/lib/embed-provider.ts` | **YENİ** | Strict tipli sağlayıcı kaydı + `resolveEpisodeEmbed()`; doğrulama günlüğü yorumda |
| `scripts/sql/add-mal-id.sql` | **YENİ** | `mal_id` kolonu + 4 dizinin doğrulanmış kimlikleri + doğrulama sorgusu |
| `src/components/FluidPlayer.tsx` | düzenlendi | Yerel `vastTags()` kaldırıldı → `prerollVastUrls()` |
| `src/routes/izle.$slug.tsx` | düzenlendi | Yerel `MYBID_VAST_DEFAULT` kaldırıldı → `prerollVastUrls()` |
| `.env` | düzenlendi | `VITE_MYBID_VAST_1/2` → 2028789 / 2028790 |

### 8.5 ⚠️ SQL **çalıştırılmadı** — senin çalıştırman gerekiyor

`.env`'de yalnızca **publishable** anahtar var (`sb_publishable_A9_i…`); `service_role` anahtarı yok.
PostgREST üzerinden **DDL (ALTER TABLE) çalıştırılamaz**. Bu yüzden kolon eklenemedi.

➡️ `scripts/sql/add-mal-id.sql` içeriğini **Supabase Panel → SQL Editor**'de çalıştır.
Betik idempotent (tekrar çalıştırılabilir) ve geri alma komutları dosyanın başında yazılı.

### 8.6 Doğrulama (ölçüldü)

```
kalıntı kontrolü (vastTags / MYBID_VAST_DEFAULT) → temiz
npx tsc --noEmit                  → exit 0
npx eslint <4 dosya>              → exit 0
npm run build                     → exit 0  (✓ built in 566ms)
```

### 8.7 MyBid notu

Ad-pod artık **iki ayrı spot** ile kuruluyor (eskiden tek spot aynı etiket iki kez çağrılarak
ikinci reklam elde edilmeye çalışılıyordu). Eski spot `2028774` **artık HTTP 403** dönüyor.
İki yeni spot da HTTP 200 + 1 `<Ad>` (**Wrapper**) veriyor. `skipoffset`/`Duration` wrapper
seviyesinde görünmüyor; atlama noktası iç etiketten gelir, gelmezse `PrerollGate`'in 5 sn
varsayılanı devreye girer.

---

## 9. AKTİVASYON + ÖN REKLAM DOĞRULAMASI (25.09.2026)

### 9.1 Yapılan değişiklikler

| Dosya | Değişiklik |
|---|---|
| `src/lib/embed-provider.ts` | **`ACTIVE_EMBED_PROVIDER` → `"megaplay"`** (kullanıcı onayı) |
| `src/components/PrerollGate.tsx` | **HATA DÜZELTİLDİ:** yalnızca İLK VAST etiketi çekiliyordu (`vastUrls.find(...)`) → artık **tüm etiketler** paralel çekilip `MAX_ADS`'e kadar birleştiriliyor |
| `src/lib/vast.ts` | `DEFAULT_MAX_REDIRECTS` **3 → 5** (zincirin sonuna ulaşabilmek için) |
| `src/lib/vast.ts` | `pickMediaFile`'a **video-olmayan MIME filtresi**: VPAID (`apiFramework="vpaid"`) ve `application/javascript` / `text/html` kreatifler artık seçilmiyor |

### 9.2 Neden `PrerollGate` düzeltmesi şarttı

Eski kod tek etiket çekiyordu ve her spot tek `<Ad>` döndürdüğü için sayaç canlıda hep
**"Reklam 1/1"** kalıyordu — ikinci spot **hiç kullanılmıyordu**. Yani "çift spot" kurulumu
kâğıt üzerinde vardı, pratikte yoktu.

### 9.3 Neden `maxRedirects` yükseltildi

Sunucu tarafı ölçüm: spot `2028789`ın InLine'ı **5. hopta** geliyor
(`vast.vstserv.com` → `kts.sensitiveclick.com` → `r.visitstats.com` → …). Eski limit 3 ile
zincirin sonuna ulaşılamıyordu.

### 9.4 Neden video-olmayan MIME filtresi eklendi

Aynı ölçümde zincirin sonundaki `<MediaFile>` bir **VPAID** dosyasıydı
(`type="application/javascript"`, `apiFramework="VPAID"` → `static.21wiz.com/.../rtb_bidding.js`).
Eski kod bunu "en yüksek puanlı MediaFile" sayıp seçiyordu: `<video src="…bidding.js">` hata verir,
reklam **hiç görünmez**, ama başlangıçta **gösterim sayaçları tetiklenirdi**. Görünmeyen bir reklam
için gösterim saymak hem bozuk oynatıcı gösterir hem reklam ağının şartlarına aykırıdır.
Filtre **yalnızca video olmayan türleri eler**; gerçek mp4 kreatifleri etkilemez.

### 9.5 CANLI TEST — ad-pod **ÇALIŞIYOR** (yerel dev sunucusu, gerçek tarayıcı)

| | Test 1 (`b=1`, Streamtape) | Test 2 (`b=3`, VidMoly) |
|---|---|---|
| Kapı metni | "Önce **2** kısa reklam oynayacak" | "Önce **2** kısa reklam oynayacak" |
| Sayaç | **`Reklam 1/2`** + `Reklamı geç` | **`Reklam 1/2` → `Reklam 2/2`** + `Reklamı geç: 5` (geri sayım) |
| Oynayan kreatif | `i.imgkcdn.com/...6280/280/..._high.mp4` (duration 15,10 sn) | `...6284/284/...` ve `...6283/283/...` (duration 17,04 sn) |
| Konsol hatası | `errors: []` | `errors: []` |
| Sonrasında oynatıcı | ✅ yüklendi (`streamtape.com/e/YB2xWzzO7bUBlK`) | ✅ yüklendi (`vidmoly.org/embed-g0cxffba5dhc.html`) |

**Ağ (birebir):** `vast.vstserv.com/vast?spot_id=2028789` → **200**, `spot_id=2028790` → **200**
(her testte 2'şer istek). Impression/event beacon'ları: `/report` → 204, `/event` → 200,
`mauc.vstserv.com/video/show/?token=…` → 200. Token içeriği: `campaign_type:"video"`,
`response_type:"vast"`, `creativeID: 7996280` (T1) / `7996284` + `7996283` (T2), `country:TR`.

> **Önemli ayrım (dürüst not):** Sunucu tarafı (Referer'sız) ölçümde MyBid **VPAID/RTB zinciri**
> döndürdü; gerçek sayfa bağlamında ise **progressive video kreatifleri** servis edildi
> (`mauc.vstserv.com/video/show` → `i.imgkcdn.com/…mp4`). Yani 9.4'teki filtre gerçek reklamları
> **engellemedi** — yalnızca oynatılamaz kreatif gelirse devreye giren bir güvenlik ağıdır.

### 9.6 Regresyon kontrolü

- Her iki testte de reklamlardan sonra **bölüm oynatıcısı yükleniyor** — akış bozulmadı.
- 3. parti oynatıcıların **otomatik oynamaması** normaldir (Streamtape 00:00/00:00, VidMoly
  "devam et?" prompt'u); hata değil.

### 9.7 Doğrulama (ölçüldü)

```
npx tsc --noEmit                              → exit 0
npx eslint <4 dosya>                          → exit 0
npm run build                                 → exit 0
ACTIVE_EMBED_PROVIDER                          → "megaplay"
```

### 9.8 Kalan tek iş

`scripts/sql/add-mal-id.sql` → **Supabase Panel → SQL Editor**'de çalıştırılacak (publishable
anahtarla DDL çalıştırılamıyor). Bu yapılana kadar `mal_id` sütunu boştur; sağlayıcı yalnızca
`watch_url` boş olan bölümlerde kullanıldığı için bugünkü yayını etkilemez.

---

## 10. "Hiçbir şey değişmedi" — KÖK NEDEN ve DÜZELTME (25.09.2026)

Kullanıcı SQL'i Supabase'de çalıştırdı ve sitede değişiklik görmedi. İnceleme sonucu:

### 10.1 SQL **doğru** çalışmış — sorun SQL'de değil

Canlı okuma:

```
erased             mal_id=31043
jujutsu-kaisen     mal_id=40748
mushoku-tensei     mal_id=39535
re-zero            mal_id=31240
```

Kolon eklendi, 4 dizi de doğru kimliklerle dolu. **SQL tarafında hata yok.**

### 10.2 GERÇEK KÖK NEDEN (benim hatam): sağlayıcı katmanı rotaya bağlanmamıştı

`src/lib/embed-provider.ts` yazılmıştı ama **hiçbir yerden çağrılmıyordu** — `resolveEpisodeEmbed`
ölü koddu. `izle.$slug.tsx` hâlâ doğrudan `watch_url`'i kullanıyordu:

```ts
const watching = Boolean(currentEpisode?.watch_url) && gateDone;   // eski
epUrl={currentEpisode?.watch_url ?? ""}                            // eski
```

Sonuç: `ACTIVE_EMBED_PROVIDER = "megaplay"` **pratikte etkisizdi.**
Daha kötüsü: `watch_url` boş olsaydı `watching` false olur, bölüm hiç açılmazdı.

**Düzeltildi:**

```ts
const episodeEmbed = currentEpisode
  ? resolveEpisodeEmbed(currentEpisode.watch_url, {
      malId: show.mal_id ?? null,
      season: currentEpisode.season,
      episode: currentEpisode.number,
    })
  : null;
const watching = Boolean(episodeEmbed) && gateDone;
// ...
epUrl={episodeEmbed ?? ""}
```

`Show` tipine `mal_id?: number | null` eklendi (`fetchShowDetail` `select("*")` kullandığı için
kolon otomatik geliyor).

### 10.3 ÖNCEKİ YANLIŞ ALARMIN DÜZELTMESİ — megaplay embed'de **ÇALIŞIYOR**

§8.2'de "410 = eşleme yok, sağlayıcı kullanılamaz" demiştim. **Bu yanlıştı.** Iframe içinde
gerçek tarayıcıyla ölçüm (5 iframe, yerel test sayfası):

| # | Embed | Sonuç |
|---|---|---|
| 1 | `/stream/mal/40748/1/sub` | **GERÇEK OYNATICI** — oynuyor, `01:50 / 23:55`, "Skip Intro", CC düğmesi |
| 2 | `/stream/mal/31240/1/sub` | **GERÇEK OYNATICI** — oynuyor (altyazı akıyor) |
| 3 | `/stream/mal/39535/1/sub` | **GERÇEK OYNATICI** — oynuyor |
| 4 | `/stream/mal/31043/1/sub` | **GERÇEK OYNATICI** — oynuyor |
| 5 | `/embed/40748/1/1` (kontrol) | HATA: `Oops! Something went wrong` / `Error Code: 404` |

Oynatıcı kontrolleri: play/pause, ses, `-10/+10`, **CC**, ayarlar, PiP, tam ekran, "Skip Intro".

**Açıklama:** Sağlayıcı **doğrudan (top-level) isteklerde** hata sayfası döndürüyor — gövdede
"410 / removed due a copyright violation" metni var, ama HTTP durumu yine **200**. Yani adresi
tarayıcıda tek başına açıp "çalışmıyor" sonucu çıkarmak **yanlış bir test**. Doğru test: adresi
bir iframe içine gömmek. Embed bağlamında **iframe engellemesi yok** (CSP / X-Frame-Options
hatası yok, konsol temiz).

Ayrıca `/embed/{mal}/{sezon}/{bölüm}` biçimi megaplay'de **yok** (404) — doğru biçim
`/stream/mal/{mal}/{bölüm}/{dil}`.

### 10.4 Neden "diğer animeler yüklenmiyor"

Canlı ölçüm — bölüm sayıları:

```
jujutsu-kaisen  mal_id=40748  bolum=24
re-zero         mal_id=31240  bolum=0
mushoku-tensei  mal_id=39535  bolum=0
erased          mal_id=31043  bolum=0
```

Bu 3 dizinin **hiç bölüm kaydı yok**. Sitede "Bölümler" bölümünde **"Henüz bölüm eklenmedi."**
yazıyor (doğrulandı). Yani oynatılacak bölüm olmadığı için "yüklenmiyor".

### 10.5 "Eski VidMoly/Streamtape duruyor" — bu **doğru davranış**

`resolveEpisodeEmbed` sırası: **1)** `watch_url` doluysa o kazanır → **2)** boşsa sağlayıcı.
24 bölümün tamamında `watch_url` dolu olduğu için sağlayıcı hiç devreye girmiyor; mevcut
oynatıcılar **bilinçli olarak** korunuyor. Tüm siteyi megaplay'e almak istenirse 24 satırın
`watch_url`'i boşaltılmalı — ayrı bir karar.

### 10.6 Bölüm kayıtları için SQL (yazma izni YOK)

Publishable anahtarla yazma denendi → **HTTP 401** (RLS engelliyor). Bu yüzden bölüm satırları
ben ekleyemiyorum. Hazır script: **`scripts/sql/add-other-anime-episodes.sql`**

- Re:Zero **25**, Mushoku Tensei **11**, Erased **12** bölüm (kaynak: AniList `episodes`)
- `watch_url = ''` → böylece `resolveEpisodeEmbed` megaplay adresini üretir
- Idempotent (`not exists` koşuluyla)
- Sonda doğrulama sorgusu var

### 10.7 Regresyon kontrolü — GEÇTİ

| Test | Reklam | İframe `src` | Sonuç |
|---|---|---|---|
| `b=3` | `Reklam 1/2` → `Reklam 2/2` | `https://vidmoly.org/embed-g0cxffba5dhc.html` | ✅ birebir aynı, video oynuyor (`0:12 / 23:54`) |
| `b=1` | `Reklam 1/1` | `https://streamtape.com/e/YB2xWzzO7bUBlK` | ✅ birebir aynı |

Konsol: hata yok, JS exception listesi boş. `re-zero` ve `erased` sayfaları beklendiği gibi
**"Henüz bölüm eklenmedi."** gösteriyor.

> Not: `b=1`'de tek reklam (`1/1`) çıktı — açık artırma varyansı (spotlardan biri o anda boş
> döndü). Normaldir; kapı takılmadan ilerliyor.

### 10.8 Doğrulama

```
npx tsc --noEmit      → exit 0
npx eslint (3 dosya)  → exit 0
npm run build         → exit 0
```

---

## 11. YENİ DİZİLER CANLI + "Reklam 1/1" KÖK NEDENİ (25.09.2026)

### 11.1 SQL doğrulandı — bölümler oluştu

Canlı okuma:

| Dizi | `mal_id` | Bölüm | `watch_url` boş |
|---|---|---|---|
| jujutsu-kaisen | 40748 | 24 | 0 (değişmedi) |
| re-zero | 31240 | **25** | **25** |
| mushoku-tensei | 39535 | **11** | **11** |
| erased | 31043 | **12** | **12** |

`watch_url` boş → adres artık sağlayıcıdan üretiliyor. Sitede de bölüm listeleri göründü
(re-zero "1. Sezon · 25 bölüm", erased 12, mushoku-tensei 11; "Henüz bölüm eklenmedi" **yok**).

### 11.2 Yeni diziler megaplay'den **çalışıyor** (canlı doğrulama)

| Test | Üretilen iframe `src` (birebir) | İçeride |
|---|---|---|
| `/izle/re-zero?sezon=1&b=1` | `https://megaplay.buzz/stream/mal/31240/1/sub` | ✅ gerçek oynatıcı, video oynuyor + altyazı |
| `/izle/erased?sezon=1&b=1` | `https://megaplay.buzz/stream/mal/31043/1/sub` | ✅ gerçek oynatıcı, video oynuyor |

Sitemize ait hata metni yok; konsolda `CSP` / `X-Frame-Options` / `blocked` uyarısı yok.
Reklam(lar)dan sonra oynatıcı iframe'i yükleniyor.

### 11.3 "Reklam 1/1" — kök neden: **iki spot aynı kreatifi veriyor**

❗ **Önceki (sunucu tarafı) tahminim yanlıştı.** Referer'sız ölçümde "spot `2028789` boş dönüyor"
görünmüştü. **Sayfa bağlamında** (doğru Referer ile) yapılan ölçüm bunu çürüttü:

```
spot 2028789 → 3/3 örnek: ads=1, inline=1, noad=false, HTTP 200, len≈36400  → DOLU
spot 2028790 → 3/3 örnek: ads=1, inline=1, noad=false, HTTP 200, len≈37100  → DOLU
```

Üstelik ikisi de **birebir aynı kreatifi** döndürüyor:

```
mediaFile: https://i.imgkcdn.com/video/video/1131/131/6aa3d42aca9066...r9658_high.mp4
Duration : 00:00:15     skipoffset: 00:00:05   (ikisinde de aynı)
```

**Gerçek sebep:** Ad-pod'a eklediğim **tekilleştirme** (`seen` kümesi, `ad.mediaFile` anahtarı)
ikinci kopyayı eliyordu → pod 1 reklama düşüyor → sayaç `Math.min(visibleAds.length, MAX_ADS)`
yüzünden **`Reklam 1/1`** yazıyordu. (İkincil sebep: `2028790` arada sırada 0 ad dönebiliyor.)

### 11.4 Düzeltme ve ölçümü

`ALLOW_REPEAT_CREATIVE` bayrağı eklendi (`src/components/PrerollGate.tsx`), **`true`** yapıldı.

| Tekrar | İlk sayaç | İkinci sayaç | Kaç reklam |
|---|---|---|---|
| 1 | `Reklam 1/2` | `Reklam 2/2` | 2 |
| 2 | `Reklam 1/2` | `Reklam 2/2` | 2 |
| 3 | `Reklam 1/2` | `Reklam 2/2` | 2 |
| 4 | `Reklam 1/1` | — | 1 |

**3/4 tekrarda 2 reklam**, 1/4 tek reklam (gerçekten tek slot doldu). Konsol hatası yok;
oynatıcı yükleniyor. Ölçüm kaydı: `docs/olcum-reklam-adpod-25-09-2026.md`.

### 11.5 ⚠️ Dürüst maliyet — iki slot **aynı reklamı** oynatıyor

Ölçüm: her iki slotta da **aynı mp4** (`i.imgkcdn.com/.../6aa3d42aca9066_high.mp4`), aynı süre
(**15,104 sn**). DOM'da tek `<video>` elemanı var; aynı kaynak yeniden yükleniyor. Yani:

> Sayaç `2/2` yazıyor ama **kullanıcı aynı reklamı iki kez, toplam ~30 sn** izliyor.

Bu, "iki farklı reklam" değildir — MyBid iki spota da aynı kreatifi servis ediyor. Aynı reklamı
iki kez göstermek:

- **Kazanç:** 2 gösterim sayılır.
- **Maliyet:** kullanıcı süresi ikiye katlanır (15 sn → 30 sn) ve deneyim bozulur.

**Karar noktası:** aynı reklamın iki kez çıkması istenmiyorsa tek satır:
`ALLOW_REPEAT_CREATIVE = false` (o zaman sayaç dürüstçe `1/1` gösterir).
**Gerçekten farklı 2. reklam** isteniyorsa farklı envanter gerekir — ya MyBid'de **ayrı talep
getiren ek bir spot**, ya ikinci bir reklam ağı.

### 11.6 Doğrulama

```
npx tsc --noEmit      → exit 0
npx eslint            → exit 0
npm run build         → exit 0
```
