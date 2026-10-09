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
