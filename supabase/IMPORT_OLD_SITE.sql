-- ============================================================
-- shanime — ESKİ SİTE İÇERİĞİNİ AKTARMA
-- Supabase -> SQL Editor -> New query -> HEPSINI yapistir -> Run
-- Ne yapar:
--   1) Demo animeleri siler (görselleri olmayan seed kayıtları)
--   2) Eski sitedeki 4 animeyi ekler (kapaklar siteden servis edilir)
--   3) Jujutsu Kaisen'in 3 bölümünü (VidMoly linkleri) ekler
--   4) Ana sayfa hero görselini eski siteden alır
-- Tekrar çalıştırmak ZARAR VERMEZ (mevcutları günceller/boş geçer).
-- ============================================================

-- 1) Demo kayitlarini temizle
delete from public.shows where image_path like 'seed/%';

-- 2) Eski sitedeki 4 anime (kapaklar sitenin kendi dosyalarindan gelir)
insert into public.shows (slug, title, subtitle, description, year, genre, image_path, sort_order) values
  ('re-zero', 'Re:Zero', 'Re:Zero kara Hajimeru Isekai Seikatsu',
   'Öldükçe aynı güne dönen Subaru, fantezi dünyada sevdiklerini kurtarmak için çırpınır. Her ölümünde anısını koruyan tek kişi olarak, zaman döngüsünün içindeki acı gerçeği çözmelidir.',
   '2016', 'Başka Dünya, Drama, Psikolojik, Fantastik, Gerilim', 'static/anime-data/re-zero/anime-cover.jpg', 1),
  ('mushoku-tensei', 'Mushoku Tensei: Jobless Reincarnation', 'Mushoku Tensei: Isekai Ittara Honki Dasu',
   'İşsiz, umutsuz bir adam trafik kazasında ölür ve büyü dünyasında bebek olarak yeniden doğar. Rudeus Greyrat olarak yeni hayatında tüm hatalarını telafi etmeye ve ailesini korumaya kararlıdır.',
   '2021', 'Başka Dünya, Drama, Aksiyon, Macera, Fantastik', 'static/anime-data/mushoku-tensei/anime-cover.jpg', 2),
  ('jujutsu-kaisen', 'Jujutsu Kaisen', 'Jujutsu Kaisen',
   'Lanetli enerjiyle örülü bir dünyada, genç bir büyücü her savaştan sonra kendine biraz daha yaklaşır.',
   '2020', 'Aksiyon, Shounen, Korku, Doğaüstü, Fantastik', 'static/anime-data/jujutsu-kaisen/anime-cover.jpg', 3),
  ('erased', 'Erased', 'Boku dake ga Inai Machi',
   'Hayatın zorluklarıyla cebelleşen manga yazarı Satoru Fujinuma, kendisini ifade edememe korkusuyla yüzleşmektedir. Ölüm ve faciaları engellemeye zorlayan doğaüstü bir yeteneği vardır. Bir gün kendisini katil durumuna düşüren bir kazaya karışır ve 18 yıl geriye, çocukluğuna gönderilir.',
   '2016', 'Drama, Psikolojik, Gerilim', 'static/anime-data/erased/anime-cover.jpg', 4)
on conflict (slug) do update set
  title = excluded.title,
  subtitle = excluded.subtitle,
  description = excluded.description,
  year = excluded.year,
  genre = excluded.genre,
  image_path = excluded.image_path,
  sort_order = excluded.sort_order;

-- 3) Jujutsu Kaisen bölümleri (VidMoly embed linkleri)
insert into public.show_episodes (show_id, number, title, summary, duration, watch_url)
select s.id, e.number, e.title, '', '', e.watch_url
from (values
  (1, 'Ryomen Sukuna', 'https://vidmoly.org/embed-xtmrwbl4x9sh.html'),
  (2, 'Kendim İçin', 'https://vidmoly.org/embed-u7vkfjv0jtr8.html'),
  (3, 'Çelik Kız', 'https://vidmoly.org/embed-rc9g6bn33hiz.html')
) as e(number, title, watch_url)
join public.shows s on s.slug = 'jujutsu-kaisen'
where not exists (
  select 1 from public.show_episodes se
  where se.show_id = s.id and se.number = e.number
);

-- 4) Ana sayfa hero görseli (eski sitedeki Jujutsu header'ı)
insert into public.site_settings (key, value)
values ('hero_image', 'static/anime-data/jujutsu-kaisen/anime-header.jpg')
on conflict (key) do update set value = excluded.value;

-- 5) KONTROL: asagida 4 anime + 3 bölüm gormelisin
select slug, title, year from public.shows order by sort_order;
select se.number, se.title, s.slug from public.show_episodes se
join public.shows s on s.id = se.show_id order by s.slug, se.number;
