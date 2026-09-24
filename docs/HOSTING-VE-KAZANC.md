# Reklam Geliri Araştırması — Türkçe Anime İzleme Sitesi

**Kapsam:** Küçük bir anime izleme sitesi, trafiği ağırlıklı **Türkiye**, **mobil ağırlıklı**.
**Hariç:** Oynatıcı içi (video preroll/mid-roll) reklamlar — bunlar video sağlayıcıya aittir.
**Araştırma tarihi:** 24.09.2026 · Tüm rakamlar için kaynak URL verilmiştir. Kaynak bulunamayan yerler **"doğrulanamadı"**, tahminler **"TAHMİN"** olarak işaretlenmiştir.

> **Yasal not (önemli):** Adsterra ve Google, telif hakkı ihlali içeren (lisanssız/pirate) içeriği resmî olarak yasaklar (aşağıda kaynaklı). "Anime" bir kategori olarak kabul edilse de, yalnızca **hak sahibi olduğunuz / lisanslı / kendi üretiminiz** içerik güvenle kabul görür. Bu rapor bir gelir araştırmasıdır; telif ihlali önerisi değildir.

---

## 0. Kısa Net Öneri (TL;DR)

1. **Sadece Adsterra yeterli değil** → en az 2–3 ağ ile çalış (Adsterra + Monetag + HilltopAds/PropellerAds).
2. **En az rahatsız edici + makul kazandıran kombinasyon:** `Native Banner (2–3 slot)` + `Social Bar / In-Page Push` + `sayfa başına en fazla 1 Popunder`.
3. **Küçük sitede gerçekçi aralık:** ayda **10.000 PV ≈ 6–38 $**, **50.000 PV ≈ 31–188 $**, **250.000 PV ≈ 156–938 $** (brüt, TAHMİN).
4. **İlk engel Adsterra'da değil, ödeme eşiğinde:** Paxum ile $5'te çekebilirsin; **Türkiye için Local Bank Transfer (TRY) mümkün — eşik $25**.
5. **AdSense'i unut:** anime/telif içerikte AdSense politikaları gereği onaylanmaz (kaynaklı).

---

## 1. Adsterra

### 1.1 Desteklenen Reklam Formatları
Kaynak: <https://adsterra.com/publishers/> · <https://adsterra.com/faq/>

| Format | Açıklama | Mobil uygun | Not |
|---|---|---|---|
| **Popunder (Onclick)** | Yeni sekme/pencerede açılan tam sayfa reklam | ✔ | Adsterra'ya göre "en yüksek ödeyen" format; yer kaplamaz |
| **Social Bar** (In-Page Push + Interstitial içerir) | Sayfa içi bildirim tarzı görseller | ✔ (iOS dahil) | Mobil trafik için öneriliyor; "30x daha yüksek CTR" iddiası |
| **In-Page Push** | Kullanıcı sayfadayken tarayıcı içi bildirim | ✔ | Ayrı format olarak da sunuluyor |
| **Interstitials** | İçeriğin üstünde tam ekran reklam | ✔ | Yüksek görünürlük |
| **Native Banners** | Editoryal içerik gibi görünen sponsor alanları | ✔ | Boyut/renk/font özelleştirilebilir; "rahatsız etmez" |
| **Banners (Display)** | Statik klasik banner: 160x300, 160x600, 300x250, 320x50, 468x60, 728x90 | ✔ (320x50 mobile) | Mobil için 320x50 / 300x250 |
| **Smartlink (Direct Link)** | Siteniz olmasa bile kullanılabilen akıllı link | — | Sosyal trafik / 404 / landing için |

> **Fiyatlandırma modelleri:** CPM, CPC, CPA (kaynak: <https://adsterra.com/publishers/>).

### 1.2 Minimum Ödeme Eşiği & Ödeme Yöntemleri
Kaynak: <https://help-publishers.adsterra.com/en/articles/5385757-receiving-and-tracking-payouts> · <https://adsterra.com/blog/adsterra-minimum-payout-for-publishers/>

| Ödeme yöntemi | Minimum | Para birimi | Ücret | Teslim |
|---|---|---|---|---|
| **Paxum** | **$5** | USD | $1 | 1–2 iş günü |
| **WebMoney (WMZ/WMT)** | **$5** | USD/USDT | WMZ %1, WMT %2 | 1–2 iş günü |
| **PayPal (Hyperwallet)** | $25 | USD | $0.65 | 1–2 iş günü |
| **Local Bank Transfer (Hyperwallet)** | $25 | **Yerel (Türkiye = TRY ✔)** | $7 + FX | 1–3 gün |
| **Tether USDT (TRC20/ERC20) & Bitcoin (INXY/CoinsPaid)** | $100 | USD | %1 + network fee | 1–2 iş günü |
| **USDC** | $100 | USD | %1 | 1–2 iş günü |
| **Wire Transfer** | **$1.000** | USD/EUR | $50 (USD) / $0 (EUR) | ≤5 iş günü |

- **USDT destekleniyor:** ✅ Tether TRC20/ERC20, minimum $100 (AB/EEA'da mevcut değil).
- **Türkiye satırı:** Local Bank Transfer listesinde **"Turkey – TRY"** açıkça var (kaynak: <https://adsterra.com/blog/payouts-in-local-currency/>).
- **KYC/KYB:** Wire & Local Bank Transfer için kimlik doğrulama zorunlu.

### 1.3 Ödeme Periyodu
Kaynak: <https://help-publishers.adsterra.com/en/articles/5385757-receiving-and-tracking-payouts> · Terms madde 5.6 (<https://adsterra.com/publishers-terms-managed/>)

- **Ayda 2 kez, otomatik** — her ayın **1–2** ve **16–17**'sinde (09:00–18:00 GMT).
- **NET15** esası; kazanç **2 hafta "hold"** sonrası ödenir.
- Talep (request) gerekmez; eşiğe ulaşınca otomatik sıraya girer.

### 1.4 Site Kabul Şartları ve İçerik Kısıtı (Anime / Telif)
Kaynaklar: <https://adsterra.com/blog/set-up-publishers-dashboard/> · <https://adsterra.com/publishers/> · <https://adsterra.com/publishers-terms-managed/>

**Kabul edilen taraflar:**
- **"Anime" açıkça bir site kategorisidir** — site eklerken kategori dropdown'ında "Movies, Books, **Anime**, News" geçiyor.
- Adsterra "top-earning publishers" listesinde **Anime** ayrı bir satır olarak yer alıyor.
- **Minimum trafik şartı yok**, onay süresi ~5–10 dakika, tüm boyutlarda yayıncı kabul edilir.
- Format: popunder/banner/native/social bar/smartlink hepsi anime/streaming sitelerinde kullanılabilir.

**İçerik kısıtı (kritik):**
- Adsterra **Terms** madde 4.2/4.4: Adsterra, **"üçüncü taraf haklarını ihlal eden veya telif/marka yasalarını çiğneyen"** siteleri reddetme hakkına sahiptir.
- "**Inappropriate Content**" tanımı **"herhangi bir kişinin Fikri Mülkiyet Haklarını ihlal eden içerik"**i kapsar.
- Ayrıca "copyright/trademark ihlal eden mal/hizmet promosyonu" yasaklılar listesinde.
- ➡️ **Sonuç:** Adsterra genel olarak anime sitesi kabul eder; ancak **resmî şartlar telif ihlalini yasaklar.** Yani lisanslı/kendi içeriğin olan bir anime sitesi sorunsuz kabul görür; tamamen lisanssız (pirate) içerik kurallara aykırıdır ve hesap riski taşır. (Pratikte denetim gevşek olsa da bu bir garanti değildir.)

---

## 2. Adsterra Tek Başına Yeterli mi?

**Cevap: HAYIR.** Gerekçe:
1. **Tek nokta bağımlılığı:** Tek ağ = tek bid havuzu; doldurma (fill) oranı ve CPM dalgalanması doğrudan gelirini vurur.
2. **CPM volatilitesi:** Adsterra'nın kendisi bile CPM'in sezona/ülkeye/reklamveren bid'ine göre "vahşice değiştiğini" söylüyor (<https://adsterra.com/blog/geos-with-high-cpm-rates-for-publishers/>).
3. **Ödeme riski:** Tek hesaplık askıya alma tüm geliri keser.
4. **Format kısıtı:** Bir ağın her formatta en iyi CPM'i vermesi beklenmez → waterfall/rotasyon daha yüksek toplam RPM verir.

**Önerilen yan ağlar (her biri 1 cümle + resmî kaynak):**

| Ağ | Tek cümle | Resmî kaynak |
|---|---|---|
| **Monetag** | Alt/orta trafik için ideal; $5'ten başlayan eşik, haftalık (Perşembe) ödeme, popunder/in-page push/vignette gibi çok format — anime vaka çalışmaları da var. | <https://monetag.com/> · <https://monetag.com/blog/anime-fansite-popunder-case-study/> |
| **PropellerAds** | Onclick/push/social'da yüksek hacim; çoğu yöntemde $5, Payoneer $20, wire $550–1000 eşik. | <https://propellerads.com/terms-conditions/> · <https://blogpros.com/propeller-review-pricing-conversion/> |
| **HilltopAds** | Popunder + in-page + video + banner; **$20** eşik, **her Salı (Net7)** ödeme, TR mobil popunder CPM'i ~$5 (sosyal trafik). | <https://hilltopads.com/publishers/> · <https://hilltopads.com/blog/best-cpm-rates-on-popunders-for-publishers-of-hilltopads/> |

> Ek seçenekler (toplulukta anime/entertainment için önerilen): **AdCash, RichAds, Clickadu** — doğrulama: BlackHatWorld tartışması (bağımsız, doğrulanamadı/resmî değil) <https://www.blackhatworld.com/seo/monetizing-anime-website-which-network-is-best.1778274/>.

---

## 3. Gerçekçi Kazanç Tahmini (Türkiye, Mobil)

### 3.1 CPM Aralıkları

| Format | TR CPM (mobil) | Kaynak / durum |
|---|---|---|
| **Popunder** | **~$5** (sosyal trafik) | HilltopAds resmî blog: TR popunder social CPM **$5** (mobil) — <https://hilltopads.com/blog/best-cpm-rates-on-popunders-for-publishers-of-hilltopads/> |
| Popunder (genel/tier-3 site trafiği) | **$0.80–$2.00** | Monetag resmî blog: 2025'te popunder CPM düşüşü; düşük-tier aralık — <https://monetag.com/blog/what-is-a-good-cpm-in-2026/> |
| Popunder (Adsterra TR) | — | **doğrulanamadı** (Adsterra'nın ülke listesinde TR yok; US website $1.70–$2.80, GB US vb. var) — <https://adsterra.com/blog/geos-with-high-cpm-rates-for-publishers/> |
| **Banner (display)** | Türkiye'ye özel kaynak **doğrulanamadı** | Genel mobil banner CPM ~$2.80 (ağırlıklı ABD/Tier-1) — <https://www.businessofapps.com/ads/research/mobile-app-advertising-cpm-rates/> |
| Banner (TR için **TAHMİN**) | **$0.05–$0.30** | Tier-2/3 pazar + reminder inventory mantığıyla türetilmiş tahmin; **bağımsız TR banner CPM verisi bulunamadı** |

> **Kural:** Yukarıdaki **$5 (HilltopAds TR)** ve **$0.80–$2.00 (Monetag)** rakamları kaynaklıdır. Bunların dışındaki TR banner rakamı **TAHMİN**dir. Popunder için modelleme aralığı olarak **$0.50 – $3.00** kullanıldı (taban: Monetag düşük-tier; tavan: HilltopAds TR $5'in muhafazakâr altı).

### 3.2 Formül
```
Aylık gelir ($) = (Aylık PV) × (Sayfa başına gösterim) / 1000 × CPM
```
- Popunder: **1 gösterim/sayfa**
- Banner: **2,5 gösterim/sayfa** (2–3 aralığının ortası; kullanıcı varsayımı)

### 3.3 Senaryolar

**Kullanılan aralıklar:** Popunder CPM: alt $0,50 / orta $1,50 / üst $3,00 — Banner CPM: alt $0,05 / orta $0,15 / üst $0,30 · *(TR banner = TAHMİN)*

**A) Yalnız Popunder (1 gösterim/sayfa)**

| Aylık PV | Aylık gösterim | Alt ($0,50 CPM) | Orta ($1,50) | Üst ($3,00) |
|---|---|---|---|---|
| 10.000 | 10.000 | **$5** | **$15** | **$30** |
| 50.000 | 50.000 | **$25** | **$75** | **$150** |
| 250.000 | 250.000 | **$125** | **$375** | **$750** |

**B) Yalnız Banner (2,5 gösterim/sayfa)**

| Aylık PV | Aylık gösterim | Alt ($0,05 CPM) | Orta ($0,15) | Üst ($0,30) |
|---|---|---|---|---|
| 10.000 | 25.000 | **$1,25** | **$3,75** | **$7,50** |
| 50.000 | 125.000 | **$6,25** | **$18,75** | **$37,50** |
| 250.000 | 625.000 | **$31,25** | **$93,75** | **$187,50** |

**C) Kombine (Popunder + Banner, 3,5 gösterim/sayfa) → gerçekçi bant**

| Aylık PV | Alt | Orta | Üst |
|---|---|---|---|
| **10.000** | **~$6** | ~$19 | ~$38 |
| **50.000** | **~$31** | ~$94 | ~$188 |
| **250.000** | **~$156** | ~$469 | ~$938 |

> **Yorum:** Küçük bir anime sitesi için gerçekçi aylık brüt beklenti **alt–orta** banttır (yani 10k PV'de ~$6–19, 50k'da ~$31–94). Üst bant, hem yüksek CPM hem tam doldurma gerektirir — **iyimser senaryo**. Ayrıca hold (2 hafta) ve ağ komisyonları sonrası net daha düşük olur.

---

## 4. Uyarılar

1. **Düşük CPM (Türkiye):** TR Tier-2/3 pazardır; aynı format ABD/DE/JP'de kat kat fazla öder (ör. Adsterra DE Windows $28,2 vs ID Android $3,4 — <https://adsterra.com/blog/geos-with-high-cpm-rates-for-publishers/>). **10k–50k PV'li bir sitede aylık gelir "harçlık" seviyesindedir.**
2. **Ödeme eşiği:** Adsterra'da küçük site için doğru seçim **Paxum ($5)** veya **Local Bank TRY ($25)**; **Wire ($1.000)** küçük siteyi pratikte bloke eder. (Bkz. Bölüm 1.2)
3. **Reklam yoğunluğu → SEO & UX:** Aşırı popunder/interstitial **bounce rate'i artırır**, oturum süresini düşürür; yavaş yüklenen reklam script'leri **Core Web Vitals (LCP/INP/CLS)**'i bozar → Google sıralaması ve dolayısıyla organik trafik düşer. Popunder'ı **sayfa başına 1** ile ve **frekans limitiyle** sınırla.
4. **Google AdSense anime/telif içerikte onaylanmaz (DOĞRULANDI):** Google Publisher Policies — **"Intellectual property abuse"**: *"infringes copyright… DMCA"* yasak; **"Google-served ads on screens with replicated content"** (başkasının içeriğini kopyalayıp katma değer eklemeden yayınlamak) yasak; **"Enabling dishonest behavior"** altında *"bypass copyright protection / DRM"* ve *"assist users to download streaming videos if prohibited by the content provider"* açıkça yasak. → **Lisanssız anime/telif siteleri AdSense onayı alamaz.** Kaynak: <https://support.google.com/adsense/answer/9335564>
5. **Telif/yasal risk:** Adsterra dahil tüm büyük ağlar resmî şartlarında telif ihlalini yasaklar (Bölüm 1.4). Hesap askıya alma + DMCA/hukuki risk gerçek. **Yalnız lisanslı/izinli içerikle çalış.**
6. **Ödeme tetiklemesi:** Adsterra ödemesi **otomatik** ve **2 hafta hold** ile; ilk ödeme gecikebilir. Gelir vergisi/KYC yükümlülüklerini unutma.

---

## 5. En Az Rahatsız Edici + En Çok Kazandıran Formatlar

Sıralama: **en az rahatsız → en çok rahatsız** (kazanç potansiyeli ayrı belirtildi).

- **① Native Banner — en az rahatsız EDEN, iyi kazandıran.** İçerikle bütünleşir, kullanıcı "reklam" hissi almaz; CPM'i klasik banner'ın üstünde, popunder'ın altında. **Küçük animede 2–3 slot önerilir.**
- **② Social Bar / In-Page Push — orta rahatsızlık, iyi kazandıran.** Yer kaplamaz, mobilde çalışır, yüksek CTR; ama bildirim gibi görünüp dikkat çeker. **1 slot yeterli.**
- **③ Klasik Banner (300x250 / 320x50) — rahatsız etmez ama düşük kazandırır.** Yerleşim doğruysa (içerik araları) görsel gürültü azdır; CPM en düşük. **Tamamlayıcı gelir.**
- **④ Popunder (sayfa başına 1) — en çok kazandıran ama en rahatsız edici.** Yer kaplamaz ama yeni sekme açar; bounce'u artırır. **Frekans limiti + sayfa başına max. 1 zorunlu.** Gelir omurgası budur.
- **❌ Kaçın:** Çoklu popunder, otomatik yönlendirme (redirect), "dead-end" interstitial, sesli/otomatik video — bunlar hem UX hem SEO hem de Google/ağ politikaları açısından risklidir.

**Önerilen kombinasyon (küçük anime sitesi):**
`2× Native Banner (içerik üstü/altı)` + `1× Social Bar` + `1× Popunder (frekans limitli)` → en iyi rahatsızlık/kazanç dengesi.

---

## Kaynaklar (tümü)
- Adsterra — Publishers: <https://adsterra.com/publishers/>
- Adsterra — FAQ: <https://adsterra.com/faq/>
- Adsterra — Minimum Payout (günc. 22.04.2026): <https://adsterra.com/blog/adsterra-minimum-payout-for-publishers/>
- Adsterra — Payouts Help Center: <https://help-publishers.adsterra.com/en/articles/5385757-receiving-and-tracking-payouts>
- Adsterra — Payouts in Local Currency (27.04.2026, TR/TRY): <https://adsterra.com/blog/payouts-in-local-currency/>
- Adsterra — Publisher Requirements (26.06.2026, "Anime" kategorisi): <https://adsterra.com/blog/set-up-publishers-dashboard/>
- Adsterra — Best CPM Rates by Country (08.09.2026): <https://adsterra.com/blog/geos-with-high-cpm-rates-for-publishers/>
- Adsterra — Publishers Terms (son günc. 29.06.2026): <https://adsterra.com/publishers-terms-managed/>
- Monetag — Ana sayfa / ödeme eşikleri: <https://monetag.com/>
- Monetag — Payment Methods (15.12.2022): <https://monetag.com/blog/monetag-payment-methods-heres-everything-you-need-to-know/>
- Monetag — Min payout (17.10.2025): <https://help.monetag.com/en/articles/6745946-what-is-the-minimum-payout-at-monetag>
- Monetag — Payouts Update (22.10.2025): <https://monetag.com/blog/monetag-payouts-update/>
- Monetag — What is a Good CPM 2026 (04.08.2025): <https://monetag.com/blog/what-is-a-good-cpm-in-2026/>
- Monetag — Anime case study: <https://monetag.com/blog/anime-fansite-popunder-case-study/>
- PropellerAds — Terms & Conditions (21.07.2026): <https://propellerads.com/terms-conditions/>
- PropellerAds — Review (29.04.2026, blogpros): <https://blogpros.com/propeller-review-pricing-conversion/>
- HilltopAds — Publishers: <https://hilltopads.com/publishers/>
- HilltopAds — Best CPM Rates on Popunders (TR $5): <https://hilltopads.com/blog/best-cpm-rates-on-popunders-for-publishers-of-hilltopads/>
- Google — Publisher Policies (AdSense): <https://support.google.com/adsense/answer/9335564>
- Business of Apps — Mobile Ad CPM Rates (27.02.2025): <https://www.businessofapps.com/ads/research/mobile-app-advertising-cpm-rates/>

---

# BÖLÜM 2 — Video barındırma (host) karşılaştırması

**Okuma tarihi:** 24 Eylül 2026 · Kaynak önceliği: hostların kendi resmî sayfaları; resmî yoksa
üçüncü taraf (not düşülmüştür). **Kritik not:** Türkiye, bu hostların en düşük ödeme yapan ülke
grubundadır (Tier 4-5 / "other") — aşağıdaki TR rakamları bu yüzden düşüktür.

## 2.1 VidMoly (şu an kullanılan)

| Konu | Bulgu | Kaynak |
| --- | --- | --- |
| Depolama | **5 TB ücretsiz** | vidmoly.me (resmî) |
| Maks. dosya / günlük limit | doğrulanamadı | vidmoly.me/faq |
| İzlenme ödemesi | **Var.** 10.000 izlenme başına: T1 $50/$25/$12 · **T5 (Türkiye) $10 / $5 / $3** · diğer $6/$3/$2 (reklam moduna göre: Full / Medium / Low) | vidmoly.me/make-money |
| Sayım kuralı | 24 saatte ziyaretçi başına **3 izlenme**, video **en az 3 dk** izlenmeli, **AdBlock izlenmeleri ödenmez** | vidmoly.me/make-money |
| Min. ödeme / süre | **$15**, genelde ~48 saat | vidmoly.me/make-money |
| Ödeme yöntemleri | doğrulanamadı | vidmoly.me/faq |
| Reklam ayarı | **Full / Medium / Low** modu var → reklamı azaltabilirsin ama kazanç düşer (Full $10 → Low $3) | vidmoly.me/make-money |
| Telif (DMCA) | Usulüne uygun bildirimde içeriği kaldırır; doğrulanmış partnerlere DMCA paneli | vidmoly.me/dmca |

## 2.2 Alternatifler (özet)

| Host | Depolama | Maks. dosya | 1000 izlenme ≈ (TR) | Min. ödeme | Reklamı azaltma | Telif politikası |
| --- | --- | --- | --- | --- | --- | --- |
| **VidMoly** | 5 TB | doğrulanamadı | **~$1,00** (Full Ads) | $15 | Var (Full/Medium/Low) | Resmî DMCA süreci var |
| **Voe** | 3 TB | 25 GB | **~$1,00** | $10 | **Premium paket ile reklamsız oynatıcı** | 7/24, 24 saatte işler |
| **StreamWish** | Sınırsız* | 50 GB | ~$0,30 | doğrulanamadı | Ücretsiz premium (uploader'a) | **Resmî terms/copyright sayfası 404** |
| **Earnvids** | doğrulanamadı | doğrulanamadı | ~$0,50 | $20 | — | doğrulanamadı |
| **Streamtape** | **Sınırsız** | 15 GB | ~$0,40 | ~$10 | **Yok** (adsız oynatıcı satmıyor) | **USTR 2025 "Notorious Markets" listesinde** |
| **DoodStream** | doğrulanamadı | 5 GB | **~$0,15** (en düşük) | $10 | Premium var, adsız belirsiz | Gönüllü DMCA, 3 ihlalde hesap kapanır |
| Vidhide | doğrulanamadı | doğrulanamadı | ~$0,30 | $20 | — | doğrulanamadı |
| LuluStream | doğrulanamadı | doğrulanamadı | ~$0,50 | $20 | — | doğrulanamadı |

\* "Player StreamWish'e öncelik verirsen" koşuluyla.

**Öne çıkanlar:**
- **Türkiye ödemesi en yüksek → VidMoly ve Voe (ikisi de ~$10/10k).** Yani mevcut host grubun en iyisi;
  değiştirmeye gerek yok. DoodStream TR'ye ~$1,50/10k ödüyor (elenir).
- **En çok depolama → Streamtape (sınırsız) ve StreamWish (sınırsız)**, ama Streamtape adsız seçenek
  sunmuyor ve **USTR 2025 Notorious Markets listesinde** (hesap/yasal risk yüksek).
- **Reklamsız oynatıcı isteyen tek gerçek seçenek → Voe Premium** (ücretli; o trafikten izlenme geliri almazsın).

## 2.3 Hız / CDN

Hiçbir hostta **Türkiye'ye özel sunucu/konum bilgisi doğrulanamadı**. Hepsi "global/ultra hızlı CDN"
diyor. Gerçek hız ölçümü ancak aynı videoyu yükleyip TR'den test ederek yapılır.

## 2.4 Net cevap: "ücretsiz + reklamsız + izlenme kazancı" üçü birden olur mu?

**Hayır.** Bu hostların modeli şu: barındırma + bant genişliği bedava, karşılığında oynatıcıya reklam
koyarlar ve reklam gelirinin bir kısmını sana öderler. Hostların kendi sayfaları bunu açıkça yazıyor:

- VidMoly: "AdBlock izlenmeleri gelir üretmez çünkü reklam gösterilmez."
- StreamWish / Earnvids / Vidhide: "AdBlock ve VPN izlenmeleri geçerli sayılmaz."
- LuluStream: AdBlock → kazanç **×0,1**.
- Voe: TOS, site sahibinin reklamı engellemesini **yasaklar**.
- Streamtape: adsız oynatıcı **satmıyor**.

Mümkün olan üçlü kombinasyonlar: (1) ücretsiz + reklamlı + kazançlı, (2) ücretsiz + reklamsız + kazançsız,
(3) reklamsız + kazançlı ama **ücretli** (Voe Premium). Türkiye'de AdBlock kullanımı yüksek olduğu için
"AdBlock = ödeme yok" kuralı gerçek kazancı bir miktar daha düşürür.

---

# BÖLÜM 3 — Net kazanç tablosu ve öneri

## 3.1 İki gelir kanalı ayrı ayrı

1. **Oynatıcı payı (host):** VidMoly, TR için 1.000 izlenme ≈ **$1,00** (Full Ads modunda; Medium $0,50,
   Low $0,30). İzlenme sayılması için en az 3 dakika izlenmeli + AdBlock kapalı olmalı.
2. **Sitenin kendi reklamları (Adsterra vb.):** sayfa görüntüleme başına; TR mobil CPM'i düşük.
   Raporun 1. bölümündeki tahmin: 10.000 PV → ~$6-38 · 50.000 PV → ~$31-188 · 250.000 PV → ~$156-938
   (popunder + 2,5 banner/sayfa kombinasyonu; **tahminidir**).

## 3.2 Birlikte (varsayım: sayfa görüntülemelerinin ~%40'ı video izlenmesine dönüşüyor)

| Aylık sayfa görüntüleme | Host payı (VidMoly) | Kendi reklamların | **Toplam / ay (brüt, tahmin)** |
| --- | --- | --- | --- |
| 10.000 | ~$4 | ~$6-38 | **~$10-42** |
| 50.000 | ~$20 | ~$31-188 | **~$51-208** |
| 250.000 | ~$100 | ~$156-938 | **~$256-1.038** |

Brüt rakamlar; ödeme eşikleri, hold süresi ve ağ kesintileri sonrası net daha düşük olur.
**VidMoly'nin $15 ödeme eşiğine 10.000 PV'lik bir sitede ~3-4 ayda ulaşılır** — yani bugünkü trafikle
anlamlı gelir ancak içerik/trafik büyüdükçe gelir.

## 3.3 Öneri (ücretsiz devam ederken)

1. **Hostu değiştirme:** VidMoly, TR ödemesinde grubun en iyisi (~$10/10k) ve zaten kurulu.
   Reklam modunu **Full Ads**'te bırak; "az reklam" istersen Medium'a çek ama payın yarıya iner.
2. **Kendi reklamlarını aç** (paneldeki 6 slot şu an boş): Adsterra'dan **2× Native Banner + 1× Social Bar**.
   Popunder'ı sitene koyma — oynatıcıda zaten var, üst üste binmesin.
3. **Adsterra tek başına yetmez.** Minimum ödeme: Paxum $5, TRY banka $25, USDT/BTC $100, wire $1.000.
   Yanına **Monetag** (min $5, haftalık ödeme) ekle; ileride trafik artarsa HilltopAds/PropellerAds.
4. **AdSense kullanma:** anime/telif içerikte onaylanmıyor (Google politika ihlali: IP abuse / replicated content).
5. **Öncelik trafik:** 24 bölüm / 4 seri ile gelir değil, içerik büyütmek belirleyici. 250.000 PV'e
   çıkıldığında tablo anlamlı hale geliyor.

## 3.4 Doğrulanamayan alanlar (uydurma yapılmadı)

VidMoly maks. dosya boyutu + ödeme yöntemleri · DoodStream toplam depolama + ödeme yöntemleri ·
StreamWish min. ödeme, ödeme yöntemleri, DMCA, CDN · EarnVids depolama/DMCA/yöntemler · Voe ödeme
yöntemleri · Streamtape resmî oran tablosu · **tüm hostlarda Türkiye'ye özel sunucu/hız bilgisi** ·
TR banner CPM'i (raporun 1. bölümünde tahmin olarak işaretlendi).

## 3.5 Telif uyarısı

Bu hostların tamamı DMCA bildirimlerine uyduğunu beyan ediyor; hiçbiri "görmezden geliyor" demiyor.
Lisanssız anime yayınlamak telif ihlalidir; host seçimi bu hukuki riski ortadan kaldırmaz.
