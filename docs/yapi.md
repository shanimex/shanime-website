# shanime — Proje Yapısı (yapi.md)

Bu dosya projenin **klasör yapısını**, **hangi dosyanın ne işe yaradığını** ve
**siteyi nasıl çalıştırıp derleyeceğini** anlatır. Tek "yapı" kaynağı burasıdır
(eski `PROJE-YAPISI.md` bu dosyaya katıldı).

- **Canlı site**: https://shanime.xyz
- **Çatı**: TanStack Start (SSR) + React 19 + Vite 8 + Tailwind 4
- **Veri**: Supabase (Postgres + Auth + Storage)
- **Yayın hedefi**: Cloudflare Pages/Nitro çıktısı → `dist/`

> **KURAL:** `src/routes/` altındaki dosya adları **site adresidir**. Dosyayı
> yeniden adlandırmak URL'yi değiştirir (`izle`/`seri` → 404 + SEO kaybı). Adlandırma
> serbest değildir.

---

## 1. Klasör ağacı (ilk 3 seviye, derleme çıktıları hariç)

```
shanime-react/
├── public/                              ← tarayıcıya doğrudan giden statik dosyalar
│   ├── shanime-logo.png · favicon.ico
│   ├── robots.txt · sitemap.xml
│   └── static/anime-data/<slug>/        ← seriye özel görseller (klasör adı = slug)
│
├── src/                                 ← TÜM KOD
│   ├── routes/                          ← SAYFALAR (dosya adı = adres)
│   ├── components/
│   │   ├── site/                        ← siteye bakan bileşenler
│   │   ├── admin/                       ← yönetim paneli bileşenleri
│   │   └── ui/                          ← temel UI (button)
│   ├── lib/                             ← veri erişimi + yardımcılar
│   ├── integrations/supabase/           ← Supabase istemcileri + tipler
│   ├── data/                            ← derleme zamanında gömülen JSON verileri
│   ├── styles.css                       ← tüm renkler/fontlar/animasyonlar
│   ├── router.tsx · server.ts · start.ts
│   └── routeTree.gen.ts                 ← OTOMATİK (elle düzenleme!)
│
├── scripts/                             ← bakım betikleri (node)
│
├── supabase/
│   ├── migrations/                      ← şema geçmişi (SQL)
│   ├── config.toml
│   ├── setup-fresh.sql                  ← sıfırdan kurulum anlık görüntüsü (+ patch notu)
│   └── patch-missing-columns.sql        ← migrations'da olmayan `parts` eki
│
├── docs/
│   ├── yapi.md                          ← bu dosya
│   ├── arastirma/                       ← sağlayıcı/site araştırma kayıtları
│   ├── plan/                            ← planlar, yol haritaları
│   ├── durum/                           ← durum + denetim raporları
│   └── rehber/                          ← "neyi nereden değiştiririm" rehberleri
│
├── package.json · tsconfig.json · vite.config.ts · eslint.config.js
├── README.md · .env (GİZLİ — paylaşma)
└── (dist/ · node_modules/ · .wrangler/ · .tanstack/ · supabase/.temp/ → .gitignore'da)
```

### Dokunulmaması gerekenler (otomatik üretilir)

| Dosya | Neden |
| --- | --- |
| `src/routeTree.gen.ts` | Rotalardan otomatik üretilir (elle değişiklik kaybolur) |
| `src/integrations/supabase/types.ts` | Veritabanı şemasından üretilir |
| `dist/` · `.wrangler/` · `.tanstack/` · `supabase/.temp/` | Derleme/araç çıktısı, `.gitignore`'da |

---

## 2. Çalıştırma ve derleme

```bash
npm install          # ilk kurulum (bir kez)
npm run dev          # geliştirme sunucusu → http://localhost:8080
npm run build        # üretim derlemesi → dist/
npm run preview      # derlemeyi yerelde önizle
npm run lint         # ESLint
npm run format       # Prettier
npm run sitemap      # public/sitemap.xml'i serilere göre yeniden üret
npx tsc --noEmit     # tip kontrolü
```

- **Port**: `8080` (`vite.config.ts` → `server.port`, `strictPort: true`). Port doluysa
  sunucu başka porta kaymaz, hata verir.
- **Ağ**: `host: true` → aynı ağdaki başka cihazdan da açılabilir.
- **Ortam**: `.env` içinde Supabase adresi ve publishable anahtarı bulunur; depoya girmez.

---

## 3. "Nerede ne var" — Site rotaları (URL'ler)

`src/routes/` altındaki **her** dosya bir adres (URL) tanımlar. Aşağıdaki tablo
o klasördeki tüm rotaları listeler. Dosya adı tekniktir (`izle.$slug.tsx` gibi);
her rota dosyasının **ilk satırına** o dosyanın hangi adresi karşıladığını ve
izleyiciye ne sunduğunu anlatan tek satırlık bir yorum eklendi — dosyayı açan
kişi adı çözümlemek zorunda kalmadan ne olduğunu görür.

| Dosya | URL | Ne yapar |
| --- | --- | --- |
| `src/routes/__root.tsx` | (URL yok — tüm sayfaları sarar) | Üst iskelet: `<html>`, fontlar, header/footer, dil değiştirici, 404 ve hata ekranı |
| `src/routes/index.tsx` | `/` | Ana sayfa: vitrin (hero) bandı, TOP TRENDING paneli, seri ızgarası, tür filtresi |
| `src/routes/seri.$slug.tsx` | `/seri/<dizi-adı>` | Seri detayı: künye, sezon/bölüm listesi, benzer seriler |
| `src/routes/izle.$slug.tsx` | `/izle/<dizi-adı>?sezon=&b=&kaynak=` | İzleme sayfası: oynatıcı, kaynak kutuları, bölüm gezinme, kaldığın yerden devam |
| `src/routes/admin.tsx` | `/admin` | Yönetim paneli (giriş gerekir): seri/bölüm/görsel/reklam yönetimi |
| `src/routes/auth.tsx` | `/auth` | Yönetici giriş / kayıt ekranı |
| `src/routes/api.anizm.ts` | `/api/anizm` | Sunucu rotası: anizm/puffytr zincirinden bölüm oynatıcı adresini çözer |
| `src/routes/api.animecix.ts` | `/api/animecix` | Sunucu rotası: animecix'te seri arar, bölüm kaynağını (TauVideo) çözer |

> `docs/ROUTES.md` yalnızca TanStack Start'ın dosya
> tabanlı yönlendirme kurallarını anlatan nottur (hiçbir adres üretmez;
> eskiden `src/routes/README.md` idi, 2026-10-01'de taşındı).

## 4. "Nerede ne var" — Bileşenler

**Site bileşenleri — `src/components/site/`**

| Dosya | Ne yapar |
| --- | --- |
| `AdSlot.tsx` | Reklam slotları (`AD_SLOTS`, `useAdCode`) |
| `AdsterraUnit.tsx` | Adsterra reklam birimleri (leaderboard / native) |
| `EpisodeCover.tsx` | Bölüm kapağı (görsel + yedek üretim) |
| `FaSolid.tsx` | Font Awesome ikon seti (`FaSolid`, `FaSolidName`) |
| `FluidPlayer.tsx` | Video oynatıcı sarmalayıcı (Fluid Player) |
| `LanguageToggle.tsx` | TR/EN dil değiştirici |
| `PrerollGate.tsx` | Ön gösterim (reklam) kapısı |

**Panel bileşenleri — `src/components/admin/`**

| Dosya | Ne yapar |
| --- | --- |
| `AddShowButton.tsx` | "Yeni seri ekle" formu |
| `ShowRow.tsx` | Panel listesindeki tek seri satırı |
| `ShowEditor.tsx` | Açılmış seri formu (vitrin anahtarı, kapak, banner burada) |
| `SeasonsPanel.tsx` | Sezon + bölüm yönetimi (sayfalı liste) |
| `AnizipSyncPanel.tsx` | ani.zip'ten bölüm/kapak senkronu paneli |
| `DataHealthPanel.tsx` | İçerik sağlığı uyarıları |
| `ImageDrop.tsx` | Sürükle-bırak görsel yükleme |
| `ToastHost.tsx` | Panel bildirimleri (`AdminToaster`) |

**Temel UI — `src/components/ui/`**

| Dosya | Ne yapar |
| --- | --- |
| `button.tsx` | Ortak buton bileşeni (`Button`) |

## 5. "Nerede ne var" — Yardımcılar (`src/lib/`)

| Dosya | Ne yapar |
| --- | --- |
| `content.ts` | ★ **Veritabanı erişimi**: tüm okuma/yazma sorguları burada toplanır |
| `admin.ts` | Panel yardımcıları: `db`, `slugify`, `uniqueSlug`, `moveAndPersist`, `checkSchema` |
| `admin-toast.ts` | Panel toast deposu (`toast`, `subscribeToasts`) |
| `admin-anizip.ts` | ani.zip panel senkron yardımcıları |
| `ad-defaults.ts` | Reklam varsayılanları (`ADSTERRA_*`, `defaultAdSource`) |
| `anizm.ts` | anizm oynatıcı adresi ve bölüm sayımı |
| `anizip-covers.ts` | ani.zip kapak/TVDB eşlemesi (`anizipCover`, `tmdbIdForMal`) |
| `content-health.ts` | İçerik sağlık kontrolleri (`scripts/audit-content.mjs` ile aynı mantık) |
| `embed-provider.ts` | Sağlayıcı şablonları (`EMBED_PROVIDERS`) |
| `embed-sources.ts` | Kaynak grupları listesi (`SOURCE_GROUPS`) — **tek kaynak** |
| `episode-sources.ts` | `episode_sources` erişimi (`fetchSourcesForEpisodes`, `replaceEpisodeSources`) |
| `error-capture.ts` | Sunucu hata yakalama (`consumeLastCapturedError`) |
| `error-page.ts` | Okunur 500 sayfası (`renderErrorPage`) |
| `i18n.ts` | TR/EN dil katmanı (`useLang`, `t`, `plural`, `useDocumentTitle`) |
| `mybid.ts` | Reklam VAST adresleri (`prerollVastUrls`) |
| `puffy.ts` | puffytr slug/hash zinciri (`puffySlugFor`, `ANIZM_PLAYER_RE`) |
| `query-client.ts` | React Query istemcisi + tazelik (`createQueryClient`, `QUERY_STALE_MS`) |
| `server-cache.ts` | Sunucu tarafı TTL önbelleği (`cachedRead`, `TTL_*`) |
| `site-settings.ts` | Site ayarları okuma (`fetchSiteSettings`, `siteSettingsQueryOptions`) |
| `skip-times.ts` | AniSkip intro/outro atlama (`fetchSkipTimes`, `formatSkipTime`) |
| `utils.ts` | `cn()` sınıf birleştirici |
| `vast.ts` | VAST reklam çözümleme (`fetchVastAds`, `fireBeacons`) |
| `watch-progress.ts` | İzleme ilerlemesi (`getWatched`, `markWatched`, `savePosition`, `getResumeFrame`) |

**Gömülü veri — `src/data/`** (derleme zamanında koda gömülür)

| Dosya | Ne yapar |
| --- | --- |
| `anizm-hashes.json` | anizm → bölüm hash tablosu (ürün: `scripts/resolve-anizm-hashes.mjs`) |
| `episode-thumbs.json` | Bölüm 16:9 görselleri (ürün: `scripts/sync-anizip-covers.mjs`) |
| `mal-tmdb.json` | MAL → TMDB kimlik eşlemesi |

## 6. Kaynak çözüm rotaları (`/api/*`)

| Rota | Dosya | Görev |
| --- | --- | --- |
| `/api/anizm` | `src/routes/api.anizm.ts` | İzleme isteğinde anizm/puffytr zincirini çözüp oynatıcı adresini döndürür |
| `/api/animecix` | `src/routes/api.animecix.ts` | Animecix (TauVideo) üzerinde arama + bölüm kaynağı çözümü |

Bu iki rota, `src/lib/anizm.ts`, `src/lib/puffy.ts` ve `src/lib/embed-provider.ts`
yardımcılarını kullanır.

## 7. Veritabanı — Supabase

**Tablolar**

| Tablo | Ne tutar |
| --- | --- |
| `shows` | Seriler (slug, başlık, açıklama, kapak/banner, `is_featured`, `animecix_id`, …) |
| `show_seasons` | Sezon kayıtları |
| `show_episodes` | Bölümler (numara, sezon, video adresi, `thumbnail_path`) |
| `show_characters` | Seri karakterleri |
| `show_images` | Seri görselleri |
| `episode_sources` | Bir bölüme ait **birden fazla** kaynak (kaynak adı + adres) |
| `site_settings` | Reklam kodları ve diğer site ayarları |
| `user_roles` | Yönetici rolleri (`app_role` enum: `admin`, `user`) |

Ek nesneler: `show_stats` görünümü (view), `has_role()` ve `update_updated_at_column()`
fonksiyonları, `images` Storage bucket'ı.

**Migration'lar — `supabase/migrations/`** (yeniden eskiye)

| Dosya | İçerik |
| --- | --- |
| `20260918061023_45c4ec3c-….sql` | `app_role` enum, `user_roles`, `shows`, `site_settings` + RLS |
| `20260918061036_c80d7d6f-….sql` | `has_role()` yetkileri |
| `20260918061053_069ad4d3-….sql` | Eski policy'lerin temizliği |
| `20260918061745_3a2d3c49-….sql` | `show_episodes`, `show_characters`, `show_images`, `slug`, `update_updated_at_column` trigger |
| `20260923_seasons_banner_content.sql` | `show_seasons` + `season` kolonu + `banner_image_path` |
| `20260924_featured_and_stats.sql` | `shows.is_featured` + `show_stats` görünümü |
| `20260925_show_banner_video.sql` | `shows.banner_video_path` |
| `20260926_episode_thumbnails.sql` | `show_episodes.thumbnail_path` |
| `20260927_animecix_id.sql` | `shows.animecix_id` |
| `20260927_episode_sources.sql` | `episode_sources` tablosu + RLS |

Yeni şema değişikliği: `supabase/migrations/` içine yeni `.sql` yaz → Supabase SQL
Editor'de çalıştır.

## 8. Betikler (`scripts/`)

| Betik | Ne yapar | Nasıl çalıştırılır |
| --- | --- | --- |
| `generate-sitemap.mjs` | `public/sitemap.xml` üretir | `npm run sitemap` |
| `sync-anizip-covers.mjs` | ani.zip'ten bölüm görselleri → `episode-thumbs.json`, `mal-tmdb.json` | `node scripts/sync-anizip-covers.mjs` |
| `resolve-anizm-hashes.mjs` | Bölüm → hash çözücü (puffytr zinciri) | `node scripts/resolve-anizm-hashes.mjs --slug <slug>` |
| `audit-content.mjs` | İçerik sağlığı CLI raporu | `node scripts/audit-content.mjs` |

## 9. "Şunu yapmak istiyorum" → nereye bakacağım

| Yapmak istediğim | Yer |
| --- | --- |
| Ana sayfa vitrinine anime eklemek | Panel → Seriler → **Düzenle** → "Vitrin'e ekle" |
| Yeni anime eklemek | Panel → **Yeni seri ekle** |
| Sezon / bölüm eklemek, silmek, sıralamak | Panel → Seriler → **Düzenle** → Sezonlar ve bölümler |
| Vitrin (16:9) görselini / kapağı değiştirmek | Panel → Düzenle → **Vitrin Banner'ı** / **Dikey Kapak** |
| Reklam kodları | Panel → **Reklam kodları** |
| Site logosu / favicon | `public/shanime-logo.png` · `public/favicon.ico` |
| **Renkler, fontlar, animasyonlar** | `src/styles.css` |
| Sayfa başlığı / açıklaması (SEO) | İlgili sayfa dosyasındaki `head()` bloğu |
| Arama motoru kuralları / sitemap | `public/robots.txt` · `npm run sitemap` |
| Veritabanı sorgusu değiştirmek | `src/lib/content.ts` |
| Veritabanı şeması değiştirmek | `supabase/migrations/` içine yeni `.sql` |
| Yeni sayfa eklemek | `src/routes/` içine yeni dosya (ör. `iletisim.tsx` → `/iletisim`) |
