# Rolling findings — Player audit (tau-video / anizium)

## Scope
A) animecix/tau-video player audit + screenshots
B) anizium player audit (quality/audio/subtitle menus, server list, media URL, subtitle URL)
C) anizium coverage (Re:Zero, Attack on Titan, Demon Slayer) media URLs
D) open tabs list

## A — DONE (verified)
- animecix Jujutsu Kaisen S1B1 page: https://animecix.tv/titles/7352/season/1/episode/1
- Embed iframe src (id="plyrFrame"): https://tau-video.xyz/embed/6335c9e6d03cb090cb4c58c1?vid=389615
- Player library: **Vidstack** (`vds-*` classes, `data-media-player`, title "TauVideo")
- Media file: https://alwin-4.cfd/file/tau-video/7352_1_1_720p.mp4 (only ONE source; only 720p requested in network)
- Quality menu: YES — settings gear > "Hız ve Kalite" > **Kalite = slider, value "720p (1.32 Mbps)"** + **"Otomatik" (Auto) checkbox ON**. Only 720p available (slider max=1). No 1080p/480p/360p options.
- Settings menu sections: Döngü (loop, off) / Hız (speed slider 0.5x–4x, Normal) / Kalite (720p + Otomatik)
- "Ses" submenu: only "Yükselt" (audio boost 0–300%, 0%) → NO audio track / dub selection
- Subtitle: `video.textTracks.length === 0`; CC button (`vds-caption-button`, label "Altyazılar") exists in DOM but `display:none`/aria-hidden → NO soft subs → **hardsub** (burned-in text visible in frame; fansub watermark "Tempest")
- Screenshots: tau_A_player_normal.png, tau_B_settings_menu_full.png, tau_B_quality_menu.png (+ tau_player_normal.png from 1st tab)
- Tabs: animecix tab = tab-vtab-1966411518, tau embed tab = tab-vtab-1966411520 (retained)

## B — PENDING
Anizium JJK S1B1 tab: tab-vtab-1966411489 (user tab)
URL: https://anizium.co/watch/808684439?season=1&episode=1&u=41107191197887
Note: page shows "Bu içeriği görüntülemek için premium olmanız gerekir." Player inside cross-origin iframe.
Server list on page: Alfa / Anizium / Standart / Beta (need verify)

## C — PENDING
Re:Zero / Attack on Titan / Demon Slayer media URLs on anizium

## D — tabs open (retained)
- tab-vtab-1966411518 animecix.tv
- tab-vtab-1966411520 tau-video.xyz embed
- old tau tab tab-vtab-1966411519 (permission denied; close attempt failed)

## Blockers
- tau-video tab vtab-1966411519 debugger permission denied by user (worked around by opening new tab 1520)
