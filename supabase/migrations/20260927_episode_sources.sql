-- ============================================================================
--  episode_sources — bir bölüme BİRDEN FAZLA kaynak
--  Tarih: 27.09.2026  ·  Karar: kullanıcı onayladı ("her bölümün altında kaynak listesi")
-- ============================================================================
--
--  NEDEN GEREKLİ: `show_episodes.watch_url` TEK bir adres tutuyor. Kullanıcı panelde
--  ikinci bir kaynak seçtiğinde birincisi siliniyordu ve şikâyet şuydu:
--  "birden fazla kaynak seçemiyorum; hangilerini seçersem oynatıcının altında o
--  kaynaklar çıksın." Tek kolonla bu mümkün değil — bu yüzden kaynaklar ayrı
--  satırlara taşınıyor.
--
--  İKİ YERDE TUTULUYOR (bilinçli):
--    · `episode_sources` → kaynakların TAM listesi (oynatıcı altındaki çipler).
--    · `show_episodes.watch_url` → mevcut "birincil kaynak" alanı KORUNUR, çünkü
--      site onu zaten okuyor ve izleme sayfası kaynak yoksa ona düşüyor.
--      Yani bu tablo eklenmeden de site çalışmaya devam eder.
--
--  `url` ALANI İKİ TÜR DEĞER TAŞIR (mevcut `watch_url` mantığıyla aynı):
--    · gerçek gömme adresi  → https://anizmplayer.com/video/<hash>
--    · sağlayıcı direktifi  → @megaplay  (adres bölüme özel olmadığı için)
--  Çipin tıklanınca ne yapacağına izleme sayfası bu ayrıma bakarak karar verir.
--
--  NASIL ÇALIŞTIRILIR: Supabase Panel > SQL Editor (publishable anahtarla DDL
--  çalıştırılamaz). Betik idempotenttir; tekrar çalıştırılabilir.
--
--  GERİ ALMA:
--    drop policy if exists "Anyone can read episode sources" on public.episode_sources;
--    drop policy if exists "Admins can insert episode sources" on public.episode_sources;
--    drop policy if exists "Admins can update episode sources" on public.episode_sources;
--    drop policy if exists "Admins can delete episode sources" on public.episode_sources;
--    drop table if exists public.episode_sources;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.episode_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES public.show_episodes(id) ON DELETE CASCADE,
  -- Sağlayıcı kimliği: anizm | animecix | megaplay | videasy | vidsrc | …
  -- (Kaynak listesiyle aynı yazım; tek kaynak `src/lib/embed-sources.ts`.)
  provider text NOT NULL,
  -- Dil: 'tr' (Türkçe altyazı/gömülü) | 'en' (orijinal ses). Çip gruplaması bunu kullanır.
  language text NOT NULL DEFAULT 'tr',
  -- Kullanıcıya görünen kısa ad (ör. "Tau Video").
  label text NOT NULL DEFAULT '',
  -- Gömme adresi ya da '@sağlayıcı' direktifi (yukarıdaki nota bak).
  url text NOT NULL,
  -- Oynatıcı altındaki diziliş sırası (küçük olan önce).
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Aynı bölüme aynı sağlayıcı iki kez eklenmesin: panelde "tekrar yaz" basıldığında
  -- satır çoğalmasın, var olan güncellensin (upsert).
  UNIQUE (episode_id, provider)
);

-- İzleme sayfası bölümün kaynaklarını TEK sorguda çeker; bu indeks o sorgunun indeksi.
CREATE INDEX IF NOT EXISTS episode_sources_episode_idx
  ON public.episode_sources (episode_id, sort_order);

COMMENT ON TABLE public.episode_sources IS
  'Bir bölümün birden çok oynatıcı kaynağı. İzleme sayfası oynatıcının altındaki '
  'çipleri buradan üretir; kaynak yoksa show_episodes.watch_url''e düşer.';

GRANT SELECT ON public.episode_sources TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.episode_sources TO authenticated;
GRANT ALL ON public.episode_sources TO service_role;

ALTER TABLE public.episode_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read episode sources" ON public.episode_sources
  FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Admins can insert episode sources" ON public.episode_sources
  FOR INSERT TO authenticated WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update episode sources" ON public.episode_sources
  FOR UPDATE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete episode sources" ON public.episode_sources
  FOR DELETE TO authenticated USING (private.has_role(auth.uid(), 'admin'::app_role));

-- DOĞRULAMA: tablo boş olmalı, hata vermemeli.
select count(*) as kaynak_sayisi from public.episode_sources;
