# anizm / puffy embed test — bulgular (kısa kayıt)

Test sayfası: http://127.0.0.1:8080/embed-anizm-embed-test.html (?cb=5151/5152/5153) ve tekrar yükleme `?r=2`
Tarayıcı: kullanıcının normal Chrome'u. Giriş/ödeme/indirme YOK.

## Özet karar
| | iframe'de render | oynatma | pre-roll | watermark | sayfa reklamı | pop-up |
|---|---|---|---|---|---|---|
| A anizmplayer.com/video/<hash> | EVET | EVET (doğrulandı) | YOK | YOK (logo dosyası 404) | YOK | 0 |
| B anizm.net/jujutsu-kaisen-1-bolum-izle | EVET | oynatıcı yüklü, tık doğrulanamadı | YOK (aynı oynatıcı) | YOK | VAR (cashwin + bahis linkleri) | 0 |
| C puffytr.com/jujutsu-kaisen-1-bolum-izle | EVET | oynatıcı yüklü, tık doğrulanamadı | YOK (aynı oynatıcı) | YOK | VAR (cashwin + bahis linkleri) | 0 |

## Kanıtlar
- Konsolda `X-Frame-Options` / CSP `frame-ancestors` / "Refused to display" hatası YOK (yalnızca uzantı logları).
- A oynatıcı JW Player: duration 1439.15s (23:59), kalite Otomatik/1080p/720p/480p/360p, hız 0.25x–2x.
- A oynatıcı config: `"advertising": []`, `"plugins": {}` → reklam modülü yok. IMA/VAST/doubleclick isteği yok.
- A oynatıcı logo tanımlı ama `.../uploads/e5b953ed....png` 404 → ekranda logo görünmüyor.
- Video kaynağı: `anizmplayer.com/cdn/hls/6379493750f488a430ae08d43e400ba0/master.txt`, başlık `[Unm3i-F4nsub]-Jujutsu-K4is3n---01-[1080p]v2` (Türkçe altyazı videoda görünüyor: "Sen…").
- B/C sayfalarındaki oynatıcı iframe = `anizm.net|puffytr.com /player/1543980`; ağ logunda bu iframe `anizmplayer.com/video/b5725710206a2753ff5a685c2a52365e` dokümanını yüklüyor → A ile aynı oynatıcı.
- `/player/1543980` doğrudan açılırsa 404 (referer kontrolü). Slug → hash çözümü sunucu tarafında.
- anizm.net sayfasında "Site niye puffytr.com oldu" ve "Rinrintan: üstten anizm.net" bildirimleri (iki site aynı içerik).
- B/C: gizli 0x0 iframe `https://undefined/<base64>` + chatango iframe; alt bilgi SEO spam + bahis linkleri (1xbetm.info, betlikegir.com, ebetebet.com, cryptobetgiris.com, madridbetgiris.org, wbahis.org).
- Pop-up: 45 sn dokunmadan 0 yeni sekme; 1 tık + 30 sn 0 yeni sekme (test sayfası ve puffytr sayfası). İlgisiz: kullanıcının "re zero izle" Google sekmesi kendiliğinden animesalt.ro'ya gitti (atfedilemedi).

## Doğrulanamayan
- iframe İÇİNE tool ile tıklama yapılamadı (cross-origin iframe ref üretmiyor) → B/C için "iframe içinde oynatma" doğrudan tıklanarak test edilemedi.
- Pre-roll 0. saniyeden itibaren gözlenemedi: oynatıcı kayıtlı konumdan (~2:00) devam ediyor; ancak reklam config'i boş ve hiç ad isteği yok.
- Altyazı soft mu hardsub mu: doğrulanamadı (JW captions listesi yalnızca "Off"; görünen Türkçe satır kodlamaya gömülü görünüyor).

## Ekran görüntüleri
- A iframe: https://sc02.alicdn.com/kf/A27d3d4be9abc4ad1aba4b1d0288a01071.png
- B iframe: https://sc02.alicdn.com/kf/Adcf5a92fbe624fd2b0b2e2b0bcc9b9ebJ.png
- C iframe: https://sc02.alicdn.com/kf/Ad7efe80449164eccba15920023b606cb1.png
- A oynatıcı (temiz): https://sc02.alicdn.com/kf/Aab385d5a8c1144bdb70a70a2b93ed66ad.png
- A oynuyor 01:54: https://sc02.alicdn.com/kf/A390520b102284df6a967f475f329641aj.png
- A reklamsız/watermarksız: https://sc02.alicdn.com/kf/A66c9b50903944c279e9325b037d00476n.png
- B tam sayfa: https://sc02.alicdn.com/kf/Ad9b0a80d89ba4dd4b66d0782c1993a48h.png
- C tam sayfa: https://sc02.alicdn.com/kf/A542324a85a284f9fa2b824f44f3a264by.png
- /player/1543980 → 404: https://sc02.alicdn.com/kf/A3779ba56c1b54527b20a9e117aaf47ebR.png
- ?r=2 A: https://sc02.alicdn.com/kf/A1c35ebef0f5c4a0d96906f4909d13dc16.png
- ?r=2 B: https://sc02.alicdn.com/kf/Aac20b32ae82a4188b27a0c1690573443a.png
- ?r=2 C: https://sc02.alicdn.com/kf/Ae164224d7e574b74b77a7b1963404de37.png
