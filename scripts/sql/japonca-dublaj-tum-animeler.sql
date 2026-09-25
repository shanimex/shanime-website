-- ============================================================================
-- BÜTÜN ANİMELERİ ORİJİNAL JAPONCA SESLE (sub sürümü) yayınla
-- ============================================================================
--
-- SORUN: vidsrc.to animeyi TMDB dizi kimliğiyle veriyor ve ses/dublaj seçici
-- sunmuyor; diziyi İngilizce dublaj olarak çalıyor (Jujutsu Kaisen ve Re:Zero'da
-- gözlendi). vidsrc oynatıcısında `Subtitles` ve `Options` sekmeleri var, ses
-- sekmesi YOK — yani URL'den ya da ayardan değiştirilemiyor.
--
-- ÇÖZÜM: bölümleri megaplay'e al. megaplay şablonu `/stream/mal/{mal}/{bölüm}/{dil}`
-- ve kod `dil = "sub"` gönderiyor. "sub" sürümü = **orijinal Japonca ses +
-- gömülü altyazı**. (iframe ölçümü 25.09.2026: JJK ve Re:Zero'da video oynadı,
-- altyazı ekranda göründü, CC + ayarlar simgeleri vardı, katman reklam yok.)
--
-- NASIL: `watch_url` alanına `@megaplay` yazılır. Kod bu değeri görünce o
-- sağlayıcıyı ZORLAR (bkz. `src/lib/embed-provider.ts` → `resolveEpisodeEmbed`).
-- Şema değişikliği gerekmez, geri alması tek `update`.
--
-- ⚠️ TAKAS: megaplay'in altyazı menüsünde **Türkçe olup olmadığı doğrulanamadı**
-- (oynatıcı cross-origin; menüsü otomatik tıklanamıyor, altyazı listesi çalışma
-- anında kaynaktan geliyor). Türkçe altyazı senin için öncelikliyse bu dosyayı
-- ÇALIŞTIRMA — vidsrc.to Türkçe altyazı veriyor ama İngilizce dublaj veriyor.
-- İkisi aynı anda hiçbir sağlayıcıda yok.
--
-- GERİ ALMA: yedek tablo sayesinde eski hâle dönülebilir.
-- ============================================================================

-- 1) YEDEK — bütün bölümlerin mevcut watch_url değeri (idempotent).
create table if not exists public.watch_url_backup_all (
  episode_id text primary key,
  watch_url  text,
  backed_up_at timestamptz not null default now()
);

insert into public.watch_url_backup_all (episode_id, watch_url)
select e.id::text, e.watch_url
from public.show_episodes e
on conflict (episode_id)
do update set watch_url = excluded.watch_url, backed_up_at = now();

-- 2) ÖNCE — dizi başına mevcut durum.
select
  s.slug,
  count(*) as bolum,
  count(*) filter (where coalesce(trim(e.watch_url), '') = '') as saglayiciya_birakilmis,
  count(*) filter (where e.watch_url = '@megaplay') as megaplay_zorlanmis
from public.show_episodes e
join public.shows s on s.id = e.show_id
group by s.slug
order by s.slug;

-- 3) UYGULA — mal_id dolu bütün dizilerin bölümleri Japonca ses (sub) sürümüne.
update public.show_episodes e
set watch_url = '@megaplay'
from public.shows s
where s.id = e.show_id
  and s.mal_id is not null;

-- 4) SONRA — beklenen: her dizide megaplay_zorlanmis = bolum.
select
  s.slug,
  count(*) as bolum,
  count(*) filter (where e.watch_url = '@megaplay') as megaplay_zorlanmis
from public.show_episodes e
join public.shows s on s.id = e.show_id
group by s.slug
order by s.slug;

-- 5) KONTROL — mal_id dolu mu? Boşsa megaplay adres ÜRETEMEZ.
select slug, mal_id from public.shows order by slug;

-- ---------------------------------------------------------------------------
-- TEK BİR DİZİYİ vidsrc.to'ya (Türkçe altyazı) geri almak için:
--
--   update public.show_episodes e
--   set watch_url = ''
--   from public.shows s
--   where s.id = e.show_id and s.slug = 'jujutsu-kaisen';
--
-- GERİ ALMA (tamamen):
--
--   update public.show_episodes e
--   set watch_url = b.watch_url
--   from public.watch_url_backup_all b
--   where b.episode_id = e.id::text;
--
--   drop table if exists public.watch_url_backup_all;
-- ---------------------------------------------------------------------------
