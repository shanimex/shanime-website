# shanime — Proje Yapısı ve İş Rehberi

Bu dosya, projede **neyin nerede olduğunu** ve **hangi işi hangi dosyadan yapacağını** anlatır.
Amaç: kod bilmeden de doğru dosyayı bulup değiştirebilmen.

---

## 1. Klasör ağacı

```
C:\Projects\shanime-react\
│
├── public\                              ← statik dosyalar (tarayıcıya doğrudan bu adresle gider)
│   ├── shanime-logo.png                 ← ★ site logosu (header, footer, giriş ekranı)
│   ├── favicon.ico                      ← sekme ikonu
│   ├── robots.txt                       ← arama motoru kuralları
│   ├── sitemap.xml                      ← arama motoru site haritası
│   └── static\anime-data\<slug>\        ← seriye özel görseller (klasör adı = seri slug'ı)
│       ├── anime-cover.jpg              ← dikey kapak (grid kartı)
│       ├── anime-header.jpg             ← geniş vitrin arka planı (16:9)
│       ├── anime-header.mp4             ← vitrin arka plan videosu (opsiyonel)
│       └── anime-logo.png / .svg        ← vitrin başlık logosu (opsiyonel)
│
├── src\                                 ← TÜM KOD
│   ├── routes\                          ← SAYFALAR: dosya adı = site adresi
│   │   ├── __root.tsx                   ← ortak iskele: <html>, fontlar, 404/hata ekranı
│   │   ├── index.tsx                    ← ana sayfa (vitrin slider'ı, seri kartları, tür filtresi)
│   │   ├── seri.$slug.tsx               ← seri detay sayfası (bölümler sezonlara göre)
│   │   ├── izle.$slug.tsx               ← izleme sayfası (oynatıcı + sezon/bölüm gezinme)
│   │   ├── admin.tsx                    ← yönetim paneli (seri listesi, arama, reklamlar)
│   │   └── auth.tsx                     ← giriş / kayıt ekranı
│   │
│   ├── components\
│   │   ├── ui\button.tsx                ← temel buton (tüm sitede kullanılır)
│   │   ├── AdSlot.tsx                   ← reklam slotları (slot listesi: AD_SLOTS)
│   │   └── admin\                       ← panelin parçaları
│   │       ├── ShowRow.tsx              ← listedeki tek satır (kapak, ad, "N sezon · M bölüm")
│   │       ├── ShowEditor.tsx           ← açılmış seri formu (vitrin anahtarı burada)
│   │       ├── SeasonsPanel.tsx         ← sezon + bölüm yönetimi (sayfalı liste)
│   │       └── AddShowButton.tsx        ← "Yeni seri ekle" formu
│   │
│   ├── lib\
│   │   ├── content.ts                   ← ★ VERİTABANI: tüm okuma/yazma sorguları burada
│   │   └── admin.ts                     ← panel yardımcıları (slug üretme, video link kontrolü)
│   │
│   ├── integrations\supabase\
│   │   ├── client.ts                    ← Supabase bağlantısı
│   │   ├── types.ts                     ← OTOMATİK: veritabanı şeması (elle düzenleme!)
│   │   └── ...                          ← oturum/doğrulama yardımcıları
│   │
│   ├── styles.css                       ← ★ TÜM renkler, fontlar, vitrin animasyonları
│   ├── routeTree.gen.ts                 ← OTOMATİK üretilir (elle düzenleme!)
│   ├── router.tsx / server.ts / start.ts ← çatı kurulumu (dokunma)
│   └── routes\README.md                 ← yönlendirme kuralları notu
│
├── scripts\
│   └── generate-sitemap.mjs             ← sitemap üretici (npm run sitemap)
│
├── supabase\
│   ├── migrations\                      ← çalıştırılmış SQL dosyaları (şema geçmişi)
│   └── IMPORT_OLD_SITE.sql              ← eski siteden içerik aktarma betiği
│
├── DURUM-RAPORU.md                      ← projenin son durumu / yapılanlar
├── PROJE-YAPISI.md                      ← bu dosya
├── LOGO-REHBERI.md                      ← logo kullanım rehberi
├── package.json                         ← bağımlılıklar + komutlar (npm run dev / build)
├── tsconfig.json, vite.config.ts        ← yapılandırma (dokunma)
└── .env                                 ← Supabase anahtarları (GİZLİ — paylaşma)
```

### Dokunmaman gerekenler (otomatik üretilir, elle değişiklik kaybolur)

| Dosya | Neden |
| --- | --- |
| `src/routeTree.gen.ts` | Sayfa ekleyince otomatik yeniden üretilir |
| `src/integrations/supabase/types.ts` | Veritabanı şemasından üretilir |
| `node_modules/`, `.output/`, `.tanstack/`, `.wrangler/` | Kurulum/derleme çıktıları, `.gitignore`'da |

---

## 2. "Şunu yapmak istiyorum" → nereye bakacağım

| Yapmak istediğim | Yer |
| --- | --- |
| **Ana sayfa vitrininde hangi animeler dönsün** | Panel → Seriler → **Düzenle** → **"Vitrin'e ekle"** (tıkla, anında kaydolur) |
| Yeni anime eklemek | Panel → **Yeni seri ekle** |
| Bölüm / sezon eklemek, silmek, sıralamak | Panel → Seriler → **Düzenle** → **Sezonlar ve bölümler** |
| Bölümü başka sezona taşımak | Aynı panelde bölüm satırındaki **sezon seçicisi** |
| Serinin vitrin (16:9) görselini değiştirmek | Panel → Düzenle → **Vitrin Banner'ı** kutusu |
| Serinin kapağını değiştirmek | Panel → Düzenle → **Dikey Kapak** kutusu |
| Serilerin ana sayfadaki sırası | Panel → listedeki **▲ ▼** okları |
| Reklam kodları | Panel → **Reklam kodları** |
| Site logosu | `public\shanime-logo.png` dosyasını **aynı adla** değiştir |
| Sekme ikonu (favicon) | `public\favicon.ico` |
| **Renkler, fontlar, vitrin animasyonu** | `src\lib` değil → **`src\styles.css`** |
| Sayfa başlığı / açıklaması (SEO) | İlgili sayfa dosyasındaki `head()` bloğu (ör. `src\routes\index.tsx`) |
| Arama motoru kuralları | `public\robots.txt` |
| Sitemap'i yenilemek | `npm run sitemap` (seri ekledikçe çalıştır; `public\sitemap.xml`'i yeniden üretir) |
| Sitemap adres kökü | `SITE_URL=https://alanadi.com npm run sitemap` veya betikteki varsayılan |
| Seriye özel statik görseller | `public\static\anime-data\<slug>\` (klasör adı seri slug'ı olmalı) |
| Veritabanı sorgusu eklemek/değiştirmek | **`src\lib\content.ts`** |
| Veritabanı şeması değiştirmek | `supabase\migrations\` içine yeni `.sql` yaz → Supabase SQL Editor'de çalıştır |
| Yeni sayfa eklemek | `src\routes\` içine yeni dosya (ör. `iletisim.tsx` → `/iletisim`) |

---

## 3. Çalıştırma

```bash
npm install      # ilk kurulum (bir kez)
npm run dev      # geliştirme sunucusu → http://localhost:8080
npm run build    # yayına hazır derleme
npm run sitemap  # public/sitemap.xml'i serilere göre yeniden üret
npx tsc --noEmit # tip kontrolü (hata çıkarsa kod bozuk)
npx eslint .     # kod stili kontrolü
```

---

## 4. Veri akışı (kısaca)

```
Supabase (Postgres)
      │  src/lib/content.ts  ← tüm sorgular burada toplanır
      ▼
React Query önbelleği (5 dk)
      │
      ├─→ index.tsx       → vitrin slider + seri kartları
      ├─→ seri.$slug.tsx  → bölümler (sezonlara gruplu)
      ├─→ izle.$slug.tsx  → oynatıcı
      └─→ admin.tsx       → panel (yazma işlemleri)
```

Vitrin arka planı hangi sırayla seçilir:

1. Panelden yüklenen **vitrin banner'ı** (`shows.banner_image_path`)
2. `public\static\anime-data\<slug>\anime-header.jpg`
3. Serinin **dikey kapağı** (`shows.image_path`)

Görseller Supabase Storage'da tutuluyorsa **tek istekte toplu** imzalanır (`signImagePaths`),
sayfa açılışında görsel başına ayrı istek gidip yavaşlamaz.
