-- ============================================================================
--  Diğer 3 dizinin BÖLÜM KAYITLARINI oluştur (watch_url BOŞ → megaplay üretir)
--  Tarih: 25.09.2026
-- ============================================================================
--
--  SORUN: `shows` tablosunda 4 dizi var ama yalnızca Jujutsu Kaisen'in bölümleri
--  var. Canlı ölçüm:
--      jujutsu-kaisen  mal_id=40748  bolum=24
--      re-zero         mal_id=31240  bolum=0
--      mushoku-tensei  mal_id=39535  bolum=0
--      erased          mal_id=31043  bolum=0
--  Bölüm kaydı olmadığı için bu 3 dizi "yüklenmiyor" — oynatılacak bölüm yok.
--
--  ÇÖZÜM: Bölüm satırlarını oluştur ve `watch_url`'i BOŞ bırak. Boş bırakılınca
--  `resolveEpisodeEmbed` (src/lib/embed-provider.ts) devreye girer ve adresi
--  aktif sağlayıcıdan üretir:
--      https://megaplay.buzz/stream/mal/{mal_id}/{bölüm}/sub
--
--  ✅ megaplay bu 3 dizide ÇALIŞIYOR (25.09.2026, iframe içinde doğrulandı):
--     31240, 39535, 31043 → gerçek oynatıcı + akan video + altyazı.
--
--  BÖLÜM SAYILARI: kaynak AniList `Media(…){episodes}` alanı.
--      Re:Zero 31240 = 25   ·   Mushoku Tensei 39535 = 11   ·   Erased 31043 = 12
--
--  NASIL ÇALIŞTIRILIR: Supabase Panel → SQL Editor.
--  (Bu depodaki publishable anahtarla yazma denendi → HTTP 401, RLS engelliyor.)
--
--  GÜVENLİK: Idempotent — `not exists` koşulu sayesinde tekrar çalıştırılabilir,
--  mevcut satırları çoğaltmaz.
--
--  GERİ ALMA (dikkat: o dizilerin TÜM bölümlerini siler):
--     delete from public.show_episodes e
--      using public.shows s
--      where e.show_id = s.id and s.slug in ('re-zero','mushoku-tensei','erased');
--
--  NOT: Başlıklar "N. Bölüm" olarak yazılır. Gerçek bölüm adlarını yönetim
--  panelinden veya sonradan bir UPDATE ile girebilirsin (mevcut JJK kayıtlarında
--  gerçek Türkçe adlar var, ör. "Ryomen Sukuna").
-- ============================================================================

begin;

-- Re:Zero (mal_id 31240) — 25 bölüm
insert into public.show_episodes (show_id, season, number, title, summary, duration, watch_url)
select s.id, 1, n, n || '. Bölüm', '', '', ''
  from public.shows s
  cross join generate_series(1, 25) as n
 where s.slug = 're-zero'
   and not exists (
     select 1 from public.show_episodes e
      where e.show_id = s.id and e.season = 1 and e.number = n
   );

-- Mushoku Tensei (mal_id 39535) — 11 bölüm
insert into public.show_episodes (show_id, season, number, title, summary, duration, watch_url)
select s.id, 1, n, n || '. Bölüm', '', '', ''
  from public.shows s
  cross join generate_series(1, 11) as n
 where s.slug = 'mushoku-tensei'
   and not exists (
     select 1 from public.show_episodes e
      where e.show_id = s.id and e.season = 1 and e.number = n
   );

-- Erased (mal_id 31043) — 12 bölüm
insert into public.show_episodes (show_id, season, number, title, summary, duration, watch_url)
select s.id, 1, n, n || '. Bölüm', '', '', ''
  from public.shows s
  cross join generate_series(1, 12) as n
 where s.slug = 'erased'
   and not exists (
     select 1 from public.show_episodes e
      where e.show_id = s.id and e.season = 1 and e.number = n
   );

commit;

-- ============================================================================
--  DOĞRULAMA — beklenen: jujutsu-kaisen 24, re-zero 25, mushoku-tensei 11, erased 12
-- ============================================================================
select s.slug,
       s.mal_id,
       count(e.id)                        as bolum_sayisi,
       count(e.id) filter (where coalesce(e.watch_url,'') = '') as saglayicidan_gelecek
  from public.shows s
  left join public.show_episodes e on e.show_id = s.id
 group by s.slug, s.mal_id
 order by s.slug;
