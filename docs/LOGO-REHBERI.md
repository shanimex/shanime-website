# shanime — "Neyi Nereden Değiştiririm?" Rehberi

Bu rehber siteyi **kod bilmeden** düzenleyebilmen için hazırlandı.
Kod gerektiren yerlerde sadece kopyala-yapıştır yeterli.

## Hızlı Harita: Hangi öğe nerede?

| Ekranda gördüğün şey | Nereden değişir |
|---|---|
| Site logosu (header + footer) | `public/shanime-logo.png` dosyasını değiştir |
| Vitrindeki (hero) anime logosu / YAZISI | ``public/static/anime-data/<slug>/anime-logo.png`` (``.svg`` olur, ikisi de olmazsa dÃ¼z yazÄ±) |
| Vitrin arka plan gÃ¶rseli | ``public/static/anime-data/<slug>/anime-header.jpg`` |
| Vitrin arka plan videosu | ``public/static/anime-data/<slug>/anime-header.mp4`` |
| Vitrindeki açıklama, yıl, tür yazıları | Supabase `shows` tablosu (veya `fallbackShows`) |
| Vitrin yazı başlığının stili | `src/styles.css` → `.hero-title` |
| Seri kartlarındaki cover (dikey poster) | Supabase `shows.image_path` (admin paneli veya DB) |
| Seri detay sayfası başlığı + arka planı | Supabase `shows` satırı (title, image_path) |
| Bölümler | Supabase `show_episodes` tablosu |
| Hero sabit görseli (fallback) | `/admin` panelindeki "Hero görseli" bölümü |

---

## 1. Site logosu (header, footer, tüm sayfalar)

1. Yeni logon hazırla: **PNG**, şeffaf zeminli, 500 KB altı ideal.
2. Adını **`shanime-logo.png`** yap, `public` klasörüne at, eskisinin üzerine yaz.
3. Tarayıcıda **Ctrl + F5** (önbellek yenileme) yap. Hepsi bu.

Adını değiştirmek istersen 5 dosyada `src="/shanime-logo.png"` arayıp
yeni adı yazman gerekir: `index.tsx`, `seri.$slug.tsx`, `izle.$slug.tsx`,
`admin.tsx` (ad değiştirme, üzerine yaz en kolayı).


---

## 2. Vitrin (hero) — YAZI ↔ LOGO geçişi

| Vitrindeki (hero) anime logosu / YAZISI | ``public/static/anime-data/<slug>/anime-logo.png`` (``.svg`` olur, ikisi de olmazsa dÃ¼z yazÄ±) |
geçmeyen seri büyük yazı gösterir.**

`src/routes/index.tsx` dosyasının en üstünde:
```ts
| Vitrindeki (hero) anime logosu / YAZISI | ``public/static/anime-data/<slug>/anime-logo.png`` (``.svg`` olur, ikisi de olmazsa dÃ¼z yazÄ±) |
  "jujutsu-kaisen": "/static/anime-data/jujutsu-kaisen/anime-logo.png",
  "re-zero": "/static/anime-data/re-zero/anime-logo.png",
  "mushoku-tensei": "/static/anime-data/mushoku-tensei/anime-logo.svg",
};
```

### Yazıdan logoya geçmek (örn. Mushoku Tensei'de yazı varsa)
1. Logo dosyanı `public/static/anime-data/<slug>/` klasörüne at
   (örn. `anime-logo.png`). PNG şeffaf olsun, açık renkli olsun.
2. Yukarıdaki listeye satır ekle: `"frieren": "/static/anime-data/frieren/anime-logo.png",`
3. `.svg` dosyası da kullanabilirsin.

### Logodan yazıya dönmek
İlgili satırı sil. Seri otomatik olarak beyaz, kalın, gölgeli yazı başlığa döner
(başlık, serinin Supabase'deki `title` alanından gelir, büyük harfe çevrilir).

### Yazı başlığın görünümünü değiştirmek
`src/styles.css` içinde `.hero-title` bloğu: renk (`color`), kalınlık
(`font-weight`), boyut (`font-size`), gölge (`text-shadow`) buradan değişir.

---

## 3. Vitrin arka planı (görsel + video) ve metinler

`src/routes/index.tsx` içinde iki harita var:
```ts
| Vitrin arka plan gÃ¶rseli | ``public/static/anime-data/<slug>/anime-header.jpg`` |
| Vitrin arka plan videosu | ``public/static/anime-data/<slug>/anime-header.mp4`` |
```

- **Görsel değiştirmek:** yeni jpg'yi klasöre at, yolu güncelle. **16:9 yatay** olmalı
  (dikey kapak hero'da kötü kırpılır).
| Vitrin arka plan videosu | ``public/static/anime-data/<slug>/anime-header.mp4`` |
- **Video eklemek:** mp4'ü klasöre at, satır ekle. Yavaş bağlantı/mobil veri
  modunda video otomatik atlanır, jpg kalır.
- Haritada adı olmayan seri: Supabase'deki `hero_image` ayarına, o da yoksa
  serinin cover'ına düşer.

### Vitrin metinleri (açıklama, yıl, tür)
Bunlar koddan değil **Supabase `shows` tablosundan** gelir
(`description`, `year`, `genre`, `subtitle` kolonları). DB'yi açıp satırı düzenle.
DB boşsa devreye `index.tsx` içindeki `fallbackShows` girer — o da aynı kolonlarla
düzeltilebilir.

### Vitrin ayarları
- Slayt süresi: `index.tsx` → `HERO_AUTO_MS = 10_000` (10 saniye).
- Sıralama: `HERO_ORDER` listesi; soldan sağa vitrine çıkacak slug'lar.

---

## 4. Cover / poster (dikey kapak) değiştirmek

Seri kartlarındaki ve seri detay sayfasındaki dikey kapak **koddan değil
veritabanından** gelir: `shows.image_path`.

**Kolay yol — Admin paneli:** `/admin` sayfasından yeni seri eklerken cover yüklüyorsun;
yüklediğin dosya Supabase Storage'daki `images` bucket'ına gider.

**Elle yol:** Supabase Storage → `images` bucket → eski posteri sil, yenisini yükle
→ `shows` tablosunda o serinin `image_path` alanını yeni dosya adıyla güncelle.

**Site içi dosya kullanmak (en pratik):** `image_path` değeri `static/` ile başlarsa
Supabase yerine sitenin kendi dosyası kullanılır. Örn. `image_path` =
`static/anime-data/re-zero/anime-cover.jpg` yaparsan `public/static/anime-data/re-zero/anime-cover.jpg`
dosyası kapak olur. Böylece Storage'a hiç uğramadan, dosyayı üstüne yazarak kapak değiştirirsin.

---

## 5. Seri detay sayfası (`/seri/...`)

- **Başlık, alt yazı, yıl, tür, açıklama:** Supabase `shows` satırı. Bu sayfada
  başlık her zaman yazıdır (`font-display` stilinde, accent renkli).
- **Sayfanın arka plan resmi:** serinin cover'ının soluk halidir (`opacity-40`
  + üstte koyu gradyan). Cover değişince bu da otomatik değişir.
- Buradaki başlığı da logoya çevirmek istersen: logoyu
  `public/static/anime-data/<slug>/anime-logo.png` içine at ve
  `src/routes/seri.$slug.tsx` içinde `{show.title}` geçen `<h1>`'i şununla değiştir:
  ```tsx
  <img
    src={`/static/anime-data/${show.slug}/anime-logo.png`}
    alt={`${show.title} logosu`}
    className="max-w-md w-auto object-contain"
  />
  ```
  (Slug'ı olmayan serilerde kırılır; gerekirse `show.slug` kontrolü ekle.)

---

## 6. İzle sayfası (`/izle/...`) ve bölümler

- Bölüm numaraları, başlıkları ve video linkleri: Supabase `show_episodes` tablosu
  (`number`, `title`, `watch_url` kolonları).
- Bölüm eklemek: tabloya yeni satır → `show_id` doğru serinin id'si olsun.

---

## 7. Kontrol listesi (yeni seri eklerken)

1. `public/static/anime-data/<slug>/` klasörü oluştur.
2. İçine `anime-logo.png` (+ istersen `anime-header.jpg`, `anime-header.mp4`, `anime-cover.jpg`).
| Vitrindeki (hero) anime logosu / YAZISI | ``public/static/anime-data/<slug>/anime-logo.png`` (``.svg`` olur, ikisi de olmazsa dÃ¼z yazÄ±) |
   `<slug>` satırlarını ekle.
4. Vitrine çıkacaksa `HERO_ORDER`'a slug'ı yaz.
5. Supabase `shows` tablosuna satır ekle (`title`, `slug`, `image_path`, `description`...).
6. Bölümleri `show_episodes`'e ekle.

---

## 8. Değişiklik görünmüyorsa

- **Ctrl + F5** — logo ve görseller tarayıcı önbelleğinde kalabilir.
- Dosya yolunda yazım hatası/boşluk var mı kontrol et (yol birebir aynı olmalı).
- Kod dosyalarını düzenledikten sonra kaydetmeyi unutma; `bun run dev` açıkken
  sayfa kendini yeniler.
- Sunucuya (deploy) yüklerken `public` klasörü altındaki yapının aynısı gitmeli.
