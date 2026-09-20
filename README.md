# shanime

Anime keşif sitesi — vitrin, seri detayları, bölüm izleme ve admin paneli.

- **Canlı site**: https://shanime.xyz
- **Veritabanı / görsel depolama**: Supabase
- **Framework**: TanStack Start (React + Vite)

## Geliştirme

Bilgisayarında Node.js ve [Bun](https://bun.sh) kurulu olmalı.

```sh
bun install
bun run dev       # http://localhost:5173
bun run build     # üretim derlemesi (.output/)
bun run lint
bun run format
```

`.env` dosyasında Supabase adresi ve publishable anahtarı bulunur; bu dosya
paylaşılmaz, repoya girmez.

## Sayfalar

| Yol | Ne yapar |
|---|---|
| `/` | Vitrin (hero slider), seri ızgarası, tür filtresi |
| `/seri/<slug>` | Seri detayı: açıklama, bölümler, karakterler, görseller |
| `/izle/<slug>?b=<no>` | Bölüm oynatıcı ve bölüm gezinme |
| `/admin` | Seri, bölüm, görsel ve reklam kodu yönetimi (giriş gerekir) |
| `/auth` | Yönetici girişi |

Kod bilmeden içerik/logoyu nasıl değiştireceğini anlatan rehber:
[`LOGO-REHBERI.md`](./LOGO-REHBERI.md)

