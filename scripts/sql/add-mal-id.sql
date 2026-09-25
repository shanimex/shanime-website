-- ============================================================================
--  mal_id kolonu + doğrulanmış kimlikler
--  Tarih: 25.09.2026   ·  Onay: kullanıcı onayladı (PLAYER-MIMARI-PLANI §6.1)
-- ============================================================================
--
--  NEDEN: `shows` tablosunda MAL/AniList/TMDB kimliği tutan HİÇBİR kolon yoktu
--  (canlı şema: banner_image_path, banner_video_path, created_at, description,
--  genre, id, image_path, is_featured, slug, sort_order, subtitle, title,
--  watch_url, year). Embed sağlayıcıları bu kimliğe ihtiyaç duyuyor.
--
--  NASIL ÇALIŞTIRILIR: Bu depodaki uygulama anahtarı yalnızca "publishable"
--  anahtardır ve PostgREST üzerinden DDL çalıştırılamaz. Bu yüzden betiği
--  Supabase Panel > SQL Editor içinde çalıştır.
--
--  GÜVENLİK: Idempotent (IF NOT EXISTS / koşullu UPDATE). Tekrar çalıştırılabilir.
--  GERİ ALMA:
--    drop index if exists public.shows_mal_id_key;
--    alter table public.shows drop column if exists mal_id;
-- ============================================================================

begin;

-- 1) Kolon -------------------------------------------------------------------
alter table public.shows
  add column if not exists mal_id integer;

comment on column public.shows.mal_id is
  'MyAnimeList kimliği. AniList GraphQL idMal alanıyla doğrulandı (25.09.2026). '
  'Embed adresi üretiminde kullanılır; NULL ise sağlayıcı adres ÜRETEMEZ.';

-- Aynı MAL kimliği iki diziye bağlanmasın (NULL'lar serbest).
create unique index if not exists shows_mal_id_key
  on public.shows (mal_id)
  where mal_id is not null;

-- 2) Doğrulanmış kimlikler ----------------------------------------------------
-- Kaynak: POST https://graphql.anilist.co
--         query { Media(search:"<başlık>", type: ANIME) { idMal title { romaji } episodes } }
--
-- | Sitedeki dizi              | idMal | Bölüm (kaynak) | DB'deki bölüm |
-- |----------------------------|-------|----------------|---------------|
-- | Jujutsu Kaisen             | 40748 | 24             | 24  (birebir) |
-- | Re:Zero                    | 31240 | 25             | ?             |
-- | Mushoku Tensei             | 39535 | 11             | ?             |
-- | Erased                     | 31043 | 12             | ?             |

update public.shows set mal_id = 40748
  where slug = 'jujutsu-kaisen'   and (mal_id is null or mal_id <> 40748);

update public.shows set mal_id = 31240
  where slug like 're-zero%'      and (mal_id is null or mal_id <> 31240);

update public.shows set mal_id = 39535
  where slug like 'mushoku-tensei%' and (mal_id is null or mal_id <> 39535);

update public.shows set mal_id = 31043
  where slug like 'erased%'       and (mal_id is null or mal_id <> 31043);

commit;

-- 3) DOĞRULAMA ---------------------------------------------------------------
-- Beklenen: 4 satır, mal_id dolu, NULL yok.
select slug, title, mal_id,
       case when mal_id is null then 'EKSIK' else 'OK' end as durum
  from public.shows
 order by mal_id nulls last;
