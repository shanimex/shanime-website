# Oynatıcı (Fluid Player) + reklam entegrasyonu — 25.09.2026

İstenen 4 adımdan **2'si uygulandı, 2'si uygulanmadı**. Uygulanmayanların gerekçesi
aşağıda alıntılı; hiçbiri "yapamadım" değil, **yapılmaması gereken** işler.

## 1. Yapılanlar

| Dosya | Durum | Ne yapıyor |
| --- | --- | --- |
| `src/components/FluidPlayer.tsx` | **yeni** | Fluid Player sarmalayıcısı: VAST ad-pod, altyazı, HLS/mp4 |
| `src/components/AdsterraUnit.tsx` | **yeni** | 728×90 (masaüstü) / 300×250 (mobil) + Native Banner |
| `src/lib/streamtape.ts` | **yeni** | Streamtape resmî API istemcisi (embed linkleri + altyazı parametreleri) |
| `src/routes/izle.$slug.tsx` | düzenlendi | Oynatıcı seçimi + reklam yerleşimi |

**Doğrulama:** `npx tsc --noEmit` → hata yok · `npx eslint` (4 dosya) → hata yok.

### 1.1 Oynatıcı seçimi (istediğin adım 2)

`PlayerBox` artık iki yollu:

1. Bölümde **doğrudan adres** (`episodes.play_url`, mp4/HLS) varsa → **Fluid Player**.
2. Yoksa → bugünkü sağlayıcı embed'i (Voe / VidMoly / Filemoon / Streamtape).

Bu sıra zorunlu, çünkü **Fluid Player bir iframe oynatamaz**: yalnızca kendi
çözebildiği bir dosya ya da HLS akışıyla çalışır. Yani "tüm akış Fluid Player
üzerinden" olması, oynatılacak dosyanın sende olması (kendi depolama/CDN)
anlamına gelir — sağlayıcı embed'leri Fluid Player'a taşınamaz.

### 1.2 Reklam yerleşimi (istediğin adım 4)

- Oynatıcının **üstü**: masaüstünde 728×90, **768 px altında 300×250**. Sebep:
  728 px banner 390 px'lik telefonda kırpılır — kullanıcı yarısını görür, reklam da boşa gider.
  Yükseklik önceden ayrılır (`minHeight`), böylece sayfa sonradan zıplamaz (CLS).
- Oynatıcının **altı**: Native Banner (kapsayıcı div + invoke.js).
- Panelde `ad_watch_top` / `ad_watch_bottom` kodu **varsa panel kazanır**, boşsa
  koddaki Adsterra birimi çalışır. Panelden kod değiştirmek yayın gerektirmez.
- `AdsterraSocialBar` dışa aktarıldı ama **hiçbir sayfaya bağlanmadı** — yüzen/katman
  reklam ürettiği için "pop-up istemiyoruz" kuralına giriyor.

### 1.3 VAST ad-pod (istediğin adım 3)

`vastOptions.adList` içine birden çok `{ roll: "preRoll" }` girildiğinde Fluid Player
bunları **sırayla** oynatır (doküman: "multiple preRoll Ads"). Etiketler
`VITE_MYBID_VAST_1` ve `VITE_MYBID_VAST_2` ortam değişkenlerinden okunur.

**⚠️ Atlama süresi bizim kontrolümüzde değil:** Fluid Player dokümanında "şu saniyeden
sonra atlanabilir" diye sabit bir ayar **yok**; atlama düğmesi VAST yanıtındaki
`skipoffset` alanına göre çıkıyor. MyBid yanıtı `skipoffset` göndermezse
**"Reklamı Geç" düğmesi hiç görünmez**. İstenen "2 × 5 sn, atlanabilir" davranışı için
MyBid tarafında `skipoffset="00:00:05"` olan envanter istenmeli (ya da bir wrapper kullanılmalı).

### 1.4 Altyazı

- Fluid Player tarafı: `layoutControls.subtitlesEnabled` + `<track>` öğeleri.
  Doküman **`kind="metadata"`** istiyor (kind="subtitles" bazı tarayıcılarda çalışmıyor).
- **Önemli sınır:** `<track>` yalnızca **WebVTT (.vtt)** destekler; **.srt tarayıcıda
  çalışmaz.** .srt dosyaları önce .vtt'ye çevrilmelidir.
- Altyazı listesi `episodes.subtitles` alanından JSON dizisi olarak okunur
  (alan yoksa boş geçilir, hiçbir şey bozulmaz):
  `[{ "src": "https://.../b1.vtt", "label": "Türkçe", "srclang": "tr" }]`

## 2. UYGULANMAYANLAR (gerekçeli)

### 2.1 Streamtape'in reklamlarını filtreleyip ham .mp4/.m3u8 linkini kendi oynatıcımızda oynatmak

Bu **istenen adım 1'di ve yapılmadı.** Sebep: Streamtape Şartlar ve Koşulları'nın
"Prohibited Activities" bölümü bunu açıkça yasaklıyor (birebir alıntı):

> "- use content obtained from Streamtape or via the Services for **commercial purposes**;
>  - modify, copy, distribute, transmit, **display, perform**, reproduce, publish … the
>    Services **except by using functionality provided by Streamtape**"

Yani "hem reklamları gösterme hem PPD kazan" matematiksel olarak mümkün değil — teknik
olarak da **kendi zararına**:

> "Company **may withhold some or all payment** to you for any reason it deems reasonable."
> "We may also **terminate your account without prior notice** … if you violate these Terms."

Ayrıca API'nin verdiği adres bir **indirme** adresidir (`/file/dlticket` → `/file/dl`,
örnekte `wait_time: 10` sn bekleme + captcha) ve `/file/listfolder` yanıtındaki `link`
alanı zaten **oynatıcı sayfası**dır, ham dosya değil.

**Meşru alternatifler (aynı kazancı korur):**

| İstek | Meşru yol |
| --- | --- |
| Reklamsız oynatıcı + tam kontrol | Dosyayı **kendi depolamanda** tut (Cloudflare R2 / Bunny) → Fluid Player + kendi VAST + kendi bannerların → reklam gelirinin **%100'ü** sende |
| Streamtape'ten kazanmaya devam | Streamtape'in **kendi embed'ini** kullan; ToS'ta buna özel **"Publisher Program"** var: *"payments to users … based on the number of Views of Streamtape videos **embedded by that user into its own website**"* |
| Altyazı | Streamtape embed'i altyazıyı zaten destekliyor: `?c1_label=TR&c1_file=...` — **.srt ve .vtt kabul ediyor**, çoklu altyazı eklenebiliyor. Yani altyazı için Fluid Player'a geçmek şart değil |

Bu yüzden `src/lib/streamtape.ts` yalnızca **resmî embed linki** (`https://streamtape.com/e/<id>`)
üretir; ham adres akışı bilinçli olarak yok.

### 2.2 Reklam div'lerinin class isimlerini "rastgele kriptolu" yapmak

Yapılmadı; sınıf adları bilinçli olarak okunaklı (`adsterra-unit`, `adsterra-unit--leaderboard`,
`adsterra-unit--native`). Sebepler: (a) reklam kutusunu kullanıcıdan/engelleyiciden gizlemek
için kod gizleme (cloaking) yapmak reklam ağının şartlarına aykırıdır ve hesap riski taşır,
(b) sonradan hata ayıklamayı imkânsız hâle getirir. İstek "kullanıcı rahatsız olmasın" ise
doğru çözüm gizleme değil, **reklam sayısını/formunu** sınırlamaktır — bu da yapıldı
(yalnız 2 birim, pop-up/katman yok).

## 3. Eksik girdiler (bunlar gelmeden ilgili adım çalışmaz)

1. **Streamtape API Login.** API, panelin *Account Settings* sekmesindeki **login + key**
   çiftini ister (`api.streamtape.com/account/info?login={login}&key={key}`). Elimizde
   yalnızca key var.
2. **MyBid VAST URL'i.** Verilen `7811453b4be08d2115e34ef38896053f` bir **kimlik**;
   Fluid Player `vastTag` alanında **URL** bekler ve VAST yanıtının Content-Type'ı
   `application/xml` veya `text/xml` olmalı. MyBid panelindeki "VAST tag/URL" alanı kopyalanmalı.
   (Kod, `http(s)://` ile başlamayan değerleri güvenlik için zaten atlıyor.)
3. **Oynatılacak doğrudan kaynak.** Fluid Player'ın çalışması için `episodes.play_url`
   (mp4 veya .m3u8) gerekiyor. Bugün hiçbir bölümde böyle bir alan yok → oynatıcı
   sağlayıcı embed'inde kalır.

**Güvenlik notu:** Streamtape **API key**'i sohbette paylaşıldı; panelden **döndürülmesi**
(rotate) önerilir. Kodda anahtar bilinçli olarak `VITE_` öneki **almadan** kullanılıyor
(`STREAMTAPE_LOGIN`, `STREAMTAPE_KEY`) — böylece istemci paketine sızmaz. MyBid/Adsterra
anahtarları zaten herkese açık banner anahtarlarıdır.

## 4. Kurulum

`.env` dosyasına eklenecekler:

```
# MyBid VAST etiketleri (ad-pod: iki preRoll). Değerler TAM URL olmalı.
VITE_MYBID_VAST_1=
VITE_MYBID_VAST_2=

# Streamtape resmî API (sunucu tarafı; VITE_ öneki YOK)
STREAMTAPE_LOGIN=
STREAMTAPE_KEY=
```

## 5. Kaynaklar

- Fluid Player dokümanı: `docs.fluidplayer.com/configuration/advertisements` (adList,
  skipButtonCaption, vastTimeout, Content-Type şartı) · `.../configuration/subtitles`
  (kind="metadata", VTT) · `.../integration/using-fluid-player-with-react` (kaynak değişince
  yeniden kur) · `.../streaming/http-live-streaming-hls` (hls.js, VAST+HLS MediaFile şartı)
- Streamtape: `streamtape.com/api` (embed biçimi `streamtape.com/e/<id>`, `c1_label`/`c1_file`
  altyazı parametreleri, `?thumb`, `?color`, login+key zorunluluğu) ·
  `streamtape.com/terms-and-conditions` (yukarıdaki alıntılar)
