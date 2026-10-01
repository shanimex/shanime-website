-- SIFIRDAN KURULUM - tum migrationlar sirayla (yeni proje icin tek seferde calistir)
-- Kaynak: supabase/migrations/

-- ============================================================
-- 20260918061023_45c4ec3c-c810-4d2c-924b-3f7d13f2f984.sql
-- ============================================================
create type public.app_role as enum ('admin', 'user');

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  role app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

create policy "Users can read own roles" on public.user_roles for select to authenticated using (auth.uid() = user_id);

create table public.shows (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subtitle text not null default '',
  image_path text not null,
  sort_order integer not null default 0,
  created_at timestamp with time zone not null default now()
);
grant select on public.shows to anon;
grant select, insert, update, delete on public.shows to authenticated;
grant all on public.shows to service_role;
alter table public.shows enable row level security;

create policy "Anyone can read shows" on public.shows for select to anon, authenticated using (true);
create policy "Admins can insert shows" on public.shows for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));
create policy "Admins can update shows" on public.shows for update to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "Admins can delete shows" on public.shows for delete to authenticated using (public.has_role(auth.uid(), 'admin'));

create table public.site_settings (
  key text primary key,
  value text not null
);
grant select on public.site_settings to anon;
grant select, insert, update, delete on public.site_settings to authenticated;
grant all on public.site_settings to service_role;
alter table public.site_settings enable row level security;

create policy "Anyone can read settings" on public.site_settings for select to anon, authenticated using (true);
create policy "Admins can update settings" on public.site_settings for update to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "Admins can insert settings" on public.site_settings for insert to authenticated with check (public.has_role(auth.uid(), 'admin'));

insert into public.shows (title, subtitle, image_path, sort_order) values
  ('Jujutsu Kaisen', 'Lanetler, büyücüler ve büyük bir hesaplaşma', 'seed/poster-cursed.jpg', 1),
  ('Re:Zero', 'Başka bir dünyada sıfırdan başlamak', 'seed/poster-zero.jpg', 2),
  ('Mushoku Tensei', 'İkinci bir hayat, sınırsız bir dünya', 'seed/poster-mage.jpg', 3),
  ('Erased', 'Geçmişe uzanan karanlık bir gizem', 'seed/poster-erased.jpg', 4);

insert into public.site_settings (key, value) values ('hero_image', 'seed/hero.jpg');

create policy "Anyone can read site images" on storage.objects for select to anon, authenticated using (bucket_id = 'images');
create policy "Admins can upload site images" on storage.objects for insert to authenticated with check (bucket_id = 'images' and public.has_role(auth.uid(), 'admin'));
create policy "Admins can update site images" on storage.objects for update to authenticated using (bucket_id = 'images' and public.has_role(auth.uid(), 'admin')) with check (bucket_id = 'images' and public.has_role(auth.uid(), 'admin'));
create policy "Admins can delete site images" on storage.objects for delete to authenticated using (bucket_id = 'images' and public.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 20260918061036_c80d7d6f-d90e-4d4c-a597-fad016fba810.sql
-- ============================================================
revoke execute on function public.has_role(uuid, public.app_role) from anon, public;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;

-- ============================================================
-- 20260918061053_069ad4d3-8ab9-4ccf-813a-5a66b6ad8eaa.sql
-- ============================================================
drop policy "Admins can insert shows" on public.shows;
drop policy "Admins can update shows" on public.shows;
drop policy "Admins can delete shows" on public.shows;
drop policy "Admins can update settings" on public.site_settings;
drop policy "Admins can insert settings" on public.site_settings;
drop policy "Admins can upload site images" on storage.objects;
drop policy "Admins can update site images" on storage.objects;
drop policy "Admins can delete site images" on storage.objects;

drop function public.has_role(uuid, public.app_role);

create schema if not exists private;

create or replace function private.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role = _role
  )
$$;

grant usage on schema private to authenticated;
revoke all on function private.has_role(uuid, public.app_role) from anon, public;
grant execute on function private.has_role(uuid, public.app_role) to authenticated;

create policy "Admins can insert shows" on public.shows for insert to authenticated with check (private.has_role(auth.uid(), 'admin'));
create policy "Admins can update shows" on public.shows for update to authenticated using (private.has_role(auth.uid(), 'admin')) with check (private.has_role(auth.uid(), 'admin'));
create policy "Admins can delete shows" on public.shows for delete to authenticated using (private.has_role(auth.uid(), 'admin'));
create policy "Admins can update settings" on public.site_settings for update to authenticated using (private.has_role(auth.uid(), 'admin')) with check (private.has_role(auth.uid(), 'admin'));
create policy "Admins can insert settings" on public.site_settings for insert to authenticated with check (private.has_role(auth.uid(), 'admin'));
create policy "Admins can upload site images" on storage.objects for insert to authenticated with check (bucket_id = 'images' and private.has_role(auth.uid(), 'admin'));
create policy "Admins can update site images" on storage.objects for update to authenticated using (bucket_id = 'images' and private.has_role(auth.uid(), 'admin')) with check (bucket_id = 'images' and private.has_role(auth.uid(), 'admin'));
create policy "Admins can delete site images" on storage.objects for delete to authenticated using (bucket_id = 'images' and private.has_role(auth.uid(), 'admin'));

-- ============================================================
-- 20260918061745_3a2d3c49-5bd4-4935-9553-2b3293ca584d.sql
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

ALTER TABLE public.shows
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS year text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS genre text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS watch_url text NOT NULL DEFAULT '';

UPDATE public.shows SET slug = id::text WHERE slug IS NULL OR slug = '';
CREATE UNIQUE INDEX IF NOT EXISTS shows_slug_key ON public.shows (slug);

CREATE TABLE IF NOT EXISTS public.show_episodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  number integer NOT NULL DEFAULT 1,
  title text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  duration text NOT NULL DEFAULT '',
  watch_url text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.show_episodes TO authenticated;
GRANT SELECT ON public.show_episodes TO anon;
GRANT ALL ON public.show_episodes TO service_role;
ALTER TABLE public.show_episodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read episodes" ON public.show_episodes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins can insert episodes" ON public.show_episodes FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update episodes" ON public.show_episodes FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete episodes" ON public.show_episodes FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.show_characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT '',
  image_path text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.show_characters TO authenticated;
GRANT SELECT ON public.show_characters TO anon;
GRANT ALL ON public.show_characters TO service_role;
ALTER TABLE public.show_characters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read characters" ON public.show_characters FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins can insert characters" ON public.show_characters FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update characters" ON public.show_characters FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete characters" ON public.show_characters FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.show_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  show_id uuid NOT NULL REFERENCES public.shows(id) ON DELETE CASCADE,
  image_path text NOT NULL,
  caption text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.show_images TO authenticated;
GRANT SELECT ON public.show_images TO anon;
GRANT ALL ON public.show_images TO service_role;
ALTER TABLE public.show_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read show images" ON public.show_images FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins can insert show images" ON public.show_images FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update show images" ON public.show_images FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete show images" ON public.show_images FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_show_episodes_updated_at BEFORE UPDATE ON public.show_episodes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_show_characters_updated_at BEFORE UPDATE ON public.show_characters FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 20260923_seasons_banner_content.sql
-- ============================================================
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


-- ============================================================
-- 20260924_featured_and_stats.sql
-- ============================================================
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


-- ============================================================
-- 20260925_show_banner_video.sql
-- ============================================================
alter table public.shows add column if not exists banner_video_path text;

-- ============================================================
-- 20260926_episode_thumbnails.sql
-- ============================================================
-- Bölüm kapakları (Crunchyroll tarzı 16:9 kartlar için).
--
-- Panelden yüklenecek kapağın Storage yolunu tutar (`images` bucket).
-- Boş bırakılırsa arayüz serinin vitrin görselinden otomatik kapak üretir;
-- yani bu kolon eklenmeden de site ÇALIŞIR, kapaklar sonradan dolar.
--
-- Kodu etkilemez: sorgular `select("*")` kullandığı için kolonun varlığı ya da
-- yokluğu hata üretmez, sadece alan boş gelir.

alter table public.show_episodes add column if not exists thumbnail_path text;


-- ============================================================
-- 20260927_animecix_id.sql
-- ============================================================
-- ============================================================================
--  animecix_id kolonu + doğrulanmış kimlikler
--  Tarih: 27.09.2026  ·  Karar: kullanıcı onayladı ("shows'a animecix_id kolonu")
-- ============================================================================
--
--  NEDEN: animecix.tv'nin Türkçe (hardsub) kaynağını çözen sunucu rotası
--  (`/api/animecix`) seri başına SAYISAL bir kimlik istiyor:
--      GET /secure/episode-videos?titleId=<id>&season=<s>&episode=<e>
--  Bu kimlik ada göre aramayla da bulunabilir (`/secure/search/<terim>`), ama
--  arama YANLIŞ SERİYE bağlanabiliyor: ölçüldü (27.09.2026) —
--      "mushoku tensei" aramasının İLK sonucu ana dizi DEĞİL,
--      "Mushoku Tensei … SPECIALS" (id 11073, 2 bölüm). Ana dizi id 7350.
--  Ayrıca "jujutsu kaisen" araması 4 farklı JJK kaydı döndürüyor (7352, 8718,
--  12157, 12839). Her çözümlemede ada güvenmek, ileride sessizce başka bir seriye
--  bölüm yazma riski demek. Bu yüzden kimlik SERİ BAŞINA BİR KEZ saklanır.
--
--  NASIL ÇALIŞTIRILIR: Depodaki uygulama anahtarı yalnızca "publishable"
--  anahtardır ve PostgREST üzerinden DDL çalıştırılamaz. Betiği
--  Supabase Panel > SQL Editor içinde çalıştır.
--
--  GÜVENLİK: Idempotent (IF NOT EXISTS / koşullu UPDATE). Tekrar çalıştırılabilir.
--  GERİ ALMA:
--    drop index if exists public.shows_animecix_id_key;
--    alter table public.shows drop column if exists animecix_id;
-- ============================================================================

begin;

-- 1) Kolon -------------------------------------------------------------------
alter table public.shows
  add column if not exists animecix_id integer;

comment on column public.shows.animecix_id is
  'animecix.tv dizi kimliği (titleId). Türkçe (hardsub) bölüm adresi bu kimlikle '
  'çözülür: https://animecix.tv/secure/episode-videos?titleId=…&season=…&episode=… '
  'Kimlik panelde bir kez eşlenir (ölçüm: 27.09.2026). NULL ise animecix kaynağı '
  'üretilemez — panel ada göre arama önerir.';

-- Aynı animecix kaydı iki dizimize bağlanmasın (NULL'lar serbest).
create unique index if not exists shows_animecix_id_key
  on public.shows (animecix_id)
  where animecix_id is not null;

-- 2) Doğrulanmış kimlikler ----------------------------------------------------
-- Kaynak: GET https://animecix.tv/secure/search/<terim>?limit=5  (çerez gerekmez)
-- Ölçüm: 27.09.2026, doğrudan HTTP ile; sonuç adları ve bölüm sayıları aşağıda.
--
-- | Sitedeki dizi     | animecix id | animecix adı                              | sezon | bölüm |
-- |-------------------|-------------|-------------------------------------------|-------|-------|
-- | Jujutsu Kaisen    | 7352        | Jujutsu Kaisen                            | 3     | 59    |
-- | Re:Zero           | 7325        | Re:Zero kara Hajimeru Isekai Seikatsu     | 3     | 53    |
-- | Mushoku Tensei    | 7350        | Mushoku Tensei: Jobless Reincarnation     | 3     | 47    |
-- | Erased            | 13          | Boku dake ga Inai Machi                   | 1     | 12    |
--
-- ⚠️ NOT: animecix bölüm sayıları TVDB/ani.zip numaralandırmasıyla birebir
-- olmayabilir (ör. JJK 59 bölüm = tüm sezonlar toplamı). Bölüm numarası bizim
-- sezon numaramızla birlikte gönderilir; eşleşme panelde canlı denenir.

update public.shows set animecix_id = 7352
  where slug = 'jujutsu-kaisen' and (animecix_id is null or animecix_id <> 7352);

update public.shows set animecix_id = 7325
  where slug like 're-zero%' and (animecix_id is null or animecix_id <> 7325);

update public.shows set animecix_id = 7350
  where slug like 'mushoku-tensei%' and (animecix_id is null or animecix_id <> 7350);

update public.shows set animecix_id = 13
  where slug like 'erased%' and (animecix_id is null or animecix_id <> 13);

commit;

-- 3) DOĞRULAMA ---------------------------------------------------------------
-- Beklenen: 4 satır, animecix_id dolu, NULL yok.
select slug, title, animecix_id,
       case when animecix_id is null then 'EKSIK' else 'OK' end as durum
  from public.shows
 order by animecix_id nulls last;


-- ============================================================
-- 20260927_episode_sources.sql
-- ============================================================
-- ============================================================================
--  episode_sources — bir bölüme BİRDEN FAZLA kaynak
--  Tarih: 27.09.2026  ·  Karar: kullanıcı onayladı ("her bölümün altında kaynak listesi")
-- ============================================================================
--
--  NEDEN GEREKLİ: `show_episodes.watch_url` TEK bir adres tutuyor. Kullanıcı panelde
--  ikinci bir kaynak seçtiğinde birincisi siliniyordu ve şikâyet şuydu:
--  "birden fazla kaynak seçemiyorum; hangilerini seçersem oynatıcının altında o
--  kaynaklar çıksın." Tek kolonla bu mümkün değil — bu yüzden kaynaklar ayrı
--  satırlara taşınıyor.
--
--  İKİ YERDE TUTULUYOR (bilinçli):
--    · `episode_sources` → kaynakların TAM listesi (oynatıcı altındaki çipler).
--    · `show_episodes.watch_url` → mevcut "birincil kaynak" alanı KORUNUR, çünkü
--      site onu zaten okuyor ve izleme sayfası kaynak yoksa ona düşüyor.
--      Yani bu tablo eklenmeden de site çalışmaya devam eder.
--
--  `url` ALANI İKİ TÜR DEĞER TAŞIR (mevcut `watch_url` mantığıyla aynı):
--    · gerçek gömme adresi  → https://anizmplayer.com/video/<hash>
--    · sağlayıcı direktifi  → @megaplay  (adres bölüme özel olmadığı için)
--  Çipin tıklanınca ne yapacağına izleme sayfası bu ayrıma bakarak karar verir.
--
--  NASIL ÇALIŞTIRILIR: Supabase Panel > SQL Editor (publishable anahtarla DDL
--  çalıştırılamaz). Betik idempotenttir; tekrar çalıştırılabilir.
--
--  GERİ ALMA:
--    drop policy if exists "Anyone can read episode sources" on public.episode_sources;
--    drop policy if exists "Admins can insert episode sources" on public.episode_sources;
--    drop policy if exists "Admins can update episode sources" on public.episode_sources;
--    drop policy if exists "Admins can delete episode sources" on public.episode_sources;
--    drop table if exists public.episode_sources;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.episode_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES public.show_episodes(id) ON DELETE CASCADE,
  -- Sağlayıcı kimliği: anizm | animecix | megaplay | videasy | vidsrc | …
  -- (Kaynak listesiyle aynı yazım; tek kaynak `src/lib/embed-sources.ts`.)
  provider text NOT NULL,
  -- Dil: 'tr' (Türkçe altyazı/gömülü) | 'en' (orijinal ses). Çip gruplaması bunu kullanır.
  language text NOT NULL DEFAULT 'tr',
  -- Kullanıcıya görünen kısa ad (ör. "Tau Video").
  label text NOT NULL DEFAULT '',
  -- Gömme adresi ya da '@sağlayıcı' direktifi (yukarıdaki nota bak).
  url text NOT NULL,
  -- Oynatıcı altındaki diziliş sırası (küçük olan önce).
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Aynı bölüme aynı sağlayıcı iki kez eklenmesin: panelde "tekrar yaz" basıldığında
  -- satır çoğalmasın, var olan güncellensin (upsert).
  UNIQUE (episode_id, provider)
);

-- İzleme sayfası bölümün kaynaklarını TEK sorguda çeker; bu indeks o sorgunun indeksi.
CREATE INDEX IF NOT EXISTS episode_sources_episode_idx
  ON public.episode_sources (episode_id, sort_order);

COMMENT ON TABLE public.episode_sources IS
  'Bir bölümün birden çok oynatıcı kaynağı. İzleme sayfası oynatıcının altındaki '
  'çipleri buradan üretir; kaynak yoksa show_episodes.watch_url''e düşer.';

GRANT SELECT ON public.episode_sources TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.episode_sources TO authenticated;
GRANT ALL ON public.episode_sources TO service_role;

ALTER TABLE public.episode_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read episode sources" ON public.episode_sources
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins can insert episode sources" ON public.episode_sources
  FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update episode sources" ON public.episode_sources
  FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete episode sources" ON public.episode_sources
  FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));

-- DOĞRULAMA: tablo boş olmalı, hata vermemeli.
select count(*) as kaynak_sayisi from public.episode_sources;


-- ============================================================
-- 20260928_show_kind.sql
-- ============================================================
-- ============================================================================
--  shows.kind — SERİ / FİLM AYRIMI
--  Tarih: 28.09.2026
--  İstek (kullanıcı): "bu arada filmler eklemek için ayrı yer ekle, seriler
--  değil de filmler diye."
--
--  NEDEN GEREKLİ
--  Panelde her şey tek listede "seri" gibi duruyordu. Film (tek parça içerik)
--  eklenince yine "sezon 1 / bölüm 1" akışına giriyor ve listede dizilerle
--  karışıyordu. Ayrım için şemada bir işaret alanı yoktu.
--
--  GERİYE DÖNÜK UYUMLULUK
--  Varsayılan `series` olduğu için MEVCUT TÜM KAYITLAR seri kalır — hiçbir
--  satır bozulmaz. Kolon eklemek yıkıcı değildir; uygulama kolon yokken de
--  çalışır (`select("*")` kullanıldığı için sorgu hata vermez, panel yalnızca
--  "Seriler" bölümünü gösterir).
--
--  GERİ ALMA (rollback)
--    alter table public.shows drop column if exists kind;
-- ============================================================================

alter table public.shows
  add column if not exists kind text not null default 'series';

comment on column public.shows.kind is
  'Kayıt türü: ''series'' (dizi, sezon/bölüm akışı) veya ''movie'' (tek parça film). Panelde iki ayrı bölümde listelenir.';

-- Değerler serbest metin kalmasın: yazım hatası ("film", "Movie") ikinci bir
-- grup oluşturmasın diye şema seviyesinde kısıtlanır.
do $$
begin
  alter table public.shows
    add constraint shows_kind_check check (kind in ('series', 'movie'));
exception
  when duplicate_object then null;
end $$;

create index if not exists shows_kind_idx on public.shows (kind);


-- ============================================================
-- 20260929_season_mal_id.sql
-- ============================================================
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

-- 20261001_parts (temizlik): patch dosyasındaki eksik buraya eklendi.
-- `parts` hiçbir migration dosyasında yok, eski projede elle açılmış.
-- Sıfırdan kurulumda bu blok olmazsa sezon bölüm aralıkları gelmez.
alter table public.show_seasons
  add column if not exists parts jsonb;

comment on column public.show_seasons.parts is
  'Part kayitlari: [{malId, start, count}]. Katalog paneli yazar/okur.';

