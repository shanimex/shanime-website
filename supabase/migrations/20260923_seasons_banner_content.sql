-- ============================================================
-- shanime — SEZON + VİTRİN BANNER + İÇERİK TABLOLARI
-- Supabase Dashboard -> SQL Editor -> New query -> HEPSİNİ yapıştır -> Run
--
-- Bu dosya IDEMPOTENT'tir: birden fazla kez çalıştırmak zarar vermez.
-- Tek seferde tüm şema güncellemesini yapar.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Bölümlere sezon numarası (varsayılan: 1. sezon)
-- ------------------------------------------------------------
ALTER TABLE public.show_episodes
  ADD COLUMN IF NOT EXISTS season integer NOT NULL DEFAULT 1;

-- ------------------------------------------------------------
-- 2) Serilere özel vitrin (hero) 16:9 yatay görsel yolu
-- ------------------------------------------------------------
ALTER TABLE public.shows
  ADD COLUMN IF NOT EXISTS banner_image_path text;

-- ------------------------------------------------------------
-- 3) Sezonlar tablosu
--    Sezonlar bölümden bağımsız var olabilir: adı ve sırası tutulur.
--    Bu sayede henüz bölümü olmayan bir sezon da açılabilir.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.show_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  number integer NOT NULL,
  title text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (show_id, number)
);

GRANT SELECT ON public.show_seasons TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.show_seasons TO authenticated;
GRANT ALL ON public.show_seasons TO service_role;

ALTER TABLE public.show_seasons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read seasons" ON public.show_seasons;
CREATE POLICY "Anyone can read seasons" ON public.show_seasons
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Admins can insert seasons" ON public.show_seasons;
CREATE POLICY "Admins can insert seasons" ON public.show_seasons
  FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can update seasons" ON public.show_seasons;
CREATE POLICY "Admins can update seasons" ON public.show_seasons
  FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Admins can delete seasons" ON public.show_seasons;
CREATE POLICY "Admins can delete seasons" ON public.show_seasons
  FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP TRIGGER IF EXISTS update_show_seasons_updated_at ON public.show_seasons;
CREATE TRIGGER update_show_seasons_updated_at
  BEFORE UPDATE ON public.show_seasons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- 4) Var olan bölümler 1. sezona ait
-- ------------------------------------------------------------
UPDATE public.show_episodes SET season = 1 WHERE season IS NULL;

-- ------------------------------------------------------------
-- 5) Bölümü olan her seriye 1. sezon kaydını aç
-- ------------------------------------------------------------
INSERT INTO public.show_seasons (show_id, number, title, sort_order)
SELECT DISTINCT e.show_id, 1, '', 1
FROM public.show_episodes e
ON CONFLICT (show_id, number) DO NOTHING;

-- ------------------------------------------------------------
-- 6) Aynı seride aynı sezon + numara iki kez olmasın
--    (Tekrarlı kayıt varsa index eklenmez, uyarı verilir; kalan adımlar çalışır.)
-- ------------------------------------------------------------
DO $$
BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS show_episodes_show_season_number_key
    ON public.show_episodes (show_id, season, number);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'UYARI: show_episodes içinde tekrar eden (show_id, season, number) kaydı var, unique index eklenmedi. Hata: %', SQLERRM;
END $$;

-- ------------------------------------------------------------
-- 7) KONTROL — beklenen çıktı:
--    seasons  => her seri için en az 1 satır
--    episodes => 24 satır, hepsi season = 1
-- ------------------------------------------------------------
SELECT s.slug, count(se.id) AS bolum_sayisi, min(se.season) AS ilk_sezon
FROM public.shows s
LEFT JOIN public.show_episodes se ON se.show_id = s.id
GROUP BY s.slug
ORDER BY s.slug;

SELECT number, season, title FROM public.show_episodes ORDER BY season, number LIMIT 5;
