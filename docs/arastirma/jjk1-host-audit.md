# JJK 1. Bölüm — tranimeizle sunucu ölçümü (kısa kayıt)

Sayfa: https://www.tranimeizle.live/jujutsu-kaisen-1-bolum-izle (Unmei Fansub, 23:52 / 1432s)
Ölçüm tarihi: 2026-09-26 · Not: iframe src'ler sayfadaki `#sourceList li.sourceBtn` (data-id) tıklanarak alındı. Süre hepsi ~1432s.

## Kaynaklar (data-id → iframe src → durum)
- Gdrive 431035 → https://drive.google.com/file/d/1k5cERlyfW-xyehp5pPYPhgFrJcQcAmGZ/preview → ÖLÜ (404, "dosya mevcut değil")
- Ok.RU 935229 → https://odnoklassniki.ru/videoembed/7714335099637/ → ÖLÜ ("yazar bulunamadı/engellendi")
- Ok.RU 431031 → https://odnoklassniki.ru/videoembed/2149108681430/ → ÖLÜ (aynı)
- MailRU 431033 → https://my.mail.ru/video/embed/8184657165802275492 → ÇALIŞIYOR 1920x1080, kalite 360p/1080p
- Sibnet 935241 → https://video.sibnet.ru/shell.php?videoid=5521985 → ÇALIŞIYOR 1280x720
- Sibnet 431040 & Upstream 935237 → https://luffytra2.top/embed2/?id=https://upstream.to/embed-ults0iq55i6l.html → ÖLÜ (luffytra2.top = "Example Domain")
- Mega 431030 → https://mega.nz/embed/q1xSnJIB#XK5dH0vIV3xDi-sT7eUdq4pbnIWUaq6OnWRe08rrMzU → ÖLÜ ("dosyaya artık erişilemiyor")
- Vidmoly 431025 → https://vidmoly.me/embed-c71jpcte6wnz.html → ÖLÜ ("video not found")
- luffytra2 sarmalı (hepsi ÖLÜ wrapper): Vudeo 935240 (vudeo.io/73x5dfztx4j6.html), Uqload 935230 (uqload.to/embed-392ywk4714o5.html), Filelions 935228 (filelions.to/file/y1sp1a8egx66), Mp4upload 431037 (mp4upload.com/6h4oee8m76ug.html), SendVid 431029 (sendvid.com/embed/5asj3u7m), BYandex 431022 (yadi.sk/i/xifd2msD2QSGyQ), Yourupload 431023 (yourupload.com/embed/Ti7H8mt6wwT7), Lulu 935235 (luluvdo.com/1w9rwen78y4s), Filesfm 935236 (files.fm/u/awcez65a96)
- AitrVip 935227 → https://optraco.top/explorer/121448d1-aec0-4a52-9234-10813895d589/7D87C119053DAD87EA1E791444A814237F717D3A → ölçülmedi

## Detay
- MailRU: 1920x1080 · 1432s · textTracks 0 (hardsub TR) · örnek altyazı "...Sugisawa Lisesi inşaatı sırasında görüldü." · 45s boş bekleme = 0 popup, oynatıcı ortasına tık = 1 yeni sekme (https://my.mail.ru/mail/ivankovgarc/video/_myvideo/676.html?time=38&from=videoplayer) · banner yok · XFO yok, CSP yok → gömülebilir
- Sibnet: 1280x720 · 1432s · textTracks 0 (hardsub TR) · örnek "Kes şunu!" · popup ölçülmedi · XFO yok, CSP yok → gömülebilir
- Ok.RU: CSP var (frame-src * blob: 'self'), XFO yok → gömülebilir ama video yok
- Gdrive: CSP (docs-tt) var, XFO yok; dosya 404

## Sonuç
En iyi: **MailRU** (1080p + TR hardsub + temiz + gömülebilir; sadece tıkla 1 popunder).
2.: **Sibnet** 720p (referans).
