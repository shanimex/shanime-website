# Anikoto Anasayfa Yapısı — Canlı DOM Blueprint

Kaynak: `https://anikototv.to/home` (canlı DOM'dan, 27.09.2026 tarihli gözlem)
Sayfa başlığı: `Home - Anikoto - Watch Anime Online, Free Anime Streaming`

> Bu dosyadaki tüm değerler canlı sayfadan okunmuştur. Emin olunamayan yerlerde `belirlenemedi` yazılmıştır.

---

## 0. Genel İskelet (DOM sırası)

```
HEADER.fixed                                   (position: fixed, top:0, z-index:50)
DIV#body
├── DIV.hotest.container
│   └── DIV#hotest.swiper-container            → HERO slider (11 slide)
└── DIV.container
    └── DIV.aside-wrapper                       (display: flex)
        ├── ASIDE.main                          (flex-grow:1; width:1px; padding 0 10px)
        │   ├── DIV#anikoto-bookmark-alert
        │   ├── SECTION#community-pinned.cpin
        │   ├── DIV.bsharing.mb-4
        │   ├── SECTION#continue-watching
        │   ├── SECTION#recent-update
        │   ├── SECTION#upcoming-anime
        │   ├── DIV.top-tables.mb-3
        │   └── DIV#schedule-block > SECTION#schedule
        └── ASIDE.sidebar                        (width:25%; min-width:320px; flex-shrink:0)
            ├── SECTION#top-anime
            └── SECTION#home-discussion
FOOTER
└── DIV.container
    ├── DIV.azlist                              → A-Z List
    └── DIV.row > DIV.col-lg-5
```

Kolon düzeni: `.aside-wrapper { display:flex }` · `aside.main` = ana kolon · `aside.sidebar { width:25%; min-width:320px; flex-shrink:0 }`
Sayfa içeriği `#body { padding-top: 5rem }` (`body.home` kuralı; ölçülen: 67.5px) — çünkü header fixed.

---

## 1. HERO (slider) — bölümlerin ÜSTÜNDE

- Konteyner: `DIV.hotest.container` → `DIV#hotest.swiper-container` (`swiper-container swiper-container-initialized swiper-container-horizontal`)
- Slide sayısı: **11** (`swiper-slide`)
- Bir slide anatomisi (`#hotest .item`):
  - `H2.title.d-title` (verbatim örnek: `Re:ZERO -Starting Life in Another World- Season 4`)
  - `DIV.meta.icons` → `i.rating` (ör. `R`), `i.quality` (ör. `HD`), `i.dub.fas.fa-microphone`, `i.sub.fas.fa-closed-captioning`, `i.date` (ör. `Apr 8, 2026 to ?`)
  - `DIV.synopsis` (3 satır clamp)
  - `DIV.actions` → butonlar (`a.btn.play` vb.)
- Tam genişlik, `container` içinde.

---

## 2. `aside.main` — SIRALI BÖLÜMLER (hero altı)

Aşağıdaki sıra, `aside.main`'in **gerçek DOM çocuk sırasıdır** (style/script düğümleri hariç tutulmuştur):

### 2.1 `DIV#anikoto-bookmark-alert.anikoto-bookmark-alert.mb-2.is-visible` — DUYURU ŞERİDİ
- Sınıflar: `anikoto-bookmark-alert mb-2 is-visible`
- İçerik: `I.fas.fa-bookmark.anikoto-bookmark-alert__icon` + `P.anikoto-bookmark-alert__text.mb-0` + `BUTTON#anikoto-bookmark-alert-close.anikoto-bookmark-alert__close`
- Sayfa açılışında `is-visible` (görünür/kapatılabilir). Full-width (main kolon).

### 2.2 `SECTION#community-pinned.cpin` — SABİTLENMİŞ DUYURU ŞERİDİ
- Sınıflar: `cpin`, alt: `DIV.cpin-bar` (`SPAN.cpin-badge` = `Pinned`, `DIV.cpin-items`, `BUTTON.cpin-hide`), `DIV.cpin-spot`
- `cpin-badge` metni: `Pinned` (fa-thumbtack ikonu ile)
- `cpin-items` içeriği (verbatim):
  - `#Updates` — `Mana Shop is live — decorate your profile (and more coming)` (146 yorum)
  - `#General` — `Best Poster 2026` (102 yorum)
  - `#Updates` — `New: Anikoto Guides (bookmark this)` (151 yorum)
- Her öğe `<a.cpin-item href="/community/post/...">`; etiket sınıfları renk kodlu (`cpin-t-red`, `cpin-t-blue`, …).
- Full-width (main kolon).

### 2.3 `DIV.bsharing.mb-4` — PAYLAŞIM SATIRI
- Sınıflar: `bsharing mb-4` · arka plan `rgb(20,32,48)`, `border-radius: 8px`, ortalanmış
- Başlık: `DIV.mb-1` → `I.fas.fa-info-circle` + metin: `If you enjoy the website, please consider sharing it with your friends. Thank you!`
- Paylaş butonları (`#st-1 .st-btn`, ShareThis): sırayla —
  `sharethis` (Share), `twitter` (Post), `whatsapp` (Share), `messenger` (Share), `reddit` (Share), `telegram` (Share)
- Full-width (main kolon).

### 2.4 `SECTION#continue-watching` — "İzlemeye devam et"
- Sınıf: boş (`class` yok) · içerik: **boş** (giriş yapılmadığı/geçmiş olmadığı için item yok)
- Not: Giriş yapılı kullanıcıda dolan bölüm. Canlı (anonim) gözlemde içerik yok.

### 2.5 `SECTION#recent-update` — **Latest Episode**
- Başlık (`DIV.head.with-more.with-tabs > DIV.title.mr-3`): verbatim **`Latest Episode`**
- Başlık yanındaki `DIV.end` içeriği:
  - `SPAN.text-tabs` sekmeleri (verbatim): **`All`** (aktif), **`Sub`**, **`Dub`**, **`Trending`**, **`Random`**
    (data-name: `updated-all`, `updated-sub`, `updated-dub`, `trending`, `random`)
  - `SPAN.paging` → `SPAN.prev.disabled` (Page 1) + `SPAN.next` (Page 2), ok ikonları
- Gövde: `DIV.body > DIV.ani.items` → **12 item**, her item `DIV.item`
- Grid: `ani items` / `item` — **CSS Grid değil, float tabanlı**: `.ani.items { margin: 0 -10px }` ve `.ani.items .item { width: 16.6667%; float: left; padding: 0 10px; margin-bottom: 20px }` → **desktop'ta satırda 6 item**
- Item anatomisi (poster kartı):
  - `DIV.ani.poster` → `A > IMG` (`padding-bottom:140%` poster, hover'da play overlay) + `DIV.meta > .inner > .left` (`SPAN.ep-status.sub` içinde bölüm no, ör. `78`) + `.right` (tip, ör. `TV`)
  - `DIV.info > A.name.d-title` → anime adı (ör. `Koupen-chan`)
  - Alt satır `DIV.paging.bottom` → `SPAN.prev.disabled` + `SPAN.next`

### 2.6 `SECTION#upcoming-anime` — **Upcoming Anime**
- Başlık (`DIV.head.with-more > DIV.title.mr-3`): verbatim **`Upcoming Anime`**
- `A.more` → metin `View more` + ok ikonu, `href="/status/not-yet-aired"`
- Gövde: `DIV.body > DIV.ani.items` → **12 item**
- Grid: **Latest Episode ile aynı** (`ani items` / `item`, 16.6667% → **satırda 6 item**)
- Item anatomisi aynı poster kartı; `meta` `.right` tip etiketi (ör. `Movie`), `.left` boş olabilir (henüz bölüm yok)

### 2.7 `DIV.top-tables.mb-3` — 3 KOLONLU KOMPAKT LİSTE BANDI (sekmeli)
- Band konteyner sınıfları: `top-tables mb-3`; kural: `.top-tables { margin: 0 -10px; overflow: hidden }`
- Sekme başlığı (`DIV.head > DIV.tabs`, `data-tabs=".top-tables section"`): verbatim —
  **`New Release`** (aktif, data-name `new-release`), **`Newly Added`** (`new-added`), **`Just Completed`** (`completed`)
- Band gövdesi `DIV.body`, içinde **3 adet `SECTION.top-table`** yan yana:
  - Kural: `.top-tables section { width: 33.33%; float: left; padding: 0 10px }` → **desktop'ta 3 kolon**
- Kolon başlıkları (her `SECTION.top-table > DIV.head > A.title`, verbatim + link):
  1. **`New Release`** → `href="/new-release"`
  2. **`New Added`** → `href="/status/ongoing"`  *(dikkat: sekme etiketi `Newly Added`, kolon başlığı `New Added`)*
  3. **`Just Completed`** → `href="/status/finished-airing"`
- Her kolonda gövde: `DIV.body > DIV.scaff.items` → **5 item** (`A.item`)
- Kompakt satır anatomisi (`scaff.items .item`, `display:flex`):
  - `DIV.poster` → `flex-shrink:0; width:60px` → içinde `SPAN` (`padding-bottom:130%`) + `IMG` → **thumbnail genişliği 60px**
  - `DIV.info`:
    - `DIV.name.d-title` → ad (2 satır clamp, ör. `A Wild Last Boss Appeared! Season 2`)
    - `DIV.meta.one-line` → rozetler sırayla:
      `SPAN.ep-wrap.dot > SPAN.ep-status.sub` (bölüm no, ör. `1`; dub ise `ep-status.dub` de olabilir) ·
      `SPAN.dot` = format (ör. `TV`) · `SPAN.dot` = **tarih** (ör. `Sep 26, 2026`)
  - Yani tarih, başlığın ALTINDAKİ meta satırının **en sağında** yer alır.

### 2.8 `DIV#schedule-block > SECTION#schedule` — **Estimated Schedule**
- Konteyner: `DIV#schedule-block` > `SECTION#schedule` (`border-radius:5px; overflow:hidden`)
- **Başlık satırı** (`DIV.head > DIV.title`): verbatim **`Estimated Schedule`** + `SPAN.now`
  - `Now` formatı: `- Now: 27.09.2026 16:22:26` → yani `- Now: DD.MM.YYYY HH:MM:SS` (`SPAN.timenow`)
- **Gün sekmesi satırı** (`DIV.head .days`):
  - `DIV.prev` (chevron-left) + `DIV.items-wrap.swiper-container` + `DIV.next` (chevron-right) — Swiper carousel
  - `DIV.items.swiper-wrapper > DIV.day.swiper-slide` — **toplam 8 gün slide'ı**, genişlik kuralı `.day { width: 14.2857% }` → **satırda 7 gün görünür**; kalan günler prev/next ile kaydırılır
  - Gün etiketi iki satır: `DIV.date` (ör. `Sep 25`) + `DIV.wday` (ör. `Fri`, "Bebas Neue" fontu)
  - Gözlenen sıra: `Sep 25/Fri`, `Sep 26/Sat`, `Sep 27/Sun`, `Sep 28/Mon`, `Sep 29/Tue`, `Sep 30/Wed`, `Oct 01/Thu`, `Oct 02/Fri`
  - **Aktif gün** (gözlemde): `Sep 25 / Fri` → `DIV.day.active` (altında 2px `::after` çizgi + renk `rgb(160,177,197)`)
- **Gövde** (`DIV.body`): `DIV.items` içinde `A.item` satırları
  - GÖRSEL sıra (CSS `order`): `.time`(order:1) → `.title`(order:2) → `.ep`(order:3)
  - DOM sırası ise: `.time` → `.ep` → `.title`
  - **Zaman**: `DIV.time` ("Bebas Neue", 1.6rem, ör. `12:55`)
  - **Başlık**: `DIV.title.d-title` (1.2rem, ör. `Pokémon Horizons: The Series`, `data-jp` ile)
  - **Bölüm çipi**: `DIV.ep` → `I.fas.fa-play` + `SPAN` (ör. `Episode 151`); stil: `min-width:140px; background: rgb(23,37,55); border-radius: 50rem`
  - Yalnızca **ilk 7 satır** görünür (`.item:nth-child(n+8) { display:none }`); altta `DIV.more` (→ metin `Show more` / genişleyince `Show less`, `DIV.body.expand`)
  - Geçmiş saatler `a.item.old` ile soluk (`rgb(81,95,117)`); hover'da başlık mavi, çip mavi
- Full-width (main kolon).

---

## 3. `aside.sidebar` — SAĞ SÜTUN (paneller, sıralı)

Sıra `aside.sidebar`'ın gerçek DOM çocuk sırasıdır:

### 3.1 `SECTION#top-anime` — **Top anime**
- Başlık (`DIV.head.with-more.with-tabs > DIV.title`): verbatim **`Top anime`**
- Sekmeler (`DIV.head .tabs`): verbatim **`Day`** (aktif, `data-name="day"`), **`Week`** (`week`), **`Month`** (`month`)
- Gövde: `DIV.body` içinde **3 adet `DIV.tab-content`** (Day/Week/Month panelleri), her birinde `DIV.scaff.side.items` → **9 item**
- Item anatomisi (`#top-anime .side.items .item`, `border-radius:5px`, `margin-bottom:10px`):
  - `A.item.rank1..rankN` → `DIV.inner`:
    - `DIV.rank` (50×55 px rozet; rank1–3 renkli kenarlık: rank1 mavi `rgb(38,163,214)`, rank2 `rgb(189,76,96)`, rank3 `rgb(171,132,69)`)
    - `DIV.poster` (mini poster + `IMG`)
    - `DIV.info > DIV.name.d-title` (ad) + `DIV.meta` (`SPAN.ep-wrap.dot > SPAN.ep-status.sub`/`.dub` rozetleri, format)
- Sidebar'da satırda **1 item** (dikey liste).

### 3.2 `SECTION#home-discussion.hd-strip.hd-strip--sidebar` — **Discussion**
- Sınıflar: `is-on hd-strip hd-strip--sidebar`
- Başlık (`DIV.hd-head > DIV.hd-left > DIV.hd-title`): ikon `fa-regular fa-comments` + metin **`Discussion`**
- Sekmeler (`DIV.hd-tabs[role=tablist]`, aria-label `Discussion sort`): verbatim
  **`Newest`** (aktif, `data-sort="newest"`), **`Top`** (`data-sort="top"`)
- Toggle (`DIV.hd-toggle`): `Show Comments` + `DIV.hd-switch` (role=switch, aria-label "Show comments")
- Gövde (`DIV.hd-body > DIV.hd-list[data-hd-list]`): yorum satırları `A.hd-row` → avatar (`SPAN.hd-row-avatar > IMG`) + `SPAN.hd-row-main > .hd-row-meta` (`hd-row-user`, `hd-row-badge`=ör. `Member`) …

---

## 4. `footer` — **A-Z List**

- Konteyner: `FOOTER > DIV.container > DIV.azlist` (`.azlist { margin-bottom:40px; overflow:hidden }`)
- Başlık (`DIV.head > DIV.title`): verbatim **`A-Z List`** (2rem, beyaz)
- Alt açıklama (`DIV.head > DIV.desc`): verbatim **`Searching anime order by alphabet name A to Z.`**
- Çipler (`UL > LI > A`), sırayla ve href'leriyle:

  | # | Chip | href |
  |---|------|------|
  | 1 | `All` | `/az-list/` |
  | 2 | `#` | `/az-list/other` |
  | 3 | `0-9` | `/az-list/0-9` |
  | 4 | `A` | `/az-list/A` |
  | 5 | `B` | `/az-list/B` |
  | … | … | … |
  | 29 | `Z` | `/az-list/Z` |

  (A→Z arası tüm harfler sırayla; toplam **29 çip**: `All # 0-9 A B C D E F G H I J K L M N O P Q R S T U V W X Y Z`)
- Çip stili: `a { padding:2px 7px; border-radius:3px; background: rgb(31,49,73); font-size:1.3rem }`, hover → `background: rgb(38,163,214)`.
- **Tıklama davranışı (canlı test edildi):** çip bir `<a>` linkidir, sayfa **navigasyon yapar**.
  - Örnek: `A` çipine tıklama → `https://anikototv.to/az-list/A`, dönen sayfa başlığı `AZ-List - Letter A - Anikoto`.
  - Yani ayrı bir sekme/panel açmaz; aynı sekmede ilgili liste sayfasına gider. (Varsayılan "All" için aktif sınıf DOM'da yoktu.)

---

## 5. Sayfanın EN ÜSTÜ (Latest Episode ÜSTÜ) — sıralı

1. **`HEADER.fixed`** (site header'ı; genel menü/logo/arama — `fixed`)
2. **Hero slider** (`DIV.hotest.container > #hotest`) — 11 slide
3. **`#anikoto-bookmark-alert`** — duyuru şeridi (başlangıçta görünür)
4. **`#community-pinned.cpin`** — `Pinned` etiketli duyuru şeridi (3 duyuru)
5. **`DIV.bsharing`** — paylaşım satırı (6 buton)
6. **`#continue-watching`** — (anonim gözlemde boş)
7. **`#recent-update`** → `Latest Episode`

---

## 6. Sticky / Fixed davranışı

- Canlı tarama sonucu yalnızca şu elemanlar `fixed`/`sticky`:
  - **`HEADER.fixed`** → `position: fixed; top: 0; z-index: 50` (site header'ı içerikle birlikte sabit kalır)
  - `DIV#sign.modal.fade` → `position: fixed` (yalnızca giriş modalı; sayfa akışının parçası değil)
- **Sidebar (`aside.sidebar`) sticky DEĞİL** — gözlemde `position` değeri `static`.
- Sayfa içeriği fixed header'ı telafi için `#body { padding-top: 5rem }` (ölçülen `67.5px`).
- Hero, Latest Episode, Upcoming Anime, top-tables bandı, Estimated Schedule, A-Z List → hiçbiri sticky değil.

---

## 7. Notlar / Belirlenemedi

- **`#continue-watching`** bölümünün item'ları: anonim (giriş yapılmamış) oturumda **boş** olduğu için iç yapısı (item anatomisi, grid sınıfları) **belirlenemedi**.
- `DIV.bsharing` içindeki 5. "Share" (sharethis) butonunun tam görsel ikonu **belirlenemedi** (yalnızca `data-network` ve etiket metni okundu).
- Sidebar `#home-discussion` gövdesindeki tüm yorum satırı alanlarının tam listesi **belirlenemedi** (yalnızca ilk satırın şeması çıkarıldı).
- Hero'nun tüm 11 slide'ının başlık listesi **belirlenemedi** (yalnızca ilk slide detaylandırıldı; görev kapsamı hero altı bölümlerdi).
- `#recent-update .head` `with-more` sınıfı taşıyor ancak ayrı bir "View more" linki DOM'da yok; onun yerine `SPAN.paging` (prev/next) var — bu yüzden `with-more`'un tam amacı **belirlenemedi**.
