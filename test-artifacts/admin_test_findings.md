# Mushoku Tensei – admin sezon-algılama testi (SADECE GÖZLEM, hiçbir şey kaydedilmedi)

Ortam: http://localhost:8080 · Rota: `/admin` (başlık: "shanime | Yönetim")
Yöntem: `mushoku-tensei` → "Düzenle" → **MAL kimliği** kutusuna değer yaz → **"MAL'de ara"** → çıkan sonuç satırına tıkla → "Katalogdan bölüm çek" paneli açılır ve hedef sezon + uyarı üretilir.
Not: Başlangıçtaki kullanıcı sekmesi (…1966413586) ortada Chrome debugger iznini kaybetti ("user denied"); testler yeni bir ajan sekmesinde (…1966413631) yapıldı. **Kaydet / Yükle / Sil düğmelerine HİÇ basılmadı.**

| # | Girdi (MAL) | Başlık (panel) | Uyarı metni (birebir) | Sonuç |
|---|---|---|---|---|
| 2 | **39535** | Hedef: **S1** · sezonun MAL kimliği 39535 | `MAL 39535 serinin kendi kimliği — 1. sezon hedeflendi.` | ✅ S1 hedeflendi, S2 değil. Liste: 11 bölüm (1–11). |
| 3 | **45576** | Hedef: **S1** · sezonun MAL kimliği 45576 | `MAL 45576 serinin kendi kimliği — 1. sezon hedeflendi.` | ⚠️ Hedef S1 (S2 DEĞİL) ✅ ama uyarı **beklenen "S1'in 2. part'ı" metni DEĞİL**; "serinin kendi kimliği" metnine düşmüş. |
| 4 | **51179** | Hedef: **S2** · sezonun MAL kimliği 51179 | `MAL 51179 zaten S2 sezonunun kimliği — YENİ SEZON AÇILMADI, mevcut sezon hedeflendi.` | ✅ "zaten S2" mesajı birebir. Panelde "12/13 bölüm yüklü". |
| 5 | **55818** | (panel yok) | toast: `MAL 55818 AniList'te "ANİME" kaydı olarak yok (404) — kimlik yanlış olmayabilir. Özel/ön bölümler (0. Bölüm) çoğu dizide SEZONUN KENDİ MAL kimliğinin kataloğunda listelenir; ait olduğu sezonun kimliğiyle ara (ör. Mushoku S2 → 51179'u ara; "Guardian Fitz" 0. Bölüm olarak çıkar).` | ✅ Ölü-son 404 DEĞİL; yönlendirme mesajı veriliyor. |

## Test 6 — 51179 kataloğu (kaydetmeden)
"0. Bölüm / Guardian Fitz" **görünüyor**. Toplam **13 satır** (0 + 1..12). Panel: "12/13 bölüm yüklü".
Satırlar: 0. Bölüm Guardian Fitz · 1. The Brokenhearted Mage · 2. The Forest in the Dead of Night · 3. Abrupt Approach · 4. Letter of Invitation · 5. Ranoa University of Magic · 6. I Don`t Want to Die · 7. The Kidnapping and Confinement of Beast Girls · 8. The Fiance of Despair · 9. The White Mask · 10. These Feelings · 11. To You · 12. I Want to Tell You

## Test 7 — izleme sayfaları
- `/anime/mushoku-tensei/season/2/episode/0` → HTTP OK (404 değil). Başlık: `Mushoku Tensei: Jobless Reincarnation 0. Bölüm izle | shanime`. Oynatıcı alanı: **"Bu bölüm için kaynak yok"**. Alt bar: "0. bölümü izliyorsun." + amber "Bu bölüm için kaynak yok — Diğer bölümler sağdaki listede — oradan devam edebilirsin." Sağ liste 0..12.
- `/anime/mushoku-tensei/season/2/episode/1` → çalışıyor; oynatıcı yüklü (iframe `https://anizmplayer.com/video/90e08c6d15d206857d4fd54fa2f334bc`), başlık "1. Bölüm izle", alt bar "1. bölümü izliyorsun."

## Test 3 sapması (kök neden notu)
Kod (src/lib/admin-anizip.ts `resolveCatalogTarget`) kuralı: girilen kimlik AniList SEQUEL zincirinde bir halkaya düşerse ve o halka `part != null` ise "S{n}'in {part}. part'ı" mesajı üretilir; aksi halde (season satırı için) "serinin kendi kimliği" metni kullanılır. Ekranda 45576 için "serinin kendi kimliği — 1. sezon hedeflendi." çıktı → zincir 45576'yı **part'sız, S1** olarak sınıflamış (hit.season=1, hit.part=null). Numaralandırma yine S1'den devam ediyor (12–23 gösteriliyor) yani "devam" davranışı var; yalnızca UYARI METNİ part ifadesini içermiyor.

## Kaydedilen ekran görüntüleri
- C:\Projects\shanime-react\test_02_39535.png
- C:\Projects\shanime-react\test_03_45576.png
- C:\Projects\shanime-react\test_04_51179.png   (Test 4 + Test 6 aynı ekran)
- C:\Projects\shanime-react\test_05_55818.png
- C:\Projects\shanime-react\test_05_55818_toast.png  (toast görünür)
- C:\Projects\shanime-react\test_07_episode0.png
- C:\Projects\shanime-react\test_07_episode1.png
