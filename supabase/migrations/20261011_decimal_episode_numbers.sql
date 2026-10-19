-- AnimeciX biçimindeki sezon içi OVA konumları için bölüm numarası ondalık olabilir.
-- Örnek: S1 B11 -> OVA 11.5 -> S1 B12; sezon sonundaki OVA -> B26.
-- Normal bölümler integer değer olarak aynı şekilde saklanmaya devam eder.

ALTER TABLE public.show_episodes
  ALTER COLUMN number TYPE numeric(8, 2)
  USING number::numeric;

COMMENT ON COLUMN public.show_episodes.number IS
  'Sezon içi bölüm numarası; normal bölüm tam sayı, ara OVA konumu 11.5 gibi ondalık olabilir.';
