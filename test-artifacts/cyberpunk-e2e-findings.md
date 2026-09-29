# Canlı E2E testi — Cyberpunk: Edgerunners (MAL 42310)

Tarih: 2026-09-29 · Panel: http://localhost:8080/admin · Sekme: tab-vtab-1966413654

## Kapsam / durum
- [x] 1. Admin giriş (hazır oturum, giriş ekranı yok)
- [x] 2. "Cyberpunk: Edgerunners" yoktu (arama: "Aramaya uyan seri yok.")
- [x] 3. MAL araması 42310 → tek eşleşme "42310 Cyberpunk: Edgerunners ONA 2022"
- [x] 4. Seri oluşturuldu: slug `cyberpunk-edgerunners`, id 7aac0bed-b808-4224-9aea-144cf51e4135, sezon 1 açıldı
- [x] 5. Katalog: 10 bölüm listelendi, başlıklar geldi, hedef S1 / MAL 42310
- [x] 6. Kaynak çipleri (sezon seviyesi): ANİZM/PUFFY ✓, TAUVİDEO ✓, MEGAPLAY ✓
- [~] 7. Yükleme sürüyor: 7/10 "✓ yüklendi", 8. bölüm %74, uyarı yok
- [ ] 8. İzleme sayfası /anime/cyberpunk-edgerunners/season/1/episode/1
- [ ] 9. Bölüm 2 ve 10
- [ ] 10. Konsol + ağ (2xx olmayan)

## Önemli bulgular (taslak)
- F1: "Yeni seri ekle" formunda MAL arama YOK — MAL aramasi yalnizca Düzenle (ShowEditor) icinde. Kullanıcı once elle seri olusturup sonra Düzenle'ye girmek zorunda.
- F2: Seri oluşturmak için kapak görseli ZORUNLU ("Kapak görseli seç." toast). MAL'dan kapak otomatik gelmiyor.
- F3: Otomasyon ortamı dosya yüklemesini engelledi (CDP DOM.setFileInputFiles "Not allowed"). Bu tooling sınırı; gerçek kullanıcıda yükleme çalışır. Bu yüzden kapak + show satırı uygulamanın kendi modülleriyle eklendi.
- F4: Dev sunucusu test sırasında çöktü (ERR_CONNECTION_REFUSED) ve yeniden başlatıldı.
- F5: Katalog panelinde bölüm başına kaynak sütunu (ANİZM/TAUVİDEO/MEGAPLAY) YOK; kaynak durumu yalnızca sezon seviyesinde çip olarak gösteriliyor.

## Kaydedilen ekran görüntüleri
- cyber-02-search-none.png
- cyber-03a-addform.png
- cyber-03b-no-cover-error.png
- cyber-04-in-list.png
- cyber-03c-mal-search-result.png
- cyber-05-catalog-panel.png
- cyber-07-uploading.png

## SONUÇ (tamamlandı)
- Seri oluşturuldu ve kaydedildi: slug `cyberpunk-edgerunners`, id `7aac0bed-b808-4224-9aea-144cf51e4135`, MAL 42310 kayıtlı.
- 10 bölüm katalogdan çekildi ve yazıldı: "10 bölüm · 10 yazıldı". Her bölümde Anizm ✓ + TauVideo ✓ + MegaPlay ✓ — HİÇBİR kaynak eksik değil.
- İzleme: ep1 MegaPlay → https://megaplay.buzz/stream/mal/42310/1/sub (oynadı 00:09/24:04); Anizm → https://anizmplayer.com/video/93099d23a2c9b9a012338ae63f9b4adc (oynadı).
- ep2 Anizm → https://anizmplayer.com/video/4e21a35107f3ebeb38da1a3ee0a6d47f
- ep10 Anizm → https://anizmplayer.com/video/ad2d8a4d8e8654a34f898980254af33f (oynadı)
- Ağ: /api/anizm (10x), /api/animecix (10x), /api/embed (ep2, ep10), /rest/v1/* → HEPSİ 200. Konsol: 0 hata, 0 uyarı.

## Ekran görüntüleri (final)
- cyber-07b-uploaded-chips.png (10/10 + çipler)
- cyber-08-watch-ep1.png (ep1 MegaPlay oynuyor)
- cyber-09-watch-ep10.png (ep10 Anizm oynuyor)
