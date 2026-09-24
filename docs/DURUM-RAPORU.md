# shanime-react — Durum Raporu

Proje: `C:\Projects\shanime-react` (TanStack Start + React 19 + Supabase + Tailwind 4)
Klasör rehberi: **[PROJE-YAPISI.md](PROJE-YAPISI.md)** — hangi işi nerede yapacağın orada.
Local preview: **http://localhost:8080/** (`npm run dev`)

---

## 1. Veritabanı — güncel

İki migration da **canlı veritabanına uygulandı** ve doğrulandı:

| Migration | Ne getirdi | Durum |
| --- | --- | --- |
| [20260923_seasons_banner_content.sql](supabase/migrations/20260923_seasons_banner_content.sql) | `show_episodes.season`, `shows.banner_image_path`, `show_seasons` tablosu (+RLS, trigger, backfill, tekillik index'i) | ✅ uygulandı |
| [20260924_featured_and_stats.sql](supabase/migrations/20260924_featured_and_stats.sql) | `shows.is_featured` kolonu + index, `show_stats` görünümü | ✅ uygulandı |

Canlı veri: **4 seri · 24 bölüm (hepsi Jujutsu Kaisen, hepsinde video var) · 2 sezon · 0 karakter · 0 görsel**

### ⚠️ Dikkat edilecek iki şey

1. **Token dosyası:** `C:\Users\shant\.supabase-token` içinde 90 günlük (22 Ara 2026) bir erişim token'ı duruyor. Sadece `shanime` projesine, sadece Database + Migrations yazma yetkisi var. İşin bittiğinde Supabase → Account Settings → Access Tokens'tan iptal edip dosyayı silebilirsin.
2. **`supabase/config.toml` yanlış projeyi gösteriyor:** içinde `project_id = "qcmyivkqrwjkccrtcyqo"` yazıyor ama canlı proje `zbcsjvxzlcxhnyzmnapu`. O ref de gerçekten var olan başka bir proje. CLI ile `supabase link` / `db push` yaparsan **yanlış veritabanına** yazarsın.

---

## 2. Vitrin (öne çıkan seri) sistemi — yeni

**Eskiden:** ana sayfada hangi animenin çıkacağı kontrol edilemiyordu; panelde sadece "Varsayılan Vitrin
Arka Planı (Yedek)" diye bir görsel yükleme kutusu vardı. O kutu neredeyse hiç görünmüyordu (yalnızca
statik dosyası olmayan serilerde devreye giriyordu) — kafa karıştırmaktan başka işe yaramıyordu, kaldırıldı.

**Şimdi:** panelde her serinin satırında bir **vitrin anahtarı** var.

- Panel → **Seriler** → ilgili seri → **Düzenle** → **★ Vitrin'e ekle**
- Tıkladığın an kaydolur, ayrıca "Kaydet"e basman gerekmez.
- İşaretli seriler ana sayfanın büyük slider'ında **sırayla** döner.
- Hiçbiri işaretli değilse (şu anki durum) tüm seriler döner — davranış değişmez.
- Panelin üstünde "Ana sayfa vitrini: N seri sırayla dönüyor" yazar, listede işaretli satırda **★ Vitrin** rozeti çıkar.

**Senin kullanım şeklin:** 1-2 ayda bir farklı animeleri göstermek istediğinde, eski seriden anahtarı kapat,
yenisinde aç. Bitti. Görsel yüklemek zorunda değilsin — serinin kapağı yeterli.

Vitrin arka planı seçim sırası:
**1)** panelden yüklenen vitrin banner'ı → **2)** `public/static/anime-data/<slug>/anime-header.jpg` → **3)** serinin dikey kapağı

---

## 3. Karakter ve galeri özelliği kaldırıldı

`show_characters` ve `show_images` tabloları **0 kayıt**tı, hiç kullanılmamıştı; detay sayfasında
"Henüz karakter eklenmedi / Henüz görsel eklenmedi" yazan boş bölümler olarak duruyordu. Boş bölüm
göstermek, o bölümü hiç koymamaktan daha kötü görünüyor. Kaldırıldı:

- `seri.$slug.tsx` → iki bölüm silindi
- `content.ts` → ilgili tipler ve sorgular silindi
- `CharactersPanel.tsx`, `GalleryPanel.tsx` → dosyalar silindi
- `ShowEditor.tsx` → sekmeleri kaldırıldı

**Tablolar veritabanında duruyor** (0 satır, maliyeti yok). Tamamen silmek istersen:
`drop table public.show_characters, public.show_images;`

---

## 4. Performans iyileştirmeleri

| İyileştirme | Kazanç |
| --- | --- |
| Görseller **tek istekte toplu imzalanıyor** (`createSignedUrls`) | Ana sayfa açılışında görsel başına ayrı istek gitmiyor — önceden 8 istek, şimdi 1 |
| Panel istatistikleri **`show_stats` görünümünden tek sorguda** | Önceden seri başına 1 istek (N+1); 50 seride 50 istek yerine 1 istek |
| Bölüm sayıları SQL içinde sayılıyor | PostgREST'in 1000 satır sınırına takılmıyor → One Piece'te de doğru sayı |
| Supabase host'una **preconnect** (`__root.tsx`) | İlk görsel isteğinden önce DNS/TLS kurulur, LCP hızlanır |
| Seri kartına **fareyle üzerine gelince ön yükleme** | Detay sayfası tıklamada beklemeden açılır |
| React Query önbelleği 60 sn → **5 dakika** | Gereksiz yeniden istek yok, gezinme akıcı |
| Vitrin arka plan görseli `fetchPriority="high"`, diğerleri `lazy` | LCP görseli öne alınır, diğerleri beklemez (zaten vardı, korundu) |

---

## 5. Panel artık 1000+ bölümlü serilere dayanıyor

Önceden her seri kartı tüm alanlarıyla açıktı ve bir sezon açıldığında içindeki tüm bölümler tek seferde
çiziliyordu. One Piece (1000+ bölüm) yüklendiğinde sayfa yenilmez hâle gelirdi.

| Değişiklik | Etki |
| --- | --- |
| Seri listesi **kompakt satır** (kapak + ad + `/slug` + "N sezon · M bölüm" + butonlar) | 4 seri ~350 px; liste kaç seri olursa olsun kısa |
| Aynı anda **yalnızca bir seri** düzenleme modunda | Alt alta açık formlar yok |
| Aynı anda **yalnızca bir sezon** açık | Üst üste liste yığılmıyor |
| Bölümler **sayfalı** (50/sayfa), üstte ve altta gezinme | 1000 bölümde bile DOM'a en fazla 50 satır |
| "**Bölüm no ile git**" kutusu | 847. bölüm için 17 sayfa tıklamak gerekmez |
| Bölüm eklenince **son sayfaya** atlar | Yeni bölüm anında görünür |
| Üstte **seri arama** | Seri çoğalınca aşağı kaydırmadan bulunur |
| Boş sezonlar sitede **görünmez** | Panelde hazırlanan 0 bölümlü sezon boş sekme olarak çıkmaz |

### Gereksiz alanlar kaldırıldı

| Ne | Neden | Şimdi |
| --- | --- | --- |
| **Sezon adı yazı alanı** | Her sezon otomatik "1. Sezon" oluyor, özel ad girilmez | **Düz yazı**: "1. Sezon". Düzenleme arayüzü tamamen kaldırıldı |
| **Sezon adı kalemi** | Alanı açan kalem simgesi de gereksizdi | Kaldırıldı — başlık satırında hiç düzenleme yok |
| **Bölüm satırındaki sezon seçici** | Bölümü sezona taşımak bu site için gereksiz | **Tamamen kaldırıldı** — sayfada artık hiç `<select>` yok |
| **"Süre" alanı** | Hiçbir bölümde dolu değildi | Kaldırıldı (hem panelden hem detay/izleme sayfasından) |
| **"Özet" alanı** | Her bölüme özet girilmez | Kaldırıldı (hem panelden hem detay/izleme sayfasından) |
| **Kaydet/Sil butonları** | Bölüm adı kutusunun yanında, satırın ortasında duruyordu; karıştırıyordu | Her zaman **satırın en sağ altında**, ayrı buton satırında |

Sonuç: bölüm satırı **202 px → 158 px**, alan sayısı **5 → 2** (bölüm adı + video linki).
Bölüm ekleme formu 3 alan: **No + Bölüm adı + Video linki**.

### Kategori kartları: çizgi yerine renk tonu

Panelde "Seriler" ve "Reklam kodları" bölümleri **kenarlıksız**; her biri kendi hafif renk tonunu alıyor
(kart renginin kategori rengiyle %12 karışımı) + başlığın solunda 6 px'lik renk çubuğu:

| Kategori | Ton | Ölçüm |
| --- | --- | --- |
| Seriler | birincil (kırmızı) | `rgb(25, 11, 13)` · çubuk `rgb(227, 13, 49)` |
| Reklam kodları | vurgu (altın) | `rgb(23, 21, 14)` · çubuk `rgb(225, 182, 0)` |

Kenarlık: dördü de **0 px**. İki ton birbirinden ayırt edilebilir ama tema kimliği korunuyor.

### Reklam kodları kompakt

6 slot alt alta dizilip ~1400 px yer kaplıyordu → **iki kolon, 3 satır: 628 px**. Metin alanı
yüksekliği de düşürüldü.

> Veritabanındaki `duration` ve `summary` kolonları **duruyor** (zararsız, 0 maliyet) — ileride
> "tüm bölümlere 24 dk yaz" gibi bir kısayol istersen tek satır kodla geri getirilebilir.

---

## 6. Temizlik

| Ne | Ne yapıldı |
| --- | --- |
| `node-compile-cache/` (548 dosya, **2,5 MB**) | Projeden çıkarıldı + `.gitignore`'a eklendi (Node derleme önbelleği, otomatik yeniden oluşur) |
| `ad_watch_top` reklam slotu | Tanımlıydı ama hiçbir yerde gösterilmiyordu — izleme sayfasına eklendi (boşken görünmez) |
| Ölü kod | `fetchHeroImage`, `detailHref`, `fetchSeasons`, `Character`/`GalleryImage` tipleri kaldırıldı |
| `uniqueSlug` | Tanımlıydı ama hiç çağrılmıyordu (aynı adlı ikinci seri hata veriyordu) — düzeltildi |
| TypeScript hataları | 2 → **0** |
| ESLint/prettier hataları | 6 → **0** |
| Vitrin etiketi | "Popüler animeler" → **"Öne çıkanlar"** (yeni sistemle tutarlı) |

`.gitignore`, `.prettierrc`, `eslint.config.js`, `AGENTS.md`, `bun.lock` gibi dosyalar **gerekli** — çöp değil.

---

## 7. Doğrulama

| Kontrol | Sonuç |
| --- | --- |
| `tsc --noEmit` | **0 hata** |
| `eslint .` | **0 hata** |
| Sayfalar | `/`, `/seri/...`, `/izle/...`, `/admin`, `/auth` → hepsi HTTP 200 |
| Ana sayfa (tarayıcı) | Vitrin tek slayta indi (vitrin işareti testi), "Öne çıkanlar" etiketi, grid'de 4 kart, tek slaytta ok/nokta yok — doğru |
| Panel (tarayıcı) | JJK satırında `★ Vitrin` rozeti, "Ana sayfa vitrini" metni doğru, "Varsayılan Vitrin Arka Planı" bölümü **yok**, düzenle formunda `Vitrin'de` butonu var |
| İzleme (tarayıcı) | Boş reklam kutusu **görünmüyor**, 5 sn geri sayım çalışıyor |
| **Vitrin geçişi (tarayıcı, ölçümle)** | `transition-property: transform` (opacity **yok**), pasif slaytlar ±100%, ok tıklandıktan 130 ms sonra iki slayt da ara değerde ve **opacity hiç değişmiyor**, 1,6 sn sonra yeni slayt tam 0'da → fade gerçekten kalktı |
| **Sayfalama (55 test bölümüyle)** | 1. sayfa **50 satır**, çubuk `1–50 / 55 bölüm · sayfa 1/2`; "Sonraki" → `51–55 / 55 bölüm · sayfa 2/2` (5 satır); "Bölüm no 53 + Git" → sayfa 2/2 ✔ |
| 24 bölümlü sezonda çubuk | **Yok** (50'nin altında — tasarım gereği) ✔ |
| Panel akıcılığı | 41 frame, ortalama **6,9 ms/frame**, >100 ms takılan frame **0** |
| Toplu ekleme formu (tarayıcı) | Buton + "İlk bölüm no" (25 hazır) + textarea + "Ekle" butonu göründü, gönderim yapılmadı ✔ |
| **Sezon başlığı satırı** | Kalem/düzenle simgesi **yok**; "1. Sezon" düz `<span>`; satırda sadece ↑ ↓ Sil ve Bölümler butonları (yükseklik 36 px) ✔ |
| **Sayfadaki `<select>` sayısı** | **0** — sezon seçici tamamen kalktı ✔ |
| **Bölüm satırı düzeni** | 1. sıra: rozet + bölüm adı · 2. sıra: video linki · 3. sıra: **Kaydet + Sil en sağ altta** (158 px) ✔ |
| **Süre / Özet** | Tüm panel gövdesinde eşleşme **yok** ✔ |
| **Bölüm satırı** | 2 alan (bölüm adı + video linki), ~202 px — önceden 5 alanlı 3 sıraydı |
| **Seri detay sayfası** | 24 bölüm, satır = numara + başlık + "İzle"; süre/özet metni **yok** ✔ |
| `/sitemap.xml` | HTTP **200**, `text/xml`, **5** kayıt (ana sayfa + 4 seri) |
| Konsol hataları | Tüm sayfalarda ve tüm etkileşimlerde **0** |

> Sayfalama testi için 2. sezona 55 geçici bölüm eklendi, doğrulandı ve **silindi** — veritabanı şu an
> yine 24 bölüm (hepsi 1. sezonda).

**Dev sunucusu:** çalışıyor → **http://localhost:8080/**. Benim arka plan komutlarımın 15 dakikalık
limiti olduğu için ara ara düşebilir; kesintisiz çalışsın istersen kendi terminalinde `npm run dev`.

> Vitrin testi için JJK geçici olarak işaretlendi, doğrulandı ve **geri alındı** — veritabanındaki içeriğin
> şu anki hâli: 4 seri de vitrin dışı (yani ana sayfada hepsi dönüyor, eskisi gibi).

---

## 8. Vitrin: sonanime.com ile birebir eşleme

sonanime.com'un vitrini **gerçek tarayıcıda ölçülerek** incelendi (DOM + computed style + geçiş
sırasında canlı ölçüm). Çıkan gerçek: sitede geçiş **opacity FADE (1.2 sn ease)** — kayma değil.
Bir önceki turda "orada fade olmadan geçiyor" geri bildirimi üzerine yaptığım **yatay kayma
değişikliği yanlıştı ve geri alındı.**

### "Resimler birbirine karışıyor" sorununun gerçek sebebi

Ken Burns zoomu (`.hero-image` → `scale(1.05)`) görseli kendi slayt kutusundan **%5 taşırıyordu**;
`.hero-slide` üzerinde `overflow: hidden` olmadığı için taşan kenar komşu slayta biniyordu.
İki slayt aynı anda görünürken "resimler birbirine karışıyor" görüntüsü oluşuyordu.
**Çözüm: `.hero-slide { overflow: hidden }`.**

### sonanime ile birebir eşleşen değerler (ölçüm)

| Öğe | sonanime.com | Bizim site | Durum |
| --- | --- | --- | --- |
| Geçiş türü | `opacity, visibility` 1.2s ease | `opacity, visibility` 1.2s ease | eşleşti |
| Slayt `transform` | `none` (kayma yok) | `none` | eşleşti |
| Pasif slayt | `opacity 0` + `visibility hidden` | aynı | eşleşti |
| Görsel zoom | aktif `scale(1)`, pasif `scale(1.05)`, 6s ease-out | aynı | eşleşti |
| Görsel taşması | yok | yok (görsel genişliği = slayt genişliği 1232 px) | eşleşti |
| Hero yüksekliği | 600 px | 609 px (`clamp(60vh, 600px, 80vh)`) | eşleşti |
| Aktif nokta | 26×6 px pill, `rgb(255,60,100)` | aynı | eşleşti |
| Pasif nokta | 6×6 px, `rgba(255,255,255,0.35)` | aynı | eşleşti |
| Açıklama | 3 satırda kesiliyor | 3 satır (`-webkit-line-clamp: 3`) | eşleşti |
| CTA butonu | `#ff3c64`, radius 50px | aynı | eşleşti |
| Yazı bloğu | slaytın içinde (onunla soluyor) | slaytın içinde | eşleşti |
| Noktalar | slaytın dışında sabit | slaytın dışında sabit | eşleşti |

Ek: hero meta satırına **bölüm sayısı** eklendi (sonanime'deki "1999 · 1171 bölüm" satırının
karşılığı). Bölümü olan seride `24 bölüm` yazar; bölümü olmayanda yazmaz.

### Kaydırırken "önce siyah, sonra resim" sorunu (ÇÖZÜLDÜ)

Kullanıcı bildirimi: sonanime'de kaydırınca resim hemen geliyor, bizde önce siyah kalıyor.
Ekran görüntüsünde vitrinin sağ yarısı boş ve yazı bloğu soldan dışarı kaymış görünüyordu.

**Kök neden:** Slaytlar normalde `visibility: hidden` (fade geçişi için). Sürükleme sırasında
komşu slaytın görünmesi `inline style` ile `opacity: 1` verilerek sağlanıyordu — ama bu,
CSS'teki `visibility: hidden`'ı **ezmiyor**. Sonuç: parmağı kaydırınca aktif slayt çekiliyor,
yerine komşu slayt gelmiyor, **siyah boşluk** kalıyordu.

**Çözüm:** `backdropDragStyle` içinde sürüklenen slaytlara `visibility: "visible"` de verildi.

**Doğrulama (gerçek tarayıcı, sürükleme simülasyonu, -300 px):**

| Ölçüm | Sonuç |
| --- | --- |
| Sürükleme sırasında görünür slayt | **2** (aktif `-300px`, komşu `+932.22px`) |
| Komşu slayt `visibility` / `opacity` | `visible` / `1` |
| Kapsanan aralık | `-300 → 2164.4` — vitrin `0 → 1232.2`'yi **tam kapsıyor** |
| Siyah boşluk | **yok** (slayt 0 bitişi 932.2 = slayt 1 başlangıcı 932.2) |
| Ekran görüntüsü | Sürükleme anında solda aktif slayt, sağda komşu slayt görünüyor |
| Bırakınca | `transform` anında `none`'a döner, geçiş `opacity` üzerinden olur, slayt 1 aktif |
| Konsol hatası | **0** |

---

## 9. Toplu bölüm ekleme — yeni

Panelde sezon açıkken **"Toplu bölüm ekle (link listesi)"** butonu var. Bir kutuya link listesini
yapıştırıyorsun, numaralar sırayla atanıyor. One Piece gibi 1000+ bölümlü serilerde tek tek uğraşmamak için.

Kabul edilen satır biçimleri:

```
https://vidmoly.to/embed-abc.html
42 - https://dood.to/e/abc
https://earnvids.com/e/xyz | 42. Bölüm adı
```

- "İlk bölüm no" kutusu ile başlangıç numarası ayarlanır (varsayılan: mevcut en büyük + 1).
- Dolu numaralar **atlanır**, üzerine yazmaz; kaç satırın atlandığı bildirilir.
- Linkler tek tek doğrulanır (tanınmayan host varsa hiçbiri eklenmez, hata satır sayısı söylenir).
- 100'lük gruplar hâlinde yazılır; ortada hata olursa eklenenler kalır ve durum bildirilir.

---

## 10. Sitemap artık serileri de listeliyor

`npm run sitemap` komutu Supabase'den serileri çekip `public/sitemap.xml`'i yeniden üretir
(ana sayfa + her seri için `/seri/<slug>`). **Yayına almadan önce bir kez, seri ekledikçe tekrar çalıştır.**
Şu an 5 adres üretiyor. Adres kökü `SITE_URL` ortam değişkeniyle değiştirilir.

---

## 10.1 Bölüm numarası rozeti + seçili durum rengi

| Konu | Yapılan | Ölçüm |
| --- | --- | --- |
| Bölüm numarası **input'ken rozet oldu** | Ekleme formundaki numara artık elle girilemez; satırlardaki gibi solda yuvarlak rozet | Sayfada sayı girişi: **0** · rozet 32×32 px, "Bölüm adı" kutusunun solunda aynı satırda |
| Rozet "kilitli" tonunda | Satır rozeti kırmızı yazılı; ekleme formundaki rozet daha koyu zemin + soluk gri yazı | satır: bg `0.135` / yazı `0.58 0.23 23` · ekleme: bg `0.115` / yazı `0.62 0.012 270` |
| **Seçili buton kırmızıydı** | Yeni `toggleOn` varyantı: altın (accent) ton | açık buton: bg altın %15, yazı `oklch(0.79 0.165 92)` · **Kaydet** hâlâ kırmızı `oklch(0.58 0.23 23)` → karışmıyor |
| Uygulandığı yerler | "Sezonlar ve bölümler", "Bölümler / Bölümleri kapat", "Vitrin'de" | Üçü de açıkken altın tonlu |

## 10.2 Kartlarda "Yakında" rozeti

`fetchShows` artık `show_stats` görünümünden bölüm sayısını da getiriyor (ayrı istek yok, aynı paralel
çağrı). Ana sayfada bölümü olmayan serinin kartında sol üstte **"Yakında"** rozeti çıkar.
Doğrulama: 4 karttan **3'ünde** rozet var (Re:Zero, Mushoku Tensei, Erased) — bölümü olan Jujutsu
Kaisen'de yok.

## 10.3 Tür alanına hazır liste

Seri düzenlerken tür alanı artık mevcut türleri önerir (`datalist`). Böylece "Aksiyon" yerine
"aksiyon" yazıp ana sayfadaki tür filtresinde **ikinci bir kategori** oluşturma riski kalktı.

---

## 11. Vurgu ve renk düzeltmeleri

| Sorun | Çözüm | Ölçüm |
| --- | --- | --- |
| Bölüm ekleme formundaki otomatik numara (25) fazla beyaz duruyordu | Numara kutusu bilinçli olarak soluk | `rgb(131, 134, 142)` — diğer inputlar `rgb(247, 246, 242)` |
| "1. sezona bölüm ekle" kırmızı dolu buton, "Sil" ile karışıyordu | `outline` varyantına çevrildi | buton `rgb(1, 1, 2)` + kenarlık · **Sil** `rgb(231, 0, 11)` → artık net ayrı |
| Açık seri düzenleme kartının kırmızı kenarlığı kaba duruyordu | Kırmızı kenarlık kaldırıldı; kart hafif tonlu yüzeye döndü | kart kenarlığı `rgb(30, 31, 35)` · **kırmızı kenarlıklı tek eleman kalmadı** |

---

## 11.1 Seri sayfası SEO başlığı (en yüksek öncelikli iş) — TAMAM

**Eski durum:** `seri.$slug.tsx` içinde başlık sabitti — yani **her seri sayfası aynı başlık ve aynı
açıklamayla** çıkıyordu (`shanime | Seri detayı`). Google'da 4 seri sayfası birbirinin kopyası gibi
görünüyordu. Ayrıca veri tarayıcıda çekildiği için sayfa HTML'inde içerik yoktu; arama motoru
bölümleri hiç görmüyordu.

**Yapılan:** Sayfa verisi React Query yerine **route loader'a** taşındı; başlık ve açıklama artık
serinin kendi verisinden üretiliyor (`head({ loaderData })`).

**Doğrulama — sunucudan gelen ham HTML:**

| İstek | `<title>` | `description` |
| --- | --- | --- |
| `/seri/jujutsu-kaisen` | `Jujutsu Kaisen izle \| shanime` | "Lanetli enerjiyle örülü bir dünyada, genç bir büyücü…" |
| `/seri/erased` | `Erased izle \| shanime` | "Hayatın zorluklarıyla cebelleşen manga yazarı Satoru…" |

`og:title` / `og:description` da seriye özel. **Ek kazanç:** sayfa artık sunucuda gerçek içerikle
render ediliyor (HTML'de `seri.$slug.tsx` kaynaklı bölüm işaretleri var), yani arama motoru içeriği
JS çalıştırmadan görüyor. Loader önbelleği 5 dakika; gereksiz yeniden istek yok.

---

## 12. Değerlendirme: eksikler ve öneriler

### A. Sitede bulunan gerçek eksikler

| # | Eksik | Neden önemli |
| --- | --- | --- |
| 1 | ~~**Her seri sayfasının başlığı aynı**: `shanime \| Seri detayı`~~ | **ÇÖZÜLDÜ** — aşağıya bak |
| 2 | **Kartta bölüm bilgisi yok** | 4 seriden 3'ünün 0 bölümü var; ana sayfadan anlaşılmıyor, tıklayıp "Yakında" görüyor. Kartta "Yakında" rozeti veya bölüm sayısı olmalı |
| 3 | **`/auth` herkese açık kayıt** yapıyor | Sitede üyelik özelliği yok; kayıt ekranı gereksiz yüzey. Sadece giriş kalsa daha temiz |
| 4 | **Arama yalnızca ana sayfada** | Seri detay ve izleme sayfasında arama yok |
| 5 | **`npm run sitemap` elle** | Yeni seri ekleyince sitemap eskisi kalır |

### B. Panelde eksikler

| # | Eksik | Not |
| --- | --- | --- |
| 1 | **İkinci admin ekleme arayüzü yok** | `user_roles` tablosu var ama panelde UI yok — yardımcı yetkilendirmek için SQL gerekiyor |
| 2 | **Tür alanı serbest metin** | "Aksiyon" yerine "aksiyon" yazılırsa ana sayfadaki tür filtresinde **iki ayrı kategori** oluşur. Hazır liste (datalist) olmalı |
| 3 | **İzinli video host listesi kodda** | `lib/admin.ts` içindeki liste; yeni host için kod değişikliği gerekiyor |
| 4 | **Silme geri alınamıyor** | Seri silinince sezon+bölümler de gider, çöp kutusu yok |
| 5 | **Duyuru bandı yok** | Anime sitelerinde yaygın ("Sunucu değişti", "Discord") — site geneli üst şerit |

### C. Gereksiz / temizlenebilir

| Ne | Durum |
| --- | --- |
| `show_characters`, `show_images` tabloları | 0 satır, kullanılmıyor — tek satır SQL ile silinebilir |
| `supabase/config.toml` | **Yanlış proje ref'i** taşıyor (`qcmyivkqrwjkccrtcyqo`) — CLI kullanırsan yanlış DB'ye yazar |
| `C:\Users\shant\.supabase-token` | Geçici erişim token'ı; iş bitince iptal edilmeli |
| `bun.lock` | Proje npm ile çalışıyor; bun kullanılmıyorsa gereksiz |
| `src/lib/error-page.ts`, `error-capture.ts` | Kendi hata yakalama katmanımız, **kullanılıyor** (bkz. §28) |

### D. Öneri sırası

1. Seri başına SEO başlığı + açıklaması (küçük refactor, en yüksek getiri)
2. Kartlarda "Yakında" rozeti
3. Tür alanına hazır liste
4. `/auth` kaydını kapatmak
5. Duyuru bandı
6. "Kaldığın yerden devam et" (tarayıcı hafızası, sunucu gerekmez)
7. Panelde ikinci admin ekleme

---

## 13. Site denetimi (10 sayfa × masaüstü + mobil) ve düzeltmeler

Tam rapor: **[DENETIM-RAPORU.md](DENETIM-RAPORU.md)** — yöntem, ölçümler, sayfa tablosu.

Denetim gerçek tarayıcıda yapıldı: `/`, `/seri/*`, `/izle/*`, `/admin`, `/auth`,
404, `sitemap.xml`, `robots.txt` — her biri masaüstü (1600×1000) ve mobil
(390×844) olarak; konsol, ağ ve DOM ölçümüyle.

**Önce iyi haber:** hiçbir sayfada uygulama kaynaklı konsol hatası, kırık görsel
veya yatay taşma yok. 404 gerçekten 404 dönüyor, mobil menü çalışıyor, oynatıcı
tam 16:9. Çıkanlar iyileştirme kalemiydi.

### Düzeltilenler

| # | Ne | Nerede |
| --- | --- | --- |
| 1 | **Logo zinciri gerçekten çalışır hâle geldi** (`.png` → `.svg` → düz yazı) + sonuç modül düzeyinde hatırlanıyor | [index.tsx](src/routes/index.tsx) |
| 2 | Ana sayfaya sayfanın tek `h1`'i; vitrin seri başlıkları `h1` olmaktan çıktı | [index.tsx](src/routes/index.tsx) |
| 3 | Slayt noktaları: tıklama alanı 6×6 px → **24×28 px** (görsel aynı kaldı) | [styles.css](src/styles.css) |
| 4 | `/izle/*` sekme başlığı: `seri + bölüm` | [izle.$slug.tsx](src/routes/izle.$slug.tsx) |
| 5 | `/izle/*` ve `/admin` sayfalarına `h1` | [izle.$slug.tsx](src/routes/izle.$slug.tsx), [admin.tsx](src/routes/admin.tsx) |
| 6 | 404 sayfası: logo + "Tüm seriler" / "Türler" linkleri + sekme başlığı | [__root.tsx](src/routes/__root.tsx) |
| 7 | Footer linkleri 20 px → ~36 px; "Yakında" rozeti 10 → 11 px | [index.tsx](src/routes/index.tsx) |
| 8 | `/auth` input'ları 14 px → **16 px** (iOS'ta odaklanınca sayfa zoom yapıyordu) | [auth.tsx](src/routes/auth.tsx) |

Ek olarak (aynı turda):

| Ne | Değer |
| --- | --- |
| Vitrin slayt süresi | 20 sn → **24 sn** (video tam **18 sn** görünür) |
| `/admin` giriş kapısı | Gizli pencerede test edildi: **e-posta/şifre ekranı çıkıyor** — güvenli |

### 1 numaranın detayı: `anime-logo.svg` hiç gösterilemiyormuş

Denetim bunu "boşa giden 404 isteği" diye raporlamıştı; kodda bakınca altından
gerçek bir hata çıktı. Eski mantık:

```ts
const logo = logoState.failed ? sources[1] : sources[0];
if (logoState.failed || !logo) {
  return <h1 className="hero-title">{title}</h1>;   // ← buraya düşüyor
}
```

`.png` hata verir vermez fonksiyon **düz yazı başlığa** dönüyordu; yani `.svg`
yedeği **hiç denenmiyordu**. Mushoku Tensei hero'da logosunu hiç gösteremiyor,
her slayt dönüşünde de boşuna bir `.png` 404'ü üretiyordu.

Artık üç adımlı zincir gerçekten çalışıyor ve bulunan adres hatırlanıyor. Gerçek
tarayıcıda 4 slayt tek tek tıklanarak doğrulandı: **dördü de logosunu yüklüyor**.

### Bilerek bırakılan tek şey

`mushoku-tensei/anime-logo.png` için **tek bir 404 isteği** kalıyor. Görsel bir
sonucu yok (logo `.svg`'den geliyor), tarayıcıda görünmez. Tamamen kapatmak için
derleme manifestosu veya logoyu panele taşımak gerekir; ikisi de bu turun kapsamı
dışında. Gerekçesi ve üç seçenek raporun sonunda.

### Sırada

1. Seri detay sayfası + oynatıcı tasarımı (sonanime ölçümüyle)
2. Bölüm kapak fotoğrafları (`thumbnail_path`)
3. Küçük kalanlar: `supabase/config.toml` yanlış proje ref'i, `.supabase-token`,
   sitemap yenileme

---

## 14. Vitrin: yazı artık resimle birlikte soluyor + Mushoku Tensei logosu

### 14.1 Yazı/resim geçişi — kök neden ve çözüm

**Şikâyet:** sonanime'de slayt geçerken yazı resimle birlikte gidiyor; bizde yazı resimden
ayrı hareket ediyor.

**Ölçülen kök neden:** `.hero-content` tek bir öğeydi ve `key={content-<slug>}` taşıyordu.
Slayt değişince React o öğeyi **anında** silip yeniden kuruyordu. Tarayıcı ölçümü:
`.hero-content` computed opacity her örnekte **1** (hiç düşmüyor), `getAnimations()` boş;
slayt değişiminden ~100 ms sonra yeni logo hazır. Bu sırada arka plan görseli **1200 ms**'de
soluyordu. Yani **yazı 0 ms, resim 1200 ms** — senkron yoktu ve ilk 300 ms boyunca yeni yazı,
hâlâ %90 görünür olan eski sahnenin üstünde duruyordu.

**Çözüm:** içerik, slaytların kardeşi olmaktan çıkıp **slaytın içine** taşındı. Artık her
slayt = resim + karartma + yazı. Slaytların opacity geçişi hepsini birlikte soluyor.

| | Önce | Sonra |
| --- | --- | --- |
| Yapı | 1 adet `.hero-content` (slaytların kardeşi) | 4 adet `.hero-content`, her biri kendi slaytında |
| Yazının solma süresi | **0 ms** (anında) | **~1200 ms** (resimle aynı) |
| Çıkan yazı geçişte | DOM'dan siliniyordu | DOM'da kalıyor (mark testi: 4/4 hayatta) |
| Sürüklerken | yazı ayrı bir `translateX` alıyordu | slaytla birlikte hareket ediyor (ölçüm: Δ −550 / −550) |

Doğrulama: geçiş boyunca 8 örnek alındı; çıkan + giren slayt opacity toplamı **her örnekte tam
1.000** → birebir çapraz geçiş.

Yan etki olarak temizlenenler: `contentDragStyle`, `videoPlaying`, `currentHasVideo`,
`currentVideoKey` ve artık kullanılmayan `current` değişkeni.

Video ile yazı kapanması da slayt başına hesaplanıyor: yazı, video **gerçekten oynamaya
başlayınca** kapanır; **çıkan** slaytta ise fade bitene kadar kapalı kalır (yoksa fade
sırasında yazı yeniden açılıp görüntü bozuluyor).

### 14.2 Mushoku Tensei logosu — ölçülerek düzeltildi

Üç ayrı sorun vardı, üçü de SVG geometrisi hesaplanarak çözüldü:

**1) Eğiklik gerçekti.** SVG'nin path verisi ayrıştırılıp her harfin merkezi hesaplandı:

- Alt yazı satırı ("jobless reincarnation") 20 ayrı path — merkezleri (205,305) → (592,258)
- Eğim: **−0.0583 → −3.34°** (sağa doğru yükseliyor)
- Büyük kelimeler ("Mushoku"/"Tensei") ≈ −5°
- Uygulanan: `rotate(4 300 159.4)` — iki grubu da neredeyse düz yapıyor

Kırpılmasın diye viewBox büyütüldü: `0 0 600 320` → `-11 -21 622 360`.

**2) Koyu vitrinde kayboluyordu.** Logo siyah `#000` + turuncu `#e59922`; vitrinin sol
tarafı neredeyse siyah. Beyaz kontur, **alfa siluetinden** üretildi:

```css
filter:
  drop-shadow(1.5px 0 0 #fff) drop-shadow(-1.5px 0 0 #fff) drop-shadow(0 1.5px 0 #fff)
  drop-shadow(0 -1.5px 0 #fff) drop-shadow(0 8px 24px rgba(0, 0, 0, 0.45));
```

Neden path'lere `stroke` değil: bu logoda harfler birbirine geçiyor; her path'e ayrı stroke
eklenseydi üst üste binen harflerin arasında **beyaz çizgiler** oluşurdu. Zincirlenmiş
drop-shadow tek parça kontur üretir ve alttaki orijinal renkleri korur.

Kontur **yalnızca Mushoku Tensei'ye** uygulanır: `index.tsx` içindeki `LOGO_NEEDS_OUTLINE`
kümesi hangi serinin kontur alacağını belirler, CSS'te `.hero-logo--outline` sınıfı taşır.
(İlk denemede kural tüm `.hero-logo`'lara uygulanmıştı; diğer logolarda istenmediği için
seriye özel hâle getirildi.) Yeni bir koyu logo eklenirse slug'ını o kümeye yazmak yeterli.

Doğrulama (tarayıcı, computed `filter`): re-zero / jujutsu-kaisen / erased → yalnızca
`rgba(0,0,0,0.45)` gölge (eskisi gibi); mushoku-tensei → 4 beyaz katman + koyu gölge.

**3) Küçüktü.** `max-height: clamp(72px, 16vh, 160px)` yüzünden bu logo 480×160 kutuya
sığdırılınca **300×160** çiziliyordu (diğer logolar 480 px genişliği tam dolduruyor — %37 fark).
Sınır `clamp(72px, 20vh, 200px)` yapıldı. Geniş logolar (oran 3.0–4.7) zaten genişliğe takıldığı
için bu değişiklik **yalnızca** görece kare logoları etkiliyor.

Ölçüm: logo kutusu 480×200, boyanan alan **327×171** (öncesi 300×160), düz duruyor,
4 katman beyaz kontur var, koyu zeminde okunuyor.

### 14.3 Doğrulama (gerçek tarayıcı)

| Kontrol | Sonuç |
| --- | --- |
| `.hero-slide` / `.hero-content` | 4 / 4 — hepsi kendi slaytında |
| Geçişte içerik DOM'da kalıyor mu | 4/4 işaretli öğe hayatta |
| Yazı↔resim solma senkronu | Toplam her örnekte 1.000, süre ~1200 ms |
| Sürüklerken yazı | Resimle aynı miktarda kayıyor (Δ −550 / −550) |
| Oklar / noktalar / butonlar | Çalışıyor, imleç pointer |
| 6 sn sonra video + yazı kapanması | Video geliyor, `.hero-details` 167 → 0 px kapanıyor |
| Logo (slayt 2) | Düz, 327×171, beyaz kontur, okunur |
| Konsol hatası | 0 |
| Yatay taşma / örtüşme | Yok |

`tsc --noEmit` temiz · `eslint` temiz · XML geçerli.

---

## 15. Kırık logo (SSR yarışı) + sürüklerken kaybolan el imleci

### 15.1 Mushoku logosu neden kırık görünüyordu

Dosyada sorun **yoktu**: `GET /static/anime-data/mushoku-tensei/anime-logo.svg` → 200,
`image/svg+xml`, 20.667 bayt, XML geçerli, BOM yok. Yani SVG sağlamdı.

**Gerçek sebep bir yarış durumu (race condition):**

1. Sunucu HTML'e **ilk kaynağı** koyar: `…/anime-logo.png`
2. O dosya yok → tarayıcı 404'ü alır ve `error` olayını **hemen** ateşler
3. React henüz **hidrasyonu bitirmemiştir** → `onError` bağlı değildir → olay **hiç
   işlenmez**
4. `setStep` hiç çalışmaz → görsel `.svg` yedeğine **geçemez** ve kırık resim simgesi +
   alt metni ekranda kalır (sayfa yenilenene kadar)

Bu yüzden aralıklı oluyordu: hidrasyon hatadan önce yetişirse sorun yok, yetişmezse kırık
kalıyordu. Nitekim testte 3/3 turda sorun çıkmadı — ama mekanizma gerçek ve kullanıcı
ekran görüntüsünde yakaladı.

**Çözüm:** kaynak her değiştiğinde durum `onError`'a bırakılmadan **elle** kontrol edilir:

```ts
const imgRef = useRef<HTMLImageElement>(null);
useEffect(() => {
  const node = imgRef.current;
  if (node && node.complete && node.naturalWidth === 0) {
    setStep((value) => value + 1);   // hidrasyondan önce hata almış → bir sonraki kaynak
  }
}, [source]);
```

`complete === true` + `naturalWidth === 0` = "yüklenmeye çalışıldı ve başarısız".
Böylece yarış ortadan kalkıyor.

⚠️ Not: Bu düzeltme yarışı kapatıyor; ilk kaynağın `.png` olup 404 dönmesi hâlâ devam
ediyor (bkz. §Düzeltme turu → "Kalan tek 404"). Tamamen kaldırmak için derleme
manifestosu gerekir.

### 15.2 Sürüklerken el imleci kayboluyordu

**İki ayrı sebep vardı:**

**1) Farede dikey titreme sürüklemeyi iptal ediyordu.** `onHeroPointerMove` içinde
"dikey hareket baskınsa sürüklemeyi bırak" kuralı vardı. Bu kural **dokunmatik** için
gerekli (sayfayı parmakla kaydırma), ama farede karşılığı yok; el 24 px'ten fazla aşağı
kayınca sürükleme sessizce iptal oluyor, `.is-dragging` sınıfı kalkıyor ve **el imleci
bir anda yok oluyordu**. Artık bu kural yalnızca fare dışı girdilerde geçerli:

```ts
if (event.pointerType !== "mouse" && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 24) { … }
```

**2) İçerikteki bağlantı/butonların kendi imleci.** `.is-dragging` yalnızca bölüme
`cursor: grabbing` veriyordu; sürükleme sırasında fare bir bağlantının üstüne gelince
onun `cursor: pointer` değeri kazanıyordu. Artık sürükleme boyunca hepsi kilitli:

```css
.hero-section.is-dragging,
.hero-section.is-dragging * {
  cursor: grabbing !important;
}
```

**Doğrulama (tarayıcı):** sürüklemenin başı/ortası/sonu — 3/3 örnekte `.is-dragging` var
ve `cursor: grabbing` (fare açıklama metninin üzerindeyken bile). 60 px sola + 35 px aşağı
sürükleme artık sürüklemeyi **iptal etmiyor**; bırakınca ~300 ms'de temizleniyor.
Logo 3/3 tam yenilemede çizildi (naturalWidth 622, `complete: true`, kırık simge yok,
alt-metin fallback'i yok). Konsol: **0** uygulama hatası.

⚠️ Test sınırı: Gerçek fare sürükleme aracı olmadığı için sürükleme, bölüme gönderilen
pointer olaylarıyla simüle edildi (React kök olayları görüyor). Cache-bypass'lı zorunlu
yenileme aracı da yok; yenileme normal navigasyonla yapıldı.

---

## 16. Detay sayfası: bölüm kartları + araç çubuğu + kapak altyapısı

Yön kararı: sonanime kopyası değil, **"streaming platformu kalitesi"** (Crunchyroll/Netflix
ürün dili) + mevcut koyu/kırmızı kimlik. Referanslar: bölüm kartı → Crunchyroll,
"izlemeye devam et" şeridi → Netflix, yoğun bölüm gezinme → animecix, bilgi hiyerarşisi →
AniList/MyAnimeList.

### 16.1 Eklenenler

| Ne | Nerede | Not |
|---|---|---|
| `show_episodes.thumbnail_path` | migration | Aşağıdaki SQL çalıştırılmalı |
| Bölüm kapağı imzalama | `content.ts` `fetchShowDetail` | Kapaklar **tek** imzalama isteğinde çözülür (300 bölüm = 300 istek değil) |
| `EpisodeCard` | `src/components/EpisodeCard.tsx` | Yeni bileşen: 16:9 görsel, numara, süre, hover'da oynat |
| Araç çubuğu | `seri.$slug.tsx` | Sezon sekmeleri + "Bölüme git" + ızgara/liste geçişi |
| "Bölüme git" | `seri.$slug.tsx` | Numarayı yaz → kart görünür olur, kaydırılır, ~3,2 sn vurgulanır |
| Sayfalama | `seri.$slug.tsx` | Bir seferde 24 kart + "N bölüm daha göster" |
| "Devamını oku" | `seri.$slug.tsx` | 280 karakterden uzun açıklama 3 satıra kısalır |
| Kompaktlaştırma | `seri.$slug.tsx` | Bant yüksekliği, poster, h1, dikey boşluklar küçültüldü |

### 16.2 Çalıştırılacak SQL

`supabase/migrations/20260926_episode_thumbnails.sql`:

```sql
alter table public.show_episodes add column if not exists thumbnail_path text;
```

**Bu SQL çalıştırılmadan da site çalışır:** sorgular `select("*")` kullandığı için kolonun
yokluğu hata üretmez, kapaklar yedek görsele düşer. Kapaklar ancak kolon eklendikten ve
panelden yüklendikten sonra görünür.

### 16.3 Yedek kapak kararı (bulanık)

Kapak yüklenmemiş bölümler serinin vitrin görselini kullanır. İlk denemede görsel net
gösterildi; tarayıcı ölçümü + ekran görüntüsü şunu ortaya çıkardı: **aynı kolaj görsel 24
kez tekrarlanınca sayfa "ucuz" görünüyor** ve ortadaki numara görselin içinde kayboluyor.

Bu yüzden yedek görsel **`blur(6px)` + `opacity .55` + `scale-110`** ile bulanıklaştırılıyor:
seriden gelen yumuşak bir renk alanına dönüşüyor, tekrar hissi kayboluyor ve numara net
okunuyor. Bölüme ait gerçek kapak varsa görsel net gösterilir (hover'da hafif zoom).

Kapak sayısı arttıkça kartlar kendiliğinden "fotoğraf kartı"na dönüşür.

### 16.4 Ölçülen doğrulamalar (`/seri/jujutsu-kaisen`)

| Test | Sonuç |
|---|---|
| Kart sayısı | 24/24 (`#bolum-1` … `#bolum-24`) |
| Izgara | Masaüstü 4 sütun, kart 260×174, gap 16 px; mobil 390 px'te 2 sütun |
| Yatay taşma | Yok (masaüstü ve mobil) |
| Bölüme git (geçerli) | Sayfa kaydı `0 → 191`, kart ortalandı, **altın çerçeve çizildi** |
| Bölüme git (geçersiz) | "9999. bölüm bu sezonda yok." uyarısı |
| Vurgu süresi | ~25 ms'de uygulanıyor, ~3,2 sn sonra kalkıyor |
| Görünüm değiştirici | Izgara ⇄ liste; listede 24 satır, görsel yok |
| Konsol hatası | **0** |
| `tsc` / `eslint` | Temiz |

### 16.5 Sırada

Oynatıcı sayfası (kompakt şerit + yatay kayan bölüm şeridi) → "izlemeye devam et"
(ana sayfa şeridi + buton durumu) → panelden kapak yükleme.

**Not:** "İzlemeye devam et" bölüm bazlı olacak; oynatıcı 3. parti iframe olduğu için
içindeki saniye okunamaz (saniye bazlı ilerleme çubuğu yapılamaz).

---

## 17. Bölüm kapakları: animecix satır düzeni + otomatik kapak (veritabanısız)

### 17.1 Satır düzeni (animecix tarzı) — varsayılan görünüm

Bölümler artık **satır satır** listeleniyor, ızgara alternatif olarak duruyor
(sağ üstteki görünüm değiştirici, varsayılan = satır).

Satır içeriği (soldan sağa): kapak görseli (224×127) → bölüm başlığı → "N. Bölüm" rozeti.
Kapak üzerinde altta `S01 B03` etiketi, ortada (kapak yoksa) büyük bölüm numarası.

**Neden rozet başlığın yanında, en sağda değil:** animecix'te rozetler en sağa yaslı ama
oradaki satırın ortasını **bölüm açıklaması** dolduruyor. Bizde 24 bölümün 24'ünde de
`summary` ve `duration` **boş** (ölçüldü). Boş alanla birlikte rozeti en sağa yaslayınca
satırın ortası ~650 px'lik kocaman bir boşluk gibi görünüyordu. Açıklama girilirse alt
satır kendiliğinden dolar.

### 17.2 Otomatik kapak — hiç migration/script gerekmiyor

Embed sayfası incelendi (`https://morencius.com/embed/<kod>`). Sayfa, aynı kodla bir
**sahne karesi** yayınlıyor:

```
https://morencius.com/embed/<kod>   →   https://pixibay.cc/<kod>.jpg
```

Bu dönüşüm `content.ts` içindeki `episodeCoverFromWatchUrl()` ile yapılıyor. Yani panelde
bölüme sadece embed adresi girilir, **kapak kendiliğinden gelir**; yeni bölüm eklendikçe
kapağı da otomatik olur. Veritabanı kolonu, script, migration gerekmez.

> ⚠️ TUZAK: aynı kodun `_xt.jpg` eki de çalışıyor ama o **25 küçük kareden oluşan bir
> mozaik** (storyboard). Kapak olarak kullanılamaz. Eki olmayan `.jpg` kullanılmalı —
> tek, temiz, 16:9 (720×405) sahne karesi verir. Bu ayrım kodda yorumla işaretlendi.

### 17.3 Kapak kapsamı ve yedek davranışı

Sağlayıcıda bazı kareler **yok** (sunucu 504 döndürüyor, her uzantıda tekrarlandı) —
ör. 1., 2. ve 4. bölüm. Yani kapsam tam değil, ~%60.

Böyle durumlarda `<img>` hata verir → `EpisodeCard` otomatik olarak **serinin vitrin
görseline** düşer (bulanık + büyük bölüm numarası). Ölçüldü: kırık resim simgesi kalmıyor,
konsola hata düşmüyor.

Kapak sırası: **panelden yüklenen kapak (`thumbnail_path`) → oynatıcının sahne karesi →
serinin vitrin görseli (yedek)**.

### 17.4 Ölçülen sonuçlar (`/seri/jujutsu-kaisen`)

| Test | Sonuç |
|---|---|
| Satır ölçüsü | 1088 × 153 px · kapak 224 × 127 px (`sm:w-56`), 16:9 |
| Kapak etiketi | `S01 B01` … okunuyor |
| Rozet | `N. Bölüm`, altın (accent), başlığın 12 px yanında |
| Otomatik kapak | Yüklenen: tek kare, **720 × 405**, `.jpg` (mozaik değil) |
| Kapak yüklenmeyen satır | Bulanık vitrin görseli + büyük numara (kırık resim yok) |
| Görünüm değiştirici | Satır ⇄ ızgara (ızgara 5 sütun) |
| Mobil 390 px | Taşma yok, metin kırpılmıyor |
| Konsol | **0 hata** |
| `tsc` / `eslint` | Temiz |

### 17.5 Açık kalanlar

- **Kapsam %100 değil** (sağlayıcıda kare olmayan bölümler). Bunu %100'e çıkarmanın tek
  yolu akıştan kare almak (ffmpeg kurulu) — ama bu, sağlayıcının video akışını indirmeyi
  gerektirir; hem oynatıcının akış adresini kovalamak kırılgan hem de ek bir bağımlılık.
  Şimdilik sağlayıcının kendi karesi kullanılıyor.
- **`show_episodes.thumbnail_path` migration'ı artık ZORUNLU DEĞİL.** Sadece panelden elle
  kapak yüklemek istendiğinde gerekir. SQL: `alter table public.show_episodes add column
  if not exists thumbnail_path text;`
- **Supabase CLI kurulu değil** (`supabase: CommandNotFoundException`). Migration'ı
  çalıştırmak için ya SQL Editor'e yapıştırmak ya da önce `supabase login` + `link` yapmak
  gerekiyor.

---

## 18. Bölüm kataloğu rötuşları + kapak katmanı hatası

### 18.1 İstenen değişiklikler

| İstek | Yapılan |
|---|---|
| "Bölüme git" kutusu ve "Git" düğmesi gereksiz | **Tamamen kaldırıldı** (input, düğme, `onJump`, `jumpValue`, `jumpError`, vurgu çerçevesi ve ilgili `useEffect` dahil — ölü kod bırakılmadı) |
| `S01 B01` değil `S1 B1` | Sıfır dolgusu kaldırıldı (`pad()` silindi) |
| Etiketin arkasına alttan yukarı hafif gölge | Etiketin arkasına 36 px yüksekliğinde `from-background/95 → transparent` katmanı eklendi |
| Katalog biraz daha daralsın, kapaklar küçülsün | Bölümler bölümü **896 px** (`max-w-4xl`, önceki 1088 px) · kapak **192×107** (`sm:w-48`, önceki 224) |

Ölçüm: satır 896×135 · kapak 190×107 · etiket `S1 B1` · mobil 390 px'te satır 95 px, taşma yok.

### 18.2 Kapak katmanı hatası (yakalandı ve düzeltildi)

Yeni katman düzenine geçildikten sonra tarayıcı ölçümü şunu gösterdi: **kapakların
hepsi `opacity: 0` kalıyordu** — `naturalWidth` 720 olan, yani başarıyla yüklenmiş
kapaklar bile görünmüyordu.

**Sebep:** `onLoad` olayı yalnızca görsel, dinleyici bağlıyken yüklendiğinde çalışır.
Görsel tarayıcı önbelleğinden geldiğinde (veya React hidrasyondan önce yüklendiğinde)
olay **hiç ateşlenmez** ve kapak sonsuza kadar gizli kalır.

**Çözüm:** `ref` ile bağlanma anında durum elle kontrol edilir:

```ts
if (node.complete) setCoverState(node.naturalWidth > 0 ? "loaded" : "failed");
```

> Bu, logo yarışıyla (§15.1) **aynı hata sınıfı**. Kural: bir görselin yüklenip
> yüklenmediğine `onLoad`/`onError`'a güvenerek karar verme; `complete` +
> `naturalWidth` ile mutlaka doğrula.

### 18.3 Kapak katman düzeni (boş kutu sorunu)

Yedek görsel artık **her zaman en altta** durur; bölümün kapağı yüklenince üstüne
yumuşakça biner (500 ms opacity geçişi).

Bunun sebebi ölçülen bir davranış: sağlayıcı bazı bölümlerde kapak isteğine **504**
dönüyor ve cevap **20-60 saniye** sürebiliyor. Eski düzende o süre boyunca kart boş
siyah bir kutu gibi görünüyordu. Yeni düzende yedek görsel + büyük bölüm numarası
anında görünür, kapak gelirse üstüne biner.

Katman sırası: yedek görsel → bölüm kapağı → karartma → numara → `S1 B1` → hover oynat.

### 18.4 1., 2. ve 4. bölümlerin kapağı neden yok

Sağlayıcıda **o görseller yok.** Doğrulama: `pixibay.cc/<kod>.jpg` ve `_xt.jpg`
adresleri o üç bölüm için **9 denemede de 504** döndü (2-3 sn arayla, 60 sn timeout
ile). Embed sayfasının kendisi de aynı bozuk adresi gösteriyor — yani sorun bizim
türetmemizde değil, kaynakta.

Diğer bölümlerde (3, 5, 6, 7, 8 …) kapaklar geliyor ve **tek, temiz, 720×405 sahne
karesi** olarak yükleniyor.

### 18.5 Sezon seçimi — öneri

Şu anki **düğmeli (chip) sezon seçici kalmalı**:
- Tek dokunuşla geçiş; açılır liste gibi "aç → seç → kapan" adımı yok
- Hangi sezonların var olduğu bir bakışta görünüyor
- Az sezonlu serilerde (1-4) en hızlı çözüm

Sezon sayısı arttığında (6+) chip'ler alt satıra kayar; bu da kabul edilebilir. Çok
fazla sezonlu serilerde (10+) satır şişerse o zaman açılır listeye geçilir — bu, tek
bir bileşen değişikliğidir.

---

## 19. Bulanıklık düzeltmesi · sağ boşluk teşhisi · Supabase CLI

### 19.1 Bulanık kapaklar → bilinçli "numara kartı"

Yedek olarak serinin vitrin görselini **bulanıklaştırmak** ilk bakışta fena durmuyordu
ama gerçek kapakların yanında "bozuk / yarım yüklenmiş görsel" izlenimi veriyordu.

Yeni davranış: kapak gelmediğinde kart **düz bir degrade zemin + ortada büyük bölüm
numarası** gösterir. Bulanıklık tamamen kalktı.

Ölçüm: görselsiz satırlarda kapak alanında **0 `img`** var (boşuna görsel isteği yok),
görselli satırlarda 1. Konsol hatası 0.

### 19.2 Gerçek kapakların "yumuşak" görünmesi — kaynak dosya

Sağlayıcıdaki varyantlar ölçüldü:

| Dosya | Ölçü | Boyut |
|---|---|---|
| **`.jpg`** (kullandığımız) | **720 × 405** | 36 KB … **9 KB** |
| `_xt.jpg` | 875 × 493 | 86-100 KB (**25'li mozaik**, kapak olamaz) |
| `_t.jpg` | 200 × 112 | 2-5 KB (çok küçük) |

`_o.jpg`, `_hd.jpg`, `_orig.jpg`, `_original.jpg`, `_xl.jpg`, `_b.jpg` → **yok**.

Yani `.jpg` mevcut en iyi tek kare. **Bazı bölümlerin karesi yalnızca 9 KB** (720×405
için aşırı sıkıştırılmış) — bu yüzden bulanık görünüyor. Kaynak kalitesi bizim
tarafımızda düzeltilebilecek bir şey değil.

### 19.3 Sağdaki boş şerit bir SİTE HATASI DEĞİL

Kullanıcı: "her yenilediğimde sağ tarafta boş alan, kaydırma çubuğu ortada duruyor."

Tarayıcıda ölçüldü (1600×1000 viewport):

| Ölçüm | Değer |
|---|---|
| `documentElement.clientWidth / scrollWidth` | **1585 / 1585** (taşma yok) |
| `body` rect | x 0, width 1585, **right 1585** |
| `main` rect | x 0, width 1585, **right 1585** |
| En sağdaki öğeler | hepsi `right = 1585` · boşluk **0 px** |
| Yatay kaydırma çubuğu | **yok** |

**Sayfa, kendi viewport'unu birebir dolduruyor. Hiçbir öğe sağda boşluk bırakmıyor.**

İki kanıt daha:
1. Kullanıcının tarayıcısı **Google Chrome değil, Microsoft Edge**
   (`...Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0`).
2. Ekran görüntüsündeki şerit **orta gri** (#3a3a3a) ve içinde yuvarlatılmış bir panel
   çerçevesi var. Sitenin kendi zemini ise neredeyse siyah. Yani o şerit sayfanın
   parçası olamaz — tarayıcının **sağ kenar çubuğu (Copilot/sidebar) panelidir**.

Bu panel yenileme sonrası kalıcıdır ("her yenilemede yine oluyor") ve F12 ile DevTools
açılıp kapanınca sayfa yeniden akışa girdiği için geçici olarak düzelir ("F12 ile
düzeliyor"). **Çözüm: Edge'de sağdaki kenar çubuğunu kapatmak** (sağ üstteki kenar
çubuğu/Copilot simgesinden veya panelin kapatma düğmesinden). Kod tarafında
düzeltilecek bir şey yok.

### 19.4 Supabase CLI kuruldu

- `supabase` **devDependency** olarak eklendi → `npx supabase --version` = **2.117.0**
- `supabase/config.toml` içindeki `project_id` **yanlıştı** (`qcmyivkqrwjkccrtcyqo`);
  gerçek proje ref'i ile değiştirildi → **`zbcsjvxzlcxhnyzmnapu`**
  (Bu, denetim raporundaki "config.toml düzeltilmeli" maddesiydi.)
- `npx supabase db push` denendi → beklenen mesaj: *"Cannot find project ref. Have you
  run supabase link?"* Yani **tek eksik `link`**.

Kalan tek adım (bir kez, kullanıcı yapar — tarayıcı ve DB şifresi gerektirir):

```bash
npx supabase login
npx supabase link --project-ref zbcsjvxzlcxhnyzmnapu
```

Bundan sonra migration'ları **ben** uygulayabilirim:

```bash
npx supabase db push
```

Bu tamamlanınca bekleyen `show_episodes.thumbnail_path` migration'ı da uygulanabilir
(panelden elle kapak yüklemek için gerekli; otomatik kapaklar onsuz da çalışıyor).

---

## 20. Oynatıcı sayfası: sağ bölüm paneli (animecix düzeni)

### 20.1 Yeni yerleşim

`/izle/$slug` baştan yazıldı. Eski "numara çipleri" listesi kaldırıldı.

| Bölge | Ne var |
|---|---|
| Sol (esnek) | Oynatıcı (16:9) + altında bölüm bilgisi + "Önceki / Sonraki bölüm" |
| Sağ (320 px) | **Bölüm paneli**: başlık, sezon seçici (çok sezonluysa), kaydırılabilir bölüm listesi |
| Mobil | Panel oynatıcının **altına** iner |

Panel satırı: küçük kapak (80 px, 16:9) + `N. Bölüm` + bölüm adı. Aktif bölüm altın
arka plan + çerçeve ile vurgulanır (`aria-current="page"`).

Sezon seçici panelde açılır liste (`<select>`): 320 px'lik dar alanda çipler sarıp
taşıyordu. Detay sayfasında çipler kalıyor — iki bağlam, iki çözüm.

### 20.2 Kaydırma hatası (yakalandı ve düzeltildi)

Panel açılırken aktif bölüme kaydırma **iki farklı sebeple** çalışmadı:

1. `ref` doğrudan `Link` bileşenine veriliyordu; TanStack Router'ın `Link`'i ref'i DOM
   düğümüne iletmiyor → `activeRef.current` hep `null`. Ref `<li>` öğesine taşındı.
2. Ref düzelse de **`scrollIntoView` hiç kaydırmadı**: effect, yerleşim oturmadan
   çalışıyordu. Çözüm: `requestAnimationFrame` ile çizim beklenir ve kapsayıcının
   `scrollTop`'u **elle** hesaplanır (satır kapsayıcının ortasına getirilir).

Ölçüm (`?b=20`): `scrollTop` **796** (> 0), aktif satır görünür alanın ortasında
(top 514 / panel 143-823), **yenileme sonrası da aynı**. Konsol 0 hata.

### 20.3 1., 2. ve 4. bölümün kapağı — sağlayıcıda YOK

Denenen her yol:

| Yol | 1 · 2 · 4 | Çalışan bölümler |
|---|---|---|
| `pixibay.cc/<kod>.jpg` (tek kare) | **504** | ✅ 720×405 |
| `pixibay.cc/<kod>_xt.jpg` (25'li mozaik) | **504** | ✅ 875×493 |
| `pixibay.cc/<kod>0000.jpg` (seek kare sayfası) | **404** | ✅ 2000×1120 |
| `pixibay.cc/<kod>0001.jpg` | 200 ama **320×240 / 1 KB** (boş) | aynı |
| `_o / _hd / _orig / _original / _xl / _b` | **yok** | yok |

Yani sağlayıcının varlık hattı o üç bölüm için hiçbir görsel üretmemiş. Bizim
türetmemizde hata yok.

**Ama video akışı bulundu** (ağ izlemesiyle):

```
master.txt  →  HLS, 480p / 720p / 1080p
segmentler .woff2 uzantısıyla maskelenmiş (anti-scrape)
```
`ffmpeg` kurulu olduğu için bu akıştan **gerçek kare almak mümkün**. Ancak:
- Akış adresi video başına **opaque token** içeriyor ve sayfa bunu paketlenmiş
  (obfuscated) JS ile üretiyor → script'le yeniden üretilemez, her bölüm için ayrı
  ağ izlemesi gerekir.
- Yani bu, **ölçeklenebilir bir boru hattı değil**; en fazla eksik bölümler için
  tek seferlik bir çözüm olur.

**Karar bekliyor** (kullanıcıya soruldu): akıştan kare çıkarma (tek seferlik, gri
alan) mi, yoksa panelden **elle kapak yükleme** yolu mu (kalıcı, `thumbnail_path`
+ panel yükleme kutusu; Supabase CLI bağlandıktan sonra migration uygulanabilir).

---

## 21. Oynatıcı sayfası genişletildi · kapak zinciri · 2 ve 4. bölüm neden kırık

### 21.1 Oynatıcı sayfası artık geniş

Şikâyet: "sayfanın kenarları boşa mı var, neden ortaya sıkıştırmışsın?"

`/izle/$slug` sayfası dar sütundan (`max-w-7xl` = 1280 px) **tam genişliğe** alındı
(`max-w-[1800px]`, kenar boşluğu `px-4 lg:px-6`). Diğer sayfalar dar sütunda kalıyor;
oynatıcı sayfası bilinçli olarak geniş.

Ölçüm (1600 px viewport):

| | Önce | Sonra |
|---|---|---|
| Oynatıcı | 874 × 492 | **1210 × 681** (+38 %) |
| Satır toplamı | ~1194 | **1552** (viewport 1600) |
| Sağ panel x | ~1160 | **1256** |

Yatay taşma yok (`scrollWidth = 1600`), konsol 0 hata.

### 21.2 Kapak zinciri

Yeni `EpisodeCover` bileşeni kapakları **sırayla** dener, biri gelmezse sonrakine
geçer; hepsi tükenirse bölüm numarası gösterilir:

1. **Panelden yüklenen kapak** (`show_episodes.thumbnail_path`)
2. **Oynatıcının karesi** — `episodeCoverFromWatchUrl()` (çoğu bölümde çalışır)
3. **Yerel kare** — `/static/episode-covers/<slug>-s<sezon>e<bölüm>.jpg`
   (`localCoverPath()`; `static/` olduğu için imza gerekmez)

Sıra bilinçli: sağlayıcının karesi önce denenir çünkü çoğu bölümde çalışıyor — böylece
gereksiz istek oluşmuyor. Yerel dosya yalnızca o yoksa istenir (dosya yoksa 404 döner ve
zincir numaraya düşer).

### 21.3 1. bölümün kapağı — videodan kare

Sağlayıcı 1. bölüm için görsel vermiyordu (bkz. §20.3). Video ise **çalışıyor**
(11:57'ye kadar oynadı). Kare, oynatıcıdan **ekran görüntüsü** alınıp kırpılarak
üretildi:

```
public/static/episode-covers/jujutsu-kaisen-s1e1.jpg   (1280×720, 50 KB)
```

Kırpma, oynatıcı alanının 16:9 bölgesinden yapıldı; sağ üstteki küçük logo izini
dışarıda bırakmak için alan sola/aşağı kaydırıldı. Sonuç: temiz, arayüzsüz kare.

> **Otomatik yol neden kullanılamadı:** ffmpeg ile akıştan kare almayı denedim (HLS master
> adresi ağ izlemesiyle bulundu), ama medya sunucusu tarayıcı dışı istemcilere
> **HTTP 522** dönüyor (Cloudflare koruması). Yani "her bölüm için otomatik kare" şu an
> mümkün değil; akış adresleri de video başına opaque token içeriyor.

### 21.4 ⚠️ 2. ve 4. bölümün VİDEOSU bozuk

Kare alınırken ortaya çıktı ve asıl sebep bu:

| Bölüm | Video durumu |
|---|---|
| **2** | **"Bu video dosyası oynatılamıyor. (Hata Kodu: 232001)"** — 3 denemede de aynı |
| **4** | 35 saniye boyunca yükleme ekranında kaldı, hiç başlamadı (0:00 / 23:54) |
| 1 | Çalışıyor (kare alındı) |

Yani o iki bölüm **sağlayıcı tarafında kırık içerik**. Kapaklarının olmaması bunun
belirtisi; aynı bozuk varlık hattı hem videoyu hem kapağı üretmemiş.

**Çözüm:** o bölümlere **çalışan embed adresleri** girilmeli (panelden `watch_url`
güncellemesi). Adres düzelince kapak da otomatik gelecek — zincirin 2. adımı çalışır.

### 21.5 Doğrulama

| Test | Sonuç |
|---|---|
| 1. bölüm kapağı (detay + panel) | `/static/episode-covers/jujutsu-kaisen-s1e1.jpg`, **naturalWidth 1280**, opacity 1 ✅ |
| 3. bölüm kapağı | `pixibay.cc/hijas5axpc32.jpg`, 720 ✅ |
| 2 · 4. bölüm | numara kartı (videoları bozuk) |
| Panel kapakları | 22/24 gerçek görsel yüklendi |
| Konsol | 0 hata |
| `tsc` / `eslint` | Temiz |

---

## 22. Oynatıcı sayfası rötuşları: boyut · hiza · kaydırma çubuğu · üst şerit

### 22.1 Oynatıcı küçültüldü + hizalama

Kapsayıcı `max-w-[1800px]` → **`max-w-[1440px]`**, yan boşluk `lg:px-6` → `lg:px-8`
(sitenin diğer sayfalarıyla aynı). Üst şerit ve `<main>` **aynı kapsayıcıyı** kullanıyor.

| | §21 sonu | Şimdi |
|---|---|---|
| Oynatıcı | 1210 × 681 | **1034 × 582** |

**Hiza ölçümü** (1600 px viewport):

| Kenar | Değer |
|---|---|
| Oynatıcı sol | 113 px |
| Logo sol | 113 px → **tam hizalı** |
| Sağ panel sağ | 1487 px |
| "Anasayfa" sağ | 1488 px (**1 px** fark) |

Logo 3-4 px sağda kalıyordu; sebep, logo bağlantısındaki `px-1` dolgusuydu — kaldırıldı.

### 22.2 Bölüm panelinin kaydırma çubuğu

Yeni `.ince-kaydirma` sınıfı (styles.css):

- **Öncelik: tamamen gizlemek** (`scrollbar-width: none`) — kaydırma tekerlekle çalışıyor.
- Tarayıcı gizlemeyi desteklemiyorsa varsayılan **beyaz/kalın/çerçeveli** görünüm yerine
  **6 px, koyu (#4a4a52), kenarlıksız** bir çubuk çizilir. Ok düğmeleri kapalı.

Ölçüm: `scrollHeight 1426 > clientHeight 680` (kaydırılıyor) · `scrollbar-width: none` ·
kaydırma çubuğuna giden genişlik **0 px**.

### 22.3 Aktif bölüm vurgusu

- **Çerçeve (ring) kaldırıldı** — istek üzerine.
- Yalnızca dolgu: `bg-accent/15`. Ölçüm: `box-shadow: none`, arka plan sarı %15,
  padding 6 px, radius 16 px.
- Satır aralığı sıkılaştırıldı (`space-y-0.5`, `gap-2.5`).
- **Renk kararı: altın (accent) kalıyor.** Gerekçe: sayfadaki **kırmızı** aksiyonlara
  (oynat düğmesi, "Sonraki bölüm") ayrılmış durumda. Seçili durumu da kırmızı yapmak,
  "buradasın" bilgisiyle "tıkla" çağrısını aynı renge sokardı. Altın, ikisini ayırıyor.

### 22.4 Üst şerit düzeni

| Önce | Sonra |
|---|---|
| Logo · seri adı (düz metin) · **"← Detay"** (altın) | Logo · **seri adı (bağlantı → seri sayfası)** · **🏠 Anasayfa** |
| (detay sayfasında) **"← Geri"** | **🏠 Anasayfa** |

- "Detay" bağlantısı kaldırıldı: aynı işi seri adı yapıyor, üst şerit sadeleşti.
- "Geri" kaldırıldı: tarayıcının kendi geri düğmesi var; yerine her sayfada aynı olan
  ana sayfa bağlantısı kondu.
- Seri adı artık tıklanabilir (`href="/seri/<slug>"`).

Doğrulama: üst şerit metni `shanime | Jujutsu Kaisen | Anasayfa` · "Detay" **yok** ·
"Geri" **yok** · Anasayfa ikonlu · seri adı bağlantı · **konsol 0 hata** ·
`tsc` + `eslint` temiz.

---

## 23. Oynatıcı/panel hizası + üst şeritteki tıklama alanı

### 23.1 Üst şeritteki fazla tıklama alanı

**Şikâyet:** İmleç, "Jujutsu Kaisen" yazısının bayağı sağına götürüldüğünde bile hâlâ
tıklanabilir görünüyordu.

**Sebep:** Seri adı bağlantısı `flex-1` taşıyordu — yani yazıdan sonra kalan **tüm boş
alanı** da kapsıyordu; imleç o boş alanda da "el" oluyordu.

**Çözüm:** `flex-1` kaldırıldı, `max-w-[60%] truncate` verildi; "Anasayfa" bağlantısına
`ml-auto` eklendi (sağa yaslı kalsın diye).

Ölçüm: bağlantının genişliği **89 px**, metnin genişliği **89 px** → **fazladan tıklama
alanı 0 px**.

### 23.2 Panelin alt kenarı oynatıcıya denk getirildi

**İstenen:** Sağdaki bölüm kutusunun alt kenarı, oynatıcı kutusunun alt kenarıyla tam
denk gelsin (simetrik dursun).

**İlk deneme (YANLIŞ):** `grid` ile panel birinci satıra alındı, satır yüksekliğini
oynatıcının belirlemesi beklendi. Ama **panel içeriği (24 satır) satırı kendisi
büyüttü**: oynatıcı sarmalayıcısı **1473 px**'e gerildi, videonun (582 px) altında
**~890 px boş siyah alan** oluştu. Ölçüm bunu yakaladı.

**Doğru çözüm:** Oynatıcı normal akışta kalır ve **yüksekliği o belirler**; panel
masaüstünde sağa **mutlak konumlanır** ve `inset-y-0` ile tam oynatıcının yüksekliğine
oturur. Sağdaki `340 px` dolgu, panelin (320 px) + 20 px boşluğun yerini ayırır.
Panel içindeki liste `flex-1 min-h-0 overflow-y-auto` ile kalan alanı doldurup kendi
içinde kaydırılır.

Mobilde panel normal akışa döner (oynatıcının altına iner) ve `max-h-[60vh]` ile sınırlıdır.

### 23.3 Ölçümler (1600 × 1000)

| Öğe | top | bottom | height |
|---|---|---|---|
| Oynatıcı sarmalayıcı | 97 | **681** | **584** |
| Oynatıcı (iframe) | 98 | 680 | 582 |
| Sağ panel (`aside`) | 97 | **681** | **584** |

- Alt kenar farkı: **0 px** ✅
- Videonun altında boş siyah alan: **yok** ✅
- Panel kaydırma: `scrollHeight 1426` / `clientHeight 537` → kaydırılıyor ✅
- Bilgi satırı + Önceki/Sonraki: panelin **dışında**, oynatıcı genişliğinde, çakışma yok ✅
- Mobil 390×844: panel oynatıcının altında, yüksekliği tam **60vh** (506 px), yatay taşma yok ✅
- **Konsol: 0 hata** · `tsc` + `eslint` temiz

---

## 24. Siyah bölümler (2 ve 4): teşhis — video mu, kapak mı?

Kullanıcının sorusu: *"1, 2 ve 3 hâlâ siyah görünüyor. Videoyu baştan mı yükleyeyim,
earnvids.com ayarlarından bir şey mi yapayım?"*

### 24.1 Mimari (doğrulandı)

Embed HTML'i hem **earnvids** hem **pixibay** referansı taşıyor:

| Ne | Adres |
|---|---|
| Panelde girilen | `morencius.com/embed/<kod>` — earnvids'in **alternatif oynatıcı alan adı** |
| Kapak (otomatik) | `pixibay.cc/<kod>.jpg` — aynı platformun görsel CDN'i |
| Storyboard (otomatik) | `pixibay.cc/<kod>_xt.jpg` |

Yani **tek anahtar: 12 karakterlik kod.** Kod sağlıklıysa oynatıcı da kapak da o koddan gelir.
Kapak elle yüklenmez, sağlayıcı üretir.

Tüm kodlar `^[a-z0-9]{12}$` biçiminde — **yazım hatası yok**, hepsi aynı formatta.

### 24.2 Sağlayıcıda ne var, ne yok

| Bölüm | Kapak `.jpg` | Storyboard `_xt.jpg` | Oynatma |
|---|---|---|---|
| 1 | **504** | **504** | ✅ çalışıyor (karesi yerelden alındı) |
| 2 | **504** | **504** | ❌ siyah — `00:00 / 00:00` (süre bile yüklenmiyor) |
| 3 | 200 | 200 | ✅ çalışıyor |
| 4 | **504** | **504** | ❌ siyah — `00:00 / 23:55` (süre var, akış yok) |
| 5 | 200 | 200 | ✅ çalışıyor |
| 6 | 200 | 200 | ✅ çalışıyor |

Tarayıcı ölçümü: 2 ve 4'te oynat'a basıldıktan 20-30 sn sonra hâlâ **siyah + dönen
yükleme çemberi**; ekranda **hiçbir hata kodu yok** (sessiz başarısızlık). 3. bölüm ise
oynatıcı önizlemesini yükleyip hazır bekliyor.

### 24.3 Kritik ayrım: iki AYRI sorun var

**(a) Oynatma** — 2 ve 4'ün videosu sağlayıcıda oynanabilir değil. 4. bölümde süre
(23:55) okunuyor ama akış gelmiyor → yarı işlenmiş/kaldırılmış dosya görüntüsü.

**(b) Kapak** — Kapak üretimi oynatmadan **bağımsız** ve sağlayıcıda **güvenilmez**.
Kanıt: **1. bölümün videosu sorunsuz çalışıyor ama sağlayıcıda kapağı da storyboard'u da
YOK (504).** O kapağı videodan ben aldım.

Bu yüzden: **yeniden yükleme (a)'yı çözer, (b)'yi garanti etmez.** Yeni kod da kapaksız
gelebilir; 1. bölüm bunun canlı örneği.

### 24.4 Panelde bölüm kapağı yükleme YOK

`show_episodes.thumbnail_path` kolonu ve `thumbnail` alanı var, kapak zinciri de önce
onu deniyor — ama **`SeasonsPanel.tsx` içinde kapak yükleme arayüzü yok**. Yani şu an
tek yol otomatik türetme veya yerel dosya koymak.

### 24.5 Öneri

1. **Sadece 2 ve 4'ü yeniden yükle** (24 bölümü değil).
2. Yükleme **tamamen kodlanana** kadar bekle — kodlama sürerken oynatıcı tam da
   böyle davranır (siyah, donuk sayaç).
3. Yeni embed adresini panele gir.
4. Kapak için: yeni kodda da kapak gelmezse, geçici çözüm olarak bölüm kapağı yükleme
   arayüzünü panele eklemek (kolon + Storage zaten hazır, yalnızca arayüz eksik) veya
   kapağı benim yerelden koymam gerekir.

---

## 25. VidMoly geçişi + kapakların otomatikleşmesi + genel kontrol

### 25.1 Geçiş tespit edildi

Kullanıcı video hosting'ini değiştirdi. Veritabanı okuması:

| | Önce | Sonra |
|---|---|---|
| 1–23. bölüm | `morencius.com/embed/<kod>` | **`vidmoly.org/embed-<kod>.html`** |
| 24. bölüm | `morencius.com/embed/<kod>` | değişmemiş |

### 25.2 KRİTİK: geçiş kapakları kırdı

`episodeCoverFromWatchUrl` kodu "son yol parçası"ndan alıyordu. VidMoly biçiminde son
parça `embed-q2qr7ilbi945.html` oluyor ve `^[a-z0-9]{6,}$` sınavını geçemiyordu — yani
**1–23. bölümün kapak adresi boş dönüyordu.** (Panelde elle kapak yüklenmediği için
bölümlerin tamamı numara kartına düşecekti.)

Ayrıca gizli bir hata daha vardı: adres `vidmoly.org/embed/<kod>` biçiminde girilseydi
kod geçerli sayılır ve yanlışlıkla `pixibay.cc/<kod>.jpg` istenirdi (404).
**Türetme artık alan adına bağlı** — yalnızca `morencius.com` için çalışıyor.

### 25.3 VidMoly kapakları koddan TÜRETİLEMEZ

Kapak adresi embed sayfasının içinde, `image:` alanında:

```
vidmoly.org/embed-q2qr7ilbi945.html
  → https://transit-up-1170-i.vmwesa.online/i/01/02950/q2qr7ilbi945.jpg
```

CDN alan adı (`transit-up-1170-i`, `1171-e`, `1164-r`… — bölümden bölüme değişiyor) ve
`01/02950` yolu sağlayıcıya özel. `vidmoly.org/i/<kod>.jpg`, `/thumb/<kod>.jpg`,
`/api/v1/thumb/<kod>` gibi 12 kalıp denendi → **hepsi 404.**

Kapakları çalışma anında çekmek de olmazdı: her sayfa açılışında 24 dış istek + tarayıcıda
CORS engeli.

### 25.4 Çözüm: kapaklar bir kez çekilip dosyaya yazılıyor

- **`scripts/sync-episode-covers.mjs`** — tüm bölümleri gezer, VidMoly embed sayfasından
  `image:` alanını okur, `src/data/episode-posters.json` dosyasına yazar.
- **`npm run covers:sync`** ile çalıştırılır. **Yeni bölüm ekledikten sonra bir kez çalıştır.**
- Betik **idempotent**: çekim başarısız olursa o bölümün **eski kapağı korunur**, yarım bir
  çalıştırma çalışan kapakları silmez.
- Kapak zinciri (EpisodeCard + izleme paneli):

  1. panelden yüklenen kapak (`thumbnail_path`)
  2. **`posterCoverPath` → dosyadan gelen sağlayıcı kapağı** ← yeni
  3. `episodeCoverFromWatchUrl` → morencius türetmesi (eski kayıtlar için)
  4. `localCoverPath` → yerel dosya
  5. bölüm numarası

Sonuç: **24/24 kapak HTTP 200.** Panelde elle kapak yüklemeye gerek yok.

### 25.5 Video tarafı da düzeldi

Eski teşhiste (§24) 2. ve 4. bölüm oynatılamıyordu. Yeni hosting'de **hepsinde HLS akışı
var**. Tarayıcı testi: 2. bölüm oynatıcısı yüklendi ve önizleme gösteriyor (artık siyah değil).

### 25.6 Genel kontrol

| Kontrol | Sonuç |
|---|---|
| `npm run build` | ✅ başarılı (431 ms, exit 0) |
| `tsc --noEmit` | ✅ temiz |
| `eslint` | ✅ temiz |
| Detay sayfası (`/seri/jujutsu-kaisen`) | 24 satır, **24/24 kapak**, kırık `<img>` yok, konsol temiz |
| İzleme paneli | 24/24 kapak, doğru bölüm vurgulu |
| Ana sayfa | 4 slayt + 4 kart, tüm görseller yüklü, konsol temiz |
| Derin bağlantı `?sezon=1&b=7` | ✅ URL korundu, 7. Bölüm yüklendi, panel doğru |
| Mobil 390×844 (detay + izleme) | ✅ yatay taşma yok (375 ≤ 390) |
| Ağ hataları | 500 yok. Görülen 404'ler **tarayıcı eklentisinden** (`/api/ext/*`), siteyle ilgisiz |
| `robots.txt` | ✅ `/admin`, `/auth`, `/izle/` kapalı |
| `sitemap.xml` | ✅ 5 adres, veritabanıyla tutarlı |

**Not:** VidMoly oynatıcısı kendi reklamını gösteriyor (`FB hacked` tarzı popup). Bu
sağlayıcının reklamı, bizim arayüzden gelmiyor.

### 25.7 Temizlik

- `supabase/.temp/` **`.gitignore`'a eklendi** (makineye özel CLI durumu).
- Projede geçici/çöp dosya **bulunamadı** (log, `.tmp`, `.bak`, `shots/` — hiçbiri yok).
- `public/static/anime-data/` **çöp değil**: vitrin logosu, banner yedeği ve seri kapakları
  hâlâ oradan okunuyor (veritabanı `image_path` alanları bu dosyaları gösteriyor).
- **Açık konu:** depoda **iki kilit dosyası** var — `bun.lock` (20 Eyl, izlenen) ve
  `package-lock.json` (23 Eyl, izlenmeyen). `node_modules` **npm** ile kurulmuş
  (`node_modules/.package-lock.json` var). İkisini bir arada tutmak sürüm sürprizlerine yol
  açar; birinin seçilmesi gerekiyor. **Silmedim** — hangisini kullanacağını sen söyle.
- `static/episode-covers/jujutsu-kaisen-s1e1.jpg` **silinmedi**: artık gereksiz ama zincirin
  son halkası; sağlayıcı CDN'i değişirse yedek olarak devrede kalıyor.

---

## 26. Kapak otomasyonu (tek tık) · kilit dosyası · GitHub

### 26.1 Kapaklar artık gerçekten otomatik

§25'te kapaklar bir betikle (`npm run covers:sync`) dosyaya yazılıyordu. Bu, yeni bölüm
eklendiğinde **bir komut çalıştırmayı** gerektiriyordu. Kaldırıldı.

**Kilit bulgu:** VidMoly embed sayfası **CORS başlığı gönderiyor**
(`Access-Control-Allow-Origin`). Yani sayfa tarayıcıdan doğrudan okunabiliyor — ayrı bir
sunucu/servis katmanına gerek yok. Tarayıcıda doğrulandı:

```
CORS_OK https://transit-up-1170-i.vmwesa.online/i/01/02950/q2qr7ilbi945.jpg
```

**Yeni akış (`src/lib/episode-covers.ts`):**

1. Panelde bölüm **eklenir/güncellenir** → `syncAllEpisodePosters()` arka planda çalışır.
2. Yalnızca kapağı **eksik** bölümler için istek atılır (1 yeni bölüm = 1 istek).
3. Sonuç `site_settings` tablosuna (`episode_posters`) yazılır.
4. Site bölüm verisini zaten çalışma anında Supabase'den okuduğu için kapak
   **yayına almaya (deploy) gerek kalmadan** görünür.

Ayrıca panelde **"Kapakları güncelle"** düğmesi var (elle tazeleme için).

Zincir: panel kapağı → sağlayıcı kapağı (dosya + veritabanı) → morencius türetmesi →
yerel dosya → bölüm numarası.

**Doğrulama (uçtan uca):**

| Adım | Sonuç |
|---|---|
| Detay sayfası | **24/24 kapak**, 0 numara kartı, konsol temiz |
| İzleme paneli | **24/24 kapak** |
| CORS testi (tarayıcı) | `CORS_OK` — kapak adresi okundu |
| Panel düğmesi | Basıldı → *"Tüm bölüm kapakları zaten güncel."* |
| `site_settings` kaydı | Oluştu · **24 kapak** · 2192 karakter |
| SSR HTML (okuma yolu) | 23 vidmoly + 1 pixibay = **24 kapak adresi** sunucuda uygulanıyor |

### 26.2 Kilit dosyası nedir, neden sorun oluyordu

Kilit dosyası, kurulu her paketin **tam sürümünü** yazan bir kayıttır. Amaç: projeyi
başka bir makinede kurunca birebir aynı sürümlerin gelmesi. `package.json` "şu aralıkta
olsun" der, kilit dosyası "tam olarak şu sürüm" der.

Sorun: depoda **iki ayrı kilit dosyası** vardı — `bun.lock` (Bun) ve `package-lock.json`
(npm). İki liste birbiriyle çelişirse, kim kurdu ise ona göre farklı sürümler gelir.

**Karar: Bun kaldı.** Gerekçe: `bun.lock` zaten commit'li ve `bunfig.toml` bilinçli bir
**tedarik zinciri koruması** taşıyor (`minimumReleaseAge = 86400` — 24 saatten yeni
sürümler kurulmaz). Bu koruma npm'de yok.

Yapılanlar:
- `package-lock.json` depodan çıkarıldı (izlenmiyordu, üretilmiş dosyaydı).
- `.gitignore`'a eklendi → npm bir komut çalıştırsa bile depoya geri giremez.
- `supabase/.temp/` de `.gitignore`'a eklendi.

**Kalan tek konu:** makinedeki Bun **1.1.0**, ama `bun.lock` **metin biçiminde**
(`lockfileVersion: 1`) — bu biçim Bun **1.2+** ile geliyor. Yani kurulum yapmadan önce
Bun'un güncellenmesi gerekiyor:

```bash
bun upgrade
```

Güncellenmezse Bun eski ikili biçimi (`bun.lockb`) arayıp yeni bir dosya üretir — o da
istediğimiz "tek kilit dosyası" durumunu bozar. **Siteyi çalıştırmayı etkilemez**; yalnızca
paket kurulumu için geçerli.

### 26.3 GitHub

- Uzak depo bağlı: `github.com/shanimex/shanime-website`
- **Commit hazır:** `1d9c12d` — 37 dosya, +5868 / −1193
- Çalışma alanı **temiz** (commit edilmemiş değişiklik yok)
- `origin/main`'in **1 commit önünde** → push edilmeye hazır
- Güvenlik: `.env` yok sayılıyor; commit içeriği tarandı, **gizli anahtar/parola yok**
  (işaretlenen iki satır `GRANT ALL ON ... TO service_role;` — standart SQL, sır değil)

---

## 27. Eski kalıntılar · kilit dosyası kararı · GitHub · CDN dönmesi · hydration

### 27.1 Eski kalıntılar: veritabanı tertemiz

| Kontrol | Sonuç |
|---|---|
| Bölüm video adresleri | **24/24 `vidmoly.org`** · eski sağlayıcı (`morencius`) **0 kayıt** |
| Kullanılmayan bileşen/modül | **YOK** (tüm `src` tarandı) |
| `src/components/ui/` | yalnızca `button.tsx` (gerisi daha önce temizlenmiş) |
| `public/static/anime-data/` | **Kullanımda**: vitrin logosu, banner yedeği, seri kapakları (veritabanı `image_path` alanları burayı gösteriyor) |
| Kalan tek kalıntı | `public/static/episode-covers/jujutsu-kaisen-s1e1.jpg` → **silindi** (eski sağlayıcıdan alınan kareydi, VidMoly kapağı çalışıyor) |
| Boş klasör | `public/static/episode-covers/` kaldırıldı |

Kaynak kodda görülen `morencius` / `pixibay` ifadeleri kalıntı **değil**: `lib/admin.ts`
panelde birden çok video ailesini kabul ediyor (EarnVids, VidMoly, Doodstream,
StreamWish, Morencius) ve `episode-covers.ts` eski kayıtlar için o adresleri de
çözebiliyor. Bilinçli çok-sağlayıcı desteği.

### 27.2 Kilit dosyası: karar Bun

Makinede `bun` **kullanıcı kurulumu değil** — `…\AppData\Roaming\Accio\external-tools\…\bun.exe`
(agent'ın yönetilen aracı, sürüm 1.1.0). `node_modules` ise **npm** ile kurulmuş.

Karar: **Bun bildirimi korundu** (`bun.lock` izlenen tek kilit dosyası). Gerekçe:
`bunfig.toml` bilinçli bir **tedarik zinciri koruması** taşıyor
(`minimumReleaseAge = 86400` — 24 saatten yeni paket sürümleri kurulmaz) ve bu koruma
npm'de yok. `package-lock.json` depodan çıkarıldı ve `.gitignore`'a eklendi, böylece
depoda tek kilit dosyası kalıyor ve çakışma imkânsız.

### 27.3 GitHub: gönderildi

`https://github.com/shanimex/shanime-website` — 4 commit gönderildi:

| Commit | İçerik |
|---|---|
| `7d2556d` | VidMoly geçişi, kapak otomasyonu, izleme sayfası düzeni |
| `0ff8ae9` | Eski yerel kapak silindi, "Kapakları güncelle" tazeleme modu |
| `ae7b074` | Kendini onaran kapak (CDN dönmesi) |
| `04b83b5` | Hydration hatası düzeltmesi |

Çalışma alanı temiz · gizli anahtar/parola yok (`.env` yok sayılıyor).

### 27.4 KRİTİK: push canlı siteyi güncellemiyor

`shanime.xyz` **push'tan sonra da eski derlemeyi** sunuyor:

| | Canlı | Yerel derleme |
|---|---|---|
| CSS | `styles-eXZ52L23.css` | `styles-Ky76RRy5.css` |
| JS | `seri._slug-BVcWMqjS.js` | `seri._slug-B-wjlzp9.js` |

Kanıt: canlı CSS varlığının `Age` başlığı **96445 sn (~27 saat)**; sayfalarda
"Anasayfa" bağlantısı yok. 10 dakika beklendi, değişmedi.

Depoda `.github/workflows` **yok**, `wrangler` **kurulu değil**, Cloudflare oturumu
**yok** → yerelden yayın yapılamıyor. Yayın hedefi Cloudflare
(`.output/server/wrangler.json` → worker adı `shanimex-shanime-website`).

**Yapılması gereken (tek seferlik):** Cloudflare panelinden bu depoyu bağlayıp
otomatik yayını açmak. Sonrasında her `git push` siteyi günceller. Alternatif: bir kez
`npx wrangler login` yapılıp `npm run build` + `npx wrangler deploy`.

### 27.5 Kapaklar: CDN dönmesi ve kendini onarma

Yeni bir sorun bulundu ve çözüldü. Sağlayıcının CDN adresi **dönüyor**:

```
transit-up-1170-i.vmwesa.online/i/01/02950/<kod>.jpg   → 404
box-1659-u.vmbox.space/i/03/02950/<kod>.jpg            → 200
```

Yani kayıtlı kapak adresi gün içinde geçersiz kalıyor (1., 2., 3. bölüm 404 oldu;
24 kapak 6 ayrı CDN alanına dağılmış durumda). Çözüm iki katmanlı:

1. **Kendini onarma** (`resolvePosterForEpisode`): görsel yüklenemezse embed
   sayfasından GÜNCEL adres okunur (CORS açık) ve oturum boyunca `sessionStorage`'da
   tutulur. Kullanıcı hiçbir şey yapmaz.
2. **"Kapakları güncelle"** düğmesi artık TÜMÜnü tazeler (`force`); bölüm eklenince
   otomatik çalışan yol yalnızca eksikleri çözer.

### 27.6 Hydration hatası (bulundu ve düzeltildi)

Kapak adresi modül durumundan okunduğu için sunucu veritabanı haritasını, istemci ise
dosyadaki tohumu kullanıyordu → React "hydration mismatch" uyarısı. Artık kapak
`fetchShowDetail` içinde çözülüp **bölüm nesnesinin `poster` alanına** yazılıyor;
nesne serileştirildiği için ilk çizimde iki taraf aynı adresi kullanıyor.

### 27.7 Uçtan uca doğrulama

| Test | Sonuç |
|---|---|
| **Otomatik kapak**: panele test bölümü eklendi | Bildirim *"1. sezonun 25. bölümü eklendi."* → 8 sn sonra kartta **gerçek kapak** (butona basmadan) ✅ |
| Test bölümü silindi | *"25. bölüm silindi."* · veritabanında 24 bölüm ✅ |
| "Kapakları güncelle" | *"24 bölüm kapağı tazelendi."* ✅ |
| Detay sayfası | **24/24 kapak** ✅ |
| İzleme paneli | **24/24 kapak** ✅ |
| Hydration uyarısı | detay + izle + ana sayfa → **0** ✅ |
| Konsol hatası | **0** ✅ |
| Derleme · `tsc` · `eslint` | temiz ✅ |

---

## 28. Projenin tamamen bağımsızlaşması + yayının düzelmesi

### 28.1 Platform sarmalayıcısı ve tüm izleri kaldırıldı

Proje artık hiçbir dış platform sarmalayıcısına bağlı değil. Kaynak ağacında,
derleme çıktısında ve canlı HTML'de **sıfır** iz var.

**Kaldırılanlar:**

| Ne | Neden |
|---|---|
| `vite.config.ts` içindeki platform `defineConfig` sarmalayıcısı | Yerine standart Vite + TanStack Start yapılandırması yazıldı |
| `package.json` → sarmalayıcı bağımlılığı + `vite-tsconfig-paths` | `@` takma adı artık Vite 8'in yerleşik `resolve.tsconfigPaths` desteğiyle |
| `.lovable/` | Platforma özel proje kimliği |
| `AGENTS.md` | Platforma ait yönerge bloğu |
| `src/lib/lovable-error-reporting.ts` | Platform editörüne telemetri gönderiyordu |
| `src/integrations/supabase/previewAuthStorage.ts` | Önizleme oturumunu editör penceresine aktaran köprü |
| `src/integrations/supabase/cron-auth.ts` | Kullanılmıyordu, platforma özel ortam değişkenleri okuyordu |
| `bun.lock`, `bunfig.toml` | Fabrikaya ait kilit dosyası özel bir npm kayıt defterine işaret ediyordu |

**Değişenler:** Supabase istemcisi artık standart `localStorage` kullanıyor; hata
mesajları Türkçe ve platformdan bağımsız.

**Sonuç:** Depoda tek kilit dosyası var (`package-lock.json`, herkese açık
kaynaktan), `npm audit` **0 açık** veriyor.

### 28.2 Yayın neden çalışmıyordu — KÖK NEDEN

Site **Cloudflare Pages**'te yayınlanıyor (`shanime-website` projesi,
`shanimex/shanime-website` deposuna bağlı, `main` dalı, otomatik yayın açık).
Yani push → derleme → yayın zinciri kuruluydu. Sorun derlemenin çökmesiydi:

```
failed to load config from /opt/buildhome/repo/vite.config.ts
Error: Cannot find module '../lightningcss.linux-x64-gnu.node'
```

**Sebep:** `package-lock.json` Windows'ta üretildiği için Linux'a özel yerel
ikiliyi (`lightningcss-linux-x64-gnu`) içermiyordu. Cloudflare'in Linux
sunucusunda kilit dosyasına göre kurulum yapılınca o ikili gelmiyor, CSS
işleyicisi yüklenemiyor ve derleme daha yapılandırmayı okurken çöküyordu.

**Sonuç:** 6 ardışık derleme başarısız → site **4 gündür** eski sürümde donmuştu.

**Çözüm:** `node_modules` ve kilit dosyası silinip **temiz kurulum** yapıldı.
Yeniden üretilen kilit dosyası artık tüm platformların yerel ikililerini içeriyor
(`lightningcss-linux-x64-gnu`, `oxide-linux-x64-gnu`).

### 28.3 İkinci düzeltme: yayın hedefi Pages'e sabitlendi

`vite.config.ts` içindeki Nitro preset'i `cloudflare-pages` olarak sabitlendi.
Gerekçe: Pages, çıktı olarak `dist/` klasörünü bekliyor
(`dist/_worker.js`, `_routes.json`, `_headers`, statik dosyalar). Preset otomatik
algılamaya bırakılınca **yerelde** `cloudflare-module` seçilip `.output/`
üretiliyordu — yani yerel derleme ile üretim hedefi uyuşmuyordu. Artık ikisi de
`dist/` üretiyor.

### 28.4 Üçüncü düzeltme: bozuk bir yerel shim

`node_modules/.bin/vite.exe` (eski bir bun shim'i) `npm run build` komutunu
`could not find bin metadata file` hatasıyla çökertiyordu. Kaldırıldı; derleme
artık `npm run build` ile de sorunsuz.

### 28.5 Doğrulama

| Kontrol | Sonuç |
|---|---|
| Kaynak ağacında platform izi | **0** |
| Derleme çıktısında platform izi | **0** |
| **Canlı site** (`shanime.xyz`) | **Yeni sürüm yayında** ✅ |
| Canlı detay sayfası | 77.355 karakter, "Anasayfa" var, **48 SSR kapak adresi**, eski "Geri" yok |
| Canlı ana sayfa | hero çalışıyor |
| Canlıda "lovable" geçişi | **0** |
| Derleme · `tsc` · `eslint` | temiz |
| `npm audit` | **0 açık** |
| Yerel dev sunucusu | HTTP 200, 48 SSR kapak |
| Git | Çalışma alanı temiz, tüm commit'ler push edildi |

**Bundan sonra:** `git push` → Cloudflare Pages otomatik derleyip yayınlıyor.
Ek bir işlem gerekmiyor.

---

## 29. "Yakında" rozeti canlıda TÜM kartlarda çıkıyordu — bulundu ve düzeltildi

### 29.1 Belirti

Canlı ana sayfada (oturum açmamış ziyaretçi) **dört kartın dördünde** de "Yakında" rozeti
vardı — 24 bölümü olan Jujutsu Kaisen dâhil. Aynı sebeple vitrindeki "N bölüm" satırı da
hiçbir seride görünmüyordu.

Ölçüm (canlı `shanime.xyz`, ham SSR HTML):

| Kontrol | Canlı (önce) | Beklenen |
| --- | --- | --- |
| "Yakında" rozeti | **4** | 3 (Re:Zero, Mushoku Tensei, Erased) |
| Vitrinde Jujutsu Kaisen "24 bölüm" satırı | **yok** | var |

### 29.2 Kök neden

Sayımlar `show_stats` görünümünden okunuyordu. O görünüm
`20260924_featured_and_stats.sql` migration'ında bilinçli olarak **anon role kapatılmış**
(`REVOKE ALL ... FROM anon`; yalnızca `authenticated` + `service_role`).

```
GET /rest/v1/show_stats?select=*
→ 401 {"code":"42501","message":"permission denied for view show_stats"}
```

Ana sayfa ziyaretçi (anon) olarak çalışır: istek reddedilince liste boş dönüyor,
`episode_count` her seri için `0` oluyor ve `episode_count === 0` koşuluna bağlı
"Yakında" rozeti **her kartta** çıkıyordu. Vitrindeki `episode_count > 0` satırı da aynı
sebeple kayboluyordu.

**Neden gözden kaçtı:** §10.2'deki doğrulama tarayıcıda **yönetici oturumu açıkken**
yapılmıştı; istek yetkili rolle gittiği için sayılar doğru geliyordu (3/4). Hata yalnızca
**çıkış yapmış ziyaretçide** görünüyordu.

### 29.3 Düzeltme

`show_stats` görünümü tamamen bırakıldı; sayımlar artık seri listesiyle **aynı istekte**,
veritabanında hesaplanıyor:

```
shows?select=*,show_episodes(count),show_seasons(count)&order=sort_order
```

| Ne değişti | Neden |
| --- | --- |
| `src/lib/content.ts` → `fetchShows` tek istek, gömülü `count` | Ziyaretçinin okuyabildiği tablolar; oturumdan bağımsız |
| `fetchShowStats` + `ShowStats` **silindi** | Gereksiz kaldı; seri nesnesi sayıları taşıyor |
| Gömülü sayım dizileri nesneden çıkarılıyor | Sayfa verisi kuru kalsın |
| `src/routes/admin.tsx` sayıları seri nesnesinden okuyor | Paneldeki "N sezon · M bölüm" de tek istek, aynı kaynak |

Kazanç: istek sayısı **2 → 1**; sayım SQL'de yapıldığı için 1000+ bölümlü seride de doğru
(PostgREST satır sınırına takılmaz).

**Canlı veritabanına dokunulmadı**, SQL/izin değişikliği gerekmedi. Artık kullanılmayan
`show_stats` görünümü istenirse tek satır SQL ile silinebilir.

### 29.4 Doğrulama

| Kontrol | Sonuç |
| --- | --- |
| "Yakında" rozeti (yerel ana sayfa, ham SSR) | **3** ✅ — Jujutsu Kaisen'de yok |
| Vitrin meta — Jujutsu Kaisen | `2020` + **`24 bölüm`** ✅ |
| Gerçek tarayıcı 1600×1000 — rozet sayısı | **3** ✅ (Re:Zero, Mushoku Tensei, Erased) |
| Gerçek tarayıcı 390×844 — rozet sayısı | **3** ✅ |
| Konsol hatası / hydration uyarısı | **0 / 0** ✅ |
| Kırık görsel (`naturalWidth === 0`) | **0** ✅ |
| Yatay taşma (masaüstü + mobil) | **yok** ✅ |
| `/seri/jujutsu-kaisen` bölüm satırı | **24** ✅ |
| `/izle/jujutsu-kaisen?sezon=1&b=2` panel satırı | **24** ✅ |
| `/admin` yerelde | `/auth`'a yönlendirdi (yerelde oturum yok) — beklenen |
| Derleme · `tsc` · `eslint` | temiz ✅ |

---

## 30. Reklamlar: kaynak tespiti, oynatıcı sandbox'ı ve boş bekleme ekranı

### 30.1 Şikâyet ve ölçüm

Kullanıcı bildirdi: mobilde bölüm açınca o kadar çok reklam çıkıyor ki başlat butonuna
dokunamıyor; "reklamlar videonun içine aynı videoyu tekrar açıyor"; masaüstünde bu kadar
rahatsız edici değil.

Ölçüm (gerçek tarayıcı; canlı site + sağlayıcının embed sayfası):

| Ölçüm | Sonuç |
| --- | --- |
| Bizim sayfada 3. taraf reklam script'i | **0** |
| Bizim sayfada reklam overlay'ı / popunder | **0** |
| Bizim reklam slotları | **hepsi boş** — `site_settings` içinde hiç `ad_*` anahtarı yok |
| VidMoly embed'inde reklam ağı script'i | **9** — AdSense (`adsbygoogle`), `llvpn.com` (×4), `mamshirt.com`, `portalfluently.com`, `eatenmockingoverwhelm.com` |
| Popunder motoru | **var** — `window.zfgloadedpopup = true` (PopAds) |
| Sağ-altta sabit reklam kutusu | **var** — `position: fixed`, `z-index: 2147483647`, 150×170 px |
| Oynatıcıya tıklama | sekme başlığı `(1) New Message!` olarak değişiyor (clickunder hilesi) |

**Sonuç:** Rahatsız eden reklamlar bizim sistemimizden **değil**, video sağlayıcısı
VidMoly'nin embed'inden geliyor. Bizim reklam slotlarımız tamamen boş — yani kendi
trafiğimizden şu an gelir üretilmiyor.

**Mobil/masaüstü farkının sebebi:** 150×170 px'lik sabit reklam kutusu oynatıcının
sağ-alt köşesine çakılı. Masaüstünde oynatıcı 1034×582 → kutu küçük bir köşeyi kaplıyor;
mobilde oynatıcı 341×192 → kutunun kapladığı alan oynatıcının yarısına yakın. Kullanıcının
"telefonda başlata dokunamıyorum, PC'de sorun değil" tarifi bununla birebir uyuşuyor.

### 30.2 Yapılan düzeltmeler

| Ne | Neden |
| --- | --- |
| `ad_preroll` boşken geri sayım atlanıyor (`izle.$slug.tsx`) | Kod yokken 5 saniyelik boş "Reklamı geç" ekranı göstermek ziyaretçiyi rahatsız etmekten başka işe yaramıyordu. Kod girilirse bekleme aynen geri gelir. |
| `useAdCode` kancası (`components/AdSlot.tsx`) | Bir slotun gerçekten boş olduğunu ayırt etmek için (kod yok ≠ henüz yüklenmedi). |
| Oynatıcı iframe'i `sandbox`SIZ bırakıldı | Aşağıdaki deneme başarısız oldu; gerekçesi kayda geçsin diye burada. |

Atlatma kararı yalnızca istemcide çalışan bir etkileşimle veriliyor; ilk çizim sunucuyla
aynı kaldığı için hydration farkı oluşmuyor.

**Sınır:** Sabit reklam kutusu ve popunder sağlayıcının kendi belgesinin İÇİNDE; cross-origin
olduğu için dışarıdan gizlenemez (aşağıdaki deneme bunu doğruladı).

### 30.3 Denendi ve GERİ ALINDI: oynatıcı iframe'ine `sandbox`

Popunder'ı engellemek için iframe'e `sandbox="allow-scripts allow-same-origin
allow-presentation"` eklendi. **Sonuç: oynatıcı kırıldı.**

| Ölçüm (aynı iframe, aynı `src`) | `sandbox` VAR | `sandbox` YOK |
| --- | --- | --- |
| 390×844 (mobil) | **"The embed could not be loaded."** | oynatıcı normal ✅ |
| 1600×1000 (masaüstü) | **"The embed could not be loaded."** | oynatıcı normal ✅ |
| Doğrudan `vidmoly.org` (embed, üst pencere) | — | her iki genişlikte normal ✅ |

Yorum: hata pencere genişliğinden değil, sağlayıcıdan da değil — **sandbox'ın kendisinden**.
VidMoly oynatıcısı sandbox altında çalışmayı reddediyor (muhtemelen reklam katmanını
engelleyen ortamları bilinçli olarak dışlıyor). Bu yüzden `sandbox` kaldırıldı;
`allow-popups`/`allow-top-navigation` vererek "gevşetmek" zaten koruma bırakmaz.

**Sonuç:** Bu sağlayıcı kullanıldığı sürece popunder/yeni sekme davranışı dışarıdan
engellenemiyor. Kalan seçenekler kullanıcı kararı ister: (a) sağlayıcı böyle kalsın,
(b) farklı video sağlayıcısı, (c) VidMoly'nin reklamsız seçeneği.

### 30.4 Doğrulama (geri alma sonrası)

| Kontrol | Sonuç |
| --- | --- |
| Geri sayım / "Reklamı geç" ekranı | **yok** — kod olmadığı için video hemen başlıyor ✅ (yükleme anında ~1 sn'lik bir kırpıntı görülebiliyor: reklam kodu sorgusu çözülene kadar) |
| Ana sayfa "Yakında" rozeti | **3** ✅ (Jujutsu Kaisen'de yok) |
| Vitrin — Jujutsu Kaisen | `2020` + **`24 bölüm`** ✅ |
| Panel — Jujutsu Kaisen satırı | **1 sezon · 24 bölüm** ✅ |
| Konsol hatası (ana sayfa, izle, panel) | **0** ✅ |
| Kırık görsel | **0** ✅ |
| `build` · `tsc` · `eslint` | temiz ✅ |

---

## 31. Mobil denetim (390×844) ve düzeltmeler

### 31.1 Ölçülen bulgular (gerçek tarayıcı, canlı site)

| Bulgu | Ölçüm | Ciddiyet |
| --- | --- | --- |
| Panelde seri adları görünmüyor | satırdaki metin alanı **0 px**'e çöküyordu; yalnızca 40×56 kapak görünüyordu | yüksek |
| Panel butonları kart sınırını aşıyor | son buton kartın ~10 px dışına taşıyordu | orta-yüksek |
| Vitrin okları içeriğin üzerinde | 64×64 oklar tür çipleri (y=352-379) ve özet metniyle (y=397-481) çakışıyordu | orta-yüksek |
| Slayt noktaları | dokunma alanı 24×28 ve komşularla **10 px kesişiyordu** (yanlış slayta gidiş) | orta |
| "Kayıt ol" bağlantısı | **284×16 px** — mobilde basılamıyor | orta |
| "Devamını oku" | **82×20 px** | orta |
| Sayfa taşması / kırık görsel / konsol hatası | yok / 0 / 0 | — |

**Hata olmayan bulgu:** `/seri/jujutsu-kaisen` sayfasında "24 bölüm" başlığına karşılık 20 satır
sayılması kusur değil — liste `GRID_PAGE_SIZE` (24) gruplar hâlinde çiziliyor ve ilk grupta
bölümlerin tamamı var. "N bölüm daha göster" butonu fazlası için duruyor.

### 31.2 Yapılan düzeltmeler

| Ne | Yer |
| --- | --- |
| Panel satırı mobilde sarar: ad/slug her zaman okunur, butonlar alt satıra iner | `components/admin/ShowRow.tsx` (`flex-wrap` + `min-w-[9rem]` + butonlar tek kapta) |
| Panel ikon butonları mobilde 40×40 (masaüstünde 36×36) | aynı dosya |
| Vitrin okları mobilde gizlendi (kaydırma + noktalar var) | `styles.css` mobil bloğu |
| Nokta dokunma alanı mobilde 34×34, aralık 28 px → kesişme bitti | `styles.css` + `index.tsx` (`gap-7 md:gap-2`) |
| "Kayıt ol" 40 px, "Devamını oku" 36 px yükseklik | `auth.tsx`, `seri.$slug.tsx` |
| Sahte bekleme ekranı kaldırıldı: geri sayım varsayılan **0** | `izle.$slug.tsx` |

**Tuzak (tekrar düşülmesin):** `.hero-indicators` diye bir sınıf YOK — göstergeler çubuğu
Tailwind sınıflarıyla çiziliyor (`gap-2`). CSS'e yazılan `.hero-indicators { gap: … }` kuralı
hiç uygulanmaz, çünkü utility katmanı bileşen katmanından önce gelir. Aralık JSX'ten
(`gap-7 md:gap-2`) değiştirilmeli.

### 31.3 Doğrulama (yerel, 390×844 ve 1600×1000)

| Kontrol | Sonuç |
| --- | --- |
| `.hero-nav` mobilde | `display: none`, kutu 0×0 ✅ |
| `.hero-nav` masaüstünde | görünür, 64×64 ✅ |
| Nokta dokunma alanları (mobil) | 34×34; komşu kesişimi **0 / 0 / 0** ✅ |
| Nokta yerleşimi (masaüstü) | `11px 9px` padding, 8 px aralık — **değişmedi** ✅ |
| Bekleme ekranı | 0,3 / 1 / 2 sn kontrollerinde hiç görünmedi ✅ |
| "Devamını oku" / "Kayıt ol" yüksekliği | 36 px / 40 px ✅ |
| Yatay taşma · konsol hatası | yok · 0 ✅ |
| `build` · `tsc` · `eslint` | temiz ✅ |

---

## 32. iPhone (Safari) denetimi: otomatik yakınlaştırma ve mobil arama

Kullanıcı siteyi iPhone + Safari ile kullanıyor. iPhone'da canlı hata ayıklama (Safari Web
Inspector) Mac gerektirdiği için denetim **kod taraması + 390×844 ölçümü** ile yapıldı.

### 32.1 Bulunan sorunlar

| Sorun | Ölçüm / kanıt | Durum |
| --- | --- | --- |
| **iOS Safari form alanına odaklanınca sayfayı otomatik yakınlaştırıyor** (16 px altı yazı boyutu) | Panel alanlarının çoğu `text-sm` (14 px), bir kısmı `text-xs` (12 px); ana sayfa arama kutusu 14 px. Panel telefonla kullanıldığı için her kutuya dokunuşta sayfa yakınlaşıp kayıyordu | **düzeltildi** |
| **Telefonda arama yok** | Arama düğmesi `hidden md:flex` ile masaüstüne kilitli; mobil menüde yalnızca 3 bağlantı vardı → telefonda seri aranamıyordu | **düzeltildi** |
| Mobil menüde bağlantıya basınca menü açık kalıyordu | `onClick` yoktu; menü içeriği kapatmıyordu | **düzeltildi** |
| Menü, arama listesi yüzünden ekranın yarısını kaplıyordu | Menü açıkken header 566 px (ekran 844 px) | **düzeltildi** → 306 px |
| Küçük telefonlarda ilk ekranda vitrin dışında hiçbir şey yok | 390×667: header 73 px + vitrin **560 px** = 633 px; `#series` y=**789** → tamamen ekran altında | **değiştirilmedi** — tasarım kararı, kullanıcıya soruldu |

**Hata olmayan:** vitrin videosu iOS için doğru ayarlı (`muted`, `loop`, `playsInline`, `autoPlay`) —
`playsInline` eksik olsaydı iPhone videoyu tam ekran açardı.

### 32.2 Yapılan düzeltmeler

| Ne | Yer |
| --- | --- |
| Mobilde form öğeleri 16 px'e sabitlendi | `styles.css` mobil bloğu (`input:not([type=checkbox]):not([type=radio]), textarea, select`) |
| Mobil menüye arama alanı + sonuç listesi | `index.tsx` (`#search-mobile`, aynı `query`/`filtered` durumu) |
| Sonuç satırı tek bileşende toplandı | `index.tsx` → `SearchResultItem` (masaüstü paneli ve menü aynı satırı kullanır) |
| Menü bağlantıları menüyü kapatıyor, sonuç seçimi de | `index.tsx` (`onClick={() => setMenuOpen(false)}`) |
| Menüdeki liste yalnızca yazarken görünür | `index.tsx` |

**Tuzak (tekrar düşülmesin):** mobil kırılımdaki `font-size: 16px` kuralında `!important` ŞART.
Tailwind utility katmanı bileşen katmanından sonra geldiği için, katman sırası özgüllükten önce
gelir; `!important` olmadan `text-sm` (14 px) kazanır. Yüksek özgüllük (`:not(...)`) da yetmez.

### 32.3 Doğrulama (yerel, 390×844 ve 1600×1000)

| Kontrol | Sonuç |
| --- | --- |
| `#search-mobile` varlığı ve yazı boyutu | var · **16 px** ✅ |
| Mobilde 16 px altı form alanı | **yok** ✅ |
| `/auth` `#email` / `#password` | 16 px / 16 px ✅ |
| Masaüstü arama kutusu | **14 px — değişmedi** ✅ |
| Menüde "juju" araması | **1 sonuç: Jujutsu Kaisen** ✅ |
| Sonuç yoksa mesaj | "Aramaya uyan seri yok." ✅ |
| Sonuç seçimi | menü kapandı, `#series`'e kaydı ✅ |
| Menü açıkken header yüksekliği | 566 px → **306 px** (panel 233 px) ✅ |
| Menü kapalıyken header | 73 px ✅ |
| Yatay taşma · konsol hatası | yok · **0** ✅ |
| `build` · `tsc` · `eslint` | temiz ✅ |

---

## 33. iPhone video kaydı incelemesi ve düzeltmeler

Kullanıcı 69 saniyelik bir iPhone kaydı paylaştı (4 sayfa: ana sayfa, arama, detay, oynatıcı,
panel). Kayıt 34 kareye bölünüp kare kare incelendi (`ffmpeg`), sorunlar ölçümle doğrulandı.

### 33.1 Kayıtta görülen sorunlar

| Sorun | Kanıt (kare / ölçüm) |
| --- | --- |
| Vitrin görselinin çok azı görünüyor | 16:9 banner, 375×608 portre kutuya `object-fit: cover` ile sığdırılınca görüntünün yalnızca **~%39'u** görünüyordu; karakter kadraj dışında kalıyordu |
| Arama sonucu yanlış yere götürüyor | Sonuç satırı `href="#series"` idi → sayfanın altındaki kart ızgarasına atıyordu |
| "Devamını oku" üstteki görseli de büyütüyor | Detay bandı `absolute inset-0` olduğu için metin uzayınca bölüm büyüyor, görselin kadrajı değişiyordu; masaüstünde ayrıca kapak `align-items: stretch` yüzünden uzuyordu |
| "Devamını oku" ile "Şimdi izle" üst üste | İkisi de satır içi kaldığı için aynı satıra düşüyorlardı (mobilde okunmuyordu) |
| Oynatıcıda reklam yağmuru | Sağlayıcının katmanı: oynatıcı içinde **VPN reklam kartı**, tıklamada yeni sekme (`tuiov.com`), boş reklam sayfası |
| Panel telefonda dağınık | Düzenleyicide kutu genişlikleri taşıyor, butonlar (Vitrin'e ekle / ↑ / ↓ / Kapat) ayrı satırlara dağılıyordu |

### 33.2 Yapılan düzeltmeler

| Ne | Yer | Nasıl |
| --- | --- | --- |
| Telefonda dikey kapak | `index.tsx` + `styles.css` | Vitrin görseli `<picture>` oldu: `max-width: 767px` için **dikey kapak** (2:3), üstü geniş banner. Tarayıcı yalnızca eşleşen kaynağı indirir. `.hero-picture` blok kutu olarak tanımlandı (içindeki görsel %100 yükseklikle hesaplandığı için şart). |
| Detay bandı sabit yükseklik | `seri.$slug.tsx` | Bant `h-60 md:h-80` (mobil 240 px / masaüstü 320 px) — artık içerikten bağımsız |
| Kapak uzaması bitti | `seri.$slug.tsx` | Kapak `self-start` + `aspect-[2/3]` (flex satırı büyüse de kapak sabit) |
| "Devamını oku" kendi satırında | `seri.$slug.tsx` | Buton blok sarmalayıcıya alındı |
| Arama sonucu detay sayfasına | `index.tsx` | `href={show.id ? \`/seri/${showSlug(show)}\` : "#series"}` |
| Panel düzenleyicisi mobil | `ShowEditor.tsx` | Kutu satırı `flex-wrap`; banner `w-36 sm:w-44`, video `w-32 sm:w-40`; ikon butonları mobilde 40×40; "Sezonlar **ve bölümler**" etiketi mobilde kısalıyor; "Kapat" `sm:ml-auto` |

### 33.3 Sınır: oynatıcı içi reklamlar

VidMoly oynatıcısının içindeki reklam katmanı **bizim sayfamızdan yönetilemiyor**: katman
sağlayıcının kendi belgesinde (cross-origin). `sandbox` denendi ve oynatıcıyı kırdı (bkz. §30).
Bu yüzden "oynatıcıda reklam çıkmasın" ancak **sağlayıcı değişikliğiyle** mümkün; karar kullanıcıda.

### 33.4 Doğrulama (yerel, 390×844 ve 1600×1000)

| Kontrol | Sonuç |
| --- | --- |
| Mobil vitrin görseli | dikey kapak **600×900 (2:3)**, kutu 379×615 ✅ |
| Masaüstü vitrin görseli | supabase geniş banner (5767×4092), **farklı URL** ✅ |
| Detay bandı (mobil) | "Devamını oku" öncesi/sonrası **240 / 240 px** ✅ |
| Kapak (mobil) | **192 / 192 px** ✅ |
| Kapak (masaüstü) | **176×264**, tıklamada değişmedi ✅ |
| "Devamını oku" / "Şimdi izle" | ayrı satırlar (y=563 / y=623), bindirme yok ✅ |
| Arama sonucu `href` | `/seri/jujutsu-kaisen` → tıklayınca doğru sayfa ✅ |
| Konsol hatası | **0** (tüm sayfalar) ✅ |
| `build` · `tsc` · `eslint` | temiz ✅ |

### 30.4 Bekleyen: `245305a` derlemesi başarısız

Cloudflare Pages, `245305a` commit'inin derlemesini **36 dk 17 sn** sonra öldürdü:

```
Failed: build exceeded the time limit and was terminated.
```

Derleme adımı 36 dakika boyunca hiç çıktı üretmedi (önceki başarılı derlemeler ~1 dk).
Hata lightningcss kaynaklı değil — altyapı tarafında takılma. Canlıdaki sürüm hâlâ
`6f0d93a`; yeni push yeni bir derleme tetikler.

---

## 34. VidMoly "reklamları kapat" ayarı + oynatıcıdaki beyazlık incelemesi

### 34.1 Reklamı kapatmak reklamı durdurmuyor

Kullanıcı VidMoly panelinden reklamları **tamamen kapattı** (panel "reklam gösterme", kazanç **$0**).
Buna rağmen oynatıcıda duraklatınca ve tam ekrandan çıkınca **2 reklam** görüyor.

Ölçüm (gerçek tarayıcı; sağlayıcının kendi embed sayfası):

| Ölçüm | Sonuç |
| --- | --- |
| Tam ekrandan ESC ile çıkış | **1 yeni sekme popunder** açıldı (zamanlama ESC ile örtüşüyor) |
| Embed gövdesindeki reklam alanları | `#vidmolyadblocktest.adsbygoogle.ad-unit.ad-zone` (1×1) ve `.afs_ads.ad-placement` (1×1) — o an boş/gizli olsa da altyapı yerinde |
| Oynat/duraklat/tam ekran sırasında görünür katman | yakalanamadı (limit/ödenek etkisi olabilir) |

**Sonuç:** "reklamsız" ayarı popunder/interstitial katmanını kaldırmıyor. Yani şu an **kazanç sıfır +
reklam devam** — en kötü durum. İki seçenek: (a) reklamı geri açıp karşılığını almak, (b) sağlayıcıyı
değiştirmek (Voe + reklamsız trafik, bkz. `HOSTING-VE-KAZANC.md` Bölüm 4).

Ayrıca kullanıcı düzeltmesi: VidMoly depolaması **15 TB** (hostun tanıtımındaki 5 TB değil).
`vidmoly.me/upgrade` ve `/premium` sayfaları yok (404) — yani "kapalı" modu yalnızca panelde var,
genel dokümantasyonda belgelenmiyor.

### 34.2 Beyaz kenar/çerçeve şikâyeti — bizim koddan DEĞİL

Ölçüm (canlı, gerçek tarayıcı, 1600×1000):

| Ölçüm | Sonuç |
| --- | --- |
| Oynatıcı `<iframe>` | **1034×582 = tam 16:9**, arkaplan `rgba(0,0,0,0)`, kenarlık `0px` |
| Sarmalayıcı kutu | `bg-black` → **rgb(0,0,0)**, yalnızca 1 px koyu gri (`oklch(0.24 …)`) kenarlık |
| Sayfada görünür beyaz yüzey (20×20 px üzeri) | **0** |
| Sağlayıcının embed sayfası | gövde/oynatıcı **siyah**, letterbox barları **siyah**, görünür beyaz yüzey **0** |

→ Kodda beyaz yüzey yok. **En olası neden:** tarayıcının (özellikle iOS Safari) cross-origin iframe'i
içeriği boyanmadan önce **beyaz** boyaması — "arkaplan beyaz, video sonradan beyaza sığdırılmış" hissi
tam olarak buna uyar.

**Uygulanan iki önlem:**

1. `:root { color-scheme: dark }` (`styles.css`) — tarayıcı, içerik gelmeden önce koyu tuval boyar.
2. Oynatıcı iframe'ine `bg-black` sınıfı — iframe kendi belgesini boyayana kadar beyaz görünmesin.

### 34.3 Adsterra formatları ve öneri

| Format | Rahatsızlık | Not |
| --- | --- | --- |
| **Native Banner** | En az | İçerikle bütünleşir; küçük sitede **2 slot** önerilir |
| **Social Bar / In-Page Push** | Orta | Yer kaplamaz, mobilde çalışır; **1 slot** yeter |
| Klasik Banner (300×250 / 320×50) | Az | CPM en düşük, tamamlayıcı |
| Popunder / Interstitial | Yüksek | **Siteye koymayacağız** — oynatıcıda zaten var, iki katı kullanıcı kaçırır |
| Smartlink | — | 404/landing için |

Ödeme eşikleri: Paxum $5 · WebMoney $5 · TRY banka **$25** · PayPal $25 · USDT/BTC $100 · wire $1.000.
Minimum trafik şartı yok, onay ~5-10 dk. **Karar: 2× Native Banner + 1× Social Bar, popunder YOK.**

### 34.4 Doğrulama

| Kontrol | Sonuç |
| --- | --- |
| `color-scheme: dark` (derleme çıktısı `dist/*.css`) | **var** ✅ |
| `aspect-video w-full bg-black` (izle chunk'ı) | **var** ✅ |
| `build` · `tsc` · `eslint` | temiz ✅ |

---

## 35. Bölüm kapaklarının otomatik çözümü: Voe desteği + bayat kapak sorunu

### 35.1 Şikâyet ve kök neden

Kullanıcı: "video kapakları otomatik ekleniyor mu, hiç değişmedi hep eski kapaklar; normalde kapağı
embed linkten otomatik çekiyordu". İki ayrı kusur bulundu:

| Kusur | Kök neden |
| --- | --- |
| **Voe linkli bölümün kapağı hiç çözülmüyor** | `resolvePosterForEpisode` ve `syncAllEpisodePosters` yalnız `vidmoly` (ve `morencius`) dallarını biliyordu; Voe için hiçbir yol kapak üretmiyordu |
| **Link değişince eski kapak kalıyor** | Kapak haritası yalnız bölüm anahtarına bağlıydı (`jujutsu-kaisen-s1e1`). `syncAllEpisodePosters(false)` "kapak zaten var" diyip atlıyordu → bölümün videosu değişse bile eski kapak gösteriliyordu |

### 35.2 Voe kapağı neden/nereden geliyor

Voe'nun embed sayfası `voe.sx/e/<kod>` → JS ile bir **mirror alan adına** yönlendiriyor
(`jamesbornmain.com`, `chuckle-tube.com`, `goofy-banana.com`…). Mirror sayfasında `og:image` şu:

```
https://jamesbornmain.com/cache/<kod>_storyboard_L2.jpg
```

Ölçüm: `https://voe.sx/cache/<kod>_storyboard_L2.jpg` de **HTTP 200**, `image/jpeg`, **1279×719**
(tek kare — VidMoly/Morencius'taki `_xt` mozaiği gibi 25'li ızgara DEĞİL). Yani adres koddan
**deterministik** türetilebiliyor; mirror dönse bile `voe.sx` sabit kalıyor. Voe sayfası CORS başlığı
**göndermiyor**, ama türetme sayesinde tarayıcıdan okumaya gerek kalmıyor.

### 35.3 Yapılan değişiklikler

| Ne | Yer | Etki |
| --- | --- | --- |
| `posterForWatchUrl(url, code)` — tüm sağlayıcıların kapak mantığı tek yerde | `lib/episode-covers.ts` | Voe: deterministik adres · VidMoly: embed'den okuma · Morencius: `pixibay.cc/<kod>.jpg` |
| `isVoeUrl(url)` | aynı dosya | `voe.sx` + bilinen mirror alan adları + `/e/<kod>` biçimi |
| Harita kaydı artık `{ p: kapak, c: çözüldüğü video kodu }` | aynı dosya | `syncAllEpisodePosters` kodu uyuşmayan kaydı (link değişmiş) **yeniden çözer** |
| `posterFromMap(raw, watchUrl)` | aynı dosya | Kod uyuşmuyorsa eski kapak gösterilmez; zincir yeni kapağı çözer |
| `episodeCoverFromWatchUrl` Voe dalı | `lib/content.ts` | Senkron ve deterministik → SSR ile istemci aynı adresi üretir (hydration riski yok) |
| `resolvePosterForEpisode` tüm sağlayıcıları kapsıyor | `lib/episode-covers.ts` | İstemci tarafı yedek çözüm de Voe'da çalışıyor |

Geriye dönük uyum: eski kayıtlar düz metindi; `posterEntryOf` ikisini de okur. Eski kayıtların kaynak
kodu bilinmediği için "Kapakları güncelle" bir kez çalıştırıldı → kayıtlar `{p,c}` biçimine geçti.

### 35.4 Oynatıcı sayfasında bizden kalan reklam var mı? (kullanıcı sorusu)

Kod taraması (`adsbygoogle|adsterra|popunder|googlesyndication`):

- Projede **3. taraf reklam script'i, gömülü reklam kodu veya eski embed kalıntısı YOK.** Tek reklam
  kaynağı `AdSlot` bileşeni; kodu `site_settings`'ten okur ve orada hiç `ad_*` kaydı olmadığı için
  **hiçbir şey çizmez**.
- Oynatıcı sayfası komşu bölümleri **önden yüklemiyor** (gizli iframe / preload yok) → eski VidMoly
  embed'i arka planda yüklenip reklam üretemez.
- Yani oynatıcıdaki reklamlar tamamen **video sağlayıcısının** (VidMoly/Voe) kendi belgesinden.

### 35.5 Doğrulama (yerel, gerçek tarayıcı; panel oturumu açık)

| Kontrol | Sonuç |
| --- | --- |
| "Kapakları güncelle" mesajı | **"24 bölüm kapağı tazelendi."** (24 çözüldü, 0 başarısız) ✅ |
| 1. bölüm kapağı (`/seri/jujutsu-kaisen`) | `https://voe.sx/cache/oimwqt5lzhps_storyboard_L2.jpg` · **1279×719** · yüklendi ✅ |
| 2. bölüm kapağı | `https://box-1409-t10.vmbox.space/i/03/02950/qrcnrp6fz0g1.jpg` · 720×405 · yüklendi ✅ |
| Kapak yüklenen bölüm | **24 / 24**, kırık **0** ✅ |
| `/izle/…?sezon=1&b=1` panel kapağı | aynı `voe.sx/cache/…` adresi ✅ |
| 1. bölüm için bayat (VidMoly/pixibay) kayıt kullanımı | **yok** ✅ |
| Konsol hatası (3 sayfa) | **0** ✅ |
| `build` · `tsc` · `eslint` | temiz ✅ |

---

## 36. Voe'dan otomatik bölüm ekleme (panel özelliği)

### 36.1 İstek

Kullanıcı: "Voe'ya video yükleyince isme göre sezon/bölüm otomatik eklensin; tek tek embed linki kopyalayıp
panele yapıştırmak istemiyorum." → Panelden tek tuşla, dosya adından çözüp ekleyen bir akış kuruldu.

### 36.2 Ön koşul: Voe API'si (araştırıldı)

Voe'nun tam bir REST API'si var: doküman `https://voe.sx/api-1-reference-index` (v1, 23/06/2026),
taban `https://voe.sx/api/...`, yetkilendirme **`?key=...`** query parametresi (Bearer YOK),
limit **3-4 istek/sn**. Anahtar: **Ayarlar → Hesap → API Ayrıntıları → "Geliştirici API anahtarı"**
(kullanıcı hesabında şu an **boş** — üretmesi gerekiyor).

Kullanılan uç nokta: `GET /api/file/list?key=&page=&per_page=&fld_id=0` → `result.data[]` içinde
`filecode, name, title, uploaded…` ve sayfalama `last_page`.

**Kritik ölçüm (CORS):** `OPTIONS /api/file/list` → **204** ve
`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET`. Yani tarayıcıdan **doğrudan**
çağrılabiliyor; sunucu/proxy GEREKMEDİ. (Canlı test: panelden `key=test` → Voe'ya giden gerçek istek
`HTTP 401` döndü, konsolda CORS hatası yok.)

### 36.3 Anahtar nerede saklanıyor?

**Yalnızca paneli kullanan tarayıcıda (`localStorage`).** Veritabanına YAZILMAZ: `site_settings`
anon anahtarla okunabildiği için anahtarı oraya koymak onu herkese açık ederdi.

### 36.4 Akış

| Adım | Ne olur |
| --- | --- |
| 1 | Panel → seri → **Düzenle** → "Sezonlar ve bölümler" → **"Voe'dan çek"** |
| 2 | API anahtarı + dosya adı filtresi (ör. "Jujutsu Kaisen") girilir; ikisi de tarayıcıda hatırlanır |
| 3 | "Voe listesini al" → tüm dosyalar sayfa sayfa çekilir (400 ms aralıkla, limit için) |
| 4 | Dosya adları çözülür, **önizleme** gösterilir: `S1 B5 · Bölüm adı` + "yeni"/"kayıtlı" etiketi |
| 5 | "Seçilen N bölümü ekle" → kayıtlı olanlar atlanır, yeniler eklenir (`watch_url = https://voe.sx/e/<kod>`) |
| 6 | Kapaklar otomatik: Voe kapağı koddan türetilir (bkz. §35) |

**Kabul edilen dosya adı biçimleri** (`lib/voe.ts` → `parseEpisodeName`):

```
Jujutsu Kaisen S01E05 - Ryomen Sukuna      → 1. sezon 5. bölüm
Jujutsu Kaisen s1e5                        → 1. sezon 5. bölüm
Jujutsu Kaisen 1x05 Ad                     → 1. sezon 5. bölüm
Jujutsu Kaisen 1. Sezon 5. Bölüm Ad        → 1. sezon 5. bölüm
Jujutsu Kaisen 05 - Ad                     → 1. sezon 5. bölüm (sezon yazılmamışsa 1)
```
Uzantı (`mp4/mkv`) ve teknik etiketler (`[1080p]`, `(SubsPlease)`) temizlenir.

### 36.5 Güvenlik / davranış notları

- **Önizleme zorunlu:** dosya adı çözümü bir tahmindir; kullanıcı onaylamadan hiçbir bölüm eklenmez.
- Zaten kayıtlı sezon/bölüm numaraları **atlanır** (mükerrer oluşmaz).
- Silme/güncelleme YAPMAZ — yalnızca eksik bölümleri ekler.
- Eklemeler 200'lük parçalar hâlinde gönderilir.

### 36.6 Doğrulama

| Kontrol | Sonuç |
| --- | --- |
| "Voe'dan çek" butonu / panel | açılıyor, 3 alan (şifreli anahtar, filtre, liste al) ✅ |
| Boş anahtar | "Önce Voe API anahtarını gir…" ✅ |
| Yanlış anahtar (`test`) | "Liste alınamadı: Authentication failed." ✅ |
| Ağ kanıtı | `GET https://voe.sx/api/file/list?key=test…` → **HTTP 401** (gerçek çağrı) ✅ |
| CORS hatası | **yok** ✅ |
| Mobil 390×844 | taşma yok (375=375), alanlar sığıyor ✅ |
| Konsol hatası | **0** (tüm adımlar) ✅ |
| `build` · `tsc` · `eslint` | temiz ✅ |

**Not:** Gerçek anahtarla uçtan uca test (liste + ekleme) kullanıcı anahtarı ürettikten sonra yapılacak.

---

## 37. Voe otomasyonu: gerçek dosya adı biçimi + kapak kademesi düzeltmesi

Gerçek Voe API anahtarıyla uçtan uca test edildi; iki önemli kusur çıktı ve düzeltildi.

### 37.1 Gerçek API cevabı (doğrulandı)

`GET /api/file/list` → `result.data[]`; her satırda `filecode, name, title, uploaded, size,
length` **ve `thumbnails[]`** ile `subtitles[]` geliyor. Kullanıcının dosyası:

```
filecode: oimwqt5lzhps
name/title: JujutsuKaisen-1080p-S1B1.mp4
length: 1435 sn (23:55)
thumbnails: L0 "100x100" · L1 "5x5" · L2 "4x4" · L3 "3x3" · L4 "2x4" · L5 "1x1"
subtitles: [{ path: "/vtt/oimwqt5lzhps_tr.srt", language: "Turkish" }]
```

### 37.2 Kusur 1 — dosya adı biçimi desteklenmiyordu

Kullanıcının biçimi `JujutsuKaisen-1080p-S1B1.mp4` (boşluksuz seri adı, `S1B1`, arada kalite
etiketi). Eski desenler bunu çözemiyordu (`S..E..` bekliyordu, `1080p` seri adına karışıyordu) →
dosya **atlanacaktı**.

Düzeltmeler (`lib/voe.ts`):

| Ne | Sonuç |
| --- | --- |
| `S1B1` deseni eklendi (`S<sezon>B<bölüm>`, `B` = bölüm) | `JujutsuKaisen-S1B1` → 1. sezon 1. bölüm ✅ |
| Yalnız bölüm deseni eklendi (`...-B5-Ad`) | `JujutsuKaisen-B5-Ad` → 1. sezon 5. bölüm |
| Kalite etiketi temizliği (`QUALITY_TAGS`) | `-1080p-`, `x265`, `WEB-DL`, `1080p`, `türkçe`… ada karışmaz |
| `normalizeText` artık boşlukları da atıyor | "Jujutsu Kaisen" filtresi `JujutsuKaisen-…` dosyasını **yakalar** |

**Doğrulama (gerçek anahtar):** `JujutsuKaisen-1080p-S1B1.mp4` → önizlemede **`S1 B1 · 1. Bölüm`**
ve **"kayıtlı"** etiketi (mükerrer eklenmiyor) ✅

### 37.3 Kusur 2 — yanlış kapak kademesi (mozaik görsel)

Kapak için `_storyboard_L2.jpg` kullanılıyordu. Ölçüm + görsel inceleme:

| Kademe | Ölçü | İçerik |
| --- | --- | --- |
| `L0` | 1250×700 | tek kare (küçük) |
| `L2` | 1279×719 | **4×4 = 16 kareli MOZAİK** ✗ |
| `L5` | **1280×720** | **1×1 = TEK KARE** ✅ |

Yani L2 kapak olarak kullanılsa bölüm kapağı ızgara gibi görünürdü. Hem `lib/voe.ts` hem
`lib/content.ts` artık **`https://i.voe.sx/cache/<kod>_storyboard_L5.jpg`** üretiyor
(API'nin `thumbnails[]` alanındaki adresin aynısı).

### 37.4 Doğrulama (yerel, gerçek anahtar, salt okuma + kapak tazeleme)

| Kontrol | Sonuç |
| --- | --- |
| Voe listesi | "1 dosya tarandı · 1 bölüm çözüldü (0 yeni, 1 zaten kayıtlı)" ✅ |
| Önizleme satırı | `S1 B1 · 1. Bölüm` · dosya: `JujutsuKaisen-1080p-S1B1.mp4` · etiket: **kayıtlı** ✅ |
| "Kapakları güncelle" | "24 bölüm kapağı tazelendi." ✅ |
| 1. bölüm kapağı | `i.voe.sx/cache/oimwqt5lzhps_storyboard_L5.jpg` · **1280×720** ✅ |
| Kapak görünümü | **tek kare** (mozaik DEĞİL) — ekran görüntüsüyle doğrulandı ✅ |
| Kırık kapak | **0** ✅ |
| Konsol hatası | **0** (tüm adımlar) ✅ |

### 37.5 Notlar

- **Başlık girilmezse**: çözümleyici `<n>. Bölüm` yazar (rastgele değil). İstenirse panelde
  satır içi düzenlenebilir; farklı bir varsayılan (ör. "Belirtilmemiş") tek satırda değiştirilir.
- **API anahtarı** yalnızca tarayıcıda (`localStorage`); repoya, dokümana veya veritabanına
  YAZILMADI. Farklı cihaz/tarayıcıda bir kez daha girilmesi gerekir (alan hatırlar).
- Voe'nun `subtitles[]` alanı altyazı desteğini API'de de gösteriyor (`/vtt/<kod>_tr.srt`).

---

## 38. Filemoon'a geçiş: yanlış link biçimi + otomatik düzeltme

### 38.1 Şikâyet

Kullanıcı Filemoon'a geçti, 1. bölümde oynatıcının "bozuk" göründüğünü ve linki yanlış koyup
koymadığını sordu. Girdiği link: `https://filemoon.org/e/qw1zeDk03Xyn`

### 38.2 Teşhis (ölçüm)

| Kontrol | Sonuç |
| --- | --- |
| `filemoon.org/e/<kod>` | **ana sayfaya yönlendiriyor** (`/en`) → oynatıcıda Filemoon'un **tanıtım sayfası** görünüyordu |
| `filemoon.sx/e/<kod>` · `filemoon.to/e/<kod>` | **404 Not Found** |
| `filemoon.org/<kod>/embed` | **gerçek oynatıcı açılıyor** ✅ |
| Kullanıcının paneli (filemoon.org) | Dosya var: `JujutsuKaisen-1080p-S1B1.mp4` · 789 MB · kod **qw1zeDk03Xyn** (yani kod doğru, **yol biçimi yanlış**) |
| Doğru biçim (API dokümanı + panel) | `https://filemoon.org/<kod>/embed` (`urls.embed` alanı) |

**Sonuç:** Kod doğruydu, `/e/<kod>` biçimi yanlıştı; Filemoon o yolu ana sayfaya düşürüyor.

### 38.3 Yapılan düzeltmeler

| Ne | Yer | Etki |
| --- | --- | --- |
| `canonicalEmbedUrl()` eklendi | `lib/admin.ts` | Kaydetme, toplu ekleme ve yapıştırma yollarının tamamı `extractEmbedUrl` üzerinden geçtiği için **her girişte** otomatik düzeltme |
| Filemoon/Byse kuralları | aynı dosya | `/e/<kod>`, `/<kod>/watch`, `/<kod>/file`, çıplak `<kod>` → `https://filemoon.org/<kod>/embed` |
| Voe kuralı | aynı dosya | `/d/<kod>`, çıplak `<kod>` → `https://voe.sx/e/<kod>` |
| **1. bölümün linki düzeltildi** | veritabanı (panelden kaydedildi) | `…/e/qw1zeDk03Xyn` → `…/qw1zeDk03Xyn/embed` |
| `isVoeUrl` daraltıldı | `lib/episode-covers.ts` | `/e/<kod>` biçim sezgisi kaldırıldı; Filemoon linki Voe sanılıp **var olmayan kapak adresi** üretiyordu |
| Ölü kapak kaydı temizlendi | veritabanı ("Kapakları güncelle") | `i.voe.sx/cache/qw1zeDk03Xyn_…` kaydı silindi; 1. bölüm kapağı geçerli bir thumbnail'e döndü |

### 38.4 Doğrulama

| Kontrol | Sonuç |
| --- | --- |
| Panelde kaydetme sonrası saklanan link | `https://filemoon.org/qw1zeDk03Xyn/embed` ✅ (otomatik düzeltildi) |
| Ağ kanıtı | `PATCH /show_episodes?id=eq.378e4e81…` → **204** ✅ |
| Oynatıcı (izleme sayfası) | iframe `src` = `/embed`; **gerçek Filemoon oynatıcısı** (oynat düğmesi + kontrol çubuğu + kare önizlemeleri) ✅ |
| Pazarlama/404 sayfası | **yok** ✅ |
| Kırık görsel · konsol hatası | **0 · 0** ✅ |
| `i.voe.sx/…qw1zeDk03Xyn…` kaydı | iki sayfada da **geçmiyor** ✅ |
| `build` · `tsc` · `eslint` | temiz ✅ |

### 38.5 Filemoon panelinden öğrenilenler (ileride gerekirse)

- **API VAR:** taban `https://filemoon.org/api/v1`, kimlik doğrulama **`Authorization: Bearer <token>`**,
  limit ~**60 istek/dk**. Uçlar: `GET /account`, `GET /files`, `GET /files/{id}` (yanıtında
  `urls.page` / `urls.watch` / `urls.embed` alanları), `PATCH /files/{id}`, `POST /files/upload`,
  `POST /remote-uploads` vb. Token: **Developer → API & Remote Upload → Create API Token**
  (`files:read`, `files:write`, `remote:write` izinleri; token bir kez gösterilir).
  → İstenirse "Voe'dan çek" özelliğinin bir **Filemoon karşılığı** yazılabilir (aynı akış, farklı istemci).
- **Reklam seviyesi ayarı YOK** (VidMoly/Voe'daki gibi izleyici-reklam kademesi bulunamadı); paneldeki
  "Advertise" bölümü reklam **satın alma** paneli (CPM $15). Premium bölümler: Creator Pro, Creator Page,
  Geo Blocking, Team & Business.
- **Not:** `filemoon.sx` / `filemoon.to` / `byse.sx` artık "Byse" tanıtım sayfasına çıkıyor; kullanıcının
  hesabı ve dosyaları **`filemoon.org`** üzerinde. Alan adı karışıklığına dikkat.
