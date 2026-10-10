import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * SİTE GENELİ DİL KATMANI (TR / EN)
 * =================================
 * NEDEN YENİ BAĞIMLILIK YOK (i18next / react-intl DEĞİL): ihtiyaç yalnızca
 * "aynı anahtarların iki dilde karşılığı + seçimi hatırla". Tipli bir sözlük
 * bunu sıfır bağımlılıkla, sıfır çalışma zamanı maliyetiyle yapar. Kütüphane
 * eklemek paket boyutunu ve sürüm yüzeyini büyütürdü.
 *
 * NEDEN VERİTABANI METNİ ÇEVİRİLMEZ: seri adları, açıklamalar ve türler Supabase
 * içeriğidir; onların çevirisi AYRI bir iş (içerik çevirisi). Bu katman YALNIZCA
 * arayüz metnini çevirir.
 *
 * Bu dosya tek doğruluk kaynağıdır: hangi metnin hangi anahtarla çevrildiği
 * sadece burada tanımlanır. Bileşenler `t("anahtar")` çağırır, metni kendileri
 * yazmaz.
 */

export type Lang = "tr" | "en";

/** Desteklenen diller; ÇİP SIRASI da bu listedir.
 *
 * KULLANICI GERİ BİLDİRİMİ (01.10.2026): "EN önce olsun — ana dil artık İngilizce."
 * Sıra `DEFAULT_LANG` ile hizalı tutulur: site İngilizce açıldığı için aktif çip
 * solda durur ve dil anahtarı ilk bakışta doğru dili işaret eder. Ayrıca çipler
 * arası ayırıcı çizgi `:first-child`/`:last-child` ile çizildiğinden sıra
 * değişince şekil bozulmaz (bkz. styles.css `.sh-lang`). */
export const LANGS: readonly Lang[] = ["en", "tr"];

/**
 * localStorage anahtarı — SÜRÜMLÜ (`:v1`).
 *
 * NEDEN SÜRÜMLÜ: ileride anahtar adları değişirse eski kayıt yeni sözlükle
 * çakışmasın. `v2`ye geçildiğinde eski değer otomatik olarak "yok" sayılır ve
 * kullanıcı varsayılan dilde açılır — bozuk veriyle uğraşmak gerekmez.
 *
 * NEDEN localStorage (çerez DEĞİL): seçim tamamen cihaz tercihidir; sunucuya
 * gitmesine gerek yoktur, oturum/hesap da gerekmez. Çerez olsaydı her istekte
 * ağa fazladan veri binerdi.
 */
const LANG_STORAGE_KEY = "shanime:ui-lang:v1";

/**
 * Tarayıcı dili tanınmadığında kullanılan dil: **İNGİLİZCE**.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DEĞİŞTİ (28.09.2026) — eskiden `tr` idi.
 *
 * KULLANICI KARARI: "sitemiz genel olarak İngilizce olacak, tamamen İngilizce
 * olacak; orijinal doğru İngilizce kullansın."
 *
 * ESKİ DAVRANIŞIN SORUNU: site global yayına hazırlanıyor ama tanınmayan dilli
 * bir ziyaretçi (ör. `de`, `fr`, `es`) TÜRKÇE arayüz görüyordu — yani global
 * ziyaretçi için site okunamaz hâldeydi. Artık o ziyaretçi İngilizce görür.
 *
 * ── TÜRKÇE NE OLACAK ──────────────────────────────────────────────────────
 * `hydrateLang()` sırası: KAYITLI TERCİH → TARAYICI DİLİ → bu varsayılan.
 * Yani:
 *   · Türkçe tarayıcı (`navigator.language = "tr…"`) yine otomatik TÜRKÇE alır,
 *   · İngilizce tarayıcı İngilizce,
 *   · TR düğmesine basan herkes (hangi ülkeden olursa olsun) kalıcı olarak TR'ye
 *     geçer ve tercih tarayıcıda saklanır.
 * Değişen tek şey: DİLİ TANINMAYAN ziyaretçinin gördüğü varsayılan.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const DEFAULT_LANG: Lang = "en";

/** Çeviri anahtarı tipi — `tr` sözlüğünün anahtarları. */
export type I18nKey = keyof typeof tr;

/** Çeviri fonksiyonu tipi (hem hook hem modül seviyesi bunu döndürür). */
export type Translate = (key: I18nKey, vars?: Record<string, string | number>) => string;

/**
 * TÜRKÇE SÖZLÜK (varsayılan / referans).
 * Anahtar listesinin kaynağı BURASIDIR: `en` sözlüğü bu anahtarların tamamını
 * taşımak ZORUNDADIR (tip bunu derleme zamanında zorlar).
 */
const tr = {
  // ---- Ortak iskelet (header / nav / düğmeler) ----
  "common.home": "Ana sayfa",
  "common.series": "Diziler",
  "common.thisSeason": "Bu sezon",
  "common.viewAll": "Tümü",
  "common.seeAll": "Tümünü gör",
  "common.watchNow": "Şimdi izle",
  "common.seriesDetails": "Seri detayı",
  "common.comingSoon": "Yakında",
  "common.search": "Anime ara",
  "common.searchPlaceholder": "Anime ara...",
  // Başlıktaki arama kutusunun sağ ucundaki kısayol ipucu (referans: "Quick Access").
  "common.quickAccess": "Hızlı Erişim",
  "common.closeSearch": "Aramayı kapat",
  "common.clearSearch": "Aramayı temizle",
  "common.openMenu": "Menüyü aç",
  "common.closeMenu": "Menüyü kapat",
  "common.explore": "Keşfet",
  "common.random": "Rastgele",
  "common.searchTab": "Ara",
  "common.schedule": "Takvim",
  "common.tvKind": "TV",
  "common.movieKind": "Film",
  "common.logoAlt": "shanime logosu",
  "common.homeAria": "shanime ana sayfa",
  "common.mainNav": "Ana navigasyon",
  "common.backHome": "Ana sayfaya dön",
  "common.animeSeries": "Anime · Seri",

  // ---- Dil değiştirici ----
  "lang.groupLabel": "Dil seçimi",
  "lang.trLabel": "Türkçe",
  "lang.enLabel": "English",

  // ---- Footer ----
  "footer.tagline":
    "Yeni serini bul: sezonun öne çıkan anime başlıkları, bölümleri ve detayları tek yerde.",
  "footer.explore": "Keşfet",
  "footer.allSeries": "Tüm diziler",
  "footer.genres": "Türler",
  "footer.copyright": "© 2026 shanime · Anime keşfi için tasarlanmıştır.",

  // ---- Katalog ----
  "catalog.all": "Tümü",
  "catalog.series": "Diziler",
  "catalog.movies": "Filmler",
  "catalog.headingAll": "Tüm içerikler",
  "catalog.headingSeries": "Diziler",
  "catalog.headingMovies": "Filmler",
  "catalog.cataloged": "{count} başlık",
  "catalog.search": "Dizi veya film ara...",
  "catalog.genre": "Tür",
  "catalog.year": "Yıl",
  "catalog.sort": "Sıralama",
  "catalog.sortFeatured": "Öne çıkan",
  "catalog.sortNewest": "Yeni eklenen",
  "catalog.sortAZ": "A-Z",
  "catalog.allGenres": "Tüm türler",
  "catalog.allYears": "Tüm yıllar",
  "catalog.clear": "Filtreleri temizle",
  "catalog.filterAria": "Katalog filtreleri",
  "catalog.noResults": "Bu filtrelere uyan içerik yok.",
  "catalog.seriesKind": "Dizi",
  "catalog.movieKind": "Film",

  // ---- Kütüphane durumu ----
  "library.aria": "Kütüphane durumu",
  "library.add": "Kütüphaneye ekle",
  "library.remove": "Kütüphaneden çıkar",
  "library.watching": "İzliyorum",
  "library.completed": "Tamamlandı",
  "library.onHold": "Beklemede",
  "library.dropped": "Bıraktım",
  "library.planToWatch": "İzlenecek",

  // ---- Ana sayfa ----
  "home.heroBadge": "Öne çıkanlar",
  "home.heroSrTitle": "shanime — sezonun öne çıkan anime serileri",
  "home.heroAria": "Vitrin",
  "home.slideScene": "{title} sahnesi",
  "home.coverAlt": "{title} kapak görseli",
  "home.logoAlt": "{title} logosu",
  "home.episodeCount": "{count} bölüm",
  "home.seasonCount": "{count} sezon",
  "home.prevSeries": "Önceki seri",
  "home.nextSeries": "Sonraki seri",
  "home.slideSelect": "Vitrin seçimi",
  "home.goToSlide": "{title} slaytına git",
  "home.resultKind": "Anime · Seri",
  "home.searchEmpty": "Aramaya uyan seri yok.",
  "home.continueTag": "İzlemeye devam et",
  "home.continueHeading": "KALDIĞIN YERDEN DEVAM ET",
  "home.continueAria": "Kaldığın yerden devam et",
  "home.continueEdit": "Düzenle",
  "home.continueDone": "Bitti",
  "home.continueRemove": "{title} kaydını listeden çıkar",
  "home.minLeft": "{min} dk kaldı",
  // BÖLÜM SÜRESİ (05.10.2026): bölüm kapağının üzerine FAREYLE gelince sağ altta
  // görünen süre damgası ("24 dk"). Kullanıcı: "imleci kapağın üzerine getirince
  // videonun süresi görünsün, kaç dk olduğu."
  "common.minutesShort": "{min} dk",
  // "1. Sezon 1. Bölüm" — hem "İzlemeye devam et" kartı hem izleme sayfasının
  // üst bilgisi kullanır (kullanıcı isteği 01.10.2026: "1/59" gibi sayaç
  // yerine sezon+bölüm yazacak).
  "common.seasonEpisode": "{season}. Sezon {n}. Bölüm",
  "watch.backToSeries": "Seriye dön",
  "watch.episodeCountChip": "{count} bölüm",
  "watch.sourceLabel": "Kaynak",
  "watch.audioLabel": "Ses",
  "watch.audioSub": "Altyazı",
  "watch.audioDub": "Dublaj",
  "watch.reportAction": "Bildir",
  "watch.reportCancel": "Vazgeç",
  "watch.reportIntro":
    "Bu bölümdeki teknik bir sorunu (video açılmıyor, yanlış altyazı vb.) ekibe iletirsin.",
  "watch.reportCurrent": "Şu anki bölüm",
  "watch.reportPlaceholder": "Sorunu kısaca yaz (isteğe bağlı)",
  "watch.seasonsHeading": "Sezonlar",
  "watch.previousSeason": "Önceki sezon",
  "watch.nextSeason": "Sonraki sezon",
  "watch.seasonNumber": "{n}. Sezon",
  "watch.commentsHeading": "Yorumlar",
  "watch.commentsEmpty": "Henüz yorum yok. İlk yorumu sen yaz.",
  "watch.commentsEmptyLocked": "Henüz yorum yok.",
  "watch.commentsLocked": "Yorumlar geçici olarak kapalı",
  "watch.commentsLockedBadge": "KAPALI",
  "watch.commentsLockedHint":
    "Kısa süre içinde yeniden açılacak. Bu sürede mevcut yorumları okuyabilirsin.",
  "watch.commentName": "Adın (isteğe bağlı)",
  "watch.commentPlaceholder": "Yorumunu yaz…",
  "watch.commentSubmit": "Gönder",
  "watch.commentDelete": "Sil",
  "watch.commentsAnonymous": "Misafir",
  "home.continueFrom": "S{season}B{episode}'ten devam et",
  // Ana kolon başlığı. Referans "Latest Episode" (başlık cümlesi) yazar; eskiden
  // BÜYÜK HARF ("SON BÖLÜMLER") idi ve referanstan sapıyordu → DÜZELTİLDİ.
  // Referans bu başlığın SAĞINA küçük bir filtre şeridi (All/Sub/Dub) + ←/→ okları
  // koyar; o şerit BİLEREK ÇİZİLMEZ çünkü elimizde onu besleyecek gerçek veri YOK
  // (gerekçe routes/index.tsx → "Latest Episode" bölümündeki nota bakın).
  "home.latestEpisodes": "Son Bölümler",
  "home.newReleases": "YENİ ÇIKANLAR",
  "home.newlyAdded": "YENİ EKLENENLER",
  // Banttaki ÜÇÜNCÜ kolon. Referans "Just Completed" yazar; bizde karşılığı
  // TAMAMLANANLAR. Kolonu besleyen veri GERÇEK bir "tamamlandı" alanı değil,
  // belgelenmiş bir VEKİL ölçüttür (bkz. routes/index.tsx → COMPLETED_STALE_DAYS).
  "home.justCompleted": "TAMAMLANANLAR",
  "home.bandAria": "Yeni çıkanlar ve tamamlananlar",
  // PANEL BAŞLIĞI — ARTIK DİLE BAĞLI (kullanıcı geri bildirimi).
  // ÖNCEKİ HATA: `tr` ve `en` değerleri BİLEREK AYNI ("TOP TRENDING") yazılmıştı;
  // panel bu yüzden dil değiştirince başlığını DEĞİŞTİRMİYORDU — kullanıcı
  // "TR'ye geçince TOP TRENDING paneli hâlâ değişmiyor" dedi. Paneldeki diğer tüm
  // metinler (sekmeler, ipuçları, meta şeridi, `aria-label`) zaten sözlükten
  // geldiği için dil değişiminde güncelleniyordu; değişmeyen tek metin BAŞLIKTI.
  // ÇÖZÜM: `tr` için doğal Türkçe karşılık ("TREND OLANLAR"), `en` için özgün ürün
  // adı ("TOP TRENDING").
  // DÜRÜSTLÜK NOTU (değişmedi): panelin ARKASINDAKİ sıralama gerçekte BÖLÜM
  // SAYISINA göredir; şemada görüntülenme / puan / trend alanı YOK (`shows`
  // tablosunda rating, view, trend kolonu bulunmuyor). ÖLÇÜT sekmelerde
  // (BÖL. / SEZON / YENİ) ve ipucu balonlarında açıkça belirtilir; reyting,
  // izlenme ya da "trend" sırası hiçbir yerde gösterilmez.
  "home.ranking": "Top Trending",
  "home.rankingAria": "Sıralama",
  "home.rankTabAria": "Sıralama ölçütü",
  // SEKME ETİKETLERİ KISALTILDI (BÖLÜM → BÖL.): kenar çubuğu 364 px'te
  // başlık (188 px) ile birlikte TEK satıra sığmıyordu (bkz. index.tsx
  // başlık şeridi ölçüm notu). "SEZON"/"YENİ" kısalmaya gerek olmadan
  // sığıyor, bu yüzden ölçüt adları okunur kalır; tam açıklama zaten
  // ipucu (title) balonundadır.
  "home.rankDay": "GÜN",
  "home.rankWeek": "HAFTA",
  "home.rankMonth": "AY",
  "home.rankDayHint": "Son 24 saatte eklenen bölüm sayısına göre (çok → az)",
  "home.rankWeekHint": "Son 7 günde eklenen bölüm sayısına göre (çok → az)",
  "home.rankMonthHint": "Son 30 günde eklenen bölüm sayısına göre (çok → az)",
  "home.episodeCountTitle": "Bölüm sayısı",
  "home.seasonCountTitle": "Sezon sayısı",
  "home.seasonTag": "Yeni seçkiler",
  // ANA KOLONDAKİ GERÇEK "GELECEK ANİMELER" BÖLÜMÜ (blueprint §2.6).
  // Referansın bu bölümdeki başlığı TR "GELECEK ANİMELER" / EN "Upcoming Anime".
  // NEDEN BU ANAHTAR ADI: başlık eskiden KATALOG ızgarasına verilmişti (o sırada
  // yaklaşan yayın verisi yoktu, bölüm hiç çizilemiyordu). Artık AniList'ten gelen
  // GERÇEK upcoming verisiyle çizilen bölümü etiketler; katalog ızgarasının başlığı
  // kendi adına döndü (`common.thisSeason` → "Bu sezon"). Böylece sayfada İKİ AYNI
  // başlık kalmaz ve header'daki/footer'daki "Bu sezon" bağlantıları (`#season`)
  // hedefledikleri bölümün adıyla yeniden uyuşur.
  "home.upcomingHeading": "GELECEK ANİMELER",
  "home.upcomingAria": "Gelecek animeler",
  // "Estimated Schedule" — referansın KENDİ bölüm adı; iki dilde de aynı yazılır.
  // BİLİNÇLİDİR (kullanıcı bu adı istedi): "TOP TRENDING"deki gibi bir ÇEVİRİ EKSİĞİ
  // değildir, vitrin etiketinin kendisidir.
  "home.scheduleHeading": "Estimated Schedule",
  "home.scheduleDayAria": "Gün seçimi",
  "home.scheduleToday": "Bugün",
  // Referans panelindeki 36×36 ‹ › düğmelerinin erişilebilirlik adları.
  "home.schedulePrevDay": "Önceki üç gün",
  "home.scheduleNextDay": "Sonraki üç gün",
  // Alt şeritteki `More ▾` düğmesi (referansta 9 satırdan sonrasını açar).
  "home.scheduleMore": "Daha fazla",
  "home.scheduleLess": "Daha az",
  "home.noFilterMatch": "Bu filtreye uygun seri bulunamadı.",
  "home.clearFilter": "Filtreyi temizle",
  // KALDIRILAN ANAHTARLAR (TÜR FİLTRESİ TAMAMEN SÖKÜLDÜ):
  //   · "home.genreTag" / "home.genreHeading" / "home.genreIntro" — büyük
  //     "Türlere göre keşfet" paneli (gereksiz tekrar) silindiğinde düşürüldü.
  //   · "home.genresTag" / "home.genresAria" — onun son kalıntısı olan tek
  //     satırlık GENRES çip şeridi KULLANICI İSTEĞİYLE silindiği için bu iki
  //     anahtarın da başka HİÇBİR kullanımı kalmadı.
  //   · "common.all" — yalnızca o şeridin "Tümü" çipinde kullanılıyordu.
  //     (Tür süzme durumu kodda sade bir Türkçe sabitle yürür; bkz.
  //     routes/index.tsx → ALL_GENRES.)

  // ---- A-Z listesi (referansın 8. bölümü) ----
  // Referans "A-Z List" başlığı + bir alt başlık + `ALL # 0-9 A B C … Z` çip
  // satırı taşır. Bu bölüm YENİ VERİ İSTEMEZ: çipler, hâlihazırda yüklü olan seri
  // listesini başlığın İLK HARFİNE göre İSTEMCİDE süzer (ek sorgu yok).
  "home.azHeading": "A-Z Listesi",
  "home.azSubtitle": "Başlığın ilk harfine göre serilere göz at.",
  "home.azAria": "A-Z listesi",
  "home.azFilterAria": "Harf filtresi",
  // "ALL" iki dilde de aynı yazılır (referansın kendi etiketi); "#" ve "0-9" bir
  // simge olduğu için sözlüğe girmez, işaretlemede doğrudan yazılır.
  "home.azAll": "ALL",
  "home.azEmpty": "Bu harfle başlayan seri yok.",

  // ---- Seri detay sayfası ----
  "series.loadError": "Bu seri yüklenemedi.",
  "series.notFound": "Bu seri bulunamadı.",
  "series.home": "Ana sayfa",
  "series.episodePill": "{count} Bölüm",
  "series.seasonPill": "{count} Sezon",
  "series.readMore": "Devamını oku",
  "series.showLess": "Daha az göster",
  "series.continueFrom": "Kaldığın yerden devam et — S{season}B{episode}",
  // KISA "devam et" etiketi: bölüm bilgisi düğme İÇİNDE küçük rozette verilir
  // (kullanıcı geri bildirimi, 03.10.2026: uzun cümle düğmeyi hantal yapıyordu).
  "series.continueShort": "Devam et",
  "series.episodesHeading": "Bölümler",
  "series.relatedMovies": "Filmler",
  "series.noEpisodes": "Henüz bölüm eklenmedi.",
  "series.seasonSelectAria": "Sezon seçimi",
  "series.seasonSelectSr": "Sezon seç",
  // Bölüm listesinin SAĞ ÜSTÜNDEKİ sezon seçicisinin etiketi (referans düzeni:
  // etiket + açılır liste). Kısa ve büyük harfli tutulur; "Sezon seç" metni
  // ekran okuyucu içindir (`series.seasonSelectSr`) ve görünmez.
  "series.seasonLabel": "SEZON",
  "series.watchedProgress": "{watched}/{total} izlendi",
  "series.rowView": "Satır görünümü",
  "series.gridView": "Izgara görünümü",
  "series.watchedBadge": "izlendi",
  // Detay sayfasındaki bölüm satırında "EN SON EKLENEN" bölümün rozeti.
  "series.newBadge": "YENİ",
  // YÜKLEME TAZELİĞİ (kullanıcı isteği, 04.10.2026): "sadece DÜN ve BUGÜN olsun,
  // yüklendiği belli olsun". Rozet artık "yeni mi" değil, "NE ZAMAN eklendi"
  // sorusunu yanıtlar; `created_at` bugünse BUGÜN, dünse DÜN yazar.
  "series.addedToday": "BUGÜN",
  "series.addedYesterday": "DÜN",
  "series.showMore": "{count} bölüm daha göster",
  "series.similar": "Benzer seriler",
  "series.seasonFallback": "{number}. Sezon",
  "series.episodeLabel": "{number}. Bölüm",
  /**
   * SEZONLU BÖLÜM ETİKETİ — kullanıcı isteği (28.09.2026): "her zaman sezon yazsın".
   * Tek sezonlu dizide de sezon görünür ("1. Sezon 1. Bölüm").
   *
   * NEDEN AYRI ANAHTAR: `series.episodeLabel` sezonun ELDE OLMADIĞI yerlerde
   * (kısa rozetler, önbelleğe alınmış metinler) yedek olarak kalır. Sezonu bilen
   * her çağrı bu anahtarı kullanır.
   */
  "series.seasonEpisodeLabel": "{season}. Sezon {number}. Bölüm",
  // Bölüm kısaltması etiketi: kart kapağının altında "S1 B1" (animecix düzeni).
  // NEDEN AYRI ANAHTAR: kısaltma dile bağlıdır — Türkçede "B"/"Bölüm", İngilizcede
  // "E"/"Episode". Harfi koşullu üretmek yerine iki dilin metni sözlükte durur.
  "series.seasonEpisodeBadge": "S{season} B{number}",
  // Aynı etiketin boşluksuz biçimi (ana sayfa "son bölümler" satırı: "S1B1").
  "series.seasonEpisodeCode": "S{season}B{number}",
  // Bölüm satırındaki kapak üzerine bindirilen köşe etiketi ("S1 B1"). Kullanıcı
  // isteği (30.09.2026): "s1 b1 yazsın, s 01 b 01 değil" — numaralar artık İKİ
  // BASAMAĞA TAMAMLANMAZ (tamamlama çağıran taraftan kaldırıldı). Harf/ayraç
  // düzeni dile bağlı olduğu için sözlükte durur (İngilizcede "E").
  "series.seasonEpisodeOverlay": "S{season} B{number}",
  // Takvim satırındaki bölüm rozeti ("B1" / "EP 1"): harf dile bağlıdır.
  "series.episodeBadge": "B{number}",

  // ---- İzleme sayfası ----
  "watch.episodeNotFound": "Bölüm bulunamadı",
  "watch.srEpisodeWatch": "{number}. Bölüm izle",
  "watch.srWatch": "izle",
  // Oynatıcı altındaki kaynak grupları (kullanıcı, 28.09.2026):
  // "Kaynak Türkçe yazmasın, oraya ALTYAZI yaz; aşağıdaki KAYNAK yazan yere de
  //  DİĞER ÇEVİRİLER yaz."
  // Gerekçe: "KAYNAK – Türkçe" etiketi hem uzun hem de site global açıldığında
  // kime göre "Türkçe" olduğu belirsiz kalıyordu; "Altyazı / Diğer Çeviriler"
  // izleyicinin aradığı şeyi söyler (altyazılı sürüm ↔ diğer çeviriler).
  "watch.trBox": "Altyazı",
  "watch.foreignBox": "Diğer Çeviriler",
  "watch.noVideo": "Bu bölüm için video henüz eklenmedi.",
  /**
   * ÖZEL / ÖN BÖLÜM (`0. Bölüm`) kaynağı yokken gösterilir.
   *
   * Kullanıcı isteği (29.09.2026, ikinci tur): "0. bölüm açılınca ep 1'e
   * DÜŞMESİN; oynatılabilir kaynak yoksa 404 YERİNE net bir 'Bu bölüm için
   * kaynak yok' durumu gösterilsin." Metin BİREBİR budur.
   */
  "watch.specialNoSource": "Bu bölüm için kaynak yok",
  "watch.reportTitle": "Bölüm sorunu bildir",
  "watch.skipHint": "Kapanış jeneriği {time}'de atlanır",
  "watch.advancing": "{number}. bölüme geçiliyor… · {reason}",
  "watch.reasonEnded": "bölüm bitti",
  "watch.reasonSkipped": "kapanış jeneriği atlandı",
  "watch.countdown": "{seconds} saniye sonra {number}. bölüme geçilecek",
  "watch.noEpisode": "Bölüm yok",
  "watch.autoNextLabel": "Oto. Sonraki Bölüm",
  "watch.autoNextHint": "Bölüm bitince sonraki bölüme geçer",
  "watch.dimLabel": "Sahne Işıkları",
  "watch.dimHint": "Sayfanın geri kalanını karartır, dikkat videoda kalır",
  "watch.previous": "Önceki",
  "watch.next": "Sonraki",
  "watch.firstEpisodeTitle": "İlk bölümdesin",
  "watch.lastEpisodeTitle": "Son bölümdesin",
  "watch.seasonEpisodeShort": "S{season} · {number}. bölüm",
  "watch.sourceAnizmTitle": "Anizm / Puffy — Türkçe altyazı videoya gömülü, 1080p, pop-up yok",
  "watch.sourceTauTitle": "TauVideo — 720p, Türkçe altyazı videoda",
  "watch.turkishSearching": "Türkçe kaynak aranıyor…",
  "watch.turkishNotFound": "Bulunamadı — tekrar dene",
  "watch.turkishSearch": "Türkçe kaynağı ara",
  "watch.turkishSearchHint": "Kayıtlı Türkçe kaynak yok: adres sunucuda aranır",
  "watch.defaultSourceTitle":
    "Varsayılan sağlayıcı — orijinal Japonca ses, altyazı oynatıcının CC menüsünde",
  "watch.directiveTitle": "{provider} sağlayıcısından üretilen adres",
  "watch.badgeAnizm": "Anizm · TR gömülü",
  "watch.badgeMegaplay": "Megaplay",
  "watch.playerTitle": "{title} bölüm {number}",
  "watch.playEpisodeAria": "{title} bölümünü oynat",
  "watch.prerollLoading": "Reklam yükleniyor…",
  "watch.prerollCounter": "Reklam {index}/{total}",
  "watch.prerollUnmute": "Sesi aç",
  "watch.prerollSkip": "Reklamı geç",
  "watch.prerollSkipCountdown": "Reklamı geç: {seconds}",
  "watch.prerollUpcoming": "Önce {count} kısa reklam oynayacak",
  "watch.adTextFirst": "Reklam · siteyi ayakta tutan gelir",
  "watch.adTextPlain": "Reklam",
  "watch.adSkipCountdown": "Reklamı geç: {seconds}",
  "watch.adSkipClick": "Reklama geç",

  // ---- İzleme sayfası — sonradan eklenen parçalar ----
  // "Şu an izliyorsun" cümlesi İKİ anahtara bölünür: kalın kısım ile kuyruk.
  // NEDEN: cümlede kalın (vurgulu) kısım yalnızca "{n}. bölümü" iken İngilizcede
  // kelime sırası farklıdır ("Episode 3 is now playing."). Tek anahtar kullanılsaydı
  // ya vurgu tüm cümleye yayılır (görünüm değişir) ya da İngilizce bozuk olurdu.
  // Bölüm numarası etiketi (küçük harfli "bölüm"): sezon geçiş düğmelerinde kullanılır.
  "watch.episodeShort": "{number}. bölüm",
  // Altyazı izinin veritabanında `label` alanı yoksa gösterilen varsayılan ad.
  "watch.subtitleDefault": "Altyazı",
  // Reklam kapısındaki büyük "Oynat" düğmesi.
  "watch.play": "Oynat",
  // "Bildir" panoya kopyalanan metnin ön eki ve Anizm kaynağı eki.
  "watch.reportPrefix": "Bildirim",
  "watch.reportAnizmSource": " · Anizm kaynağı",

  // ---- 404 / hata sınırı ----
  "notFound.title": "Sayfa bulunamadı",
  "notFound.body": "Aradığın sayfa yok ya da taşınmış olabilir.",
  "error.title": "Sayfa yüklenemedi",
  "error.body":
    "Bir şeyler ters gitti. Sayfayı yenilemeyi ya da ana sayfaya dönmeyi deneyebilirsin.",
  "error.retry": "Tekrar dene",

  // ---- İçerik türü yedeği ----
  // Alt başlığı ve yılı olmayan serilerin kart alt satırı. Veritabanı içeriği değil,
  // arayüz yedeğidir → çevrilir (iki dilde de aynı yazılır, özel ad).
  "common.anime": "Anime",

  // ---- Sekme başlığı ve sayfa künyesi (meta) ----
  // NEDEN SÖZLÜKTE: rota `head()` çağrıları SUNUCUDA bir kez üretilir ve dili
  // izleyemez (sunucuda `localStorage` yoktur, dil her zaman `DEFAULT_LANG` —
  // yani bugün İngilizce — kalır). Sekme
  // başlığı bu yüzden istemcide `useDocumentTitle` ile aktif dile bağlanır;
  // buradaki değerler hem SSR başlığı hem de istemci güncellemesi için tek kaynaktır.
  "meta.animesDescription": "Anime kataloğunu keşfet ve aradığın animeyi bul.",
  "meta.scheduleDescription": "Haftalık anime yayın takvimini ve yeni bölümleri takip et.",
  "meta.homeTitle": "Ana Sayfa - shanime",
  "meta.siteDescription": "Yeni anime serilerini keşfet.",
  "meta.seriesNotFoundTitle": "Seri bulunamadı | shanime",
  "meta.seriesTitle": "{title} izle | shanime",
  "meta.seriesDescription": "{title} tüm bölümleri Türkçe altyazılı izle. {seasons}{count} bölüm.",
  "meta.seriesDescriptionSeasons": "{count} sezon, ",
  "meta.watchTitle": "shanime | İzle",
  "meta.watchSeriesTitle": "{title} izle | shanime",
  "meta.watchEpisodeTitle": "{title} {number}. bölüm izle | shanime",

  // ---- Tekil/çoğul (İngilizce sayı uyumu) ----
  // TÜRKÇEDE sayıdan sonra çoğul eki YOKTUR: "1 bölüm" ve "24 bölüm" aynı yazılır.
  // İngilizcede ise "1 episode" / "24 episodes" ayrımı ŞARTTIR; bu yüzden her
  // sayısal metnin bir "One" karşılığı vardır ve çağrı yerleri `plural()` kullanır
  // (bkz. `plural` yardımcı fonksiyonu).
  "home.episodeCountOne": "{count} bölüm",
  "home.seasonCountOne": "{count} sezon",
  "series.episodePillOne": "{count} Bölüm",
  "series.seasonPillOne": "{count} Sezon",
  "series.showMoreOne": "{count} bölüm daha göster",
} as const;

/**
 * İNGİLİZCE SÖZLÜK.
 *
 * `Record<I18nKey, string>` tipi BİLEREK seçildi: eksik bir anahtar ya da
 * `tr`de olmayan fazladan bir anahtar derleme zamanında hata verir. Böylece
 * "Türkçede var, İngilizcede yok" durumu sessizce ekrana düşemez.
 */
const en: Record<I18nKey, string> = {
  // ---- Shared chrome ----
  "common.home": "Home",
  "common.series": "Series",
  "common.thisSeason": "This season",
  "common.viewAll": "All",
  "common.seeAll": "View all",
  "common.watchNow": "Watch now",
  "common.seriesDetails": "Series details",
  "common.comingSoon": "Coming soon",
  "common.search": "Search anime",
  "common.searchPlaceholder": "Search anime...",
  "common.quickAccess": "Quick Access",
  "common.closeSearch": "Close search",
  "common.clearSearch": "Clear search",
  "common.openMenu": "Open menu",
  "common.closeMenu": "Close menu",
  "common.explore": "Explore",
  "common.random": "Random",
  "common.searchTab": "Search",
  "common.schedule": "Schedule",
  "common.tvKind": "TV",
  "common.movieKind": "Movie",
  "common.logoAlt": "shanime logo",
  "common.homeAria": "shanime home",
  "common.mainNav": "Main navigation",
  "common.backHome": "Back to home",
  "common.animeSeries": "Anime · Series",

  // ---- Language switch ----
  "lang.groupLabel": "Language selection",
  "lang.trLabel": "Türkçe",
  "lang.enLabel": "English",

  // ---- Footer ----
  "footer.tagline":
    "Find your next series: this season's standout anime titles, episodes and details in one place.",
  "footer.explore": "Explore",
  "footer.allSeries": "All series",
  "footer.genres": "Genres",
  "footer.copyright": "© 2026 shanime · Built for anime discovery.",

  // ---- Catalogue ----
  "catalog.all": "All",
  "catalog.series": "Series",
  "catalog.movies": "Movies",
  "catalog.headingAll": "All titles",
  "catalog.headingSeries": "Series",
  "catalog.headingMovies": "Movies",
  "catalog.cataloged": "{count} titles",
  "catalog.search": "Search series or movies...",
  "catalog.genre": "Genre",
  "catalog.year": "Year",
  "catalog.sort": "Sort",
  "catalog.sortFeatured": "Featured",
  "catalog.sortNewest": "Recently added",
  "catalog.sortAZ": "A-Z",
  "catalog.allGenres": "All genres",
  "catalog.allYears": "All years",
  "catalog.clear": "Clear filters",
  "catalog.filterAria": "Catalogue filters",
  "catalog.noResults": "No titles match these filters.",
  "catalog.seriesKind": "Series",
  "catalog.movieKind": "Movie",

  // ---- Library status ----
  "library.aria": "Library status",
  "library.add": "Add to library",
  "library.remove": "Remove from library",
  "library.watching": "Watching",
  "library.completed": "Completed",
  "library.onHold": "On hold",
  "library.dropped": "Dropped",
  "library.planToWatch": "Plan to watch",

  // ---- Home ----
  "home.heroBadge": "Featured",
  "home.heroSrTitle": "shanime — this season's standout anime series",
  "home.heroAria": "Showcase",
  "home.slideScene": "{title} scene",
  "home.coverAlt": "{title} cover image",
  "home.logoAlt": "{title} logo",
  "home.episodeCount": "{count} episodes",
  "home.seasonCount": "{count} seasons",
  "home.prevSeries": "Previous series",
  "home.nextSeries": "Next series",
  "home.slideSelect": "Showcase selection",
  "home.goToSlide": "Go to the {title} slide",
  "home.resultKind": "Anime · Series",
  "home.searchEmpty": "No series match your search.",
  "home.continueTag": "Keep watching",
  "home.continueHeading": "CONTINUE WHERE YOU LEFT OFF",
  "home.continueAria": "Continue where you left off",
  "home.continueEdit": "Edit",
  "home.continueDone": "Done",
  "home.continueRemove": "Remove {title} from the list",
  "home.minLeft": "{min} min left",
  "common.minutesShort": "{min} min",
  "common.seasonEpisode": "Season {season}, Episode {n}",
  "watch.backToSeries": "Back to series",
  "watch.episodeCountChip": "{count} episodes",
  "watch.sourceLabel": "Source",
  "watch.audioLabel": "Audio",
  "watch.audioSub": "SUB",
  "watch.audioDub": "DUB",
  "watch.reportAction": "Report",
  "watch.reportCancel": "Cancel",
  "watch.reportIntro":
    "Send a technical issue with this episode (video won't play, wrong subtitles, etc.) to the team.",
  "watch.reportCurrent": "Current episode",
  "watch.reportPlaceholder": "Describe the issue (optional)",
  "watch.seasonsHeading": "Seasons",
  "watch.previousSeason": "Previous season",
  "watch.nextSeason": "Next season",
  "watch.seasonNumber": "Season {n}",
  "watch.commentsHeading": "Comments",
  "watch.commentsEmpty": "No comments yet. Be the first to write one.",
  "watch.commentsEmptyLocked": "No comments yet.",
  "watch.commentsLocked": "Comments are temporarily closed",
  "watch.commentsLockedBadge": "CLOSED",
  "watch.commentsLockedHint":
    "They will reopen soon. In the meantime you can still read existing comments.",
  "watch.commentName": "Your name (optional)",
  "watch.commentPlaceholder": "Write a comment…",
  "watch.commentSubmit": "Post",
  "watch.commentDelete": "Delete",
  "watch.commentsAnonymous": "Guest",
  "home.continueFrom": "Resume from S{season}E{episode}",
  // Reference wording ("Latest Episode"): the old ALL-CAPS value ("LATEST
  // EPISODES") did not match the reference. The small filter row + arrows the
  // reference puts on the right are deliberately NOT rendered — no data backs
  // them (see the note in routes/index.tsx, "Latest Episode" section).
  "home.latestEpisodes": "Latest Episode",
  "home.newReleases": "NEW RELEASES",
  "home.newlyAdded": "NEWLY ADDED",
  // Üçüncü kolonun İngilizce karşılığı referansın kendi başlığıdır.
  "home.justCompleted": "JUST COMPLETED",
  "home.bandAria": "New releases and just completed",
  // Panel title now FOLLOWS the language (see the Turkish note at the same key).
  // The previous bug: `tr` and `en` were deliberately identical ("TOP TRENDING"),
  // so the panel kept its heading when the site language changed. Every OTHER
  // string in that panel already came from the dictionary; only the title was
  // stuck. Turkish reads "TREND OLANLAR", English keeps the original wording.
  // Honesty note (unchanged): the ordering behind the panel is really by EPISODE
  // COUNT — the schema has no views/rating/trend column.
  "home.ranking": "Top Trending",
  "home.rankingAria": "Ranking",
  "home.rankTabAria": "Ranking criterion",
  // Tab labels shortened for the same 364 px single-line fit as the Turkish
  // dictionary (EPISODES → EPS., SEASONS → SEAS.); full wording stays in the
  // hint (title) tooltips.
  "home.rankDay": "DAY",
  "home.rankWeek": "WEEK",
  "home.rankMonth": "MONTH",
  "home.rankDayHint": "By episodes added in the last 24 hours (most → least)",
  "home.rankWeekHint": "By episodes added in the last 7 days (most → least)",
  "home.rankMonthHint": "By episodes added in the last 30 days (most → least)",
  "home.episodeCountTitle": "Episode count",
  "home.seasonCountTitle": "Season count",
  "home.seasonTag": "New picks",
  // The REAL "Upcoming Anime" block in the main column (blueprint §2.6), fed by
  // the AniList query. The heading used to label the CATALOGUE grid instead (there
  // was no upcoming data back then); the catalogue grid is now titled
  // `common.thisSeason` again, so the page never shows the same heading twice and
  // the "This season" links (`#season`) match the section they jump to.
  "home.upcomingHeading": "Upcoming Anime",
  "home.upcomingAria": "Upcoming anime",
  // "Estimated Schedule" — the reference's own section name; identical in both
  // languages ON PURPOSE (a showcase label, not a missing translation).
  "home.scheduleHeading": "Estimated Schedule",
  "home.scheduleDayAria": "Day selection",
  "home.scheduleToday": "Today",
  "home.schedulePrevDay": "Previous three days",
  "home.scheduleNextDay": "Next three days",
  "home.scheduleMore": "More",
  "home.scheduleLess": "Less",
  "home.noFilterMatch": "No series match this filter.",
  "home.clearFilter": "Clear filter",
  // REMOVED KEYS (THE WHOLE GENRE FILTER WAS STRIPPED OUT):
  //   · "home.genreTag" / "home.genreHeading" / "home.genreIntro" — dropped
  //     when the large "Explore by genre" panel (needless duplication) was
  //     deleted.
  //   · "home.genresTag" / "home.genresAria" — its last remnant, the one-line
  //     GENRES chip strip, was deleted AT THE USER'S REQUEST, so nothing
  //     references these two any more.
  //   · "common.all" — was used only by that strip's "All" chip.
  // (See the Turkish note at the same position in the `tr` dictionary.)

  // ---- A-Z list (reference section 8) ----
  // Needs NO new data: the chips filter the already-loaded series list client-side.
  "home.azHeading": "A-Z List",
  "home.azSubtitle": "Browse series by the first letter of the title.",
  "home.azAria": "A-Z list",
  "home.azFilterAria": "Letter filter",
  "home.azAll": "ALL",
  "home.azEmpty": "No series start with this letter.",

  // ---- Series detail ----
  "series.loadError": "This series could not be loaded.",
  "series.notFound": "This series could not be found.",
  "series.home": "Home",
  "series.episodePill": "{count} Episodes",
  "series.seasonPill": "{count} Seasons",
  "series.readMore": "Read more",
  "series.showLess": "Show less",
  "series.continueFrom": "Continue where you left off — S{season}E{episode}",
  "series.continueShort": "Continue",
  "series.episodesHeading": "Episodes",
  "series.relatedMovies": "Movies",
  "series.noEpisodes": "No episodes added yet.",
  "series.seasonSelectAria": "Season selection",
  "series.seasonSelectSr": "Choose season",
  "series.seasonLabel": "SEASON",
  "series.watchedProgress": "{watched}/{total} watched",
  "series.rowView": "Row view",
  "series.gridView": "Grid view",
  "series.watchedBadge": "watched",
  "series.newBadge": "NEW",
  "series.addedToday": "TODAY",
  "series.addedYesterday": "YESTERDAY",
  "series.showMore": "Show {count} more episodes",
  "series.similar": "Similar series",
  "series.seasonFallback": "Season {number}",
  "series.episodeLabel": "Episode {number}",
  "series.seasonEpisodeLabel": "Season {season} Episode {number}",
  "series.seasonEpisodeBadge": "S{season} E{number}",
  "series.seasonEpisodeCode": "S{season}E{number}",
  "series.seasonEpisodeOverlay": "S{season} E{number}",
  "series.episodeBadge": "EP {number}",

  // ---- Watch page ----
  "watch.episodeNotFound": "Episode not found",
  "watch.srEpisodeWatch": "Watch episode {number}",
  "watch.srWatch": "watch",
  "watch.trBox": "Subtitles",
  "watch.foreignBox": "Other Translations",
  "watch.noVideo": "No video has been added for this episode yet.",
  "watch.specialNoSource": "No source available for this episode",
  "watch.reportTitle": "Report episode issue",
  "watch.skipHint": "Ending skipped at {time}",
  "watch.advancing": "Switching to episode {number}… · {reason}",
  "watch.reasonEnded": "episode finished",
  "watch.reasonSkipped": "ending skipped",
  "watch.countdown": "Switching to episode {number} in {seconds} seconds",
  "watch.noEpisode": "No episode",
  "watch.autoNextLabel": "Auto next episode",
  "watch.autoNextHint": "Plays the next episode when this one ends",
  "watch.dimLabel": "Stage lights",
  "watch.dimHint": "Dims the rest of the page so your attention stays on the video",
  "watch.previous": "Previous",
  "watch.next": "Next",
  "watch.firstEpisodeTitle": "You are on the first episode",
  "watch.lastEpisodeTitle": "You are on the last episode",
  "watch.seasonEpisodeShort": "S{season} · Episode {number}",
  "watch.sourceAnizmTitle": "Anizm / Puffy — Turkish subtitles burned in, 1080p, no pop-ups",
  "watch.sourceTauTitle": "TauVideo — 720p, Turkish subtitles in the video",
  "watch.turkishSearching": "Searching for a Turkish source…",
  "watch.turkishNotFound": "Not found — try again",
  "watch.turkishSearch": "Search for a Turkish source",
  "watch.turkishSearchHint": "No saved Turkish source: the address is looked up on the server",
  "watch.defaultSourceTitle":
    "Default provider — original Japanese audio, subtitles in the player's CC menu",
  "watch.directiveTitle": "Address generated from the {provider} provider",
  "watch.badgeAnizm": "Anizm · TR embedded",
  "watch.badgeMegaplay": "Megaplay",
  "watch.playerTitle": "{title} episode {number}",
  "watch.playEpisodeAria": "Play {title}",
  "watch.prerollLoading": "Loading ad…",
  "watch.prerollCounter": "Ad {index}/{total}",
  "watch.prerollUnmute": "Unmute",
  "watch.prerollSkip": "Skip ad",
  "watch.prerollSkipCountdown": "Skip ad in {seconds}",
  "watch.prerollUpcoming": "{count} short ads will play first",
  "watch.adTextFirst": "Ad · the revenue that keeps this site running",
  "watch.adTextPlain": "Ad",
  "watch.adSkipCountdown": "Skip ad in {seconds}",
  "watch.adSkipClick": "Skip ad",

  // ---- Watch page — added later ----
  "watch.episodeShort": "Episode {number}",
  "watch.subtitleDefault": "Subtitles",
  "watch.play": "Play",
  "watch.reportPrefix": "Report",
  "watch.reportAnizmSource": " · Anizm source",

  // ---- 404 / error boundary ----
  "notFound.title": "Page not found",
  "notFound.body": "The page you are looking for does not exist or may have been moved.",
  "error.title": "Page failed to load",
  "error.body": "Something went wrong. You can try refreshing the page or going back home.",
  "error.retry": "Try again",

  // ---- Content-type fallback ----
  "common.anime": "Anime",

  // ---- Tab title and page metadata ----
  "meta.animesDescription": "Explore the anime catalog and find your next anime.",
  "meta.scheduleDescription": "Follow the weekly anime release schedule and upcoming episodes.",
  "meta.homeTitle": "Home - shanime",
  "meta.siteDescription": "Discover new anime series.",
  "meta.seriesNotFoundTitle": "Series not found | shanime",
  "meta.seriesTitle": "Watch {title} | shanime",
  "meta.seriesDescription":
    "{title} — watch every episode with Turkish subtitles. {seasons}{count} episodes.",
  "meta.seriesDescriptionSeasons": "{count} seasons, ",
  "meta.watchTitle": "shanime | Watch",
  "meta.watchSeriesTitle": "Watch {title} | shanime",
  "meta.watchEpisodeTitle": "Watch {title} — episode {number} | shanime",

  // ---- Singular/plural ----
  // Turkish never takes a plural suffix after a number ("1 bölüm", "24 bölüm");
  // English needs the singular form ("1 episode" vs "24 episodes").
  "home.episodeCountOne": "{count} episode",
  "home.seasonCountOne": "{count} season",
  "series.episodePillOne": "{count} Episode",
  "series.seasonPillOne": "{count} Season",
  "series.showMoreOne": "Show {count} more episode",
};

/** Şu an geçerli dil. Sunucuda HER ZAMAN `DEFAULT_LANG` kalır (aşağıdaki nota bkz.). */
let currentLang: Lang = DEFAULT_LANG;

/**
 * Dil değişimini dinleyen bileşenler.
 *
 * NEDEN ABONE LİSTESİ: başlıktaki tek bir TR/EN düğmesi tüm sayfanın metnini
 * değiştirmeli. Her bileşen kendi `useState`ini tutsaydı yalnızca düğmenin
 * kendisi yeniden çizilir, sayfanın geri kalanı eski dilde kalırdı. Tek bir
 * modül seviyesi kaynak + abonelik, seçimi TÜM bileşenlere aynı anda yayar.
 */
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** `useSyncExternalStore` aboneliği — React 18+ ile gelen yerleşik API, ek paket yok. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** İstemcide okunan anlık değer. */
function getSnapshot(): Lang {
  return currentLang;
}

/**
 * Sunucu (SSR) anlık değeri.
 *
 * NEDEN SABİT VARSAYILAN: sunucuda `window`/`localStorage`/`navigator` YOKTUR.
 * Sunucu her zaman `DEFAULT_LANG` (bugün `en`) yazar; istemcinin İLK render'ı da
 * `DEFAULT_LANG`'tir (gerçek tercih mount sonrası effect'te okunur) ve SSR'deki
 * `<html lang>` de aynı sabitten gelir (bkz. `__root.tsx` → `RootShell`). Böylece
 * hem hidrasyon uyuşmazlığı (hydration mismatch) hem de dil/`lang` uyuşmazlığı
 * oluşmaz.
 */
function getServerSnapshot(): Lang {
  return DEFAULT_LANG;
}

/** Değerin geçerli bir dil olup olmadığını daraltır. */
function isLang(value: unknown): value is Lang {
  return value === "tr" || value === "en";
}

/**
 * Depodan kayıtlı dili okur.
 *
 * ASLA HATA FIRLATMAZ: `localStorage` erişimi (gizli sekme, kapatılmış depo,
 * kota) bazı tarayıcılarda doğrudan exception atar. Bozuk/eksik/erişilemez
 * veri "tercih yok" demektir — site varsayılan dille sorunsuz açılmalıdır.
 */
function readStoredLang(): Lang | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LANG_STORAGE_KEY);
    return isLang(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Depoya yazar. Aynı şekilde hata fırlatmaz: yazamıyorsak seçim yalnızca bu
 * oturum için geçerli olur, uygulama çalışmaya devam eder.
 */
function writeStoredLang(lang: Lang): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* Depo yazılamıyorsa sessizce geç: tercih bu oturumla sınırlı kalır. */
  }
}

/**
 * Tarayıcı dilini okur: `tr` → tr, `en` (en-US, en-GB…) → en, diğerleri → null.
 *
 * NEDEN YALNIZCA İKİ DİL: sözlüğümüz iki dilli. Tanımadığımız bir dilde
 * (`de`, `fr`…) burada null döneriz; çağıran `hydrateLang()` o durumda
 * `DEFAULT_LANG`e (bugün `en`) düşer. (Eskiden varsayılan `tr`ydi.)
 */
function detectBrowserLang(): Lang | null {
  /**
   * TARAYICI DİLİ ARTIK KULLANILMIYOR — site HERKESE İngilizce açılır.
   *
   * KULLANICI İSTEĞİ (01.10.2026): "ana dil İngilizce olacak, varsayılan".
   *
   * ESKİDEN NEYDİ: sıra "KAYITLI TERCİH → TARAYICI DİLİ → varsayılan" idi; bu
   * yüzden Türkçe tarayıcı (`navigator.language = "tr…"`) otomatik TÜRKÇE
   * açılıyordu. İngilizce isteyen ziyaretçi her seferinde TR→EN çevirmek zorunda
   * kalıyordu ve site varsayılan olarak Türkçe görünüyordu.
   *
   * YENİ SIRA: KAYITLI TERCİH → (yoksa) İNGİLİZCE.
   * Yani:
   *   · İlk kez gelen HERKES İngilizce görür (tarayıcısı ne olursa olsun),
   *   · TR düğmesine basan TÜRKÇE'ye geçer ve tercih cihazda saklanır,
   *   · kayıtlı tercih her zaman kazanır — kimsenin seçimi ezilmez.
   *
   * Fonksiyon silinmedi: `hydrateLang()` hâlâ onu çağırıyor ve `null` dönmesi
   * "varsayılana düş" anlamına geliyor; böylece çağrı zinciri değişmiyor.
   */
  return null;
}

/**
 * Dili uygular: modül değişkenini günceller, dinleyicilere haber verir,
 * `<html lang>` niteliğini tazeler ve (istenirse) tercihi kaydeder.
 *
 * `persist` YALNIZCA kullanıcı seçiminde true olur: otomatik tespit edilen dil
 * depoya yazılmaz, böylece kullanıcı bilinçli bir tercih yapana kadar
 * "hatırlanan seçim" oluşmaz.
 *
 * ── NEDEN BURADA GEZİNME/YENİLEME YOK (kullanıcı geri bildirimi) ────────────
 * KULLANICI: "TR'ye basınca sayfa neden yenileniyor?" Dil değişimi bir
 * YÖNLENDİRME DEĞİLDİR ve bu fonksiyon bilerek yalnızca şunları yapar:
 *   1) modül değişkenini değiştirir, 2) abonelere haber verir (React yeniden
 * çizer), 3) `<html lang>` niteliğini tazeler (ekran okuyucu için), 4) tercihi
 * depoya yazar.
 * Burada `router.invalidate()`, `navigate()`, `window.location.*` ya da
 * `location.reload()` YOKTUR — biri eklenirse dil düğmesi sayfayı baştan
 * yükler, kaydırma konumu sıfırlanır ve açık paneller (arama, mobil menü)
 * kapanır. İstenen davranış saf istemci metin değişimidir; kaydırma ve açık
 * paneller korunmalıdır.
 *
 * `<html lang>` yazımı GÜVENLİDİR: sunucuda çizilen kabuk (`__root.tsx` → `RootShell`)
 * `lang` özniteliğini `DEFAULT_LANG`ten alır; istemcide React bu öğeyi yönetmediği
 * için elle yazılan değer geri alınmaz ve gezinme tetiklemez.
 */
function applyLang(next: Lang, persist: boolean): void {
  if (next !== currentLang) {
    currentLang = next;
    emit();
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = next;
  }
  if (persist) writeStoredLang(next);
}

/**
 * İlk mount'ta bir kez çalışır: kayıtlı tercih → tarayıcı dili → `DEFAULT_LANG`.
 *
 * NEDEN EFFECT'TE (render sırasında DEĞİL): sunucuda depo yoktur ve istemcinin
 * ilk render'ı sunucu HTML'iyle aynı olmalıdır. Okuma mount sonrasına
 * bırakılınca hidrasyon uyuşmazlığı olmaz; kullanıcı bir kare boyunca
 * varsayılan dili, sonra kendi dilini görür.
 *
 * Birden çok bileşen `useLang()` çağırdığı için bu fonksiyon birçok kez
 * çağrılabilir; aynı değeri yeniden uygulamak zararsızdır (gereksiz emit yok).
 */
function hydrateLang(): void {
  applyLang(readStoredLang() ?? detectBrowserLang() ?? DEFAULT_LANG, false);
}

/** Metindeki `{ad}` yer tutucularını değerlerle doldurur. */
function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * MODÜL SEVİYESİ `t` — React dışından (yardımcı fonksiyon, üçüncü parti oynatıcı
 * yapılandırması, effect içi kod) çeviri yapmak için.
 *
 * Etkin dili modül değişkeninden okur; dil değişince otomatik güncellenir.
 * React bileşenlerinde bunun yerine `useLang().t` tercih edilmelidir: o sürüm
 * dil değiştiğinde bileşeni yeniden çizer, modül seviyesindeki sürüm çizmez.
 */
export const t: Translate = (key, vars) => format(dictFor(currentLang)[key], vars);

/** Geçerli dilin sözlüğü. */
function dictFor(lang: Lang): Record<I18nKey, string> {
  return lang === "en" ? en : tr;
}

/**
 * Sayı + çoğul uyumu: `1` için tekil anahtar, diğer sayılarda çoğul anahtar kullanılır.
 *
 * NEDEN AYRI YARDIMCI: `{count} bölüm` / `{count} episodes` gibi metinlerde İngilizce
 * çoğul ekini metnin kendisi taşıyor. Tek anahtar kullanıldığında kenar çubuğu
 * "1 seasons" / "1 episodes" yazıyordu (kullanıcı geri bildirimi). Türkçede sayıdan
 * sonra çoğul eki olmadığı için iki anahtarın değeri AYNIDIR — yine de anahtar
 * ikilisi tutulur ki iki dil aynı kuralla çalışsın.
 */
export function plural(t: Translate, count: number, oneKey: I18nKey, otherKey: I18nKey): string {
  return t(count === 1 ? oneKey : otherKey, { count });
}

/**
 * Sekme (`<title>`) metnini aktif dile bağlar.
 *
 * NEDEN HOOK: rota başlıkları `Route.head()` içinde üretilir ve `head()` SUNUCUDA
 * (ya da gezinme anında) bir kez çalışır — aktif dili izleyemez. Başlık dil
 * değişiminde de güncellenmeli diye istemcide bu efekt yazılır. Parametre olarak
 * HAZIR metin alınır (`t(...)` sonucu): dil değişince metin değişir, efekt yeniden
 * çalışır ve gereksiz bağımlılık (nesne/dizi) karşılaştırması gerekmez.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = title;
  }, [title]);
}

/** Çeviri yapan bileşenler için hook: `{ lang, setLang, t }`. */
export function useLang(): { lang: Lang; setLang: (lang: Lang) => void; t: Translate } {
  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  // İlk mount'ta tercihi oku (bkz. hydrateLang notu).
  useEffect(() => {
    hydrateLang();
  }, []);

  // Kullanıcı seçimi: değiştir + kalıcı yaz. useCallback ile sabit tutulur ki
  // tüketici bileşenlerin effect bağımlılıkları gereksiz kurulmasın.
  const setLang = useCallback((next: Lang) => {
    applyLang(next, true);
  }, []);

  // `t` dile bağlı: dil değiştiğinde yeni bir fonksiyon döner (tüketiciler
  // yeniden çizilir).
  const translate = useCallback<Translate>((key, vars) => format(dictFor(lang)[key], vars), [lang]);

  return { lang, setLang, t: translate };
}
