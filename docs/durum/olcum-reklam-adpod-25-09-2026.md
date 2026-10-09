# Ad-pod ölçüm kaydı — /izle/re-zero?sezon=1&b=1

Hedef: http://localhost:8080/izle/re-zero?sezon=1&b=1
Yöntem: yalnızca gözlem. Built-in tarayıcı devre dışı → Chrome'da YENİ sekme (tab-vtab-1966411255).
NOT: Ctrl+Shift+R (CDP key event) tarayıcı seviyesinde çalışmadı (navType hep "navigate" kaldı).
Bu yüzden her tekrarda "taze yükleme" aynı URL'e tam navigasyon ile yapıldı. Sayfa tarafında
gözlemlenen süreç aynı (Oynat butonu / reklam podu sıfırdan geldi).

## Ölçümler (sayaç metni DOM'dan birebir okundu, 150ms örnekleme)

| # | İlk sayaç | İkinci sayaç | Kaç reklam | Yaklaşık toplam reklam süresi |
|---|---|---|---|---|
| Tekrar 1 | Reklam 1/2 (t=0.2s) | Reklam 2/2 (t=15.3s) | 2 | ~30 sn (oynatıcı t=30.6s) |
| Tekrar 2 | Reklam 1/2 (t=0s, oto-başladı) | Reklam 2/2 (t=2.1s) | 2 | ~8 sn (oynatıcı t=8.1s) |
| Tekrar 3 | Reklam 1/2 (t=0.2s) | Reklam 2/2 (t=15.3s) | 2 | ~30 sn (oynatıcı t=30.5s) |
| Tekrar 4 | Reklam 1/1 (t=0.2s) | — (ikinci reklam yok) | 1 | ~15 sn (oynatıcı t=15.3s) |

Ek gözlemler:
- Ön ölçüm (ilk tıklama): sayaç "Reklam 2/2" olarak görüldü (ilk sayaç geç okundu), sonra oynatıcı yüklendi.
- Tekrar 3 denemesi A (enjeksiyon 3s sonra): reklam görülemedi, oynatıcı doğrudan yüklüydü (0 reklam gözlendi).
- Ek yapı denetimi (Oynat tıklandı): Reklam 1/2 (t=0.2s, video duration 15.104s) → Reklam 2/2 (t=15.3s,
  AYNI src, AYNI duration). Pod boyunca DOM'da TEK <video> elemanı var (VIDEO<DIV<DIV), slot başına ayrı
  video elemanı yok, data-slot benzeri işaret yok.

Her iki slotta da görülen video kaynağı (birebir):
https://i.imgkcdn.com/video/video/1131/131/6aa3d42aca9066.93196011t1789121578r9658_high.mp4
(1/1 durumunda da aynı src)

Oynatıcı iframe src (reklamlar bittikten sonra, birebir):
https://megaplay.buzz/stream/mal/31240/1/sub

Konsol: hata yok (browser_utility errors = [], console level=error = []). Sadece Vite + tarayıcı
eklentisi (Futoo/Pinterest/Fatkun) info/debug kayıtları. "refused"/"blocked"/"undefined"/"video"
içeren hata yok.

Reklamı geç kontrolü: pill şeklinde (gerçek <button> değil, div/role). Metin "Reklamı geç: N" → "Reklamı geç".
Programatik basma denemelerinde <button> bulunamadı; reklamlar kendiliğinden ilerledi.

Ekran görüntüleri:
- Reklam 1/2: https://sc02.alicdn.com/kf/A21ae7f14ac084f809b523abf3f12aac8d.png
- Reklam 2/2: https://sc02.alicdn.com/kf/Ae9bf630eea5444008b4cb6232e04b919f.png
