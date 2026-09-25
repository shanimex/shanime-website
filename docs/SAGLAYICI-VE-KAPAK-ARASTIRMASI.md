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
| **megaplay.buzz** (mevcut) | Var (MAL id ile) | `/stream/mal/{mal}/{ep}/{lang}` → 200. MAL **40748 (JJK) bölüm 1 → HTTP 410** ("removed due a copyright violation"); MAL 31240 (Re:Zero) bölüm 1 → gerçek oynatıcı yüklendi | Çalışıyor; bazı MAL kimliklerinde 410 |
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
| Başka "hazır anime" servisi var mı? | vidsrc.to anime **desteklemiyor**. vidlink.pro ve videasy nin anime **şu an kırık/erişilemez**. megaplay çalışan tek sağlayıcı, ama bazı MAL kimliklerinde 410. Yeni bir sağlayıcıya geçmek bugün **net bir kazanç sağlamıyor**. |
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
