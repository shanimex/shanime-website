-- Bölüm kapakları (Crunchyroll tarzı 16:9 kartlar için).
--
-- Panelden yüklenecek kapağın Storage yolunu tutar (`images` bucket).
-- Boş bırakılırsa arayüz serinin vitrin görselinden otomatik kapak üretir;
-- yani bu kolon eklenmeden de site ÇALIŞIR, kapaklar sonradan dolar.
--
-- Kodu etkilemez: sorgular `select("*")` kullandığı için kolonun varlığı ya da
-- yokluğu hata üretmez, sadece alan boş gelir.

alter table public.show_episodes add column if not exists thumbnail_path text;
