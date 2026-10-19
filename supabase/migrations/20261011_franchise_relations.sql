-- shanime — anime aile importu için ilişkili içerik alanları
--
-- Bu alanlar zorunlu değildir: panel, migration çalıştırılmamış eski bir
-- Supabase ortamında da katalogu kök kayda yazmaya devam eder. Migration
-- çalıştırıldığında film/OVA/ONA/Special kayıtları kök seriye gerçek bir
-- ilişkiyle bağlanır ve detay sayfasında doğru aile altında gösterilebilir.

ALTER TABLE public.shows
  ADD COLUMN IF NOT EXISTS franchise_root_id uuid
    REFERENCES public.shows(id) ON DELETE SET NULL;

ALTER TABLE public.shows
  ADD COLUMN IF NOT EXISTS media_format text NOT NULL DEFAULT 'TV';

CREATE INDEX IF NOT EXISTS shows_franchise_root_idx
  ON public.shows (franchise_root_id);

CREATE INDEX IF NOT EXISTS shows_media_format_idx
  ON public.shows (media_format);

COMMENT ON COLUMN public.shows.franchise_root_id IS
  'Otomatik franchise importunda film/OVA/ONA/Special kaydının kök dizisi.';

COMMENT ON COLUMN public.shows.media_format IS
  'AniList biçimi: TV, TV_SHORT, MOVIE, OVA, ONA veya SPECIAL.';
