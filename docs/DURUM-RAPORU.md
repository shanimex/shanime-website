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
