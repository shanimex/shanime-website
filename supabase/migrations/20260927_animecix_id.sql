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
