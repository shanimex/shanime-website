# shanime

Anime keşif sitesi — vitrin (hero), seri detayları, bölüm izleme ve yönetim paneli.

- **Canlı site**: https://shanime.xyz
- **Veritabanı ve görseller**: Supabase (Postgres + Storage)
- **Yayın**: Cloudflare Pages

## Teknolojiler

| Katman           | Ne kullanılıyor                                      |
| ---------------- | ---------------------------------------------------- |
| Arayüz           | React 19 + TypeScript                                |
| Çatı (framework) | TanStack Start (SSR — sayfalar sunucuda üretilir)    |
| Derleyici        | Vite 8                                               |
| Stil             | Tailwind CSS 4                                       |
| Veri             | Supabase (Postgres, Auth, Storage)                   |
| Yayın hedefi     | Cloudflare Pages (Nitro `cloudflare-pages`, `dist/`) |
| İkonlar          | lucide-react                                         |

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
npm run build      # üretim derlemesi -> dist/
npm run preview    # derlemeyi yerelde önizle
npm run lint       # kod denetimi
npm run format     # biçimlendirme
npm run covers:all    # tüm bölüm kapaklarını sağlayıcılardan senkronlar
npm run covers:r2     # mevcut kapakları R2'ye taşır
npm run sitemap       # public/sitemap.xml üretir
```

## Klasör düzeni

```
public/                 Statik dosyalar (logo, yedek görseller, robots.txt, sitemap)
src/
  components/site/      Siteye bakan bileşenler
  components/admin/     Yönetim paneli bileşenleri
  components/ui/        Temel UI (button)
  routes/               Sayfalar (dosya adı = adres)
  lib/                  Veri erişimi ve yardımcılar
  integrations/         Supabase istemcileri
scripts/                Bakım betikleri (kapak senkronu, site haritası)
supabase/               Veritabanı migration'ları ve yapılandırma
docs/                   Proje belgeleri (yapi.md + arastirma/plan/durum/rehber)
```

## Sayfalar

| Yol                                               | Ne yapar                                               |
| ------------------------------------------------- | ------------------------------------------------------ |
| `/`                                               | Vitrin (hero slider) ve ana keşif akışı                |
| `/animes`                                         | Tüm seriler, arama ve filtreleme                       |
| `/schedule`                                       | Yayın takvimi                                          |
| `/anime/<slug>`                                   | Seri detayı: açıklama, sezonlar ve bölümler            |
| `/anime/<slug>/season/<season>/episode/<episode>` | Bölüm oynatıcı ve bölüm gezinme                        |
| `/seri/<slug>`                                    | Eski seri adresi; `/anime/<slug>` adresine yönlenir    |
| `/izle/<slug>?sezon=<season>&b=<episode>`         | Eski izleme adresi; yeni bölüm adresine yönlenir       |
| `/admin`                                          | Seri, bölüm, görsel ve reklam yönetimi (giriş gerekir) |
| `/auth`                                           | Yönetici girişi                                        |

## Belgeler

- [Proje yapısı](docs/yapi.md)
- [Durum raporu](docs/durum/DURUM-RAPORU.md) — yapılan işlerin günlüğü
- [Denetim raporu](docs/durum/DENETIM-RAPORU.md)
- [Logo ve içerik rehberi](docs/rehber/LOGO-REHBERI.md) — kod bilmeden içerik değiştirme
