-- ============================================================================
-- Jujutsu Kaisen: eski reklamlı embedleri (VidMoly / Streamtape) KALDIR
-- ============================================================================
--
-- NEDEN: `jujutsu-kaisen` dizisinin 24 bölümünün 22'si VidMoly, 2'si Streamtape
-- embed'i kullanıyordu (ölçüm 25.09.2026, `show_episodes` tablosu). Bu iki
-- sağlayıcı kendi pop-up / sahte çarpı / agresif reklam katmanlarını gösteriyor ve
-- kullanıcı bunların tamamen kaldırılmasını istedi.
--
-- NASIL: `watch_url` boşaltılır. Kod, `watch_url` BOŞ olan bölümlerde aktif
-- sağlayıcıya (megaplay) düşer — bkz. `src/lib/embed-provider.ts`,
-- `resolveEpisodeEmbed`: önce `watch_url`, boşsa sağlayıcı.
--
-- DOĞRULAMA (25.09.2026, iframe bağlamı — top-level DEĞİL):
--   megaplay `/stream/mal/40748/1/sub`   → GERÇEK oynatıcı, video oynadı
--   megaplay `/stream/ani/113415/1/sub`  → GERÇEK oynatıcı, video oynadı
--   Kontrol: 31240 (Re:Zero)            → GERÇEK oynatıcı, video oynadı
--   Üçünde de: CC (altyazı) + ayarlar (kalite) simgeleri var, katman reklam yok.
--
-- ⚠️ ÖNEMLİ ÖLÇÜM TUZAĞI: aynı megaplay adresini TARAYICIDA SEKME OLARAK açmak
-- "Error Code: 410 — removed due a copyright violation" sayfası verir. Bu,
-- doğrudan (top-level) erişim korumasıdır; site embed'i (iframe) etkilemez.
-- 410'u görüp "megaplay'de JJK yok" sonucu çıkarmak YANLIŞ olur.
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

-- 2) ÖNCE — kaç bölümde eski link var? (beklenen: 24)
select
  count(*) filter (where coalesce(trim(e.watch_url), '') <> '') as eski_linkli,
  count(*) as toplam_bolum
from public.show_episodes e
join public.shows s on s.id = e.show_id
where s.slug = 'jujutsu-kaisen';

-- 3) TEMİZLE — watch_url boşaltılır, sağlayıcı (megaplay) devreye girer.
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

-- 5) KONTROL — dizi mal_id dolu mu? Boşsa sağlayıcı adres ÜRETEMEZ ve bölümler
--    "video henüz eklenmedi" ekranına düşer.
select slug, mal_id from public.shows where slug = 'jujutsu-kaisen';

-- ---------------------------------------------------------------------------
-- GERİ ALMA (gerekirse bu bloğu çalıştır):
--
-- update public.show_episodes e
-- set watch_url = b.watch_url
-- from public.watch_url_backup_jjk b
-- where b.episode_id = e.id::text;
--
-- Yedeği tamamen silmek için:
-- drop table if exists public.watch_url_backup_jjk;
-- ---------------------------------------------------------------------------
