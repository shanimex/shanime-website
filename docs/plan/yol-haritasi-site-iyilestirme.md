# Site iyileştirme yol haritası

Kullanıcı onayı: **27.09.2026** — altı işin **hepsi** seçildi. Ön gösterim (PrerollGate) sonraya bırakıldı.
Kural: her iş **localde** bitirilir, `tsc` + `eslint` + `npm run build` temiz olmadan "bitti" denmez.
Canlıya push yok — kullanıcı istediğinde yapılacak.

## 1. Arama — ⛔ GERİ ALINDI (kullanıcı isteği, 27.09.2026)
**Durum:** Bu madde için yapılan her şey **iptal edildi**. Kullanıcı "arama için ne yaptıysan
tamamen geri al" dedi; eklenen `/ara` rotası ve arama kutusu bileşeni kaldırıldı, ana sayfadaki
**özgün** arama geri getirildi (büyüteç düğmesi + yazdıkça açılan sonuç listesi + Escape ile kapanma).
Ana sayfa ızgarası yazdıkça **canlı** filtrelenmeye devam ediyor (bu davranış korundu).

**Neden iptal:** Kullanıcı ana sayfadaki "yazdıkça filtreleyen" davranışın kaybolmasına tepki verdi.

**Yan kazanç:** Geri alma sırasında **eski bir hata** bulundu ve düzeltildi: `desktopSearchRef`
hiçbir elemana bağlanmamıştı → açılır sonuç listesine fare ile tıklamak listeyi kapatıyor,
seriye **gitmiyordu**. Artık gidiyor (canlı doğrulandı).

**İleride yeniden istenirse:** filtre/sıralama/URL parametreli ayrı bir sonuç sayfası fikri
duruyor — ama **ana sayfadaki canlı filtre korunarak** yapılmalı, onun yerine geçmemeli.

## 2. Raflar ve benzer seriler
- Ana sayfaya raflar: **Popüler**, **Yeni eklenen**, **Devam eden**
- Seri sayfasına **"Benzer seriler"** (tür/yıl yakınlığına göre)
- Kabul: raf boşsa çizilmez (boş başlık görünmez)

## 3. Hız ve yükleme hissi
- Veri gelene kadar **iskelet (skeleton)** kartlar
- Görsellerde `loading="lazy"` + sabit en-boy oranı (kayma/CLS önlenir)
- Kabul: sayfa ilk boyamada boş görünmez

## 4. SEO ve paylaşım kartı
- Seri ve bölüm sayfalarına `title` / `description` / `canonical`
- Open Graph + Twitter kartı (WhatsApp/X paylaşımında düzgün önizleme)
- `sitemap.xml` + `robots.txt`
- Kabul: paylaşılan link önizlemesinde seri adı + görsel çıkar

## 5. Erişilebilirlik ve mobil
- Klavye ile gezinme + görünür odak halkaları
- Mobilde dokunma hedefleri (min 44px) ve alt gezinme çubuğu
- `prefers-reduced-motion` desteği
- Kabul: sayfa tamamen klavyeyle kullanılabilir; odak hiç kaybolmaz

## 6. "Bildir" düğmesini gerçek yapmak
- Oynatıcıdaki **Bildir** şu an kaydediyor mu **doğrulanmadı** — ilk iş ölçmek
- Çalışmıyorsa: `reports` tablosu + panelde liste (hangi bölüm, hangi kaynak, ne zaman)
- Kabul: bildirim panelde görünür ve okundu/çözüldü işaretlenebilir

## Bekleyen küçük işler (panel)
- Bölüm satır yüksekliği 46px → ~30px (yarım kaldı)
- İlk kayıtta "Kaynaklar (5)" görünme anormalliği (sebebi belirsiz, tek gözlem)
- "VidSrc/Videasy" artık seçilemiyor → bir bölüm yeniden kaydedilirse o bölümdeki eski kayıtları düşer (bilinen yan etki)

## Bilinen dış riskler
- Supabase kotası: panel uyarısına göre **29 Eylül 2026**'dan itibaren projeler kısıtlanabilir
- TMDB gerekmiyor (bölüm adları elle düzeltiliyor) — konu kapandı
