-- ============================================================
-- shanime — TUM MIGRASYONLAR TEK DOSYA
-- Supabase Dashboard -> SQL Editor -> New query ac,
-- bu dosyanin HEPSINI yapistir ve Run'a bas. SADECE 1 KEZ calistir!
-- (Bu dosya supabase/migrations altindaki 4 dosyanin aynisidir,
--  sirasiyla birlestirilmis halidir. Hangisini kullanirsan kullan,
--  ikisini birden calistirma.)
-- ============================================================
-- >>> migration: 20260918061023_45c4ec3c-c810-4d2c-924b-3f7d13f2f984.sql
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
  ('Jujutsu Kaisen', 'Lanetler, bÃ¼yÃ¼cÃ¼ler ve bÃ¼yÃ¼k bir hesaplaÅŸma', 'seed/poster-cursed.jpg', 1),
  ('Re:Zero', 'BaÅŸka bir dÃ¼nyada sÄ±fÄ±rdan baÅŸlamak', 'seed/poster-zero.jpg', 2),
  ('Mushoku Tensei', 'Ä°kinci bir hayat, sÄ±nÄ±rsÄ±z bir dÃ¼nya', 'seed/poster-mage.jpg', 3),
  ('Erased', 'GeÃ§miÅŸe uzanan karanlÄ±k bir gizem', 'seed/poster-erased.jpg', 4);

insert into public.site_settings (key, value) values ('hero_image', 'seed/hero.jpg');

create policy "Anyone can read site images" on storage.objects for select to anon, authenticated using (bucket_id = 'images');
create policy "Admins can upload site images" on storage.objects for insert to authenticated with check (bucket_id = 'images' and public.has_role(auth.uid(), 'admin'));
create policy "Admins can update site images" on storage.objects for update to authenticated using (bucket_id = 'images' and public.has_role(auth.uid(), 'admin')) with check (bucket_id = 'images' and public.has_role(auth.uid(), 'admin'));
create policy "Admins can delete site images" on storage.objects for delete to authenticated using (bucket_id = 'images' and public.has_role(auth.uid(), 'admin'));

-- >>> migration: 20260918061036_c80d7d6f-d90e-4d4c-a597-fad016fba810.sql
revoke execute on function public.has_role(uuid, public.app_role) from anon, public;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;

-- >>> migration: 20260918061053_069ad4d3-8ab9-4ccf-813a-5a66b6ad8eaa.sql
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

-- >>> migration: 20260918061745_3a2d3c49-5bd4-4935-9553-2b3293ca584d.sql
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
-- 'images' bucket'ini olustur (gorsel yuklemeleri icin gerekli)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('images', 'images', true)
on conflict (id) do update set public = true;

-- ============================================================
-- ADMiN YAPMA ADIMI (BU DOSYADA DEGIL, AYRI calistir):
-- 1) Supabase -> Authentication -> Users -> Add user ile kendi
--    e-posta + sifrenle kullanici olustur.
-- 2) Sonra SQL Editor'de asagidaki satiri kendi e-postanla calistir:
-- insert into public.user_roles (user_id, role)
--   select id, 'admin' from auth.users where email = 'senin@mail.com';
-- ============================================================
