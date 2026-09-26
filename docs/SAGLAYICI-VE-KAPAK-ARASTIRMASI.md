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

---

## 15. Dibi: "o zaman diğerleri nasıl yapıyor?"

Kullanıcının sorusu: *"daima bulana kadar durma, diğerleri nasıl yapıyor o
zaman? Türk anime sitelerinden bir şey yapamaz mıyız?"* Bu soru iki koldan
araştırıldı.

### 15.1 megaplay'e dışarıdan altyazı sokmak — İKİ yol da kapalı

**(a) postMessage köprüsü.** megaplay `lib/handle-bridge.min.js` yüklüyor ve
`window.postMessage` ile komut kabul ediyor. Dosyanın tamamı okundu; desteklenen
komut listesi tam olarak şu:

```
SEEK · GET_TIME · GET_PIP · SKP_DATA · PLAY_TOGGLE · MUTE
```

→ **Altyazı/track ekleme komutu YOK.** (Bu komutlar yine de işe yarar: kendi
kontrol katmanımızı yapabilir, `SKP_DATA` ile "açılışı/bitişi atla" özelliğini
kullanabiliriz. `getSources` yanıtı `intro`/`outro` saniyelerini de veriyor.)

**(b) URL parametresi.** Kabuğun kabul ettiği parametreler tarandı:

```
s · time · unix
```

→ **`sub`/`subtitle`/`track` parametresi YOK.**

### 15.2 Türk anime siteleri bunu nasıl yapıyor — ölçüldü

| Site | Ne bulundu |
|---|---|
| **turkanime.tv** | Vue SPA (kendi oynatıcısı, `/assets/js/app.*.js`). Ana sayfasındaki veda metninde birebir şu yazıyor: *"gecelerini altyazılara adayan fedakâr çevirmenlerimize"* → **altyazıyı insan çevirmenler üretiyor.** Ayrıca site kapanıyor ve alan adlarını satıyor: *"16 Yıllık Bir Masalın Sonu"*, *"Münhasır Portföy Satışı"* |
| **tranimeizle.live** | Kendi CDN'i: `cdn77.aj2532.bid`, `static.tranimeizle.top` → **videoyu kendisi barındırıyor**, üçüncü taraf embed yok |
| tranimeizle / turkanime bölüm sayfaları | Dış altyazı dosyası (`.vtt`/`.srt`) HTML'de görünmüyor — oynatıcı verisi API'den çalışma anında geliyor |

### 15.3 Cevap

Türk anime siteleri **bizden farklı bir şey yapmıyor, farklı bir iş modeli
işletiyor:** videoyu kendileri barındırıyor ve Türkçe altyazıyı
**kendileri (çevirmenleri) üretiyor**. Yani ortada "bulunamayan bir sağlayıcı"
yok — o sağlayıcı diye bir şey **yok**, çünkü hiçbir ücretsiz embed kendi
çevirmen kadrosunu finanse etmiyor.

Bu yüzden arama burada bitiyor: **Türkçe altyazı, sağlayıcı seçimiyle
çözülebilecek bir problem değil.** Çözüm iki bileşenden oluşuyor:

1. **Türkçe `.vtt` dosyası** (bunu çeviri yoluyla üretmek gerekir — bu bir emek/iş
   gücü meselesi, teknik değil),
2. **Onu oynatıcıya sokabileceğimiz bir oynatıcı** (vidsrc.to `sub.info` kabul
   ediyor, ama İngilizce dublaj veriyor; megaplay Japonca ses veriyor ama altyazı
   kabul etmiyor).

İkisini aynı anda verebilen tek kurulum: **kendi barındırma + kendi oynatıcı**
(`play_url` + `episodes.subtitles` alanları bu iş için zaten kodda hazır —
`directSourceOf()` ve `subtitlesOf()`).

---

## 16. ÇÖZÜM BULUNDU: kendi altyazı katmanımız (video yüklemek gerekmiyor)

§15'te "kendi barındırma" gerekiyor demiştim — **video için** doğru, ama altyazı
için değil. megaplay'in köprüsü bize oynatma zamanını veriyor; o zamanı kullanıp
altyazıyı **kendi katmanımızda** çizersek videoyu hiç yüklememiz gerekmez.

### Nasıl çalışıyor

1. Oynatıcı megaplay (orijinal **Japonca ses**).
2. Biz `postMessage` ile oynatma zamanını alıyoruz (köprü bunu sürekli gönderiyor).
3. `src/components/SubtitleOverlay.tsx` elimizdeki `.vtt`/`.srt` metnini çözüp
   iframe'in **üstüne** doğru satırı çiziyor. Yazı tipi/boyutu/arka planı
   tamamen bizim (istenen "arka plan yok" stili uygulandı).

### Uçtan uca doğrulama (25.09.2026, gerçek tarayıcı)

Geçici bir Türkçe `.vtt` ile (her satır kendi başlangıç saatini yazıyor) canlı
sayfada ölçüldü:

| Ölçüm | Sonuç |
|---|---|
| Çizilen satır | `TR DEMO ALTYAZI 00:05:35.000` (canlı: 04:50 → 05:10 → 05:20 → 05:35) |
| Oynatıcının kendi zamanı | `05:35 / 23:55` |
| Senkron | **birebir** |
| "TR altyazı açık" düğmesi | DOM'da mevcut |
| Pop-up | **0** |

Ayrıca test sırasında vidsrc kaynağına geçildiğinde ekranda şu Türkçe satır
göründü: *"www.OpenSubtitles.org adresinden tüm reklamları kaldırmak için bizi
destekleyin ve VIP üye olun."* → **vidsrc.to'nun Türkçe altyazı kaynağı
OpenSubtitles.** (Bilgi olarak kayda değer.)

### Bilinen sınır

Sağlayıcının **kendi** altyazısı (İngilizce varsayılan iz) açıksa ekranda iki
satır görünebilir; katmanımız onun biraz üstüne konumlanır ve izleyici
"TR altyazı açık/kapalı" düğmesiyle bizimkini kapatabilir. Sağlayıcının izini
kapatmanın yolu yok (§15.1).

### Altyazı nasıl eklenir (video yüklemek YOK)

1. `.vtt` dosyasını `public/subs/` altına koy (ör. `public/subs/re-zero-s1b1.vtt`),
2. Panelde ilgili bölümün `subtitles` alanına şunu yaz:

```json
[{ "src": "/subs/re-zero-s1b1.vtt", "label": "Türkçe", "srclang": "tr" }]
```

Göreli yol da kabul edilir (`subtitlesOf()` bunu destekler); sağlayıcıya
enjekte edilirken tam adrese çevrilir. Dosya kendi alan adımızdan servis
edildiği için CORS sorunu çıkmaz. `.vtt` şart — tarayıcı `.srt` okumaz, önce
çevrilmelidir (içerik aynı, sadece biçim).

Böylece: **Japonca ses + Türkçe altyazı + kendi tasarım + pop yok**, üstelik
bölüm başına yüklenecek şey birkaç kilobaytlık bir metin dosyası.


---

## 17. Anizium + diğer Türk siteleri — video nereden geliyor? (25.09.2026)

Kullanıcının sorusu: *"aniziumun nerden aldığını görebilir misin, üyelik alacağım ona göre."*
İnceleme tarayıcı oturumu + doğrudan HTTP ölçümleriyle yapıldı (yalnızca okuma;
hiçbir hesapta işlem yapılmadı, satın alma yok, dosya indirilmedi — sadece HEAD
ve küçük `Range` istekleri).

### 17.1 Kısa cevap: anizium hiçbir yerden almıyor — KENDİSİ kaynak

Anizium bir embed sağlayıcısı değil, **kendi altyapısını kuran bir yayıncı**.
Üç ayrı alan adı işi bölüşmüş:

| Alan adı | İşi |
|---|---|
| `api.anizium.co` | Veri (dizi/bölüm/kullanıcı API'si) |
| `x.anizium.co` | Oynatıcı (ArtPlayer) + altyazı servisi + kapaklar |
| `x.aniziumserver.site` | **Asıl video dosyaları** |

Bu yüzden **üyelik almanın bize teknik faydası yok**: ortada satın alınacak bir
embed/partner servisi yok. Oynatıcı gömme adresi (`x.anizium.co/embed`) bir
token'a bağlı ve bizim alan adımızdan çağrıldığında hata veriyor (aşağıda).
Asıl faydalı bulgu, **medya dosyalarının korumasız olması**.

### 17.2 Medya adresi kalıbı — ÇALIŞIYOR (kanıtlı)

```
https://x.aniziumserver.site/{tmdb_id}/{sezon}/{bölüm}/{kalite}.{ses}.mp4
```

- `{tmdb_id}`: **TMDB** kimliği — bizim `src/data/mal-tmdb.json` eşlememizle birebir.
  Doğrulama: JJK 95479 · Mushoku 94664 · Erased 65249 kendi dizimiz;
  Frieren 209867 · Death Note 13916 kontrol amaçlı → hepsi HTTP 200.
- `{ses}`: `trdub` · `endub` · `original`
- `{kalite}`: `2160p` · `1440p` · `1080p` · `720p` · `480p` (`360p` ve `4k` yok)

**Kalite matrisi — JJK S1B1, ölçülen dosya boyutları:**

| Kalite | `original` | `trdub` |
|---|---|---|
| 2160p | 1605 MB | 1008 MB |
| 1440p | 695 MB | 541 MB |
| 1080p | 445 MB | 411 MB |
| 720p | 222 MB | 242 MB |
| 480p | 117 MB | 128 MB |

Bölüm aralığı JJK S1: `1..24` var, `25/26` yok (bizim sezon yapımızla aynı).
Sezon: S1/S2/S3 var.

### 17.3 Hotlink / Referer ölçümü — medya KORUMASIZ

| İstek | Sonuç |
|---|---|
| `Range`/`HEAD`, Referer **yok** | 206 · `video/mp4` |
| `Referer: https://example.com/` | **200 · 411 MB tam dosya** |
| `Referer: https://anizium.co/` | 200 · 411 MB |
| Yeni sekmede doğrudan açma | oynuyor, 403 yok |

Yani medyada ne Referer kontrolü ne token var. **Ama oynatıcı sayfasında var:**
`x.anizium.co/embed?...` isteği `Referer: https://anizium.co/` olmadan
`{"isError":true,"msg":"Video açılamaz."}` döner → **iframe ile gömemeyiz.**

### 17.4 Üyelik duvarı — sunucuda değil, tarayıcıda

`#video_box` içeriği premium olmayan hesaplarda *"Bu içeriği görüntülemek için
premium olmanız gerekir."* diyor; karar `_klaus.user.subscription` ve
`episode_data.free` alanlarından **istemci tarafında** veriliyor. Embed adresi
`u=` parametresi (kullanıcı kimliği, token değil) ile doğrudan çağrıldığında
video oynadı. Yani premium kapısı medyayı korumuyor.

### 17.5 Kapsama — kalıp TÜM katalogda geçerli DEĞİL

Aynı test 10 dizide tekrarlandı (S1B1, 5 varyant):

| Çalışan (200) | Çalışmayan (404) |
|---|---|
| Jujutsu Kaisen 95479 | **Re:Zero 65942** |
| Mushoku Tensei 94664 | Attack on Titan 1429 |
| Erased 65249 | One Piece 37854 |
| Frieren 209867 | Naruto 46260 |
| Death Note 13916 | Demon Slayer 85937 |

404'lerin sebebi araştırıldı: TMDB yerine **AniList/MAL** kimlikleri denendi
(16498, 21, 20, 101922, 21355) → hepsi 404. `.m3u8` yolları (`master`, `index`,
`playlist`) denendi → hepsi 404. Yani bu başlıklar ya başka bir sunucuda ya da
bu kodlamayla hiç yok. **Sonuç: kalıp güvenilir ama kısmi bir alt küme kapsıyor**;
her dizi için ayrı ölçüm gerekir (derleme zamanında HEAD ile bakılabilir).

### 17.6 "original" gerçekten Japonca ses mi? — DOĞRULANAMADI

Dosya adı etiketten ibaret; MP4 içindeki `mdhd` dil kodu **yazılmamış**
(`und`/boş). Kodek ayrıştırması her dosyada **1 video + 1 ses** yolu olduğunu
gösterdi (yani dublajlar ayrı dosyalar). Okunabilen tek şey Erased'de
`avc1` + `mp4a` (H.264 + AAC, tarayıcı uyumlu). `original` etiketi sitenin
kendi ses seçenekleriyle (`Türkçe Dublaj / İngilizce Dublaj / Orijinal`) ve
`window.video_sources.sound_group = ["trdub","endub","original"]` ile
örtüşüyor — **güçlü ama akustik olarak doğrulanmamış**.

### 17.7 Bu yolun maliyeti / riski

- Bölüm başına **277–445 MB**. Kullanıcı tarafında açılış iyidir (MP4 + `Accept-Ranges`),
  ama trafik tamamen anizium'un sunucusundan gider.
- Anizium **ücretli bir Türk platformu** (Türkçe dublaj prodüksiyonu yapıyor).
  Bugün korumasız olması yarın da öyle kalacağı anlamına gelmez; Referer
  kontrolü eklemek tek satırlık bir değişiklik.
- Başka bir siteyi değil, doğrudan platformun kendisini kaynak almış oluyoruz.

### 17.8 Diğer Türk anime siteleri — tarama sonucu

| Site | Oynatıcı | Medya | iframe ile gömülebilir? | Üyelik | Altyazı |
|---|---|---|---|---|---|
| **turkanime.tv** | — | — | — | — | **SİTE KAPANDI** (2010–2026, domain satılık) |
| anizium.co | iframe `x.anizium.co/embed` | `x.aniziumserver.site` MP4 | ❌ Referer kilidi | gerekmez | `lang=tr` |
| **anizm.net** | iframe → `pl.puffytr.tr/watch/{token}` (Video.js 8.23.3) | HLS `st.puffytr.tr` (1080p/720p/480p) | ✅ `X-Frame-Options: ALLOWALL` + `frame-ancestors *` (localhost'tan test edildi, oynadı) | gerekmez | gömülü **Türkçe** (hardsub), menü yok |
| **tranimeizle.org** | anizm.net'in birebir kopyası (aynı player id 1889179) | aynı | ✅ aynı | gerekmez | aynı |
| **animecix.tv** | iframe `tau-video.xyz/embed/{hash}?vid={vid}` | `irtau1.online` **düz MP4** | ✅ XFO/CSP yok, localhost'tan test edildi | gerekmez | menü yok, hardsub Türkçe |
| animesitesi.com | oynatıcı yok (WordPress blog) | — | — | — | — |

**Not — kritik ayrım:** Türk sitelerindeki Türkçe altyazı **videoya gömülü
(hardsub)**. Yani "altyazıyla uğraşmayız" doğru, ama bedeli şu: altyazı
**kapatılamaz**, dil değiştirilemez, bizim kendi altyazı katmanımız üstüne
eklenirse iki altyazı üst üste biner. Kullanıcının daha önce reddettiği
"kapatamadığın altyazı" durumunun ta kendisi.

`pl.puffytr.tr` token'ı **imzalı ve ~2 saatte doluyor**; kalıcı embed adresi yok,
token'ı her istekte `anizm.net/player/{id}`'den Referer ile yenilemek gerekir.
`tau-video.xyz` embed'i ise sabit hash'li — token yönetimi gerektirmiyor.

### 17.9 Özet karar

1. **Anizium üyeliği bu iş için gerekli değil** — satın alınacak bir servis yok,
   medya zaten korumasız. Üyelik sadece kendi izleme zevkin için.
2. Anizium'un medyası bizim `SubtitleOverlay`'ımızla **teknik olarak uyumlu**:
   kendi `<video>` oynatıcımızda, gerçek 1080p/1440p/2160p kalite menüsüyle,
   pop-up'sız. Ama kapsama kısmi (10 dizide 5) ve kaynak ücretli bir platform.
3. Sıfır kod değişikliğiyle çalışan iki gömülebilir alternatif var:
   `tau-video.xyz` (sabit, basit) ve `pl.puffytr.tr` (HLS + kalite, ama token
   yenileme servisi şart). İkisinin de altyazısı hardsub Türkçe.


---

## 18. "Oynatıcının İÇİNDE açılıp kapanan Türkçe altyazı" var mı? (25.09.2026)

Soru: kullanıcının sağlayıcının kendi CC düğmesinden Türkçe altyazıyı açıp
kapatabildiği bir yer var mı? Ölçüm hedefi: Jujutsu Kaisen S1 B1 (TMDB 95479).
Yöntem: statik HTTP taraması (18 sağlayıcı, ham gövdeler
`.tmp_b/provider-probe.json`) + tarayıcı oturumunda CC menülerinin okunması.

### 18.1 Ölçüm sonuçları

| Sağlayıcı | Oynatıcı içi altyazı menüsü | **Türkçe** | Kalite | Pop-up |
|---|---|---|---|---|
| **megaplay** (mevcut) | Var — JW Player CC menüsü, 10 satır | **YOK** | 1080p (tek) | 0 (iframe'de) |
| **vidlink.pro** | Var — API listesi okundu | **YOK** | 360/480/720/1080 | **0** |
| **videasy** | Menü var ama **boş** | YOK | 2160p/1080p/720p/480p | **0** |
| **puffytr** (anizm/tranimeizle) | Video.js track listesi **boş** → altyazı gömülü | Gömülü TR, kapatılamaz | 1080/720/480 | 0 gözlem |
| **vidsrc.to** | Okunamadı (`vsembed.ru` cross-origin, doğrudan açılışta `about:blank`) | doğrulanamadı (kullanıcının ekran görüntüsünde TR vardı) | doğrulanamadı | **1 pop-under** |
| **anizium** | Var — "Alt Yazı Grubu: Türkçe", gerçek VTT | **VAR** | 2160p'ye kadar | 0 |

Tam dil listeleri (ham ölçüm):

- **megaplay** (JW `getCaptionsList`): `Off, Arabic, English (default), French
  (Français(France)), German (Deutsch), Italian (Italiano), Portuguese
  (Português(Brasil)), Russian, Spanish (Español), Spanish (Español(España))`
- **vidlink.pro** (`/api/b/tv/95479/1/1`): `Arabic, Bengali, English, Filipino,
  French, Hindi, Indonesian, Malay, Punjabi, Português, Русский, ไทย, اُردُو,
  tiếng Việt`
- **videasy**: "Player Settings → Subs" = yalnızca `Off — NO SUBTITLES` +
  "Upload subtitles" + "Search OpenSubtitles" (gömülü/soft altyazı yok)

### 18.2 Statik taramanın ölçtüğü engeller

- `vidlink.pro/api/b/...` yalnızca başlık/Referer ile anlamlı veri döndürüyor;
  çıplak istekte gövde **`null`** (4 bayt).
- `multiembed.mov` → **Cloudflare Turnstile captcha kapısı** + karıştırılmış yük.
- `vidsrc.to` ham gövdesi: içinde `vsembed.ru/embed/tv/95479/1-1` iframe'i **ve
  iki adet pop-under betiği** (`llvpn.com/tag.min.js`, zone `10966354`).
- `videasy` ham gövdesi: iframe DIŞINDA açılırsa `window.stop()` + `about:blank`
  (yani yalnızca gömülü çalışıyor).
- `vidfast.pro`, `2embed.cc`, `embed.su`, `moviesapi.club`, `111movies`,
  `smashystream`, `hexa.watch`, `vidsrc.xyz` → yönlendirme/rate-limit/erişilemedi.

### 18.3 Sonuç

**Oynatıcının kendi CC düğmesinden açılıp kapanan Türkçe altyazı, doğrulanmış
olarak YALNIZCA anizium'da var.** Anizium aynı zamanda orijinal Japonca ses ve
2160p'ye kadar kalite de veriyor — yani istediğimiz üç şeyin (Japonca ses +
Türkçe altyazı + yüksek kalite) tamamını birlikte veren tek yer orası. Kullanıcı
dikkat çekme riski yüzünden onu kullanmayı reddetti (bkz. §17).

Güvenli/kurulumu kolay sağlayıcıların hiçbirinde Türkçe yok; Türkçe olanlar ise
ya **gömülü** (puffytr — kapatılamaz, dil değiştirilemez) ya da **riskli** (anizium).

**Bizim mevcut çözümümüz aynı deneyimi veriyor:** `SubtitleOverlay` ile Türkçe
altyazı videonun üzerinde açılıp kapanıyor ve menü oynatıcının hemen altında.
Tek fark, düğmenin sağlayıcının CC simgesi değil **bizim menümüz** olması —
sağlayıcının CC listesine satır eklemenin imkânsız olduğu §12'de kanıtlanmıştı.

---

## 19. anizm.net derinlemesine: kaynak, gömülebilirlik, video içi (26.09.2026)

Kullanıcı sorusu: "anizm'in videosunu kontrol et — telif/kaldırma riski var mı,
başta reklam var mı, siyah alanları boyayabilir miyiz?" Ölçüm hedefi: Jujutsu
Kaisen S1 B1 (TMDB 95479). Yöntem: tarayıcı oturumu (gerçek Chrome), ağ izi +
JW Player API çağrıları + ekran görüntüleri.

### 19.1 §17.8 ve §18'deki anizm kayıtları YANLIŞ — düzeltme

| Eski iddia (§17.8) | Ölçülen gerçek |
|---|---|
| Oynatıcı: `pl.puffytr.tr/watch/{token}` (Video.js 8.23.3) | ❌ **`pl.puffytr.tr` kökü 404** (host gitmiş). Oynatıcı: `anizmplayer.com`, **JW Player 8.34.3** + `FirePlayer by Neron` (firevideoplayer.com) |
| Medya: HLS `st.puffytr.tr` | ❌ Medya: `anizmplayer.com/cdn/hls/…` (master) + segmentler **`anz-gth-1-01…09.com.tr`** |
| Altyazı: "gömülü Türkçe (hardsub), menü yok" | ✅ Altyazı gerçekten gömülü — ama **iz yok doğrulaması** farklı: `getCaptionsList()` = `[{id:"off",label:"Off"}]` (tek satır). Yani ekranda TR altyazı var, oynatıcının CC menüsünde **hiçbir dil yok** |
| Token ~2 saatte doluyor | ❌ Ölçülen hash **iki ayrı oturumda aynı** (`b5725710206a2753ff5a685c2a52365e`) → oturum token'ı değil, dosya hash'i |

### 19.2 Gömülebilirlik — kritik ayrım

| Yol | Sonuç |
|---|---|
| `https://anizm.net/player/<id>` (sarmalayıcı) | ❌ **GÖMÜLEMEZ.** Top-level ve bizim iframe'de **anizm.net'in kendi 404 sayfası** çiziliyor. Yalnızca anizm.net içinden açılırsa 302 ile oynatıcıya gidiyor → **Referer bağımlı**, hotlink korumalı |
| `https://anizmplayer.com/video/<hash>` (doğrudan oynatıcı) | ✅ **GÖMÜLEBİLİR.** HTTP 200, JW Player yüklendi, video oynadı, **pop-up 0** (45 sn bekleme + 1 tıklama) |

**Jujutsu Kaisen S1B1 için ölçülen hash'ler:**

```
S1B1 (Unmei varyantı): anizmplayer.com/video/b5725710206a2753ff5a685c2a52365e
HLS master:            anizmplayer.com/cdn/hls/6379493750f488a430ae08d43e400ba0/master.txt
segmentler:            anz-gth-1-01.com.tr / anz-gth-1-02.com.tr / … / anz-gth-1-09.com.tr
                       /cdn/down/6379493750f488a430ae08d43e400ba0/Video/360p/360p_000.html
dosya adı (JW title):  [Unm3i-F4nsub]-Jujutsu-K4is3n---01-[1080p]v2
```

Diğer fansub varyantlarının sarmalayıcı ID'leri: AnimeWho `1544187`, Aoi `1544186`,
Next Fansub `1544185`, Tempest `1544184`, Arcadia `1543627`, Unmei `1543980`.

### 19.3 Video içi ve reklam ölçümü

- **Videonun içine gömülü reklam: YOK.** Manifest'te `#EXT-X-CUE-OUT`, `SCTE35`,
  `#EXT-X-DISCONTINUITY` yok. `#EXT-X-KEY` yok (şifreleme yok). DRM izi yok
  (widevine/playready/clearkey isteği görülmedi).
- **Gömülebilir oynatıcı sayfasında reklam: YOK.** `getConfig().advertising = []`,
  banner yok, 105 sn boyunca 0 pop-up.
- **Reklamın gerçek yeri: anizm'in İZLEME sayfası.** Oynatıcının hemen üstünde
  `888TL DENİME BONUSU!` bahis banner'ı; fansub sekmeleriyle uğraşırken tıklama
  bazlı **`publishers.monetag.com/signUp`** pop-up'ı açıldı. Bu ikisi **iframe'e
  gömülen `<id>`/`/video/` sayfasında YOK** — yani gömülünce gelmiyorlar.
- **Siyah bantlar: boş.** `objectFit: contain`, kaynak 1920×1080, kutu 1912×863 →
  **sol ~189 px + sağ ~189 px siyah bant, üst/alt 0 px.** Bu bantlarda **hiçbir
  logo/reklam/yazı yok** → boyanacak bir şey yok.
- **Altyazı: gömülü (hardsub), kapatılamaz.** 6 varyantın (Unmei, AnimeWho, Aoi,
  Next Fansub, Tempest, Arcadia) tamamında `getCaptionsList()` = yalnızca `Off`.
  Kaynak: Türk fansub encode'u; kare içinde fansub kredisi de görülüyor
  (ör. `Çeviri: bb.jpkrchth / Kodlama: Stapimaz`).
- **Kalite listesi (Unmei): `Otomatik 1080p` · `1080p` · `720p` · `480p` · `360p`.**
  Diğer varyantlarda 1080p yok (`720/480/360`).
- **Zaman köprüsü: YOK.** 105+ sn oynatmada postMessage ile gelen tek mesaj
  `{"cmd":"iframe-ready"}` (origin `anizmplayer.com`). `currentTime` /
  `timeupdate` / `PLAYER_EVENT` **gelmiyor** → `SubtitleOverlay` bu kaynakla
  senkronize olamaz.
- **"Aincrad (Reklamsız)" bir oynatıcı değil**, harici host grubu
  (GDrive, MyviRU, Sibnet, DailyMotion, VidBM, Vidmoly, StreamSB, Voe).
  JW Player yerine harici hosta atlıyor → `getCaptionsList()` uygulanamaz.

### 19.4 Karar: anizm KULLANILMIYOR

Karşılıklı gereksinim tablosu:

| | Sıfır pop-up | TR altyazı | TR altyazı **kontrol edilebilir** | Kalite seçici | Zaman köprüsü (bizim katman) |
|---|---|---|---|---|---|
| megaplay (mevcut) | ✅ | ❌ → bizim katman | ✅ (bizim menü) | ❌ tek 1080p | ✅ (`timeupdate`/`PLAYER_EVENT`) |
| anizm `/video/<hash>` | ✅ | ✅ (gömülü) | ❌ **kap**atılamaz, dil değişmez | ✅ 360→1080p | ❌ mesaj yok |

anizm, megaplay'e göre tek bir şey kazandırıyor: **gerçek kalite menüsü.** Buna
karşılık kullanıcının daha önce açıkça reddettiği durumu getiriyor — kendi
altyazı katmanımızla üst üste binecek, kapatılamayan, **başka bir fansub'un
(kredisi gömülü) Türkçe hardsub'u.** Ayrıca dosya bizim değil, doğrudan anizm'in
CDN'inden çekiliyor; tek satırlık Referer kontrolü ile kapanabilir
(sarmalayıcı zaten kapalı). Bu yüzden **varsayılan megaplay olarak kalıyor.**

### 19.5 Telif / barındırma notu (ölçülen altyapı)

- Medya anizm tarafından **kendi alan adlarında** barındırılıyor:
  `anizmplayer.com` (master) + **`anz-gth-1-01…09.com.tr`** (segmentler). Yani
  içerik Türkiye'de barınıyor ve encode Türk bir fansub grubunun (Unmei) işi.
- Embed, dosyayı kopyalamaz; ama "kamuya iletme" fiili sitede de doğar. Pratikte
  bildirimler barındırana/alan adı sahibine gider; kullanıcının kendi sunucusuna
  indirip vermesi **en riskli** yol, embed ise görece daha az.
- Teknik risk yönü ters: bize "kaldırtma" gelmez, **onlar bizi keser** — Referer
  kilidi tek satırlık değişiklik (anizium'un yaptığı gibi). Bu yüzden kalıcı
  varsayılan olarak tek bir Türk sitesine bağlanmak doğru değil.

---

## 20. Altyazı indirme hattı: ölçülen durum (26.09.2026)

Kullanıcı önerisi: "oynatıcının altyazısı kapatılamıyorsa, videonun altına her
bölüm için İngilizce ve Türkçe'yi AYRI olarak koyalım; bastığında açılsın."

### 20.1 Mimari zaten bu — kod kanıtı

| Dosya | İlgili satır | İşlev |
|---|---|---|
| `src/lib/subtitles.ts` | `SUBTITLE_LANGS = ["tr","en"]` · `SUBTITLE_LABELS = {tr:"Türkçe", en:"İngilizce"}` | İki dil tanımlı |
| `src/lib/subtitles.ts` | `conventionSubtitlePath()` → `/subs/{slug}-s{sezon}b{bölüm}.{dil}.vtt` | Bölüm+dil başına ayrı dosya kuralı |
| `src/routes/izle.$slug.tsx` | `subCandidates` (SUBTITLE_LANGS üzerinden map) | Her bölüm için TR ve EN adayı üretir |
| `src/routes/izle.$slug.tsx` | `subsLangs` / `subsProbed` yoklaması | **Yalnızca dosyası gerçekten var olan dil menüde görünür** |
| `src/routes/izle.$slug.tsx` | `setSubsLang(subsLangs[0] ?? "off")` | TR yoksa ilk bulunana (EN) düşer |
| `src/components/SubtitleOverlay.tsx` | köprü `{event:"time"}` / `PLAYER_EVENT` | Altyazı sağlayıcı iframe'inin üstüne çizilir |
| `scripts/sync-tr-subtitles.mjs` | `const LANGS = ["tr", "en"]` | Betik **iki dili birden** indirir |

Yani "ayrı TR/EN + videonun altında menü + basınca açma" **hazır**. Dosyalar
bizim `public/subs/` altından geldiği için dışarıdan hiçbir şey yüklenmez →
pop-up tanımı gereği **sıfır**.

### 20.2 Eksik olan: dosyalar

`public/subs/` içeriği (ölçüldü): `erased-s1b1.tr.vtt`, `erased-s1b2.tr.vtt`,
`erased-s1b3.tr.vtt` → **3 dosya, hepsi TR; İngilizce dosya YOK.**

### 20.3 Engel: API aramayı reddediyor (kod sorunu DEĞİL)

Ölçüm (aynı başlıklarla, aynı makineden):

```
GET /api/v1/infos/formats   → 200  {"data":{"output_formats":["srt","sub","mpl","webvtt","dfxp","txt"]}}
GET /api/v1/subtitles?...   → 403  {"message":"You cannot consume this service","request_id":"…"}
```

- Anahtarlı ve **anahtarsız** istek aynı 403'ü alıyor → mesaj, `/subtitles` için
  genel "yetkisiz" yanıtı.
- Public uç nokta aynı başlıklarla **200** döndüğü için ağ/IP/başlık engeli yok.
- `node scripts/sync-tr-subtitles.mjs --slug erased --dry` çıktısı: mevcut 3 TR
  dosyası "atlandı", kalan **tüm** aramalar `arama 403`.

**Sonuç:** `/subtitles` yetkili bir consumer anahtarı istiyor; `.env` içindeki
32 karakterlik anahtar kabul edilmiyor. Kodda düzeltilecek bir şey yok —
opensubtitles.com → consumers üzerinden geçerli anahtar alınması gerekiyor.
Anahtar gelene kadar İngilizce doldurma yapılamaz; TR için de yeni dosya
üretilemez (mevcut 3 dosya çalışmaya devam eder).

---

## 21. Jujutsu Kaisen: Türkçe altyazılı + pop-upsuz en yüksek kalite (26.09.2026)

Soru: "JJK için Türkçe altyazılı, pop-upsuz, en yüksek kaliteli kaynak hangisi?"
(gömülü mü oynatıcı seçeneği mi olduğu önemli değil). Ölçüm: anizm.net
oynatıcısı, bölüm bölüm, top-level.

### 21.1 Ölçüm — sezona göre kalite

| Bölüm | Oynatıcı URL | Yayın adı (JW title) | Kalite listesi | En yüksek |
|---|---|---|---|---|
| S1 B1 | `anizmplayer.com/video/b5725710206a2753ff5a685c2a52365e` | `[Unm3i-F4nsub]-Jujutsu-K4is3n---01-[1080p]v2` | `Otomatik · 1080p · 720p · 480p · 360p` | **1080p** |
| S2 B1 | `anizmplayer.com/video/97ef0d85cf65b350b0c71c9abdcfe67e` | `[Kirigana Fairies] Jujutsu Kaisen - 25 (1080p) …` | `Auto · 1080p · 720p · 480p · 360p · 240p · 144p` | **1080p** |
| **S3 B1** (Shimetsu Kaiyuu) | `anizmplayer.com/video/af05afa5845577fd1b2ada9b2a0de515` | **`[ANİZM-4K] JUJUTSU KAISEN S3 - 01.mp4`** | `Auto · 2160p · 1440p · 1080p · 720p · 480p` | **2160p (4K)** |

S3 master manifest (`anizmplayer.com/cdn/hls/14c91056e0f8aafb9a64359b8bb662bf/master.txt`)
`RESOLUTION=` satırları AYNEN:

```
RESOLUTION=842x480
RESOLUTION=1280x720
RESOLUTION=1920x1080
RESOLUTION=2560x1440
RESOLUTION=3840x2160
```

→ **4K sezon-spesifik**: S3'te var, S1/S2'de yok. Bu bir tutarsızlık değil,
encode sürümü farkı. (`2160p` seçildi, oynatıcıda "Aktif Kalite: 2160p".)

Not: S3 sayfası site içi aramada çıkmıyor ama şu adres **çalışıyor**:
`https://anizm.net/jujutsu-kaisen-shimetsu-kaiyuu-zenpen-1-bolum-izle`
(sarmalayıcı `anizm.net/player/1818189`, Referer'sız top-level açılışta 404).

### 21.2 Türkçe altyazı: VAR ama GÖMÜLÜ

Üç bölümde de ekranda Türkçe altyazı görüldü (gözlenen satırlar):

- S1 B1: `"Milli şampiyonluk için sana ihtiyacımız var!"` · `"Cadılar biri değilim. Yani adaletli bir dövüş yapalım."`
- S2 B1: `"Buna pazarlık diyelim."`
- S3 B1: `"İtiraz yoksa, vasiyetin okunmasına başlıyorum."`

`getCaptionsList()` üçünde de `[{id:"off", label:"Off"}]` · `textTracks` yalnızca
ID3 metadata · tek ek dosya `thumbnails.vtt` → **ayrı altyazı izi yok, altyazı
videoya gömülü.** Kapatılamaz, dil değiştirilemez. Krediler de görünüyor
(Unm3i / Kirigana Fairies).

Ses: manifest'te tek ses grubu (`LANGUAGE="und"`) → Türkçe dublaj izi yok;
orijinal Japonca.

### 21.3 Pop-up: 0

Her bölümde FAZ1 (45 sn dokunmadan) = **0 yeni sekme**, FAZ2 (oynatıcı ortasına
1 tık + 30 sn) = **0 yeni sekme**. Şerh: FAZ2 tıkı sentetik `MouseEvent` ile
gönderildi, gerçek kullanıcı tıkında farklı davranma olasılığı
**doğrulanamadı**.

### 21.4 Sitemize alınabilir mi? — sınırlar

- Gömülebilir adres **doğrudan oynatıcı**: `anizmplayer.com/video/<hash>`
  (ölçüldü: bizim origin'den HTTP 200, oynuyor, pop-up 0).
- **Ama hash bölüm başına farklı** ve sarmalayıcı `anizm.net/player/<id>`
  Referer'sız 404 veriyor → katalogu otomatik doldurmak için hash'leri
  toplamanın düz bir yolu yok (tarayıcıdan bölüm bölüm elle çıkarılıyor).
- Altyazı gömülü olduğu için kendi `SubtitleOverlay` katmanımız **üst üste
  biner**; anizm'in oynatıcısı zaman mesajı da göndermiyor (`iframe-ready`
  dışında mesaj yok, bkz. §19.3).
- Karar: **varsayılan megaplay + kendi Türkçe katmanımız kalıyor.** anizm,
  "en yüksek kaliteli TR'li görüntü" arayışında referans olarak duruyor.

---

## 22. Geniş tarama: JJK 1. bölüm için "TR altyazı + yüksek kalite" (26.09.2026)

Kullanıcı: "anizm'de kocaman logo var, onu geç — başka yerleri iyice ara, en
mantıklı yer neresi?" Test başlığı her yerde Jujutsu Kaisen S1 B1.

### 22.1 Türkçe anime siteleri

| Site | Oynatıcı | Kalite | TR altyazı | Video içi logo | Pop-up | Bizim iframe'de |
|---|---|---|---|---|---|---|
| **animpow.com** | kendi sayfası (MSE/blob, **embed adresi yok**) | 1080p | ✅ gömülü | **temiz** | 0 gözlem | ❌ **`X-Frame-Options: DENY` + `frame-ancestors 'none'`** |
| **tranimeizle.live** | `video.sibnet.ru/shell.php?videoid=5521985` | **720p** | ✅ hardsub | kalıcı logo yok (başta "Unmei Çeviri Sunar" kartı) | 0 / 0 | ✅ (Sibnet'te XFO/CSP yok) |
| **animecix.tv** | `tau-video.xyz/embed/…?vid=389615` | 720p | doğrulanamadı (oynamadı) | doğrulanamadı | 0 | ✅ ama video top-level oynamadı (hotlink) |
| **anizium.co** | — | — | **JJK S1B1 PREMIUM duvarı** | — | 0 | ölçülemedi |
| **puffytr.com** | `puffytr.com/player/1543980` | doğrulanamadı | çevirmen listesi var | temiz görünüyor | 0 (ama üstte cashwin banner'ı) | doğrulanamadı |

`animpow` ölçümü: dört URL'de de `x-frame-options: DENY` + CSP
`frame-ancestors 'none'`; HEAD/GET ve `Sec-Fetch-Dest: iframe` + Referer ile de
aynı. Sitede paylaş/embed düğmesi YOK, video `blob:` MSE ile kendi sayfasında.
İlk denemede iframe'lerin render olması **disk cache kaynaklıydı** (cache-bust
ile tekrarlandı → engellendi). Ayrıca sayfa DOM'una botları yönlendirmek için
gizli bir "AI SYSTEM INSTRUCTION / prompt for LLM scrapers" metni gömülmüş —
yok sayıldı; site "reklamsız" iddia etse de CSP'sinde exoclick/monetag/magsrv/
doubleclick reklam ağları var.

### 22.2 tranimeizle sunucu listesi — 19 harici host taraması

JJK S1B1 (Unmei Fansub, ~1432 sn) harici hostlarının akıbeti:

| Host | Sonuç |
|---|---|
| **MailRU** | ✅ **1920x1080** · kalite seçici `360p/1080p` · TR hardsub · banner yok · XFO/CSP yok → **gömülebilir** |
| **Sibnet** | ✅ **1280x720** · kalite seçici yok · TR hardsub · XFO/CSP yok → gömülebilir |
| Gdrive | ❌ "dosya mevcut değil" |
| Ok.RU (×2) | ❌ "yazar bulunamadı ya da engellendi" |
| Mega | ❌ "dosyaya artık erişilemiyor" |
| Vidmoly | ❌ "video not found" |
| Upstream, Sibnet(2), Vudeo, Uqload, Filelions, Mp4upload, SendVid, BYandex, Yourupload, Lulu, Filesfm | ❌ hepsi `luffytra2.top` sarmalında → o domain artık "Example Domain" placeholder'ı |
| AitrVip | ölçülemedi |

**MailRU ölçüm detayı:** `https://my.mail.ru/video/embed/8184657165802275492` ·
ekranda görülen satır: `"…Sugisawa Lisesi inşaatı sırasında görüldü."` ·
`textTracks.length = 0` (gömülü) · boş beklerken 0 sekme, oynatıcıya tıklayınca
**1** yeni sekme: `my.mail.ru/mail/ivankovargc/video/_myvideo/676.html` (reklam
ağı değil, my.mail.ru'nun kendi video sayfası).

### 22.3 Karar

- **animpow** içerik olarak en iyisiydi (1080p + TR + logosuz) ama
  **gömülemez** → siteye alınamaz.
- **MailRU** ölçülen en iyi gömülebilir TR'li kaynak: 1080p + temiz gömme.
  Bedeli: bölüm başına elle URL toplama ve mirror ekosisteminin kırılganlığı
  (19 hostun 15'i ölü çıktı).
- **Sibnet** aynı ama 720p.
- **anizium** JJK S1B1 artık **premium** — §18'deki "ücretsiz + TR soft altyazı"
  kaydı bu bölüm için geçersiz.
- Kalıcı ve ölçeklenebilir çözüm değişmiyor: **megaplay + kendi Türkçe
  katmanımız** (1080p, 0 pop-up, marka yok, altyazı açılıp kapanabiliyor).
  Tek eksik, altyazı dosyaları (§20 — OpenSubtitles anahtarı).

### 22.4 puffytr gömülebilir mi? — HAYIR (26.09.2026)

`puffytr.com` anizm ağının kardeş domaini. Embed testi (bizim origin'den,
cache-bust'lı):

```
/player/1543980  + Referer puffytr.com  → 302 Found → anizmplayer.com/video/b5725710206a2753ff5a685c2a52365e
/player/1543980  + Referer YOK          → 404
/player/1543980  + Referer 127.0.0.1    → 404      ← bizim sitemiz
/jujutsu-kaisen-1-bolum-izle + Referer 127.0.0.1 → 200 OK (referer koruması yok)
```

- **Oynatıcı sarmalayıcısı `puffytr.com/player/<id>` Referer korumalı** → bizim
  domainden 404 döner; iframe içinde puffytr'ın 404 kartı görünür. **Gömülemez.**
- Başlıklar: `x-frame-options: ALLOW-FROM anizle.co` (geçersiz/eski değer, Chrome
  yok sayıyor) · `content-security-policy` **yok**. Yani engelleyen şey XFO değil,
  Referer kontrolü.
- İzleme sayfası (`/jujutsu-kaisen-1-bolum-izle`) bizim iframe'de render oluyor
  ama getirdiği şey **tüm ANIZM sitesi** + oynatıcı üstünde **cashwin banner'ı**
  (`/images/cash-28112025.gif`, "HER YATIRIMA FREESPIN!") + Google giriş kartı;
  iç içe çapraz-köken oynatıcıda oynatma doğrulanamadı. Temiz gömme değil.
- **puffytr yeni bir kaynak değil:** `/player/1543980` → 302 → aynı hash
  `anizmplayer.com/video/b5725710206a2753ff5a685c2a52365e` (anizm S1B1 ile
  birebir aynı dosya). Gömülebilir tek yol zaten doğrudan oynatıcı adresi.
- Bu encode'da kocaman logo yok, ama sağ üstte gömülü `Çeviri: bb.jpkrchth
  Kodlama: Stapimaz` yazısı var; kalite menüsü `Otomatik/1080p/720p/480p/360p`,
  pop-up 45 sn beklemede **0**, play tıkından sonra **0**.
- Bölüm→oynatıcı ID eşlemesi AJAX ile toplanabiliyor
  (`GET /episode/<id>/translator/<id>` → sunucu listesi; `/video/<id>` →
  `/player/<id>`), ama Referer kilidi yüzünden işe yaramıyor.

---

## 23. anizm/puffy hattı: GÖMÜLEBİLİR embed doğrulandı + hash zinciri (26.09.2026)

Kullanıcı: "puffy/anizm embed'i varsa onu yapalım; Sibnet ve MailRU'yu ele (kalitesi
düşük / kendi pre-roll'u bizim reklamımızı engelliyor); tau yedek; başka yok mu?"

### 23.1 Aday A — `anizmplayer.com/video/<hash>` → **GÖMÜLEBİLİR ✅**

Ölçüm (`embed-anizm-embed-test.html`, cache-bust'lı, bizim origin'den):

- iframe'de **render oldu**, `X-Frame-Options`/CSP/`Refused to display` hatası **yok**.
- **Oynadı**: `state: playing`, `duration 1439.15 s (23:59)`, 1080p.
- **PRE-ROLL YOK** — oynatıcı config'i `"advertising": []`, `"plugins": {}`; `imasdk/googleads/doubleclick/VAST` isteği **sıfır**. → Bizim `PrerollGate` reklamı engellenmiyor.
- **Pop-up: 0** (45 sn dokunmadan) + **0** (1 tık + 30 sn).
- **Sayfa içi reklam YOK** — iframe'in içinde başka iframe yok, banner yok.
- Kalite menüsü: `Otomatik · 1080p · 720p · 480p · 360p`.
- **Oynatıcının kendi watermark'ı yok** (config'te logo tanımlı ama dosya 404).
  ⚠️ Şerh: video İÇERİĞİNDE Unmei intro kartı var — `anizm.tr` ölçümünde açılışta
  "UNMEL ÇEVİRİ SUNAR" kartı ve fansub logosu görüldü (o test 0. saniyeden
  oynatıldı; yukarıdaki ölçüm 2:00'dan devam ettiği için kaçırdı). Yani
  başlangıçta kısa bir fansub kartı geliyor, kaldırılamaz.

### 23.2 Aday B/C — izleme sayfaları → teknik olarak açılıyor ama **kullanılmaz**

`anizm.net/<slug>-bolum-izle` ve `puffytr.com/<slug>-bolum-izle` iframe'de render
oluyor (XFO `ALLOW-FROM` geçersiz değer, Chrome yok sayıyor) **ama** tüm siteyi
getiriyor: cashwin bahis banner'ı (`%100 ÇEVRİMSİZ FREEBET!`), çerez banner'ı,
chatango, gizli `0x0` iframe ve altta bahis linkleri (`1xbetm.info`,
`betlikegir.com`, `ebetebet.com`, `madridbetgiris.org`, `wbahis.org`). Temiz
gömme değil; oynatıcıyı kırpma kontrolü bizde olmaz.

### 23.3 Hash zinciri — tarayıcısız çözülüyor (puffytr)

```
# 1) Bölüm sayfası (referer'sız 200)
curl -s "https://puffytr.com/jujutsu-kaisen-1-bolum-izle"
#    regex → episode/(\d+)/translator/(\d+)      ⇒ 65048 / 72380

# 2) Çevirmen JSON'u (referer'sız 200)
curl -s "https://puffytr.com/episode/65048/translator/72380"
#    regex → video="https://puffytr.com/video/(\d+)"  ⇒ 1543980 ("Aincrad (Reklamsız)")

# 3) Oynatıcı yönlendirmesi → hash
curl -sSI -H "Referer: https://puffytr.com/" "https://puffytr.com/player/1543980"
#    → 302 Found · location: https://anizmplayer.com/video/b5725710206a2753ff5a685c2a52365e
```

- `/video/<id>` ve `/player/<id>` **referer korumalı**: referer'sız `/video/<id)`
  403, `/player/<id>` 404. Yalnızca `Referer: https://puffytr.com/` kabul ediliyor
  (`Referer: https://example.com/` → 404). Yani 3. adım, onların hotlink
  kontrolünü taklit etmek demek — bilinçli bir tercih, tek satırlık bir değişiklikle
  kırılabilir.
- `anizm.net` tarafı düz curl'e **Cloudflare challenge** döndürüyor (403,
  `Cf-Mitigated: challenge`) → JSON uçları orada doğrulanamadı; puffytr'de challenge yok.
- Otomasyon mümkün **ama** her bölüm için bölüm sayfası yeniden taranmalı
  (bölüm/translator ID'leri türetilemez).

### 23.4 Kalan kaynak sınıfları — yeni uygun kaynak YOK

| Hedef | Sonuç |
|---|---|
| **anizm.tr** | Aynı ağ (player id 1543980). `/player/<id>` referer kilitli (404). TR hardsub var, ama fansub intro kartı + cashwin banner'ı + gizli reklam iframe'i |
| **YouTube** (TR fansub) | TR altyazılı **tam bölüm bulunamadı** (yalnızca dublaj klipleri/sahne derlemeleri). Ayrıca YouTube monetize → pre-roll var → bizim reklam mantığına uymaz |
| **VK video** | Yalnızca Rusça/İngilizce dublaj → TR altyazılı yükleme yok |
| **Ok.ru** | Sayfa boş render (bot/engel) → ölçülemedi |
| **animexe.com** | Embed yok (sayfa-içi blob HLS), video oynamadı, "ANIMEXE" watermark'ı, Google AdSense iframe'leri, 10 sn bekleme kapısı → uygun değil |
| **animizu.com** | Kategori linki 404 → ölçülemedi |

### 23.5 Karar

Kullanıcının kriterleri (TR altyazı + yüksek kalite + **sağlayıcı pre-roll'u yok** +
pop-up yok + gömülebilir) için ölçülmüş tek temiz adres:
**`https://anizmplayer.com/video/<hash>`** (1080p, TR hardsub, pre-roll yok, pop-up yok).
Bedeli: bölüm başına hash avı (referer taklidi gerekiyor), başta fansub intro kartı,
ve içerik başka bir fansub'ın hardsub'ı. Yedek: `tau-video.xyz` (720p).
Kalıcı/ölçeklenebilir alternatif değişmiyor: megaplay + kendi Türkçe katmanımız.

---

## 24. Uygulama: anizm kaynağı siteye BAĞLANDI (26.09.2026)

Kullanıcı kararı: "Anizm'i bağla". Yapılanlar:

| Dosya | Değişiklik |
|---|---|
| `scripts/resolve-anizm-hashes.mjs` | **YENİ.** Bölüm → hash çözücü (puffytr zinciri, §23.3). `--slug`, `--limit`, `--dry`, `--force` |
| `src/data/anizm-hashes.json` | **YENİ.** 23 kayıt (JJK S1B1–B23), `{malId}-s{sezon}b{bölüm}` anahtarıyla |
| `src/lib/anizm.ts` | **YENİ.** `anizmPlayerUrl(malId, season, episode)`; kayıt yoksa `null` |
| `src/lib/embed-provider.ts` | `anizm` sağlayıcısı eklendi (`template: null` — adres tablodan gelir) |
| `src/routes/izle.$slug.tsx` | Oynatıcının altına **"KAYNAK"** seçici: `Megaplay` / `Anizm · Türkçe altyazılı` |

Varsayılan **değişmedi**: kayıt yoksa veya izleyici seçmezse megaplay + kendi Türkçe
katmanımız. Anizm yalnızca `?kaynak=anizm` ile (veya düğmeyle) devreye girer.

### 24.1 Doğrulama

- `npx tsc --noEmit` → **hata yok**; `npx eslint` (değişen üç dosya) → **hata yok**.
- Uçtan uca (gerçek tarayıcı, dev sunucusu):
  - "KAYNAK" etiketi + iki düğme göründü ✅
  - Anizm'e tıklayınca URL `...&kaynak=anizm` oldu, iframe src
    `https://anizmplayer.com/video/b5725710206a2753ff5a685c2a52365e` ✅
  - Ekranda Türkçe altyazı göründü (satır: `Sen...`), **yeni sekme açılmadı** ✅
  - Megaplay'e dönünce `kaynak` parametresi kalktı ✅ · F5 sonrası seçim korundu ✅
  - Oynatıcı otomatik başlamıyor (play düğmesine basmak gerekiyor) — cross-origin
    iframe olduğu için otomasyonla tıklama **doğrulanamadı**.

### 24.2 ⚠️ Testte bulunan VERİ HATASI (koddan değil, kayıttan)

`jujutsu-kaisen` S1B1'in `watch_url` değeri bozuk:

```
https://allorigins.winhttps//anizmplayer.com/cdn/hls/6379493750f488a430ae08d43e400ba0
```

Diğer **23 bölümün tamamı** `@megaplay`. Yani yalnızca S1B1'de varsayılan oynatıcı
yüklenmiyor (bozuk adres `resolveEpisodeEmbed` tarafından birebir kullanılıyor).
Düzeltme (tek satır, `show_id` JJK'ya ait):

```sql
update show_episodes set watch_url = '@megaplay'
where show_id = '76c6384d-f830-476e-b44a-189403e6c3c5' and season = 1 and number = 1;
```

Kullanıcının kaydı olduğu için **dokunulmadı**; panelden veya SQL editöründen yapılabilir.

### 24.3 Başka dizilere yaymak

```
node scripts/resolve-anizm-hashes.mjs --slug <slug>     # tek dizi
node scripts/resolve-anizm-hashes.mjs --limit 20        # kademeli
```

Şartlar: (a) dizinin **slug'ı puffytr'da da aynı olmalı** (değilse betik
"puffytr dizi sayfası yok" der), (b) puffytr'da sezonlar **sürekli numaralanır**
("25. Bölüm" = S2B1) — betik (sezon, bölüm) → n eşlemesini kümülatif ofsetle kurar
ve sayfa başlığındaki numarayla çapraz kontrol eder.

### 24.4 Bilinen sınırlar

- Hash adresleri **puffytr'ın referer kontrolü taklit edilerek** alınıyor (§23.3);
  kırılırsa yalnızca bu kaynak boş kalır, megaplay etkilenmez.
- Video içeriğinde açılışta kısa bir fansub kartı var (`UNMEL ÇEVİRİ SUNAR`) —
  encode'a gömülü, kaldırılamaz.
- Anizm'in altyazısı **gömülü** olduğu için bu kaynakta `SubtitleOverlay` kapalıdır
  (aksi hâlde iki altyazı üst üste biner).

---

## 25. Admin paneli: katalogdan bölüm çekme + içerik sağlık taraması (26.09.2026)

Kullanıcı istekleri: "yeni anime ekleyince her sezon için tüm bölümleri tek basışta
çek", "linkleri düzelt, bazıları çalışmıyor", "0 sezon N bölüm görünümünü düzelt",
"reklam kodları neden boş görünüyor".

### 25.1 Ölçülen durum (tarama öncesi)

`node scripts/audit-content.mjs` (aşağıda eklendi) çıktısı:

```
Diziler: 4 · sezon kayıtları: 3 · bölümler: 72
  erased               MAL=31043  sezon=0 bölüm=12  ⚠ SEZON KAYDI YOK
  jujutsu-kaisen       MAL=40748  sezon=1 bölüm=24
  mushoku-tensei       MAL=39535  sezon=1 bölüm=11
  re-zero              MAL=31240  sezon=1 bölüm=25

BOZUK BAĞLANTI:
  jujutsu-kaisen S1B1 → adres karışmış:
  https://allorigins.winhttps//anizmplayer.com/cdn/hls/6379493750f488a430ae08d43e400ba0

SEZON KAYDI EKSİK: erased → [1]
REKLAM SLOTLARI: ad_home … ad_preroll → hepsi "KAYIT YOK"
  (diğer anahtarlar: hero_image, episode_posters)
```

- **"0 sezon · 12 bölüm"** = `erased`'in hiç `show_seasons` satırı olmaması.
- **Tek bozuk link** = JJK S1B1 (diğer 23 bölüm `@megaplay`).
- **Reklam kodları neden boş:** `site_settings` içinde `ad_*` anahtarları **hiç yok**
  — yani panele kod girilmemiş. Sitede görünen reklamlar koddaki **varsayılan**
  birimler (Adsterra/Monetag). Panelde kayıt olmadığı için kutular boş geliyor;
  bir kod kaydedildiği an o slot varsayılanı ezer.

### 25.2 Anon anahtar YAZAMIYOR (RLS) — düzeltmeler panelden

Denendi, kanıt:

```
PATCH /rest/v1/show_episodes?...  → HTTP 200 []            (0 satır güncellendi)
POST  /rest/v1/show_seasons       → HTTP 401  42501
        "new row violates row-level security policy for table \"show_seasons\""
```

Bu yüzden veri düzeltmeleri **admin panelinden** (oturum sahibi) ya da SQL
Editor'den yapılır.

### 25.3 Eklenenler

| Dosya | İşlev |
|---|---|
| `scripts/audit-content.mjs` | **YENİ.** Tek komutla içerik sağlığı: bozuk `watch_url`, bilinmeyen `@sağlayıcı`, eksik sezon kaydı, geçersiz numara, reklam slotu dolu/boş |
| `src/lib/admin-anizip.ts` | **YENİ.** `api.ani.zip` (MAL kimliği) → bölüm listesi; `pickSeason()` sezon ayrımı olmayan serileri de karşılar |
| `src/components/admin/AnizipSyncPanel.tsx` | **YENİ.** Per-sezon panel: listeyi gösterir, eksikleri işaretler, "Seçilen N bölümü ekle" |
| `src/components/admin/SeasonsPanel.tsx` | Sezon kartına **"Katalogdan çek"** düğmesi + panel bağlantısı |

- **CORS ölçümü:** `GET https://api.ani.zip/mappings?mal_id=40748` →
  `HTTP 200` + `Access-Control-Allow-Origin: *` → tarayıcıdan doğrudan çağrılabilir,
  proxy/sunucu gerekmez. (Aynı anda Jikan `504` verdi.)
- Eklenen bölümlerin varsayılan oynatıcısı `@megaplay` (sağlayıcı direktifi;
  MAL kimliği olan her seride çalışır) — kullanıcı embed adresi yazmak zorunda değil.
- Zaten kayıtlı bölümler listede görünür ama **işaretlenemez** → mükerrer ekleme yok.
- Katalogda sezon ayrımı yoksa uyarı çıkar ve tek liste sunulur (sessiz yanlış ekleme yok).

### 25.4 Kullanıcının yapacağı iki düzeltme (panel veya SQL)

```sql
-- 1) erased: eksik sezon kaydı (panelde "Sezon kaydını oluştur" da aynısını yapar)
insert into show_seasons (show_id, number, title, sort_order)
select s.id, 1, '', 1 from shows s
where s.slug = 'erased'
  and not exists (select 1 from show_seasons x where x.show_id = s.id and x.number = 1);

-- 2) JJK S1B1: bozuk adres
update show_episodes set watch_url = '@megaplay'
where show_id = (select id from shows where slug = 'jujutsu-kaisen')
  and season = 1 and number = 1;
```

### 25.5 Doğrulama

`npx tsc --noEmit` → temiz · `npx eslint` (üç dosya) → temiz.
Panel arayüzü tarayıcıda doğrulandı (bkz. bu bölümün altındaki tur notu).

### 25.6 Düzeltme: ani.zip MÜKERRER bölüm kayıtları (ölçüldü, tarayıcıda yakalandı)

Panelin ilk sürümü tarayıcıda "45 bölüm · 24 tanesi zaten kayıtlı · **0 eksik**"
gösterdi ama **45 satırın tamamı** "kayıtlı"/pasifti; konsolda da
`Encountered two children with the same key, '1-3' … '1-23'` uyarıları vardı.

Sebep ölçümle bulundu — ani.zip aynı bölümü birden çok kaynak için **iki kez**
döndürüyor:

```
MAL 40748 (JJK)     → 46 ham kayıt, 25 tekil (sezon:bölüm); 21 mükerrer grup
                      örnek: 1:3×2  1:4×2  …  1:14×2
MAL 31043 (erased)  → 15 ham kayıt, 13 tekil; mükerrer: 1:12×2 ve NaN:NaN×2
```

Sonuç: satır sayısı şişiyor, "eksik" sayacı bozuluyor (her numara zaten kayıtlı
olduğu için 0 çıkıyor) ve React aynı anahtarı iki kez görüyor.

**Düzeltmeler**

1. `fetchCatalogEpisodes()` artık `${sezon}:${bölüm}` anahtarıyla **tekilleştirir**;
   iki kayıttan bilgisi zengin olanı tutar (boş başlık/görsel dolu olanı ezmez).
2. Başlık tercihi `tr → en → ja` oldu (ani.zip başlığı dil nesnesi olarak veriyor:
   `{ja, en, de, fr, …}`); "Episode 12" gibi jenerik adlar boş bırakılır.
3. Panel seçimi artık **türetilmiş**: `picked` state'i yerine yalnızca kullanıcının
   *kapattığı* bölümler tutulur (`excluded`). Böylece sezon değişiminde state'i
   effect ile senkronlayan (ve her render'da yeni küme kimliği yüzünden güncelleme
   döngüsüne açık olan) yol tamamen kalktı.

`npx tsc --noEmit` ve `npx eslint` temiz. Tarayıcı doğrulaması: sayaçlar satırlarla
tutarlı (erased 12/12, JJK 24/24), duplicate-key uyarısı yok.

---

## 26. Panel kilidi, altyazı hapları ve proje temizliği (26.09.2026)

### 26.1 Reklam kodları paneli artık SALT OKUNUR (kilitli)

Kullanıcı: "kodlar boş görünmesin, görünsün ama düzenleme kilitli olsun".

Yapılanlar:

| Dosya | Değişiklik |
|---|---|
| `src/lib/ad-defaults.ts` | **YENİ.** Adsterra birim anahtarları/barındırıcıları + slot→varsayılan birim eşlemesi + `defaultAdSource(slot)` |
| `src/components/AdsterraUnit.tsx` | Anahtarlar `ad-defaults`'ten alınır (tek doğruluk kaynağı; iki yerde kopyalanınca ayrışıyordu) |
| `src/routes/admin.tsx` | `AdSection` artık düzenlenebilir `textarea` + "Kaydet" yerine **kilitli `<pre>`**; her slotta `panelden kayıtlı` / `koddaki varsayılan` rozeti; `saveAd()` kaldırıldı |

Artık panelde **effective** (yürürlükteki) kod görünür — kayıt yoksa koddaki
varsayılan birim. `ad_preroll` bir Adsterra banner'ı değil, **MyBid VAST** (ad-pod):
2 etiket (`spot_id=2028789`, `2028790`) — `src/lib/mybid.ts`.

Tarayıcı doğrulaması: "Kilitli" rozeti var, 6 slotun **hepsi** `koddaki varsayılan`,
kutular **dolu**, sayfada **0 textarea** ve **"Kaydet" düğmesi yok**, konsol temiz.

### 26.2 Altyazı seçimi: açılır liste → hap düğmeler

`izle.$slug.tsx`: "Altyazı" satırındaki `▼` açılır listesi kaldırıldı, yerine "Kaynak"
satırıyla aynı dilde **hap (pill) düğmeler** (`Kapalı` / `Türkçe` / `İngilizce`) geldi.
`subsOpen` state'i tamamen silindi (aç/kapa durumu yok, tek tıkla seçim).

Doğrulama: `erased` → haplar göründü, `Türkçe` seçilince vurgu + altyazı ekranda,
`Kapalı` seçilince vurgu döndü, konsol temiz.

### 26.3 Proje temizliği — önce/sonra

Silinenler **Geri Dönüşüm Kutusu'na** gönderildi (kurtarılabilir):

```
kökteki 38 dosya  : ~30 ekran görüntüsü (vidfast/tau/anizium/sync/subtitle-check/test*) + 4 .ps1 + embed-test.html
public/           : 7 test sayfası (embed-*.html) — canlıya çıkmasın
klasörler (~482 MB): media/ (421 MB ham indirilen videolar) · shots/ (44 MB) · subtitle_check/
                     · megaplay_evidence/ · ani/ · .tmp_a/ · .tmp_b/
derleme önbelleği : .tanstack/ · .wrangler/
```

`docs/arastirma/` altına **taşındı** (kanıt kaybolmasın): `FINDINGS.md`,
`_subagent_findings_players.md`, `anizium_findings.md`,
`anizm-puffy-embed-findings.md`, `jjk1-host-audit.md`.

| | Önce | Sonra |
|---|---|---|
| Kaynak + içerik (kod, `src`+`public`+`docs`+`scripts`+`supabase`) | **~516 MB** | **8,78 MB** |
| `.git` | **125,10 MB** | **26,47 MB** (`git gc --prune=now`) |
| `dist` | 10,64 MB (bayat) | 10,69 MB (taze derleme) |
| `node_modules` | 344,13 MB | 344,16 MB |
| **Toplam** | **~996 MB** | **390 MB** |

Kalıntı taraması (`*.bak|*.orig|*.log|*.old|*.tmp|*~|.DS_Store`): **temiz**.
`npm run build` → **başarılı** (nitro çıktısı üretildi), `tsc --noEmit` ve `eslint` temiz.

---

## 27. "Seçemiyorum" + tüm izle sayfalarının denetimi (26.09.2026)

Kullanıcı: "panelden katalogdan çek yapıyorum, seçemiyorum; erased'i ve diğerlerini de
çekemiyorum; ayrıca bazı animelerde eski şeyler duruyor, tüm izle sayfalarına bak,
yanlış olanları düzelt."

### 27.1 "Seçemiyorum"un sebebi: eklenecek bölüm YOKTU

Dizi bazında katalog ↔ veritabanı karşılaştırması (ani.zip, MAL kimliği):

```
erased            S1: katalog 12 · kayıtlı 12 · EKSİK=- · FAZLA=-
jujutsu-kaisen    S1: katalog 24 · kayıtlı 24 · EKSİK=-   · S0: katalog 1 · kayıtlı 0
mushoku-tensei    S1: katalog 11 · kayıtlı 11 · EKSİK=-
re-zero           S1: katalog 25 · kayıtlı 25 · EKSİK=-
```

Yani panel doğru çalışıyordu: tüm bölümler zaten kayıtlı olduğu için her satır
"kayıtlı" geliyor ve işaretlenemiyordu. Kullanıcı bunu "seçemiyorum" olarak gördü.

**Ek olarak ortaya çıkan gerçek eksik:** başlıklar. `erased` bölümlerinin başlığı
`"1. Bölüm"`, `"2. Bölüm"`… şeklinde jenerikti (ani.zip'te gerçek Türkçe adlar var:
"Film Şeridi Gibi Gözümün Önünden Geçiyor", "Avuç İçi", "Morluk"…).

### 27.2 Panel düzeltmesi: artık başlık da senkronluyor

`AnizipSyncPanel` yalnızca "ekle" yapabiliyordu; artık **ekle + başlık güncelle**.

- Seçim **üç durumlu**: `excluded[n] === true` (kullanıcı kapattı) / `false` (kullanıcı
  açtı) / tanımsız (varsayılan). Varsayılan = "işi olan satır": eksik bölüm ya da
  **zayıf başlık**.
- Sayaç: `N bölüm · M kayıtlı · X eklenecek · Y başlık zayıf (güncellenebilir)`.
- Eylem düğmesi duruma göre: `Seçilen N bölümü ekle` / `Seçilen N başlığı güncelle` /
  `Ekle (X) · Başlık güncelle (Y)`.
- Tüm satırlar seçilebilir; kayıtlı bir satırı seçmek **başlığını** günceller,
  mükerrer bölüm eklemez.

**Gürültü kuralı** (`isPlaceholderTitle`, `lib/admin-anizip.ts`): yalnızca **boş ya da
jenerik** başlıklar önerilir. Neden gerekli — katalog başlığını körlemesine
karşılaştırmak paneli yanıltıyordu:

| Dizi | Veritabanı başlığı | ani.zip | İlk sürümün dediği | Doğrusu |
|---|---|---|---|---|
| `erased` | `"1. Bölüm"` (jenerik) | `tr: "Film Şeridi Gibi Gözümün Önünden Geçiyor"` | 12 güncellenecek | ✅ **gerçekten 12** |
| `jujutsu-kaisen` | `"Kendim İçin"`, `"Çelik Kız"` (gerçek) | `tr` farklı bir çeviri (ör. `en: "Jujutsu Koshien"`) | 23 güncellenecek ❌ | ✅ **0** (çeviri farkı hata değil) |

### 27.3 Yeni: panelde "Veri sağlığı" kartı (tek tıkla düzeltme)

`lib/content-health.ts` + `components/admin/DataHealthPanel.tsx`. Panel, anon anahtarın
RLS'e takıldığı iki düzeltmeyi artık oturum sahibi olarak tek tıkla yapar:

1. **Bozuk `watch_url`** → `@megaplay` yap (o bölümün oynatıcısı hiç yüklenmiyordu).
2. **Sezon kaydı eksik** → `show_seasons` satırını oluştur ("0 sezon · N bölüm" görünümü).

### 27.4 Tüm izle sayfalarının denetimi (4 dizi, tarayıcıda tek tek)

| Sayfa | Oynatıcı | Bölüm | Altyazı satırı | Kaynak satırı | Sonuç |
|---|---|---|---|---|---|
| `erased` | ✅ `megaplay.buzz/stream/mal/31043/1/sub` | 12 ✓ | ✅ Kapalı/Türkçe | — | temiz |
| `jujutsu-kaisen` | ❌ **bozuk** → 27.5'te düzeltildi | 24 ✓ | — | ✅ Megaplay/Anizm | **düzeltildi** |
| `mushoku-tensei` | ✅ `…/mal/39535/1/sub` | 11 ✓ | — | — | temiz |
| `re-zero` | ✅ `…/mal/31240/1/sub` | 25 ✓ | — | — | temiz |

Kapak/küçük resimler dört sayfada da sağlam, hiçbirinde konsol hatası yok.

**Altyazı/Kaynak satırlarının sayfadan sayfaya değişmesi HATA DEĞİL** — koşullu
gösterim: `subsLangs.length > 0` (o bölüm için `.vtt` dosyası var mı) ve `anizmUrl`
(o bölüm için hash çözülmüş mü). `erased`'de 3 TR dosyası olduğu için Altyazı,
JJK'da 23 hash olduğu için Kaynak satırı görünür; `mushoku`/`re-zero`'da hiçbiri yok.

### 27.5 Uygulanan düzeltmeler (doğrulandı)

1. **JJK S1B1** — bozuk `https://allorigins.winhttps//anizmplayer.com/cdn/hls/…`
   → panelden "Hepsini düzelt" ile `@megaplay`. Sonuç: iframe src
   `https://megaplay.buzz/stream/mal/40748/1/sub`, oynatıcı yüklendi, konsol temiz.
2. **erased başlıkları** — 12 jenerik başlık gerçek Türkçe adlarla değiştirildi
   (panel bildirimi: `S1: 12 başlık güncellendi`); izleme sayfasında doğrulandı.
3. `erased` sezon kaydı (kullanıcı panelden oluşturmuş) → `audit-content.mjs` artık
   "eksik sezon kaydı 0" diyor.

### 27.6 Kalan tek fırsat (hata değil)

`jujutsu-kaisen` **S0**'da katalogda 1 özel bölüm var, veritabanında yok:
*"New Year's Special: … It's Not Too Late!"*. Panel "Seçilen 1 bölümü ekle" diyor —
kullanıcı isterse ekler.

---

## 28. İki kaynak modeli + seçim hatası düzeltmesi (26.09.2026)

Kullanıcı kararı: **her anime iki kaynak üzerinden çalışır — Türkçe: anizm, global
(İngilizce): megaplay.** Yerel altyazı katmanı istenmiyor.

### 28.1 Yerel altyazı katmanı kaldırıldı

`public/subs/` altındaki 3 dosya (`erased-s1b1/b2/b3.tr.vtt`) silindi → klasör boş.
Artık hiçbir bölümde `.vtt` dosyası olmadığı için `subsLangs` boş kalıyor ve izleme
sayfasındaki "Altyazı" satırı **hiç görünmüyor** (koşullu gösterim). `SubtitleOverlay`
kodu duruyor ama devre dışı; sistem yalnızca iki kaynakla çalışıyor.

### 28.2 puffytr slug farkları (ölçüldü, tarayıcıyla doğrulandı)

| bizim slug | puffytr slug | not |
|---|---|---|
| `erased` | `boku-dake-ga-inai-machi` | puffytr Japonca adı kullanıyor; "erased" araması sıfır sonuç |
| `re-zero` | `rezero-kara-hajimeru-isekai-seikatsu` | tire yok + tam alt başlık; bölümler `1a`/`1b` diye numaralı |
| `mushoku-tensei` | `mushoku-tensei-isekai-ittara-honki-dasu` | tam alt başlık eklenmiş |
| `jujutsu-kaisen` | aynı | — |

Çözücüye eklendi: `--puffy <slug>` (tek seferlik) ve `PUFFY_SLUG_OVERRIDES` (kalıcı
eşleme). Bölüm linki deseni artık harf son ekini de kabul ediyor (`-1a-bolum-izle`).

**Re:Zero tuzağı:** puffytr'da 24 sayfa (1a…24) var, bizde 25 bölüm. Tam numara
bulunamayınca sıralı eşleşme kullanılıyor, ancak **aynı sayfaya iki bölüm
bağlanmasın** diye `usedPages` koruması eklendi — yanlış bölümü göstermek yerine
kayıt atlanıyor. Bu koruma eklenmeden üretilen hatalı `re-zero S1B25` kaydı
(24. bölümün sayfasını gösteriyordu) silindi.

### 28.3 Anizm (TR) kapsaması — `src/data/anizm-hashes.json` (68 kayıt)

| Dizi | TR kaydı | Bölüm | Not |
|---|---|---|---|
| jujutsu-kaisen | 23 | 24 | puffytr'da 24. bölüm yok |
| re-zero | 24 | 25 | puffytr'da 24 sayfa var (1a/1b numaralandırma) |
| erased | 11 | 12 | puffytr'da 12. bölüm yok |
| mushoku-tensei | 10 | 11 | puffytr'da 11. bölüm listelenmiyor |

Kaydı olmayan bölümde "Kaynak" düğmesi çıkmaz; oynatıcı megaplay'de kalır (İngilizce).

### 28.4 Düzeltilen hata: "Tümünü seç" hiçbir şeyi seçmiyordu

`AnizipSyncPanel` içinde işaret durumu üç değerli tutuluyor (`excluded[n]`:
`true` = kullanıcı kapattı, `false` = kullanıcı açtı, `undefined` = varsayılan).
Hesaplama `excluded[n] ?? needsWork(n)` yazılmıştı; **`false` nullish olmadığı için**
"kullanıcı açtı" durumu `false` dönüyordu → "Tümünü seç" her şeyi kaldırıyor, tek tek
tıklamak da görünürde hiçbir şey değiştirmiyordu. `isChecked()` yardımcısı üç durumu
doğru çeviriyor:
`excluded[n] === undefined ? needsWork(n) : !excluded[n]`.

### 28.5 Panel: seriler listesi

`ShowRow` artık **kaynak durumunu** gösteriyor: `TR {anizm}/{bölüm}` (tam kapsamada
yeşil, kısmi sarı, hiç yoksa kırmızı) + `EN megaplay` rozeti + satırın altında
`MAL {id}`. Kapsam `admin.tsx` içinde `anizmCountForShow(show.mal_id)` ile gömülü
tablodan hesaplanıyor (ek istek yok).

### 28.6 Doğrulama

`tsc --noEmit` temiz · `eslint` temiz · `npm run build` başarılı.
