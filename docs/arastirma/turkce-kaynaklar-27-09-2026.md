# Türkçe kaynak araştırması — animecix / turkanime / openanime (27.09.2026)

Kullanıcı isteği: *"animecix, turkanime, openanime bunlarınkini de bul; en ufak reklam bile
olmayan Türkçe altyazıların listesini bul; API'si falan ne yapıyorsan yap ama yeter ki bul.
Sadece anizm yazması çok saçma — her yerde arasın, hepsi."*

Yöntem: yalnızca **okuma amaçlı** HTTP (GET/HEAD) + tarayıcıda sayfa gözlemi. Giriş/ödeme/indirme
yok. Her satır gerçek istekle doğrulandı; doğrulanamayanlar açıkça "doğrulanamadı" diye yazıldı.

---

## 0. Özet tablo

| Kaynak | Durum | Türkçe altyazı | Reklam | iframe'e gömülebilir | Sunucudan çözülebilir |
|---|---|---|---|---|---|
| **anizm / puffytr** | ✅ Zaten entegre (`/api/anizm`) | Gömülü (hardsub) | Yok | ✅ | ✅ |
| **animecix.tv** | ✅ **Çözüldü** (yeni: `/api/animecix`) | Gömülü (hardsub) | Gömülü oynatıcıda yok | ✅ | ✅ **çerez gerekmez** |
| **openanime (openani.me)** | ⚠️ Kısmen | **Altyazı KAPALI (gated)** | MP4 temiz | ❌ Sayfa gömülemez | Kısmen (altyazı hariç) |
| **turkanime.tv** | ❌ **KAPANDI** | — | — | — | — |

**Sonuç:** "Türkçe altyazılı + reklamsız + gömülebilir + sunucudan çözülebilir" dört koşulu
birlikte sağlayan **iki** kaynak var: **anizm/puffytr** ve **animecix.tv**. OpenAnime altyazıyı
şifreli/token'lı veriyor, turkanime kapandı.

---

## 1. animecix.tv — çözüldü ✅

### 1.1 Neden zordu
animecix bir **Angular SPA**. Bölüm sayfasının HTML'i veriyi içermiyor: hem
`/titles/7352/season/1/episode/1` hem `/titles/7352` isteği **aynı 68.008 baytlık kabuğu**
döndürüyor (`<title>AnimeciX - Türkçe Anime Bilgi ve Paylaşım Platformu</title>`, `app-root`);
HTML'de `tau-video` / `iframe` / `plyrFrame` **0 kez** geçiyor. Ana JS paketinde de API host'u
yok — uçlar **lazy chunk**'larda (biri `chunk-C555YVY5.js`).

### 1.2 Uçlar (doğrulandı)

**a) Seri arama** — terim **yolun parçası**, `?query=` DEĞİL:

```
GET https://animecix.tv/secure/search/<urlencoded terim>?limit=20
→ { "results": [ { "id": 7352, "name": "Jujutsu Kaisen", "name_english": "...",
                   "name_romanji": "...", "season_count": 3, "episode_count": 59 } ],
    "query": "jujutsu kaisen", "status": "success" }
```

⚠️ **Tuzak (ölçüldü):** `GET /secure/titles?query=jujutsu%20kaisen` da 200 döner ama terimi
**yok sayar** ve alâkasız bir kayıt verir ("Yuru Camp△", id 7346). Yani "200 döndü" demek
"doğru uç" demek değil — içerik kontrol edildi.

**b) Bölümün oynatıcıları:**

```
GET https://animecix.tv/secure/episode-videos?titleId=7352&season=1&episode=1
→ JSON DİZİSİ (JJK S1B1 için 23 kayıt), her öğe bir çevirmen/kalite:
   { "_id": "64d8a9f2…", "id": 389615, "name": "Tau Video",
     "url": "https://tau-video.xyz/embed/6335c9e6d03cb090cb4c58c1",
     "type": "embed", "quality": "regular", "language": "tr",
     "category": "full", "approved": true, "order": 0 }
```

**c) Gömülecek adres** = `url` + `?vid=` + `id` (site kendi kodunda da böyle kurar:
`buildTauUrl` → `"?vid"` yoksa ekler):

```
https://tau-video.xyz/embed/6335c9e6d03cb090cb4c58c1?vid=389615
```

Bu adres iki bağımsız yolla doğrulandı: (1) tarayıcıda sayfa açılıp `#plyrFrame` iframe'inin
`src`'si okunarak, (2) bu sunucudan `/secure/episode-videos` çağrılarak. İkisi birebir aynı.

### 1.3 Kritik ayrıntı: çerez gerekmiyor
Panelin en büyük riski "acaba oturum ister mi?" sorusuydu. Ölçüm: **istemiyor.**

```
GET https://animecix.tv/secure/episode-videos?titleId=7352&season=1&episode=1
   (yalnızca masaüstü User-Agent; çerez yok)
→ HTTP 200, gövde yukarıdaki JSON
```

### 1.4 Bu projeye giren hâli
`src/routes/api.animecix.ts` yazıldı. İki mod:

- `GET /api/animecix?search=<seri adı>` → panelin seriyi eşlemesi için aday listesi
- `GET /api/animecix?titleId=<id>&season=<s>&episode=<e>` → `best` + tüm `candidates`

Doğrulama (yerel dev sunucusu, 8080):

```
/api/animecix?search=jujutsu%20kaisen
  → ok:true, results[0] = { id:7352, name:"Jujutsu Kaisen", seasons:3, episodes:59 }

/api/animecix?titleId=7352&season=1&episode=1
  → ok:true, best = "https://tau-video.xyz/embed/6335c9e6d03cb090cb4c58c1?vid=389615"
  (23 aday)

/api/animecix?titleId=7352&season=9&episode=99
  → ok:false, "bu bölüm için animecix kaydı yok"   ← negatif kontrol
```

**Yazarken yapılan hata (kayda değer):** ilk denemede adres deseni `…embed/<hash>$` ile
sonu sabitlenmişti; `?vid=` eklenince eşleşmedi ve rota "gömülebilir kayıt yok" dedi.
Desen `(?:\\?vid=\\d+)?$` yapıldı. Yani **"adres üretildi" ≠ "adres doğrulandı"** —
filtre regex'i üretilen biçimle birlikte test edilmeli.

### 1.5 Gömülebilirlik / reklam
`tau-video.xyz`'te `X-Frame-Options` / CSP `frame-ancestors` **yok** (bkz.
`docs/arastirma/SAGLAYICI-VE-KAPAK-ARASTIRMASI.md` §17.8 — localhost'tan test edildi). Gömülü oynatıcı
720p, Türkçe altyazı **videoya gömülü**, ölçülen pop-up sayısı 0. Reklamlar animecix'in kendi
izleme sayfasında; gömülen oynatıcıda gelmiyor.

---

## 2. openanime (openani.me) — kısmen ⚠️

SvelteKit SSR. İyi haber: **doğrudan MP4** veriyor. Kötü haber: **Türkçe altyazı kapalı.**

### 2.1 Çalışan (doğrulandı)

```
Bölüm listesi : GET https://openani.me/anime/{slug}/{sezon}/__data.json
                → { name, episodeNumber, summary, avatar, airDate }
Bölüm detayı  : GET https://openani.me/anime/{slug}/{sezon}/{bolum}/__data.json
                → episodeData.files[] = { file, resolution, size }, CDN_LINK
Video adresi  : CDN_LINK + slug + "/" + sezon + "/" + file
Örnek         : https://de2---vn-….eu.org/animes/one-piece/1/1-7081593322405367809-720p.mp4
                → 200, Content-Type: video/mp4, CORS: *, Accept-Ranges: bytes
```

⚠️ `CDN_LINK` host'u **istek başına rastgele** (`de2---vn-…`, `do7---ha-…`) — adres her
zaman **aynı yanıttan** okunmalı, sabitlenmemeli.

### 2.2 Neden altyazı kullanılamıyor (doğrulandı)

| Test | Sonuç |
|---|---|
| `api.openani.me/…/subtitles/{fansub}?type=ass` | **401** |
| aynı yol, `?type=vtt` / `srt` / `json` | **401** (hepsi) |
| `openani.me` üzerinde aynı-köken altyazı yolu | **yok** (bilinmeyen yollar bağlantıyı kapatıyor) |
| `__data.json` içinde altyazı/oynatıcı URL'i veya token | **yok** (yalnızca fansub `secureName`) |

Yanıt gövdesi: `{"code":"error.unauthorized","message":"Unauthorized access is denied by
OpenAnime Vanguard."}`. İstemci tarafı altyazıyı `encryptedContent` olarak alıp
`kms.openani.me` üzerinden **çözüyor** — yani altyazı bilinçli olarak kapalı. Bu koruma
**aşılmaya çalışılmadı**.

### 2.3 Gömülebilirlik

`https://openani.me/` ve bölüm sayfası: `X-Frame-Options: SAMEORIGIN` → **başka origin'den
iframe'e gömülemez**. (CSP'de `frame-ancestors` yok; engel XFO'dan geliyor.)

**Karar:** OpenAnime şu hâliyle "Türkçe altyazılı kaynak" olarak kullanılamaz. Yalnızca
altyazısız temiz MP4 kaynağı olarak değerlidir; altyazı gerekiyorsa bizim kendi katmanımız
gerekir — ama metni OpenAnime'den alamıyoruz.

---

## 3. turkanime.tv — KAPANDI ❌

| İstek | Sonuç |
|---|---|
| `GET https://turkanime.tv/` | 200 → `www.turkanime.tv` (aynı sayfa) |
| `GET https://turkanime.net/` | 200 → **bayt bayt aynı** HTML |
| `GET https://turkanime.co/` | 200, `<title>Redirecting...</title>` → park/redirect |

Sayfa başlığı: **"Türk Anime TV — Veda (2010 - 2026) & 2'li Domain Portföyü"**.
Meta açıklama: *"2010'dan 2026'ya 16 yıllık serüven sona eriyor. turkanime.tv ve
turkanime.net alan adları kapalı teklif usulüyle 2'li tek paket halinde devredilecektir."*
Gövdede: *"16 Yıllık Bir Masalın Sonu. Sonsuz Teşekkürler."* Sayfada **dış bağlantı yok**
(0 `<a href>`) → resmî bir ardıl adres duyurulmuyor.

Basında: 21.09.2026 — <https://www.webtekno.com/turk-anime-tv-kapandi-h225004.html>,
ayrıca technopat/reddit/donanım forumu başlıkları (19–24.09.2026).

**Toplulukta dolaşan ayna/ardıl adayları** (`anime-altyazi.vercel.app`, `aniarsiv.com`,
`turk-ani.me`, `turkanimez.com`, `turkanime.com.tr` …): hiçbiri doğrulanmadı; resmî bir
açıklama yok. `turkanime.com.tr` canlı ve "Türkçe Altyazılı Anime İzle" diyor ama
**resmî ardıl mı yoksa klon mu** belirsiz — ayrıca o sitenin bölüm/oynatıcı ucu da
henüz çıkarılmadı.

**Karar:** turkanime şu an bir kaynak değil. İstenirse ardıl adayları ayrı bir turda
incelenir (hangi adres, hangi oynatıcı, altyazı gömülü mü, reklam var mı).

---

## 4. Panel için çıkan yol haritası

Kullanıcı isteği: *"her yerde arasın, sonra çıkan şeylerden seçim hakkı sunsun."*
Buna göre "Türkçe kaynak" artık tek kaynak değil, **sağlayıcı listesi** olmalı:

1. **Anizm / Puffytr** — mevcut zincir (`/api/anizm`), puffytr adresi sezon başına.
2. **Animecix** — `/api/animecix`: seri adından `titleId` bul → sezon/bölüm → `best` aday
   (birden çok çevirmen varsa listeden seçim).
3. Panel, bulunan adayları **liste hâlinde** gösterip hangisinin yazılacağını kullanıcıya
   bırakmalı (tek sessiz seçim yok).
4. Yazma adımı: seçilen adres bölümün `watch_url` alanına yazılır → izleme sayfasında
   oynatıcının altındaki kaynak çipinde görünür.

**Açık kalan tek karar:** animecix `titleId`'si seri başına sabit olduğu için ya her seferinde
adsız arama yapılacak ya da `shows` tablosuna bir `animecix_id` kolonu eklenip bir kez
eşlenecek. İkincisi daha hızlı ve daha az yanlış eşleme riski taşır (migration gerekir).
