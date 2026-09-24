# shanime

Anime keşif sitesi — vitrin (hero), seri detayları, bölüm izleme ve yönetim paneli.

- **Canlı site**: https://shanime.xyz
- **Veritabanı ve görseller**: Supabase (Postgres + Storage)
- **Yayın**: Cloudflare Workers

## Teknolojiler

| Katman | Ne kullanılıyor |
| --- | --- |
| Arayüz | React 19 + TypeScript |
| Çatı (framework) | TanStack Start (SSR — sayfalar sunucuda üretilir) |
| Derleyici | Vite 8 |
| Stil | Tailwind CSS 4 |
| Veri | Supabase (Postgres, Auth, Storage) |
| Yayın hedefi | Cloudflare Workers (Nitro `cloudflare-module`) |
| İkonlar | lucide-react |

## Kurulum

Node.js gerekir (npm ile birlikte gelir).

```sh
npm install
```

`.env` dosyasında Supabase adresi ve publishable anahtarı bulunur. Bu dosya
paylaşılmaz, depoya girmez.

## Komutlar

```sh
npm run dev        # geliştirme sunucusu -> http://localhost:8080
npm run build      # üretim derlemesi (.output/)
npm run preview    # derlemeyi yerelde önizle
npm run lint       # kod denetimi
npm run format     # biçimlendirme
npm run covers:sync   # bölüm kapaklarını sağlayıcıdan çekip dosyaya yazar
npm run sitemap       # public/sitemap.xml üretir
```

## Klasör düzeni

```
public/          Statik dosyalar (logo, yedek görseller, robots.txt, sitemap)
src/
  components/    Arayüz bileşenleri
  routes/        Sayfalar (dosya adı = adres)
  lib/           Veri erişimi ve yardımcılar
  integrations/  Supabase istemcileri
scripts/         Bakım betikleri (kapak senkronu, site haritası)
supabase/        Veritabanı migration'ları ve yapılandırma
docs/            Proje belgeleri
```

## Sayfalar

| Yol | Ne yapar |
| --- | --- |
| `/` | Vitrin (hero slider), seri ızgarası, tür filtresi |
| `/seri/<slug>` | Seri detayı: açıklama, bölümler, karakterler, görseller |
| `/izle/<slug>?b=<no>` | Bölüm oynatıcı ve bölüm gezinme |
| `/admin` | Seri, bölüm, görsel ve reklam yönetimi (giriş gerekir) |
| `/auth` | Yönetici girişi |

## Belgeler

- [Proje yapısı](docs/PROJE-YAPISI.md)
- [Durum raporu](docs/DURUM-RAPORU.md) — yapılan işlerin günlüğü
- [Denetim raporu](docs/DENETIM-RAPORU.md)
- [Logo ve içerik rehberi](docs/LOGO-REHBERI.md) — kod bilmeden içerik değiştirme
