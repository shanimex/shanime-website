# Tarama Raporu + Hosting / Depolama Çözümü

**Tarih:** 27 Eylül 2026
**Kapsam:** yerel repo (`C:\Projects\shanime-react`) · tarayıcı sekmelerindeki yapay zekâ sohbetleri · sağlayıcıların kendi fiyat sayfaları
**Kural:** Supabase'e dokunulmadı (ne okuma ne yazma). Aşağıdaki Supabase maddeleri yalnızca **bilgi**dir.

---

## 0. Üç cümlelik özet

1. **Kritik:** Supabase Free kotası aşılmış (panel metni: *"Cached Egress Exceeded"*). Panelin kendi uyarısına göre **29 Eylül 2026'dan itibaren** projelere gelen istekler **402** dönecek. Free plan limitleri: **5 GB egress + 5 GB cached egress**.
2. Kod tarafında **kırık bulamadım** (tsc/eslint/build/audit temiz). Asıl eksikler: **test altyapısı yok** ve **video depolama katmanı hiç kurulmamış**.
3. Google AI'nın hosting önerisi **kısmen yanlış** — aşağıda ölçümle: "R2 pahalı" değil, "Cloudflare 100 MB'ta hata verir → Bypass Cache" **yanlış**, "Contabo 250 GB 3-4 €" bugünün fiyat sayfasında **yok**.

---

## 1. Yerel tarama — bulgular

### 1.1 Kritik

| # | Bulgu | Kanıt | Ne yapmalı |
|---|---|---|---|
| K1 | **Supabase kotası aşımı → 402 riski (29 Eyl 2026)** | Supabase kullanım panelinin kendi metni + Free plan limitleri (5 GB egress / 5 GB cached egress / 500 MB DB / 1 GB dosya) | Supabase'e dokunma dedin. Seçenekler: (a) Pro plan **$25/ay** → 250 GB egress + 250 GB cached egress + 8 GB disk, (b) trafiği azalt, (c) veri katmanını taşı. Karar senin. |

### 1.2 Yüksek

| # | Bulgu | Kanıt | Ne yapmalı |
|---|---|---|---|
| Y1 | **Hiç test yok** | `package.json`'da vitest/jest/playwright/cypress **yok**; `scripts/` altında yalnızca elle çalıştırılan `.mjs` araçları var | En azından saf fonksiyonlar (`title-match`, `import-runner`, `episode-sources`, `safe-json`) için **vitest** ekle. Bu görünümlü iş akışları şu an yalnızca oturum içi elle denemeyle doğrulanıyor → her yeni anime/sezonda aynı hataların tekrar etmesinin yapısal sebebi bu. |

### 1.3 Orta

| # | Bulgu | Kanıt | Ne yapmalı |
|---|---|---|---|
| O1 | **81 dosyalık commit edilmemiş birikim** | `git status --porcelain` → 27 değişik + 19 silinmiş + 35 yeni; `git log origin/main..HEAD` = **0** | Tek commit'lik "yerel yığın" hâline gelmiş. Kontrollü parçalara bölüp commit'le (push yok kuralın sürüyor) — disk arızasında hepsi gider. |
| O2 | **Video depolama katmanı yok** | Kodda R2/S3 istemcisi yok (yalnızca bir yorum satırı), `.env`'de R2 anahtarı yok. Akış tamamen 3. taraf embed: Anizm/TauVideo/MegaPlay. Voe yalnızca **kapak karesi** için (`i.voe.sx/cache/<kod>_storyboard_L5.jpg`) | Video barındırma isteğe bağlı — bugünkü mimari onsuz çalışıyor. Karar verirsen §4. |
| O3 | **Kullanılmayan sırlar `.env`'de duruyor** | `STREAMTAPE_LOGIN / STREAMTAPE_KEY / STREAMTAPE_FOLDER / STREAMTAPE_SUBS_FOLDER / OPENSUBTITLES_API_KEY` duruyor ama `src/lib/streamtape.ts` ve `scripts/import-streamtape.mjs` **silinmiş** | Kullanılmayan anahtarları sağlayıcı panelinden iptal et ya da `.env`'den çıkar. |
| O4 | **Dev sunucu LAN'a açık** | `vite.config.ts`: `server: { port: 8080, strictPort: true, host: true }`; port 8080'de dinleyen süreç var (pid 4460) | Aynı ağdaki biri `/admin`'e erişebilir. Admin tarafında oturum kontrolü var mı **ölçmedim** — ölçmemi istersen söyle. |

### 1.4 Düşük / temiz çıkanlar (iyi haberler)

- `npm audit --omit=dev` → **0 zafiyet**.
- `tsc --noEmit` → **0 hata**, `eslint` → **0**, `vite build` → **başarılı** (`dist/_worker.js` üretildi).
- `tsconfig.json` **çok sıkı**: `strict` + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess` + `noPropertyAccessFromIndexSignature`. Metin botundan gelen veriyi `unknown` kabul etmeye bu zorluyor — doğru kurulum.
- `.env` **gitignore'da** ve `VITE_` ön ekli olmayan sırlar (Streamtape, OpenSubtitles) istemciye sızmıyor; tarayıcıya giden tek şey `VITE_SUPABASE_PUBLISHABLE_KEY` + reklam VAST etiketleri (ikisi de zaten herkese açık).
- `docs/` altındaki 19 silme, bir **taşıma** işlemi (yeni `docs/arastirma`, `docs/durum`, `docs/plan`, `docs/rehber` klasörleri). `git` bunları henüz commit edilmediği için "silinmiş" sayıyor — panik yok, O1 kapsamında.
- `TODO/FIXME`: 2 eşleşme, ikisi de gerçek TODO değil (değişken adı `todoCount`).
- `public/` = 7,7 MB; `robots.txt` + `sitemap.xml` yerinde.

---

## 2. Sekmelerindeki yapay zekâ sohbetleri — okuduklarım

**Önemli tespit:** Tarayıcında ChatGPT / Gemini / Claude / DeepSeek / Grok / Perplexity sekmesi **yok**. Bulunan tek AI sohbetleri **Google "AI Modu"** (`udm=50`) sohbetleri. 12 sekmenin 3'ü AI sohbeti:

| Sekme | Konu | Bizim için değeri |
|---|---|---|
| `anime website icin hosting arıyorum videoları depolam` | **Ana sohbet** (~40.000+ karakter, ilk mesajdan sonuna kadar okundu) | Hosting/depolama önerileri — §3'te değerlendirdim |
| `knk` | Embed ile otomatik bölüm çekme, Türkçe altyazı + kalite seçeneği | Zaten çözdüğümüz konular (Vidsrc/Superembed/Consumet önerileri) |
| `animecix sitesi nasıl para kazanıyor` | AnimeciX gelir modeli (reklam, Premium, sponsorluk) | Monetag sekmesiyle birlikte gelir modeli araştırması |

**"Abstract" notu:** Sohbette birebir *abstract* kelimesi geçmiyor. En yakın bölüm AI'nın **"💡 Özetle Sana Önerim"** bloğu; o bloğun **sonrası dahil** hepsini okudum.

### 2.1 AI'nın önerisi (birebir alıntı)

> **"💡 Özetle Sana Önerim:** Altyapın çok elit duruyor. Sitenin kalitesini bozmamak için bütçen varsa **Bunny Stream**, bütçen kısıtlıysa **Contabo Object Storage** entegrasyonu yapman bu Jamstack mimarisine en çok yakışan şey olacaktır."

> **"🚀 1. Yol: 'Sıfır Dert, Maksimum Performans' (Bunny Stream)** — Maliyet: Depolama için GB başına aylık $0.01, trafik için ise GB başına $0.005."

> **"2. Yol: 'Maliyeti Kısıp Kontrolü Ele Almak' (Contabo S3 + Vidstack)** … R2'ye göre çok daha ucuzdur (250 GB alan aylık ~3-4 Euro)."

> **"Cloudflare İçin Hayati İpucu … Page Rules kısmından video istekleri için 'Bypass Cache' yapmalısın. Eğer Cloudflare büyük video dosyalarını önbelleğe almaya çalışırsa, 100 MB'tan büyük dosyalarda hata verir."**

### 2.2 Değerlendirmem — ne doğru, ne yanlış

| AI'nın dediği | Benim ölçümüm | Sonuç |
|---|---|---|
| Videoyu normal hosting'de tutma, bulut/VOD kullan | Doğru | ✅ |
| Oynatıcı olarak **Vidstack** | Doğru — bizim yığına uyar (React + Vite, kendi oynatıcı) | ✅ |
| **Bunny Stream** önerisi | Fiyatı doğruladım: transcoding **ücretsiz**, depolama **$0.01/GB'dan**, trafik **$0.005/GB'dan**, aylık min **$1** | ✅ doğru rakam |
| "**R2 video için pahalı**" | **Yarım doğru.** R2'de **egress ücretsiz**. Pahalı olan şey depolama ($0,015/GB-ay) ve **Class B işlem** ($0,36/milyon). R2 dokümanındaki örnek: günde 10 milyon okuma = **$104,40/ay**. Yani maliyeti belirleyen şey *trafik* değil, **cache'in açık olup olmaması**. | ⚠️ |
| "**Cloudflare 100 MB üstü dosyalarda hata verir → Bypass Cache yap**" | **YANLIŞ ve zararlı.** Cloudflare dokümanı: önbelleğe alınabilir dosya limiti Free/Pro/Business **512 MB** (Enterprise 5 GB). 100 MB olan şey **yükleme (upload)** limiti, önbellek değil. Üstelik `Bypass Cache` yapmak R2'de her byte'ı kaynağa gönderir → yukarıdaki **$104/ay** tuzağına tam da böyle düşülür. Video tek noktadan servis edilecekse **cache açık olmalı**. | ❌ |
| "**Contabo 250 GB ~3-4 €/ay**" | **Bugünün sayfasında bu rakam yok.** Contabo'nun object-storage adresi Storage VPS'e yönlendiriyor. Ölçtüğüm en ucuz plan: **Storage VPS 10 → 300 GB SSD, 200 Mbit/s, sınırsız trafik, ~$6,60/ay liste (~$5,28 24 ay taahhütte)**. 1 TB'lık olan **Storage VPS 30: ~$16,80/ay liste (600 Mbit/s)**. | ❌ |
| **AlexHost / Flaunt7 / Shinjiru** ("DMCA-ignored", kripto ödeme) | Teknik olarak var olan firmalar ama burada **öneri olarak sunmuyorum**: telif ihlalinden kaçınma aracı olarak kullanmak yasal riski tamamen sana yıkar. | ⛔ |
| "Cloudflare'de video için eski 2.8 maddesi" tartışması | Doğruladım: **Self-Serve Subscription Agreement (12 Eyl 2025 sürümü) 2.8 "non-HTML" maddesi artık YOK** — metinde böyle bir kısıtlama bulunmuyor. | ✅ (eski tartışma geçersiz) |

**Ama dikkat:** Cloudflare sözleşmesinin **§8** maddesi aynen şöyle: *"We reserve the right to disable or limit your access … or terminate your user account upon receiving any number of DMCA notifications from content owners regarding your website(s), or upon learning through other means that you are a repeat infringer."* Yani Cloudflare "DMCA-ignored" değil — **telif bildirimi gelirse hesabı kapatabilir**. Bu, hangi altyapıyı seçersen seç geçerli olan asıl risk.

---

## 3. Doğrulanmış fiyatlar (hepsi sağlayıcının kendi sayfasından, 27 Eyl 2026)

| Sağlayıcı | Depolama | Trafik | İşlem | Kaynak |
|---|---|---|---|---|
| **Cloudflare R2** (Standard) | **$0,015/GB-ay** (10 GB ücretsiz) | **$0 — ücretsiz** | Class A **$4,50/milyon**, Class B **$0,36/milyon** (1M / 10M ücretsiz) | developers.cloudflare.com/r2/pricing |
| **Bunny Stream** | **$0,01/GB'dan** | **$0,005/GB'dan** | Transcoding **ücretsiz**, oynatıcı **ücretsiz**, aylık min **$1** | bunny.net/pricing/stream |
| **Bunny CDN** (standart ağ) | — | AB/K.Amerika **$0,01/GB** · Asya **$0,03** · G.Amerika **$0,045** · Ortadoğu/Afrika **$0,06** | Yüksek hacim ağı: ilk 500 TB **$0,005/GB** | bunny.net/pricing |
| **Backblaze B2** | **$6,95/TB-ay** ≈ **$0,00695/GB** (ilk 10 GB ücretsiz) | Depolananın **3 katına kadar ücretsiz**, sonra $0,01/GB | Class A/B/C **ücretsiz** | backblaze.com/cloud-storage/pricing |
| **Contabo Storage VPS** | 300 GB → 1,4 TB SSD | **Sınırsız** (fair use) | 200 Mbit/s → 1 Gbit/s | contabo.com/en/object-storage |
| **Supabase Free** | 500 MB DB + 1 GB dosya | **5 GB egress + 5 GB cached egress** | — | supabase.com/pricing |
| **Supabase Pro** | 8 GB disk + 100 GB dosya | **250 GB egress + 250 GB cached egress** | **$25/ay** (içinde $10 compute kredisi) | supabase.com/pricing |

**Cloudflare önbellek limitleri (doğrulandı):** önbelleğe alınabilir dosya **512 MB** (Free/Pro/Business); **100 MB** olan şey **yükleme** limiti. Varsayılan önbelleğe alınan uzantılar arasında **MP4, MKV, WEBM, AVI** var — yani video dosyaları ek kural olmadan da önbelleğe girer.

---

## 4. Bizim mimariye uygun senaryolar

**Önce netleştirelim:** Site şu an videoyu **kendi barındırmıyor**, üçüncü taraf embed ile oynatıyor. Bu yüzden "video depolama" bugün **zorunlu değil**. İhtiyaç iki durumda doğar: (a) kendi oynatıcınla kendi dosyanı servis etmek, (b) kapak/thumbnail biriktirmek.

### Senaryo A — "Bugün 0 TL" (mevcut mimariyi koru)
- Video: mevcut embed'ler (Anizm / TauVideo / MegaPlay) → depolama maliyeti **$0**.
- Kapaklar: **R2** (10 GB ücretsiz kota, egress ücretsiz) + Cloudflare'de **cache açık** kural.
- **Maliyet: $0/ay.** Yapılacak iş: R2'yi bağla, kapağı oraya taşı, cache kuralını yaz. (Supabase kotası bunun dışında — §0/K1.)

### Senaryo B — "Kendi videonu barındır, en az uğraş": Bunny Stream
Benzetme ölçeği: **100 bölüm × 400 MB = 40 GB depolama**, ayda **500 GB izleme**.
- Depolama: 40 GB × $0,01 = **$0,40/ay**
- Trafik: 500 GB × $0,005 = **$2,50/ay**
- **Toplam ≈ $2,90/ay** (aylık min $1 zaten karşılanıyor)
- Artısı: transcoding **ücretsiz** (kalite kademeleri otomatik), oynatıcı hazır, adaptif bitrate var.

### Senaryo C — "Tam kontrol, sabit fiyat": Contabo Storage VPS + R2/kapak
- **Storage VPS 30**: 1 TB SSD, 600 Mbit/s, sınırsız trafik → **~$16,80/ay** liste (24 ay taahhütte ~$13,44)
- İçine MinIO/Nginx kurup Cloudflare'i önüne alırsın.
- Artısı: trafik sürprizi yok, dosya başına ücret yok. Eksisi: bakım (kurulum, sertifika, güncelleme) sende; ve telif riski burada daha yüksek (§2.2 Cloudflare §8 + sağlayıcı kendi politikası).

### Senaryo D (referans) — R2'yi video için kullanmak
Matematik aslında iyi: 40 GB × $0,015 = **$0,60/ay**, trafik **$0** — *cache açık olduğu sürece*. Eksikleri: **transcoding yok** (tek dosya servis edersin, adaptif bitrate yok), ve cache kuralını yanlış kurarsan Class B işlem ücreti patlar (dokümandaki örnek: **$104,40/ay**). Yani "R2 ucuzdur" cümlesi doğru, "R2 kendiliğinden ucuzdur" cümlesi yanlış.

---

## 5. Önerim (sırayla)

1. **Bugün:** Supabase kararını ver (dokunmadım). 29 Eylül'de site 402 dönerse hiçbir kod işi bunu telafi etmez.
2. **Bu hafta:** `vitest` ekle + `title-match` / `import-runner` / `episode-sources` için ilk 10 test. Bu, "her yeni animede yeni hata" döngüsünü yapısal olarak kırar.
3. **Sonra:** 81 dosyalık yerel yığını anlamlı commit'lere böl.
4. **Kapaklar:** R2 + Cloudflare cache kuralı (Senaryo A) — maliyeti $0, ölçülebilir kazanç.
5. **Video barındırma gerçekten gerekirse:** **Bunny Stream** ile başla (Senaryo B, ~$3/ay); hacim 500 GB/ay'ı geçince Senaryo C'yi yeniden hesapla.

---

## 6. Doğrulayamadıklarım (dürüstçe)

- **Canlı tarayıcı testi yapmadım** (Supabase'e dokunmama kuralı yüzünden veri okumadım/yazmadım). Bulgular kod + dosya sistemi + sağlayıcı dokümanı düzeyinde.
- **Admin panelinin oturum kontrolünü ölçmedim** (O4). "LAN'a açık" tespiti yalnızca `host: true` ve 8080'in dinliyor olmasına dayanıyor.
- **Supabase kotasının hangi trafikten dolduğunu ölçmedim** — bunun için Supabase paneline bakmak gerekir, dokunmadım.
- Sohbetteki **fiyat/limit** rakamlarının bir kısmı AI'nın kendi metnindendi; ben yalnızca sağlayıcı sayfalarından doğrulayabildiklerimi "doğrulanmış" tabloya aldım, kalanını alıntı olarak işaretledim.
