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