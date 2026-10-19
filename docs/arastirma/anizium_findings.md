# Anizium media-URL capture — findings (sub-agent, 2026-09-25)

## Status: PAUSED — blocked by Anizium premium/login gate (no player without account)

## 1. Public Anizium IDs (from anizium.co, no login needed)
| Title | anizium.co watch URL id | watch page | TMDB (our value) |
|---|---|---|---|
| Attack on Titan | 791674752 | https://anizium.co/watch/791674752?season=1&episode=1 | 1429 |
| Re:Zero | 116904225 | https://anizium.co/watch/116904225?season=1&episode=1 | 65942 |
| Demon Slayer | 266309975 | https://anizium.co/watch/266309975?season=1&episode=1 | 85937 |
| Jujutsu Kaisen (control) | 808684439 | https://anizium.co/watch/808684439?season=1&episode=1 | 95479 |

Anizium's own ID space is NOT TMDB (e.g. AoT = 791674752, not 1429).

## 2. BLOCKER — player never loads
On ALL FOUR watch pages (incl. Jujutsu Kaisen) the player area shows:
"Bu içeriği görüntülemek için premium olmanız gerekir." + PREMIUM button.
- No <iframe>, no <video>, 0 media requests (performance.getEntriesByType('resource') empty of mp4/m3u8).
- Direct embed attempt:
  https://x.anizium.co/embed?u=41107191197887&site=main&lang=tr&id=791674752&plan=undefined&server=1&skin=art&season=1&episode=1
  (and the same for id=808684439) → HTTP body: {"isError":true,"msg":"Video açılamaz."}
- api.anizium.co requires a client token + session: 401 {"isError":true,"msg":"API tokeni mevcut değil."}
  e.g. https://api.anizium.co/anime/get?id=791674752 , https://api.anizium.co/page/search?value=Re%3AZero&page=1

=> The real media request could NOT be captured. Items A/B/C real media URL = DOĞRULANAMADI.

## 3. Direct CDN probes (curl HEAD, with and without Referer: https://x.anizium.co/)
Host sweep (path /95479/1/1/1080p.original.mp4):
- x.aniziumserver.site  -> DNS 104.26.11.29  -> 200
- x.aniziumserver.sbs   -> DNS 172.67.70.248 -> 200   (mirror host EXISTS)
- u.aniziumserver.site  -> DNS 104.26.10.29  -> 404 (host exists, no /95479 tree)
- aniziumserver.site / aniziumserver.sbs -> 000 (no response)
- x.aniziumserver.xyz / .com / cdn.* / s1.* -> DNS yok (NR)

Path probes on x.aniziumserver.site:
| status | path |
|---|---|
| 200 | /95479/1/1/1080p.original.mp4 |
| 200 | /95479/1/2/1080p.original.mp4 |
| 200 | /95479/1/1/2160p.original.mp4 |
| 200 | /209867/1/1/1080p.original.mp4 |
| 404 | /95479/1/1/1080p.tr.mp4 |
| 404 | /1429/1/1/1080p.original.mp4 |
| 404 | /1429/1/1/2160p.original.mp4 |
| 404 | /1429/1/1/2160p.tr.mp4 |
| 404 | /1429/1/1/720p.original.mp4 |
| 404 | /1429/1/1/1080p.mp4 |
| 404 | /1429/1/1.mp4 |
| 404 | /65942/1/1/1080p.original.mp4 |
| 404 | /85937/1/1/1080p.original.mp4 |
| 404 | /791674752/1/1/1080p.original.mp4 (Anizium own ID) |
| 404 | /116904225/1/1/1080p.original.mp4 (Anizium own ID) |
| 404 | /266309975/1/1/1080p.original.mp4 (Anizium own ID) |

Referer header made NO difference (200 stays 200, 404 stays 404). No 403 observed.

## 4. Conclusion reachable without login
- The CDN path DOES use TMDB ids for titles that exist there: 95479 (JJK) and 209867 (Frieren) = TMDB ids, both 200.
- For Attack on Titan / Re:Zero / Demon Slayer, the TMDB-id path returns a genuine 404, and so do
  the Anizium internal id, alternate quality/sound tokens, and the mirror host .sbs.
- Therefore: NOT a host difference and NOT a naming/quality difference for the tested variants.
  Either a DIFFERENT numeric id is used for those titles, or the media is not hosted on this CDN at all.
  Which of the two CANNOT be determined without an authenticated player session.

## 5. Player menus (quality / sound / subtitle / server list)
DOĞRULANAMADI — no player was ever rendered (premium gate). Only textual hint on the watch page:
"Donma veya takılma yaşıyorsanız, Alfa'yı tercih edebilirsiniz." (server named "Alfa").

## 6. Screenshots
- Premium gate (Jujutsu Kaisen watch page): https://sc02.alicdn.com/kf/A3b112ba312c44423899a3baac1ca0cc3h.png
- Embed JSON error (AoT): https://sc02.alicdn.com/kf/A42eea6536f60470ab9f6fd969bbe13988.png
- anizium.co search "Attack on Titan": https://sc02.alicdn.com/kf/A2b119fdb4d4f452fa63fba5502b75f74L.png
