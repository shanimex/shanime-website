# Mushoku Tensei — sil & sıfırdan ekle testi (canlı)

**Show:** Mushoku Tensei: Jobless Reincarnation · id `4582d4a5-c92f-4d48-a0ff-190c15680f26` · slug `mushoku-tensei` · MAL 39535 · animecix_id 7350 · kind `series`
**Panel:** http://localhost:8080/admin (tab 1966413681; kullanıcının kendi sekmesi 1966413586 debugger iznini reddetti)

## 0) YEDEK
- `test-artifacts/mushoku-backup-2026-09-29.json` (Supabase REST, panelin client creds)
- Satırlar: shows **1**, show_seasons **1**, show_episodes **12**, episode_sources **36** (12 eps × anizm+animecix+megaplay)

## 1) SİLME ÖNCESİ
- show_seasons: 1 satır → S2 (number 2, mal_id 51179, sort_order 2). **S1 satırı YOK.**
- show_episodes: 12 satır — hepsi season=2, number 1..12.
- episode_sources: 36 satır, her bölümde anizm+animecix+megaplay (hepsi yeşil).

## 2) SİLME
- Katalog paneli → "2. sezonu tamamen sil" → onay: **"2. sezon silinsin mi?" / "İçindeki 12 bölüm de silinir. Sezon kaydı ve bölümleri kalıcı olarak silinir; bu işlem geri alınamaz."** / buton "Sezonu sil".
- Sonrası: show_seasons 0, show_episodes 0. (Panel sayacı 217→205 bölüm.)

## 3) SIFIRDAN EKLEME
| Girilen MAL | Hedeff | Katalog satırı | Yazılan | Toast |
|---|---|---|---|---|
| 39535 | S1 | 11 (1..11) | 11 eps | "S1 Anizm + TauVideo + MegaPlay: 11 bölüm eklendi, 0 bölümün kaynakları güncellendi." |
| 45576 | S1 | 13 (0 special + 12..23) | 12 eps (12..23, 0 hariç) | "S1 Anizm + TauVideo + MegaPlay: 12 bölüm eklendi, 0 bölümün kaynakları güncellendi." |
| 51179 | S2 | 13 (0 special + 1..12) | 12 eps (1..12, 0 hariç) | "S1 Anizm + TauVideo + MegaPlay: 12 bölüm eklendi, 0 bölümün kaynakları güncellendi." |

Notices (birebir):
- 39535: "MAL 39535 serinin kendi kimliği — 1. sezon hedeflendi."
- 45576: "MAL 45576 → S1'in 2. part'ı (AYNI sezonun DEVAMI), S2 DEĞİL — numaralar 1. sezonun bölümlerinden sonra sürer."
- 51179: "MAL 51179 → S2 (zincirdeki 2. sezon) — hedef S2."

## DURUM (checkpoint)
- seasons: S1(39535), S2(51179). episodes: S1=23 (1..23), S2=12 (1..12). total 35. sources 35×3.
- **KALAN:** 55888 (S2P2) · 59193 (S3P1) · 65077 (ops.) · izleme sayfası doğrulamaları + konsol/ağ hataları.
