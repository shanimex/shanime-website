-- ============================================================================
-- SEZON BAŞINA MAL KİMLİĞİ
-- ============================================================================
-- Kullanıcı isteği (29.09.2026): "ben MAL id girdim, kaynakları falan girdim,
-- otomatik 1. sezon oldu. Sonra tekrar MAL id girdim (39587) ve 'MAL'de ara'
-- yaptım — ama o yeni sezon olmuyor. İlk sezon için bir id girdiysem otomatik
-- 1. sezon olmuyor mu zaten? Sonra tekrar girince OTOMATİK SIRADAKİ SEZON olarak
-- kendi yaratması/algılaması gerek."
--
-- SORUN: MAL kimliği yalnızca `shows.mal_id` alanında, yani SERİ BAŞINA TEK bir
-- değerdi. İkinci bir kimlik girmek yeni sezon açmıyor, serinin kimliğini
-- değiştirmeye çalışıyordu (bu yüzden panel yine S1 · 31240 gösteriyordu).
--
-- ÇÖZÜM: her sezonun KENDİ MAL kimliğini taşıyabilsin.
--
-- DAVRANIŞ:
--   · `mal_id` NULL ise → hiçbir şey değişmez; sezon katalogu eskisi gibi
--     serinin kimliğinden + AniList zincirinden bulunur (mevcut satırlar böyle).
--   · `mal_id` DOLU ise → o sezonun katalogu DOĞRUDAN bu kimlikten çekilir
--     (zincir tahmini devre dışı; yanlış sezon gelme riski kalmaz).
--
-- Panel, serinin kimliğinden FARKLI bir kimlik verildiğinde onu SIRADAKİ sezona
-- atar ve sezon kaydı ilk YAZIMDA oluşur (bölümsüz boş sezon açılmaz).
-- ============================================================================

alter table public.show_seasons
  add column if not exists mal_id integer;

comment on column public.show_seasons.mal_id is
  'Sezonun MyAnimeList (anime) kimliği. NULL ise katalog serinin kimliğinden ve AniList zincirinden çözülür.';
