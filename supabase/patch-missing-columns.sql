-- YENI PROJEDE EKSIK KALAN ELLE-ACILMIS KOLONLAR (idempotent, tekrar calistirilabilir).
-- Neden: `parts` hicbir migration dosyasinda yok; eski projede elle acilmis.
-- SQL Editor'de tek seferde calistir.
alter table public.show_seasons
  add column if not exists parts jsonb;

comment on column public.show_seasons.parts is
  'Part kayitlari: [{malId, start, count}]. Katalog paneli yazar/okur.';
