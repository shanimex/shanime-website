# Sağlayıcı + Kapak Araştırması (25.09.2026)

Bu belge, "animeyi hazır getiren farklı bir servis var mı, TR altyazı ve kalite
seçenekleri olan, yavaş olmayan" sorusuna verilen **ölçülmüş** cevabı ve bölüm
kapakları için uygulanan çözümü kaydeder.

Ölçüm bağlamı her satırda belirtilmiştir. Sunucu tarafı (referer'sız) ölçümler
sayfa bağlamındaki gerçek davranışı yansıtmaz — bu oturumda bu tuzağa iki kez
düşüldü, o yüzden her iddianın yanında nasıl ölçüldüğü yazılı.

---

## 1. Aday sağlayıcılar — ölçüm sonuçları

| Sağlayıcı | Anime desteği | Ölçüm | Sonuç |
|---|---|---|---|
| **vidsrc.to** | **YOK** | Kendi SSS metni: *"Can i use this API for anime? Currently we do not support anime, we may do that in the future."* Ayrıca `/embed/anime/40748/1/sub` → **HTTP 404** | Elenir |
| **vidlink.pro** | Var (MAL id ile) | Doküman: `https://vidlink.pro/anime/{MALid}/{number}/{subOrDub}` — `/anime/40748/1/sub` → **HTTP 200**. Ama üretim JS paketi anime sayfasında `fetch("http://localhost:8080/api/anime/...")` çağırıyor; gerçek tarayıcıda sayfa **"FETCHING DATA, PLEASE WAIT…" ekranında kilitli kaldı, hiç `<video>` oluşmadı, 0 istek yanıtlandı** | **Şu an KIRIK** |
| **player.videasy.net** | Var (MAL id ile) | Sunucu tarafı istek → 200. Gerçek tarayıcı → **403 / `net::ERR_HTTP_RESPONSE_CODE_FAILURE`** (`player.videasy.to`'ya yönleniyor). Anime kaynağını çağırdığı `api.speedracelight.com/hianime/sources-with-title` rotası → **404 "Route … not found"** | **Erişilemez + rota ölü** |
| **megaplay.buzz** (mevcut) | Var (MAL **ve** AniList id ile) | **iframe içinde** (doğru bağlam): MAL 40748 (JJK), AniList 113415 (JJK), MAL 31240 (Re:Zero) → **üçünde de gerçek oynatıcı, video oynadı**, CC + ayarlar simgeleri var, katman reklam yok. Sekmede (top-level) açılınca üçünde de "Error Code: 410" sayfası çıkar — bu bir erişim koruması, embed davranışı değil | **Çalışıyor — JJK dahil** |
| vidora.su / vidsrc.cc / 2anime.xyz / embed.animekai.to | — | sırasıyla **timeout / timeout / 403 / DNS çözülemedi** | Elenir |

### vidlink.pro'nun gerçek problemi (kanıt)

VidLink'in **avantajı** gerçek: 94K film / 66K dizi / 5K anime, `sub_file`+
`sub_label` parametreleriyle **harici VTT altyazı** yükleyebiliyor, kalite menüsü
(360/480/720/1080/4K) var. Ama iki ölçüm üst üste aynı sonucu verdi:

1. Üretim paketi (`/anime/[id]/[episode]/[subordub]/page-*.js`) içinde
   `fetch("http://localhost:8080/api/anime/…")` **sabit yazılmış**. Tarayıcı bunu
   *ziyaretçinin kendi makinesine* çözer → yanıt gelmez.
2. Canlı test: sayfa açıldı, JS hatası yok, ama veri hiç gelmedi; oynatıcı
   basılmadı. İki denemede de aynı.

Ayrıca VidLink'in kendi paketinde **kendi popunder'ı** var:
`zoneId: "10112814"`, `baseUrl: "https://brightadnetwork.com/jump/next.php"`,
`popunderMode: true`, `maxTriggersPerSession: 5`, `triggerDelay: 5` — play /
pause / seek / fullscreen / **kalite değişimi** olaylarında tetikleniyor.
Yani VidLink iframe'i, sizin "sitede popup istemiyorum" kuralınızı **5 kez**
delmeye çalışır ve bunu engellemenin bir yolu yok (iframe'in içi).

### player.videasy.net'in kaynağı

Anime için `https://api.speedracelight.com/hianime/sources-with-title?title=…&year=…&episodeId=…`
çağrısı yapıyor ve `{sources, subtitles}` JSON'u bekliyor — yani kaynak **HiAnime**.
`/hdmovie/sources-with-title` rotası canlı (TMDB ID isteyince 500 dönüyor), ama
`/hianime/...` rotası **404**. Sunucu gerçek: `https://api.speedracelight.com/`
→ `200` + `:)`. Rota yayından kaldırılmış.

---

## 2. TR altyazı + kalite seçenekleri — gerçek durum

Hiçbir üçüncü taraf embed sağlayıcısı **Türkçe altyazı** yayınlamıyor. VidLink'in
dokümanındaki dil listesi: Arapça, Bengalce, İngilizce, Filipince, Fransızca,
Endonezce, Rusça, Urduca — **Türkçe yok**. Diğerlerinde ya menü yok (megaplay) ya
site erişilemez (videasy).

Kritik teknik sınır: sağlayıcı **iframe** ise, iframe'in içindeki oynatıcıya
altyazı eklenemez ve kalite menüsü değiştirilemez — bunlar sağlayıcının kendi
belgesinin içinde. Sandbox denemesi bu oturumda ölçüldü ve başarısız oldu
(Streamtape "Client blocked!", VidMoly "The embed could not be loaded.").

**TR altyazı + kalite menüsü + gerçek video karesi** üçlüsünün tek yolu:
**videoyu kendimiz barındırmak** (Cloudflare R2) ve **kendi oynatıcımızda**
(Fluid Player) oynatmak. O zaman:

- kalite: elimizde kaç çözünürlük varsa o kadar,
- altyazı: kendi `.vtt` dosyamız (Türkçe),
- kapak: `video.currentTime=…; canvas.drawImage()` ile **gerçek kare** (kendi
  dosyamız olduğu için cross-origin engeli yok),
- reklam: %100 bizim kontrolümüzde.

R2 maliyeti (önceki ölçüm): 6,5 GB → $0/ay, 100 GB ≈ $1,35/ay, 500 GB ≈ $7,35/ay
(çıkış trafiği ücretsiz). Bu, listedeki tek "hepsini birden veren" seçenek.

---

## 3. Bölüm kapakları — ÇÖZÜLDÜ (gerçek bölüm görselleri)

**Sorun:** embed sağlayıcıları bölüm kapağı yayınlamıyor; `watch_url` boş olduğu
için mevcut `episode-posters.json` zinciri de türetme yapamıyordu → kart seri
posterine düşüyordu (bütün bölümler aynı görsel) ya da boş kalıyordu.

**Çözüm:** `api.ani.zip` (TVDB + AniDB + AniList birleşik eşleme) MAL kimliğiyle
**bölüm bölüm** görsel veriyor.

Ölçüm (25.09.2026):

```
GET https://api.ani.zip/mappings?mal_id=40748
→ 200, 46 bölüm
  ep1: image=https://artworks.thetvdb.com/banners/series/377543/episodes/5f72c5c9dddf4.jpg
       title.en=Ryoumen Sukuna   runtime=24
  Görsel isteği: referer'sız → 200, content-type=image/jpeg, 108 KB
                 referer=shanime.xyz → 200, image/jpeg (hotlink koruması YOK)
```

Uygulananlar:

| Dosya | Ne yapar |
|---|---|
| `scripts/sync-anizip-covers.mjs` **(yeni)** | Supabase'ten `mal_id` dolu serileri okur, ani.zip'ten bölüm görsellerini çeker, `src/data/episode-thumbs.json` dosyasına yazar. `--force` ile yeniden çeker. |
| `src/lib/anizip-covers.ts` **(yeni)** | `anizipCover(malId, season, episode)` → derleme zamanında gömülü tablodan görseli döndürür (`s<sezon>e<bölüm>`, yoksa `abs<bölüm>`). |
| `src/components/EpisodeCard.tsx` | Yeni `malId` prop'u; kapak zincirine panel kapağı + sağlayıcı kapağından **sonra**, türetmeden **önce** eklendi. |
| `src/routes/seri.$slug.tsx` | `malId={show.mal_id ?? null}` geçilir. |
| `src/routes/izle.$slug.tsx` | `EpisodeSidebar` → `SidebarCover` zincirine aynı `malId` eklendi. |

Çalıştırma sonucu: **4 seri / 145 kapak** yazıldı
(erased 24, jujutsu-kaisen 49, re-zero 50, mushoku-tensei 22).

Yeni seri ekledikten sonra bir kez:

```bash
node scripts/sync-anizip-covers.mjs
```

**Dürüst sınır:** bu görseller TVDB'nin **bölüm görseli**, videodan alınmış kare
değil. Gerçek kare yalnızca §2'deki R2 + kendi oynatıcı yolunda üretilebilir.
Yine de "boş/aynı görsel" sorunu bitti: her bölüm kendi görselini gösteriyor.

---

## 4. "En çok kazanç" — 2 reklamın **2 farklı** reklam olması

Durum: ad-pod **her zaman 2 slot** oynatıyor (`PrerollGate`, `MAX_ADS = 2`).
Ama MyBid'in iki spotu (2028789 / 2028790) ölçümde **aynı kreatifi** veriyor
(creativeID 7991131, birebir aynı mp4, 15,1 sn, skip 5 sn) → reklamveren
tarafında 2. gösterim "tekrar" sayılabilir, gelir artmaz.

Gerçekten **farklı** 2. reklam için 2. slotu **başka bir VAST ağıyla**
doldurmak gerekir. Kod tarafı buna hazır: `prerollVastUrls()` adresleri
`.env`'den okuyor ve **her etiket ayrı bir açık artırma** açıyor.

```dotenv
# 1. slot: MyBid
VITE_MYBID_VAST_1=https://vast.vstserv.com/vast?spot_id=2028789
# 2. slot: BAŞKA bir ağın VAST etiketi (MyBid olmak zorunda değil)
VITE_MYBID_VAST_2=<ikinci-ag-vast-etiketi>
```

VAST video pre-roll yayınladığı **üçüncü taraf kaynaklarda belirtilen** ağlar
(doğrulanmadı — kendi panellerinden teyit edin):

- **Clickadu** — formatlar arasında "Video Pre-Roll" listeleniyor.
- **HilltopAds** — "Video VAST" formatı destekleniyor deniyor.

Her ikisi de popunder ağırlıklı çalışan ağlar; yalnızca **VAST video** birimini
kullanın (popunder'ı almaya gerek yok). Etiketi aldıktan sonra `.env`'e yazıp
dev sunucusunu yeniden başlatmak yeterli — kod değişikliği yok.

---

## 5. Karar özeti

| Soru | Cevap |
|---|---|
| Başka "hazır anime" servisi var mı? | vidsrc.to **anime ucu yok** (ama TMDB dizi kimliğiyle JJK'yı tanıyor). vidlink.pro ve videasy'nin anime uçları **şu an kırık/erişilemez**. vidfast.pro 3 pop-under açtı. multiembed/streamingnow kendini kapatıyor (otomasyonda doğrulanamadı). **megaplay çalışan tek sağlayıcı** ve JJK dahil çalışıyor. Sağlayıcı değiştirmek bugün net kazanç sağlamıyor. |
| TR altyazı + kalite? | Embed ile **imkânsız**. Tek yol R2 + kendi oynatıcı (§2). |
| Hızlı/yavaş olmasın? | megaplay iframe'i hafif (sayfa ~5 KB kabuk). Sağlayıcı değişikliği hız kazandırmaz; asıl kazanç kendi barındırmada. |
| Kapaklar? | **Çözüldü** — ani.zip ile bölüm başına gerçek görsel (§3). |
| En çok kazanç? | 2 slot zaten var. 2. slotu **farklı bir VAST ağıyla** doldurun (§4). Asıl sıçrama: kendi barındırma = %100 reklam kontrolü. |

---

## Kaynaklar

- vidsrc.to SSS + API dokümanı (anime desteklenmiyor ifadesi): https://vidsrc.to/
- VidLink dokümanı (anime MAL yolu, `sub_file`, kalite/dil listeleri): https://vidlink.pro/
- VidLink üretim JS paketi (localhost:8080 çağrısı + brightadnetwork popunder ayarları)
- Videasy anime sayfası + `api.speedracelight.com` rota testleri
- ani.zip eşleme API'si (bölüm görselleri): https://api.ani.zip/mappings?mal_id=40748
- Clickadu / HilltopAds VAST format iddiaları: affmaven.com, afftank.com (üçüncü taraf blog)
- İframe bağlamı testi (JJK): `public/_embed-test.html` → bkz. §6

---

## 6. Jujutsu Kaisen — eski reklamlı embedlerin kaldırılması

### Durum (ölçüm, `show_episodes` tablosu, 25.09.2026)

| Dizi | Bölüm | Embed durumu |
|---|---|---|
| **jujutsu-kaisen** | 24 | **22 VidMoly + 2 Streamtape** ← reklamlı, kaldırılıyor |
| re-zero | 25 | boş → megaplay |
| erased | 12 | boş → megaplay |
| mushoku-tensei | 11 | boş → megaplay |

### Doğrulama — iframe bağlamında (top-level DEĞİL)

`public/_embed-test.html` içine 4 iframe konup gerçek tarayıcıda oynatıldı:

| Hücre | Adres | Sonuç |
|---|---|---|
| 1 | `megaplay.buzz/stream/mal/40748/1/sub` | **Gerçek oynatıcı. Video oynadı** (JJK S1B1, `23:55`), altyazı göründü, CC + ayarlar simgeleri var, katman reklam yok |
| 2 | `megaplay.buzz/stream/ani/113415/1/sub` | Aynı — gerçek oynatıcı, video oynadı |
| 3 | `megaplay.buzz/stream/mal/31240/1/sub` (kontrol) | Gerçek oynatıcı, farklı dizi (Re:Zero) |
| 4 | `vidsrc.to/embed/tv/95479/1/1` | Gerçek oynatıcı (poster + başlık "JUJUTSU KAISEN 2020 · S01 E01" + oynat). Oynatma **doğrulanamadı**; oynatıcı üstünde `Histats.com` rozeti çizildi |

**Kritik düzeltme:** bu testten önce megaplay adresleri tarayıcıda **sekme olarak**
açılmış ve hepsinde "Error Code: 410 — removed due a copyright violation" görülmüştü.
Bu bir **doğrudan erişim korumasıdır**; aynı adresler iframe içinde sorunsuz oynuyor.
O ölçüme dayanarak "megaplay'de JJK yok" sonucu çıkarmak yanlıştı.

Not: test sırasında **1 adet kendiliğinden açılan pop-under** gözlendi
(`arenabreakoutinfinite.com` adresine giden reklam sayfası) — hangi hücreden
geldiği belirlenemedi. Yani sağlayıcıların sıfır pop-up garantisi yok.

### Uygulama

`scripts/sql/jjk-megaplay.sql` — Supabase SQL Editor'de çalıştırılır:

1. `public.watch_url_backup_jjk` yedek tablosu oluşturulur (24 satır) → **geri alınabilir**.
2. JJK'nın `watch_url` alanları boşaltılır → kod aktif sağlayıcıya (megaplay) düşer.
3. Öncesi/sonrası sayım sorguları ve geri alma bloğu dosyanın içinde.

Kod değişikliği GEREKMEZ: `resolveEpisodeEmbed` zaten "önce `watch_url`, boşsa
sağlayıcı" sırasını uyguluyor ve `jujutsu-kaisen` kaydında `mal_id = 40748` dolu.

---

## 7. TR altyazı — hangi yol gerçekten mümkün

Hiçbir sağlayıcı **Türkçe** altyazı yayınlamıyor (vidlink dil listesi: Arapça,
Bengalce, İngilizce, Filipince, Fransızca, Endonezce, Rusça, Urduca — Türkçe yok).
megaplay'de CC simgesi var ama dil listesi **doğrulanmadı**.

Kendi altyazı dosyanı enjekte etmeye izin veren sağlayıcılar ve durumları:

| Sağlayıcı | Parametre | Anime durumu |
|---|---|---|
| **vidsrc.to** | `?sub_file=<vtt>` (tek dosya) veya `?sub.info=<json>` (`{file,label,kind}` dizisi) | Anime ucu yok **ama** TMDB dizi kimliğiyle JJK gerçek oynatıcı verdi (oynatma doğrulanamadı) |
| vidlink.pro | `sub_file` + `sub_label` | Anime ucu **kırık** (`localhost:8080` hatası) |
| multiembed / SuperEmbed | `directstream.php` + `sub_url` + `sub_label` | VIP oynatıcı bu kimlikler için **404** (yok) |

### ⚠️ DÜZELTME (25.09.2026, kullanıcı kanıtı)

Yukarıdaki "hiçbir sağlayıcı Türkçe vermiyor" tespiti **fazla genellemeydi**: o
liste VidLink'in dokümanındaki dillere dayanıyordu. Kullanıcı `vidsrc.to`
oynatıcısının **kendi altyazı panelini** açtı ve panelde:

- `SEARCH BY LANGUAGE` → **Turkish — Türkçe** seçili,
- altında **Türkçe altyazı dosyası** listelenmiş (`Jujutsu.Kaisen.S01E01...`, 11588 indirme),
- video aynı anda oynuyor (`1:46 / 23:55`).

Yani **vidsrc.to Türkçe altyazı sunuyor** — altyazıları harici sitelerden topladığını
kendi SSS'inde zaten söylüyor ("we have a wide selection available for almost every
title"). Ayarlar menüsünde kalite seçenekleri de var.

Bu yüzden aktif sağlayıcı **vidsrc.to** yapıldı (§9). Kendi altyazı dosyanı
(`?sub_file` / `?sub.info`) yükleme imkânı da duruyor — yani Türkçe dosyayı biz
sağlamak istersek altyapı hazır.

Bundan bağımsız olarak §2'deki kendi barındırma yolu hâlâ **tek** yol olarak
kalıyor: (a) gerçek video karesi kapak, (b) altyazıyı varsayılan yapma, (c) %100
reklam kontrolü. vidsrc.to bunların hiçbirini vermez — TR altyazıyı kullanıcı
menüden kendi seçer.

Koddaki hazır altyapı: `izle.$slug.tsx` içindeki `subtitlesOf()` zaten
`episodes.subtitles` alanını `[{src, label, srclang}]` biçiminde okuyup Fluid
Player'a veriyor. Aynı veri, vidsrc.to seçilirse `sub.info` parametresine
çevrilebilir — yani **tek alan, iki kullanım**.

---

## 8. "2 reklam aynı çıkıyor, yine kazanır mıyım?"

Ölçülen durum: iki MyBid spotu (2028789 + 2028790) dolu dönüyor ama **aynı
kreatifi** veriyor (creativeID 7991131, birebir aynı mp4).

Mekanik olarak ne oluyor:

- Her slot **ayrı bir açık artırma** açar (`PrerollGate` iki etiketi ayrı ayrı
  çeker). Yani iki ayrı reklam yanıtı ve iki ayrı `<Impression>` beacon'ı oluşur.
- Buna karşılık talep tarafında **sıklık sınırı (frequency cap)** uygulanabilir:
  aynı kullanıcıya aynı kreatifi kısa sürede iki kez göstermek bazı alıcılarda
  ikinci gösterimin sayılmamasına yol açar. Bu, ağın iç kuralıdır ve dışarıdan
  doğrulanamaz.

Yani: **kesin iki kat gelir garantisi yok.** Garantili artış için 2. slotu
**farklı bir talep kaynağıyla** doldurmak gerekir (§4).

Kullanıcı tarafında doğrulanabilir kontrol: MyBid panelinde **gösterim
(impression) sayısı** ile **izlenme/oynatma sayısı** oranına bakın. Oran ≈ 2 ise
iki slot da sayılıyor; ≈ 1 ise ikinci gösterim sayılmıyor demektir.

Her iki MyBid spotu da koda ve `.env`'e girilmiştir (`src/lib/mybid.ts` →
`MYBID_VAST_SPOT_1/2`, `.env` → `VITE_MYBID_VAST_1/2`); `prerollVastUrls()`
ikisini birden döndürür.

---

## 9. Yeni sağlayıcı mimarisi (vidsrc.to aktif)

### Neden değişti

megaplay çalışıyor ama **altyazı menüsünde Türkçe yok**; vidsrc.to'da **var**
(kullanıcı kanıtı, §7). Kalite menüsü ikisinde de var.

### Eşleme: MAL → TMDB

vidsrc.to MAL kimliği kabul etmiyor, TMDB dizi kimliği istiyor. Eşleme
`scripts/sync-anizip-covers.mjs` içinde **aynı ani.zip yanıtından** üretilip
`src/data/mal-tmdb.json` dosyasına yazılıyor (ayrı istek yok):

| Dizi | MAL | TMDB |
|---|---|---|
| jujutsu-kaisen | 40748 | 95479 |
| re-zero | 31240 | 65942 |
| erased | 31043 | 65249 |
| mushoku-tensei | 39535 | 94664 |

Okuma: `tmdbIdForMal(malId)` (`src/lib/anizip-covers.ts`).

### Kod değişiklikleri

| Dosya | Değişiklik |
|---|---|
| `src/lib/embed-provider.ts` | `vidsrc` sağlayıcısı eklendi; şablonda `{tmdb}` ve `{season}` yer tutucuları; `ACTIVE_EMBED_PROVIDER = "vidsrc"` |
| `src/lib/embed-provider.ts` | `resolveEpisodeEmbed` sırası: **`@saglayici` direktifi** → `watch_url` → aktif sağlayıcı → **megaplay yedeği** (TMDB eşlemesi olmayan dizi boş ekrana düşmesin) |
| `src/lib/anizip-covers.ts` | `tmdbIdForMal()` eklendi |
| `src/routes/izle.$slug.tsx` | Sağlayıcı isteğine `tmdbId` geçiliyor |
| `scripts/sync-anizip-covers.mjs` | `mal-tmdb.json` da üretiliyor |
| `scripts/sql/jjk-eski-embedleri-kaldir.sql` | JJK'nın eski linklerini yedekleyip boşaltır |

### `@saglayici` direktifi

`watch_url` alanı `@vidsrc` veya `@megaplay` yazılırsa o sağlayıcı **zorlanır**.
Şema değişikliği gerekmez, geri alması tek `update`. Bir dizide vidsrc bölüm
bulamazsa o diziyi tek satırla megaplay'e döndürebilirsin (SQL dosyasında örnek var).

### Kalan riskler (dürüstçe)

- vidsrc.to iç içe iframe zinciri kullanıyor (`vidsrc.to → vsembed.ru →
  cloudorchestranova.com`) ve `vsembed.ru` üzerinde `disable-devtool.js` var. Bu
  otomasyon testini engelliyor; **bölüm kapsamı 4 dizi için tek tek elle
  doğrulanmadı**.
- Testte 1 adet kendiliğinden açılan pop-under gözlendi (hangi sağlayıcıdan geldiği
  belirlenemedi). vidsrc.to oynatıcı üstüne `Histats.com` izleme rozeti çiziyor.
- Türkçe altyazı **varsayılan değil**; kullanıcı panelden seçiyor. Varsayılan yapmak
  ancak kendi altyazı dosyamızı `?sub_file=` ile vermekle mümkün.

---

## 10. vidsrc.to — üç istek, üç ölçüm

Kullanıcı üç şey istedi: (1) altyazı otomatik Türkçe olsun, (2) oynatıcıdaki
`S01 E01` yazısı `S1 B1` olsun, (3) pop kaldırılsın. Hepsi incelendi; sonuçlar:

### 10.1 Altyazıyı varsayılan Türkçe yapmak — parametreyle MÜMKÜN DEĞİL

Zincir: `vidsrc.to/embed/... → vsembed.ru/embed/... → cloudorchestranova.com/...`

Zincirin ikinci halkası (`vsembed.ru`) sayfasının kodu indirilip tarandı
(54.133 karakter, 25.09.2026):

- `URLSearchParams` / `searchParams` **hiç geçmiyor** → sayfa hiçbir sorgu
  parametresi okumuyor.
- Sayfada bir üst şerit var: `#vs-bar` → `#vs-title` ("JUJUTSU KAISEN 2020 ·
  S01 E01" metni **buradan** geliyor) + `#vs-epnav` içinde **iki adet `<select>`**:
  `Season N` ve `Episode N`. Yani oradaki menüler **sezon/bölüm seçicisi**,
  altyazı dili seçicisi değil.
- Bölüm değiştirme protokolü: `postMessage({type:'TV_SET', season, episode})`.
- Altyazı menüsü (Türkçe'nin listelendiği yer) en içteki oynatıcıda
  (`cloudorchestranova.com`) — oraya dışarıdan erişilemiyor.

**Tek çalışan yol:** kendi `.vtt` dosyamızı `?sub.info=` ile vermek
(vidsrc.to API dokümanı, "Use custom subtitles"):

```
https://vidsrc.to/embed/tv/95479/1/1?sub.info=<urlencoded json>
json: [{"file":"https://.../tr.vtt","label":"Türkçe","kind":"captions"}]
```

Dosyanın `Access-Control-Allow-Origin: *` başlığıyla servis edilmesi şart.

**Uygulandı:** `src/lib/embed-provider.ts` → `appendSubInfo()`. Panelden
`episodes.subtitles` alanına bir Türkçe `.vtt` adresi girildiği anda altyazı
sağlayıcının menüsüne eklenir. (Aynı alan kendi oynatıcımızda `<track>` olarak
da kullanılıyor — tek alan, iki kullanım.)

### 10.2 `S01 E01` → `S1 B1` — metin değiştirilemez, ÜSTÜ BOYANDI

O metin `vsembed.ru` sayfasının `#vs-title` öğesinde. Cross-origin iframe'in
içeriğine yazı yazılamaz / CSS uygulanamaz.

**Çözüm:** iframe'in tam üstüne kendi şeridimizi çizdik — aynı konum, aynı
görünüm, bizim metnimiz (`{seri} · S{sezon} B{bölüm}`). Sağlayıcının şeridi de
fareyle üzerine gelince göründüğü için bizimki de öyle davranıyor; video normalde
temiz kalıyor. `src/routes/izle.$slug.tsx` → `PlayerBox`, `group-hover` şeridi.

Dürüst sınır: bu bir **kapatma**, düzenleme değil. Sağlayıcı yazıyı başka bir
konuma taşırsa ikisi birlikte görünebilir.

### 10.3 Pop kaldırmak — MÜMKÜN DEĞİL (kasıtlı engel)

`vsembed.ru`, `/assets/sbx.js` adlı bir **"Sandbox-embed blocker"** yüklüyor.
Kendi yorumu birebir:

> "If that page is loaded inside an `<iframe sandbox>` (a client trying to cage
> the player), this frame is redirected to `/sandbox.php?ref=<embedding host>`."

Algılama: (1) kendi çerçevesinde `sandbox` özniteliği, (2) opak kaynak
(`allow-same-origin` olmayan sandbox) → `document.domain` ataması "sandbox"
içeren bir `SecurityError` verir. Yani **sandbox ile pop-up engelleme yolu
bilinçli olarak kapatılmış.**

Pop'un nasıl çıktığı da bulundu (sayfa JS'i):

- `window.open` **hook'lanıyor**; gizli bir iframe oluşturulup
  `t.contentWindow.open(...)` çağrılıyor → iframe tabanlı pop-under.
- `localStorage`'da `unloaded_at` / `shown_at` anahtarları ve
  `... > 6e4` karşılaştırması → **60 saniyelik bekleme süresi**.

Bu, kullanıcının gözlemini açıklıyor: "1 pop oldu, 2 olmadı, ama 2.'de olur" —
pop, ~60 saniyelik soğuma süresiyle sınırlandırılmış.

**Yapılabilecek bir şey yok.** Pop, sağlayıcının kendi belgesinin içinde
oluşturuluyor; bizim tarafımızdan engellenemiyor. Seçenekler: (a) izleyicinin
reklam engelleyicisi, (b) pop'u olmayan bir sağlayıcı, (c) kendi barındırma.

---

## 11. Sandbox A/B ölçümü — kesin sonuç: ENGELLİ

`sbx.js` kaynağı tamamen okundu (1.201 byte). Algılama iki yolla ve ikisi de
**cross-origin** bir üst çerçevede tetiklenmemesi gerekiyordu:

```js
try { if (window.frameElement && window.frameElement.hasAttribute('sandbox')) { block(); return; } } catch (t) {}
try { document.domain = document.domain; }
catch (t) { if (('' + t).toLowerCase().indexOf('sandbox') !== -1) { block(); return; } }
```

Yani `allow-same-origin` İÇEREN bir sandbox teorik olarak `sbx.js`'i atlatmalıydı.
Bu yüzden gerçek tarayıcıda 3 hücreli A/B testi yapıldı
(`public/_sandbox-test.html`, aynı adres, tek değişken `sandbox`):

| Hücre | sandbox | Sonuç |
|---|---|---|
| 1 | **yok** (kontrol) | Gerçek oynatıcı geldi: poster "JUJUTSU KAISEN 2020 - S01 E01" + oynat düğmesi |
| 2 | `allow-scripts allow-same-origin allow-forms allow-presentation allow-orientation-lock` | **ENGELLENDİ** |
| 3 | `allow-scripts allow-forms` (allow-same-origin yok) | **ENGELLENDİ** |
| 4 | yok (megaplay kontrol) | Oynatıcı geldi |

Hücre 2 ve 3'te ekranda birebir şu yazdı:

> **This content can't be embedded in a sandboxed frame**
> The player was loaded inside an `<iframe sandbox>`, which isn't permitted.

Yani `sbx.js`'in yanında **ikinci bir engel** var: en içteki oynatıcının kendisi
sandbox'ı algılayıp reddediyor. `allow-same-origin` olsa bile.

**Sonuç: vidsrc.to'da pop-up'ı sandbox ile engellemek mümkün değil.** Pop
60 saniyelik soğuma ile sağlayıcının kendi belgesinde oluşturuluyor.

---

## 12. Sağlayıcı oynatıcısının İÇİNDEKİ ayarlar — dışarıdan değiştirilemez

Kullanıcı şunları istedi; hepsi en içteki oynatıcının (`cloudorchestranova.com`)
kendi arayüzünde ve **cross-origin** olduğu için dışarıdan müdahale edilemez:

| İstek | Durum | Neden |
|---|---|---|
| Kaliteyi varsayılan **1080p** yap | **Mümkün değil** | Kalite menüsü oynatıcının içinde. Ayrıca bu akışta menüde yalnızca **Auto / 360p / 720p** var — 1080p kaynak yok |
| Altyazıyı varsayılan **Türkçe** yap | **Mümkün değil** | Seçim oynatıcının iç durumu. Tek yol kendi `.vtt` dosyamızı `?sub.info=` ile vermek (§10.1) |
| Altyazı tasarımı: **Background opacity 0** | **Mümkün değil** | "CAPTION STYLE" ayarları oynatıcının kendi VTTCue render'ı; her ziyaretçi için bizden ayarlanamaz |

Bu ayarlar ziyaretçinin tarayıcısında sağlayıcının origin'i altında saklanıyor;
bizim sayfamızdan ne okunabilir ne yazılabilir. Kalıcı varsayılan istiyorsan tek
yol kendi oynatıcımız (§2).

### Ses/dublaj (ör. Re:Zero İngilizce dublaj)

vidsrc.to oynatıcısında **ses/dublaj seçici yok** (arayüzde yalnızca
`Subtitles` ve `Options` sekmeleri var; `Settings` içinde sadece `QUALITY`).
Yani hangi sesi verdiyse o çalar — URL'den değiştirilemez.

Alternatif: diziyi `@megaplay`e almak. megaplay `/sub` yolu **orijinal Japonca
ses + gömülü altyazı** verir (iframe ölçümünde altyazı göründü). Ama megaplay'de
Türkçe altyazı yok.

| Seçim | Ses | TR altyazı |
|---|---|---|
| vidsrc.to (bugünkü varsayılan) | sağlayıcı ne verirse (Re:Zero'da İngilizce dublaj) | **var** (menüden seçilir) |
| `@megaplay` | **orijinal Japonca** | yok |

Tek satırla dizi bazında değiştirilir:

```sql
update public.show_episodes e
set watch_url = '@megaplay'
from public.shows s
where s.id = e.show_id and s.slug = 're-zero';
```

**Bütün diziler için hazır SQL:** `scripts/sql/japonca-dublaj-tum-animeler.sql`
(yedekli, geri alınabilir).

---

## 13. Canlı site ölçümü (25.09.2026) — lokalle aynı mı?

Gerçek tarayıcıyla `shanime.xyz/izle/jujutsu-kaisen` açıldı, "Oynat" tıklandı,
~50 sn izlendi:

| Ölçüm | Sonuç |
|---|---|
| Ön reklam sayısı | **2** — sayaç metinleri birebir `Reklam 1/2` → `Reklam 2/2` |
| İki reklam aynı mı? | **AYNI** — ikisi de birebir aynı dosya (`i.imgkcdn.com/...6aa3d42aca9066..._high.mp4`, 15,10 sn, Zeus casino slot) |
| Sonrasında ne yüklendi | `vidsrc.to/embed/tv/95479/1/1` iframe'i + "JUJUTSU KAISEN 2020 S01 E01" + oynat düğmesi |
| Kendiliğinden açılan pop-under | **0** |

Yani **canlı site lokalle birebir aynı davranıyor**: 2 ön reklam, aynı kreatif.
Ayrıca canlıda JJK artık vidsrc.to'dan yükleniyor → SQL çalıştırılmış ve yeni
sürüm yayına girmiş.

### Sayfadaki "farklı farklı" reklamlar nereden geliyor?

Ön reklamlarımız sabit (2 adet, aynı dosya). Değişenler **Adsterra birimleri**:

- Oynatıcının üstünde leaderboard banner (ölçümde MELBET kreatifi, `highrevenueformat.com`),
- Oynatıcının altında native blok — kreatifleri her açılışta değişiyor
  (ölçümde: "Single women here hate being alone❤️", "Spider-Man: Across the
  Spider-Verse", "Your IP is exposed. Click to hide", "Just won 15000$ in bonus
  game. Try luck").

Yani sitede bizim tarafımızdan **4 reklam yüzeyi** var: 2 ön reklam + 1 banner +
1 native. Bunun üstünde gördüğün her şey sağlayıcının kendi oynatıcısından gelir
(vidsrc zinciri).

---

## 14. "Japonca dublaj + Türkçe altyazı" arayışı — kesin sonuç

### Önce: megaplay'in kaynak ucu bulundu (önemli)

megaplay oynatıcısının altyazı listesi **açık bir uçtan** okunabiliyor:

```
GET https://megaplay.buzz/stream/getSources?id=<data-id>     (kimlik gerekmiyor)
→ { "tracks":[{ "file":"https://….hiddenvertex.top/…/subtitles/<hash>.vtt",
                "label":"English", "kind":"captions", "default":true }],
    "t":1, "intro":{"start":0,"end":0}, "outro":{"start":2853,"end":2950},
    "server":4, "enc":"wdeBruh3…" }
```

`data-id`, embed kabuğundaki `<div id="megaplay-player" data-id="…">` alanından
alınır. **Kabuğu sunucudan isterken `Sec-Fetch-Dest: iframe` göndermek şart** —
yoksa sağlayıcı "Error Code: 410" sayfası döndürüyor (üçüncü kez doğrulandı:
gerçek engelleme değil, bağlam kontrolü).

Yan ürün: `intro`/`outro` saniyeleri de geliyor → ileride "açılışı atla" için
hazır veri.

### Tarama sonucu: megaplay'de TÜRKÇE ALTYAZI YOK

4 dizi × 3 bölüm (B1/B2/B5) tarandı:

| Dizi (MAL) | Bölüm 1'in izleri |
|---|---|
| jujutsu-kaisen (40748) | Arabic, **English\\***, French, German, Italian, Portuguese(BR), Russian, Spanish, Spanish(ES) — **Türkçe yok** |
| re-zero (31240) | English\\* — **tek iz** |
| mushoku-tensei (39535) | **English\\***, Portuguese(BR), Spanish — **Türkçe yok** |
| erased (31043) | English\\* — **tek iz** |

(`*` = varsayılan iz)

### Karar: hiçbir sağlayıcı ikisini birlikte vermiyor

| Sağlayıcı | Ses | Altyazı | Türkçe |
|---|---|---|---|
| **megaplay** | **orijinal Japonca** (sub sürümü) | 1–9 iz, İngilizce varsayılan | **YOK** (ölçüldü) |
| **vidsrc.to** | İngilizce dublaj (anime için) | geniş altyazı veritabanı, dil aramalı | **VAR** |

Ek olarak bu turda taranan ve elenen adaylar: `vidsrc.cc` (anime sub/dub ucu —
**522, tamamen düşmüş**), `vidsrc.sbs` (anime → 404), `vidsrc.net`/`.rip`/`.in`/
`.xyz`/`vidora.su` (bağlantı yok), `vidsrc.win`/`vidsrc.me`/`vidsrc.pm`
(200 döndü ama altyazı/kalite izi yok), `2anime.xyz` (403 Cloudflare),
`anizone.to` (404), `animekai.to` (erişilemedi), `embed.su` (erişilemedi).

### Uygulanan çözüm: izleyiciye kaynak seçimi

Oynatıcının altına iki düğme eklendi:

- **Japonca ses** → megaplay (orijinal ses, altyazı EN ve diğerleri)
- **Türkçe altyazı** → vidsrc.to (Türkçe altyazı menüsü, ses İngilizce dublaj)

Teknik: `?kaynak=megaplay|vidsrc` sorgu parametresi; `buildProviderUrl()` seçilen
sağlayıcıdan adresi üretir (watch_url ve `@` direktifi o anda yok sayılır).
Düğme yalnızca iki sağlayıcı da adres üretebiliyorsa görünür. Kaynak değişince
iframe yenilenir, **ön reklam tekrar oynamaz**.

Kod: `src/lib/embed-provider.ts` → `buildProviderUrl()`,
`src/routes/izle.$slug.tsx` → `WatchSource` / `WATCH_SOURCES` / kaynak düğmeleri.

### İkisini birlikte vermenin tek yolu

Videoyu kendimiz barındırmak (R2) + kendi Türkçe `.vtt` dosyamız. O zaman
Japonca ses, Türkçe altyazı, kalite menüsü, altyazı tasarımı ve pop kontrolü
aynı anda bizim olur. Aksi halde sağlayıcı seçimi zorunlu bir takas.
