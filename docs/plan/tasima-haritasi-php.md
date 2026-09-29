# Taşıma haritası — PHP/WordPress'e geçilirse ne taşınmalı

Karar: kullanıcı **tasarımı kendisi yönetmek** istiyor; bu yüzden PHP/WordPress düşünüyor.
Bu dosya, mevcut projede **deneme yanılma ile bulunmuş** bilgileri kaybetmemek için var.
Hiçbiri tahmin değil; hepsi bu projede canlı ölçülerek doğrulandı.

## 1. Veri modeli (Postgres)
- `shows` — seri: `slug, title, subtitle, year, genre (virgüllü metin), description, image_path, banner_image_path, is_featured, sort_order, mal_id, animecix_id`
- `show_seasons` — sezon: `show_id, number, title, sort_order`
- `show_episodes` — bölüm: `show_id, season, number, title, watch_url`
- `episode_sources` — **çoklu kaynak** (yeni): `episode_id, provider, language ('tr'|'en'), url, label, sort_order` — izleme sayfasındaki TÜRKÇE/YABANCI kutuları buradan
- `site_settings` — anahtar/değer: reklam kodları, kapak haritası, ayarlar
- **Puan/izlenme/yayın tarihi alanı YOK** → "IMDb sıralaması", "Just Completed", "Estimated Schedule" bu yüzden uydurulamaz

## 2. Kaynak çözümü (en değerli kısım — kaybolmasın)
**Anizm / Puffytr** (`/api/anizm`):
- puffytr bir **Türk sitesi**; sezon eki bazen İngilizce bazen **Türkçe** yazılır. Aynı dizide bile karışık!
- Ölçüm: `rezero-...-2-sezon` → **200**, `rezero-...-2nd-season` → **302** ama `rezero-...-3rd-season` → **200**
- Bu yüzden **iki yazım da** denenir: `-<N>-sezon`, `-<N>-sezon-izle`, `-<N>nd-season`, `-<N>rd-season`, `-<N>`, `-season-<N>`
- Sunucu taraflı **arama yok** (`/searchAnime` 404, `/aramasonuclari` 302, `/arama` 500)
- Bölüm adresi hash'i referer korumalı → **sunucudan** çözülür, tarayıcıdan değil

**Animecix / TauVideo** (`/api/animecix`):
- Arama: `GET /secure/search/<terim>?limit=20` — terim **yolun parçası**, `?query=` **çalışmaz** (sessizce alâkasız kayıt döner)
- Bölüm videosu: `GET /secure/episode-videos?titleId=<id>&season=<s>&episode=<e>` → dizi içinde `url` (tau-video embed) + `id`
- Gömülecek adres: `url + "?vid=" + id` (ör. `tau-video.xyz/embed/<hash>?vid=<vid>`)
- **Çerez gerekmez**, yalnızca User-Agent yeterli
- `id` alanı **video** kimliğidir, bölüm kimliği değil (karıştırılırsa `/secure/episodes/<id>` "Episode not found" der)

**Devam sezonları (en kritik mantık):**
- AniList ilişkileri **geçişli değil**: JJK S1 (40748) → S2 (51009) → S3 (57658). Tek adım bakmak S3'ü asla bulmaz.
- Çözüm: **SEQUEL zincirini adım adım yürü**, film/OVA/ONA'yı sezon sayma, hedefi **sıra numarasıyla** eşle, belirsizse dur ve uydurma.

## 3. Panel tarafında öğrenilen tuzaklar
- Katalog (`ani.zip`) bölüm adlarını **İngilizce** verir; Türkçe ad kaynağı **bulunamadı** (animecix uçları vermiyor, puffytr vermiyor). Türkçe adlar bu projede **elle** yazıldı.
- **Çözülemeyen kaynağı sessizce yutma**: yabancı kaynak her zaman yazıldığı için hata görünmez oluyordu → panelde kalıcı "YAZILAMAYAN KAYNAKLAR" bloğu şart.
- `PostgrestError` bir `Error` **örneği değil** → `String(err)` ekrana `[object Object]` yazar.

## 4. Kota / hız (para konusu)
- Sitenin çökmesini engelleyen şey **veritabanına gidişi kesmek**: istemci önbelleği, sunucu önbelleği, `Link` gezinmesi, **statik katalog**, **görselleri DB dışına almak**.
- Dil değiştirmek hız kazandırmaz; barındırma/kenar ağı belirler.
- Supabase Pro taban fiyatı **üçüncü taraf** kaynaklara göre ~$25/ay; resmî teyit `supabase.com/pricing`.

## 5. Taşıma yapılırsa sıra
1. Yukarıdaki tabloları MySQL'e kur (WordPress MySQL kullanır)
2. Kaynak çözümünü PHP'ye yaz (curl + aynı adres merdiveni)
3. Panel: katalog çekme, bölüm ekleme, kaynak yazma — panel **kodla** yapılır, tasarım WordPress temasıyla
4. Tasarımı sen WordPress teması/Elementor ile yaparsın
