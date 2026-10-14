-- ============================================================
-- shanime — VİTRİN (ÖNE ÇIKAN SERİ) + PANEL İSTATİSTİKLERİ
-- Supabase Dashboard -> SQL Editor -> New query -> HEPSİNİ yapıştır -> Run
--
-- Bu dosya IDEMPOTENT'tir: birden fazla kez çalıştırmak zarar vermez.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Ana sayfa vitrininde (hero) gösterilecek seri işareti
--    Panelde "Vitrin'de göster" anahtarını açtığın 1-3 seri ana
--    sayfada döner. Hiçbiri işaretli değilse ilk seriler gösterilir.
-- ------------------------------------------------------------
ALTER TABLE public.shows
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS shows_is_featured_idx
  ON public.shows (is_featured)
  WHERE is_featured;

-- ------------------------------------------------------------
-- 2) Panel için seri istatistikleri
--    Sezon ve bölüm sayıları SQL içinde sayılır: tek istek, ve
--    1000+ bölümlü serilerde de doğru (satır çekme sınırı yok).
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public.show_stats
  WITH (security_invoker = on) AS
SELECT
  s.id AS show_id,
  (SELECT count(*) FROM public.show_seasons ss WHERE ss.show_id = s.id)::int AS season_count,
  (SELECT count(*) FROM public.show_episodes e WHERE e.show_id = s.id)::int AS episode_count
FROM public.shows s;

REVOKE ALL ON public.show_stats FROM anon;
GRANT SELECT ON public.show_stats TO authenticated;
GRANT ALL ON public.show_stats TO service_role;

-- ------------------------------------------------------------
-- 3) KONTROL — beklenen: 4 satır, jujutsu-kaisen 1 sezon / 24 bölüm
-- ------------------------------------------------------------
SELECT
  s.slug,
  s.is_featured,
  st.season_count,
  st.episode_count
FROM public.shows s
LEFT JOIN public.show_stats st ON st.show_id = s.id
ORDER BY s.sort_order;
