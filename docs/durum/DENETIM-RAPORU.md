# shanime — Site Denetim Raporu

Tarih: 25.09.2026 · Yöntem: gerçek tarayıcıda 10 sayfa × 2 görünüm (masaüstü 1600×1000, mobil 390×844),
her sayfa yüklemesinden sonra konsol/ağ okuması + DOM ölçümü.

---

## Genel sonuç: temel sağlam

Denetimin en önemli bulgusu **iyi haber**: 

- **Hiçbir sayfada uygulama kaynaklı konsol hatası ya da uyarısı yok** (10/10 sayfa)
- **Kırık görsel yok** (DOM'daki `<img>`'lerin `naturalWidth` kontrolü)
- **Hiçbir sayfada yatay taşma yok** (masaüstü ve mobil)
- **404 gerçekten 404 dönüyor**
- Mobil menü çalışıyor, odak (focus) görünür, `aria-label`'sız metinsiz ikon-buton **0**
- 0 bölümlü seriler doğru boş durum gösteriyor (kırık bölüm listesi yok)
- Oynatıcı iframe'i tam **16:9** (1086×611 masaüstü, 356×200 mobil)

Yani: sayfalar çökmüyor, veri doğru geliyor, düzen bozuk değil. Aşağıdakiler **iyileştirme** kalemleri.

---

## Gerçek hatalar (önem sırasına göre)

### 🔴 1. `/admin` giriş istiyor mu? — DOĞRULANMASI GEREK

Denetimde `/admin` doğrudan açıldı ve tüm yönetim arayüzü (Yeni seri ekle, Kaydet, Reklam kodları,
"Çıkış") göründü; `/auth`'a yönlendirme olmadı.

**Ama bu bir yanlış alarm olabilir:** denetim aracı **senin Chrome'unu** kullanıyor ve o tarayıcıda
zaten açık bir yönetici oturumu var. Kodda kapı mevcut (`isAdmin` kontrolü → yetki yoksa "Yetki yok"
ekranı). **10 saniyelik test:** tarayıcıda **gizli pencere** (Ctrl+Shift+N) aç, `localhost:8080/admin`
adresine git. Karşına giriş ekranı çıkıyorsa güvenlik tamam; **panel açılıyorsa ciddi açık var** ve
hemen düzeltirim.

### 🟠 2. Hero'da kırık logo isteği (404)

Ana sayfa vitrininde Mushoku Tensei slaytı `/static/anime-data/mushoku-tensei/anime-logo.png`
dosyasını istiyor, ama diskteki dosya **`anime-logo.svg`**. Bu yüzden her ana sayfa açılışında
**gereksiz bir 404 isteği** gidiyor. Görsel olarak sorun yok — logo gelmeyince metin başlığa
düşüyor (doğru davranış). Yine de istek boşa gidiyor.

**Çözüm:** logo yüklenemezse bir daha denenmesin (kırık görsel hafızası) ya da dosya adı eşlensin.

### 🟠 3. Mobilde slayt noktaları dokunulamayacak kadar küçük

Hero'daki slayt noktaları **6×6 px** (aktif olan 26×6). Dokunma hedefi en az **24-44 px** olmalı.
Parmakla noktaya basmak neredeyse imkânsız — mobilde slayt seçilemiyor.

**Çözüm (CSS, tek satır):** noktanın görsel boyutu 6 px kalsın ama tıklama alanı
`padding` + `background-clip: content-box` ile 26 px'e çıkarılsın.

### 🟠 4. `h1` eksik (SEO + erişilebilirlik)

`/`, `/izle/jujutsu-kaisen`, `/izle/erased`, `/admin` sayfalarında **hiç `h1` yok**.
Her sayfanın bir `h1`'i olmalı.

### 🟡 5. `/izle/*` sayfa başlığı seri adını içermiyor

Şu an hep `shanime | İzle`. Detay sayfalarında düzelttiğimiz sorunun izleme sayfasındaki hâli —
`Jujutsu Kaisen 5. Bölüm izle | shanime` gibi olmalı.

### 🟡 6. 404 sayfasında site menüsü yok

Sayfa gerçekten 404 dönüyor ✅ ama üst menü/footer yok; kullanıcı sadece "Ana sayfaya dön"
linkiyle baş başa kalıyor. Ayrıca `<title>` "shanime" kalıyor, "Sayfa bulunamadı" ifadesi yok.

### 🟡 7. Küçük dokunma hedefleri (mobil)

- Footer linkleri (Tümünü gör, Bu sezon, Tüm seriler, Türler) → **20 px** yükseklik
- "Yakında" rozeti yazı boyutu **10 px** (4 kartta) — mobilde okunabilirlik sınırında

### 🟢 8. `/auth` input yazı boyutu 14 px

16 px'in altındaki input'lar iOS Safari'de **odaklanınca sayfayı otomatik zoom** yapar.
`16px` yapılması yeterli.

---

## Sayfa tablosu

| Sayfa | HTTP | Konsol | Başarısız istek | Kırık görsel | Taşma | Yükseklik (D / M) |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | 200 | 0 | 1 → `anime-logo.png` 404 | 0 | yok | 2150 / 2684 px |
| `/seri/jujutsu-kaisen` | 200 | 0 | 0 | 0 | yok | 2356 / 2584 px |
| `/seri/erased` | 200 | 0 | 0 | 0 | yok | 1000 / 1073 px |
| `/izle/jujutsu-kaisen` | 200 | 0 | 0 | 0 | yok | 1000 / 844 px |
| `/izle/erased` | 200 | 0 | 0 | 0 | yok | 1000 / 844 px |
| `/admin` | 200 | 0 | 0 | 0 | yok | 1360 / 1967 px |
| `/auth` | 200 | 0 | 0 | 0 | yok | 1000 / 844 px |
| 404 (`/yok-boyle-...`) | **404** ✅ | 0 | 0 | 0 | yok | 1000 / 844 px |
| `/sitemap.xml` | 200 (`text/xml`, 5 URL) | 0 | 0 | – | yok | – |
| `/robots.txt` | 200 (`text/plain`) | 0 | 0 | – | yok | – |

---

## Denetimin yapamadıkları (dürüstçe)

- **Oynatıcı videosunun gerçekten oynadığı doğrulanamadı**: iframe 3. parti (morencius.com), cross-origin.
  Çerçeve ve oran doğru, ama içeride videonun akıp akmadığı tarayıcı tarafından okunamıyor.
- **Yazma işlemleri denenmedi** (bölüm ekleme, silme, yükleme) — veri bozulmasın diye. Bu akışlar
  ayrı bir "fonksiyonel test" turu ister.
- **Gerçek mobil cihaz** değil, masaüstü Chrome'da mobil görünüm kullanıldı.
- Konsoldaki `chrome-extension`, `[vite] connected`, `/api/ext/*` 404 kayıtları **tarayıcı eklentisi**
  kaynaklı — siteyle ilgisi yok, hata değil.

## Önerilen düzeltme sırası

1. `/admin` kapısını doğrula (gizli pencere testi) — güvenlik
2. Hero logo 404'ünü kes
3. Mobil slayt noktalarının dokunma alanını büyüt
4. `h1` eksiklerini ekle
5. `/izle/*` başlıklarına seri + bölüm adı
6. 404 sayfasını site iskeletine al
7. Küçük dokunma hedefleri + "Yakında" yazı boyutu
8. `/auth` input 16 px

---

## Düzeltme turu — durum (aynı gün)

Denetimden sonra 8 maddenin tamamı elden geçirildi. Aşağıda ne yapıldığı ve
doğrulaması var. Doğrulamalar gerçek tarayıcıda ölçümle yapıldı.

| # | Bulgu | Durum | Doğrulama |
| --- | --- | --- | --- |
| 1 | `/admin` giriş kapısı | ✅ **Kapalı değil, güvenli** | Kullanıcı gizli pencerede denedi: e-posta/şifre ekranı çıktı. Denetimdeki görünüm, o an açık olan oturumdandı |
| 2 | Hero logosu 404 | ⚠️ **Gerçek hata bulundu ve düzeltildi**, tek istek kaldı | Aşağıya bak — beklenenden ciddiydi |
| 3 | Mobil slayt noktaları 6×6 px | ✅ Düzeltildi | Tıklama alanı **24×28 px** (aktif 44×28), görsel **6×6 px** değişmedi; mobilde dokunma slaytı değiştirdi |
| 4 | `h1` eksik (`/`, `/izle/*`, `/admin`) | ✅ Düzeltildi | `/` → `shanime — sezonun öne çıkan anime serileri` (SSR'da var), `/izle/*` → `Jujutsu Kaisen 1. Bölüm izle`, `/admin` → sr-only başlık |
| 5 | `/izle/*` başlığında seri adı yok | ✅ Düzeltildi | Sekme başlığı `Jujutsu Kaisen 1. Bölüm izle \| shanime` |
| 6 | 404 sayfasında menü yok / başlık boş | ✅ Düzeltildi | Başlık `Sayfa bulunamadı \| shanime`; logo + Ana sayfaya dön + Tüm seriler + Türler linkleri; HTTP hâlâ **404** |
| 7 | Küçük dokunma hedefleri | ✅ Düzeltildi | Footer linkleri 20 px → ~36 px; "Yakında" rozeti 10 px → 11 px |
| 8 | `/auth` input 14 px (iOS zoom) | ✅ Düzeltildi | Ölçüldü: e-posta ve şifre **16 px** |

Konsol: düzeltmelerden sonra da **uygulama kaynaklı hata yok**.

### 2 numaranın gerçek yüzü: logo zinciri hiç çalışmıyormuş

Denetim "boşa giden 404 isteği" demişti. Kodu açınca çok daha ciddi bir şey çıktı:

```ts
const logo = logoState.failed ? sources[1] : sources[0];
if (logoState.failed || !logo) {
  return <h1 className="hero-title">{title}</h1>;   // ← buraya düşüyor
}
```

`logoState.failed` **true** olduğu anda fonksiyon düz yazı başlığa dönüyordu; yani
`.svg` yedeği **hiçbir zaman denemiyordu**. Sonuç: `anime-logo.svg` dosyası olan
Mushoku Tensei, hero'da logosunu **hiç gösteremiyordu** — hem de her slayt
dönüşünde boşuna bir `.png` 404'ü üretiyordu.

Yapılan: zincir gerçekten üç adımlı hâle getirildi (`.png` → `.svg` → düz yazı) ve
bulunan adres modül düzeyinde hatırlanıyor, böylece her slayt dönüşünde yeniden
denenmiyor.

Doğrulama: 4 slayt tek tek tıklandı — dördü de logosunu **görsel olarak** yükledi.
Mushoku artık `/static/anime-data/mushoku-tensei/anime-logo.svg` (200) kullanıyor,
yazı başlığa düşmüyor.

### Kalan tek 404 — bilerek bırakıldı

`GET /static/anime-data/mushoku-tensei/anime-logo.png` isteği hâlâ 404 dönüyor.
**Tek istek, görsel bir sonucu yok** (logo `.svg`'den geliyor). Sebebi mimari:

Logo uzantısı seriden seriye değişiyor ve tarayıcı bir dosyanın var olup
olmadığını ancak **isteyerek** öğrenebilir. Bu proje Cloudflare üzerine derleniyor;
orada sunucu tarafında dosya sistemine bakılamıyor. Yani "hangi uzantı var"
bilgisini derleme anında öğrenmek gerekir — bu da özel bir derleme eklentisi
demek. Tek bir kozmetik 404 için çalışan derleme hattına o riski almadım.

Kalıcı çözüm için üç seçenek (istersen birini yaparım):

1. **Derleme manifestosu** — küçük bir Vite eklentisi `public/static/anime-data/*/`
   altını tarayıp uzantıları koda gömer. 404 tamamen biter, ~40 satır. Derlemeye
   dokunduğu için riski sıfır değil.
2. **Logoyu panele taşı** (kalıcı ve en temiz) — `shows` tablosuna `logo_path`
   kolonu, panelde "Logo yükle" kutusu. Statik klasör bağımlılığı ve deneme
   mantığı tamamen kalkar. Bu bir **özellik**, düzeltme değil.
3. **Olduğu gibi bırak** — tek istek, kullanıcıya hiçbir etkisi yok.
