-- ============================================================================
-- Eski reklamlı embedleri kaldır (Jujutsu Kaisen)
-- ============================================================================
--
-- NEDEN: `jujutsu-kaisen` dizisinin 24 bölümünün 22'si VidMoly, 2'si Streamtape
-- embed'i kullanıyordu (ölçüm 25.09.2026, `show_episodes`). Bu iki sağlayıcı
-- kendi pop-up / sahte çarpı / agresif reklam katmanlarını gösteriyor.
--
-- NASIL: `watch_url` boşaltılır. Kod, `watch_url` BOŞ olan bölümlerde aktif
-- sağlayıcıya düşer — bkz. `src/lib/embed-provider.ts`:
--   ACTIVE_EMBED_PROVIDER = "vidsrc"  →  https://vidsrc.to/embed/tv/{tmdb}/{sezon}/{bölüm}
--   TMDB eşlemesi: `src/data/mal-tmdb.json` (40748 → 95479)
--
-- KULLANICI DOĞRULAMASI (25.09.2026, gerçek tarayıcı, JJK S1B1):
--   `/embed/tv/95479/1/1` → video OYNADI (1:46 / 23:55); altyazı panelinde
--   "SEARCH BY LANGUAGE → Turkish — Türkçe" seçili ve Türkçe altyazı listelendi.
--   Ayarlar (kalite) menüsü mevcut.
--
-- GERİ ALMA: aşağıdaki yedek tablo sayesinde eski adresler geri yüklenebilir.
-- ============================================================================

-- 1) YEDEK — eski adresler kaybolmasın (idempotent).
create table if not exists public.watch_url_backup_jjk (
  episode_id text primary key,
  watch_url  text,
  backed_up_at timestamptz not null default now()
);

insert into public.watch_url_backup_jjk (episode_id, watch_url)
select e.id::text, e.watch_url
from public.show_episodes e
join public.shows s on s.id = e.show_id
where s.slug = 'jujutsu-kaisen'
on conflict (episode_id)
do update set watch_url = excluded.watch_url, backed_up_at = now();

-- 2) ÖNCE — kaç bölümde eski link var? (beklenen: eski_linkli = 24)
select
  count(*) filter (where coalesce(trim(e.watch_url), '') <> '') as eski_linkli,
  count(*) as toplam_bolum
from public.show_episodes e
join public.shows s on s.id = e.show_id
where s.slug = 'jujutsu-kaisen';

-- 3) TEMİZLE — watch_url boşaltılır, sağlayıcı (vidsrc.to) devreye girer.
update public.show_episodes e
set watch_url = ''
from public.shows s
where s.id = e.show_id
  and s.slug = 'jujutsu-kaisen';

-- 4) SONRA — beklenen: eski_linkli = 0, toplam_bolum = 24
select
  count(*) filter (where coalesce(trim(e.watch_url), '') <> '') as eski_linkli,
  count(*) as toplam_bolum
from public.show_episodes e
join public.shows s on s.id = e.show_id
where s.slug = 'jujutsu-kaisen';

-- 5) KONTROL — mal_id dolu olmalı: boşsa sağlayıcı adres ÜRETEMEZ ve bölümler
--    "video henüz eklenmedi" ekranına düşer.
select slug, mal_id from public.shows where slug = 'jujutsu-kaisen';

-- ---------------------------------------------------------------------------
-- İSTEĞE BAĞLI — dizi bazında sağlayıcı zorlama
--
-- Kod, `watch_url` değeri `@saglayici` biçimindeyse o sağlayıcıyı ZORLAR.
-- (Kayıttaki eski adresi silmeden tek bir dizi için sağlayıcı seçmenin yolu;
--  şema değişikliği gerekmez.)
--
-- Bir diziyi megaplay'e döndürmek için (ör. vidsrc'te bölüm bulunamazsa):
--   update public.show_episodes e
--   set watch_url = '@megaplay'
--   from public.shows s
--   where s.id = e.show_id and s.slug = 're-zero';
--
-- Geri (aktif sağlayıcıya bırak):
--   update public.show_episodes e
--   set watch_url = ''
--   from public.shows s
--   where s.id = e.show_id and s.slug = 're-zero';
-- ---------------------------------------------------------------------------
-- GERİ ALMA (JJK — eski VidMoly/Streamtape adresleri):
--
-- update public.show_episodes e
-- set watch_url = b.watch_url
-- from public.watch_url_backup_jjk b
-- where b.episode_id = e.id::text;
--
-- Yedeği tamamen silmek için:
-- drop table if exists public.watch_url_backup_jjk;
-- ---------------------------------------------------------------------------
