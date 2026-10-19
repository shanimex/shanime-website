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