# Shanime player CC / fullscreen verification — rolling findings

## Scope (from task)
Verify the new "CC menu over player" + "our own fullscreen" feature on http://127.0.0.1:8080 (user's Chrome, not built-in).
Steps: open /izle/erased?sezon=1&b=1 + Ctrl+Shift+R, press Oynat on ad gate, hover player, measure rects,
screenshot (is our CC button exactly over the provider's CC icon?), open CC menu (list rows), pick Türkçe
(subtitle line?), fullscreen test (real fullscreen? subtitle visible? CC reachable? screenshot; exit), count pop-ups.
Output: rects, gap from iframe right/bottom edges, image evidence, keep tab OPEN.

## Browser / tab
- targetId: tab-vtab-1966411245 (pre-existing agent tab, reused — no new tab opened)
- url: http://127.0.0.1:8080/izle/erased?sezon=1&b=1

## Key layout data (DOM-measured, player wrapper = div.group.relative.bg-black)
- player wrapper box: x=261.5, y=208, w=1034, h=581.6 (page px)
- player iframe (index 1, megaplay.buzz/stream/mal/31043/1/sub): x=262, y=108?? (after scroll: x=262,y=208) w=1034 h=582
- OUR CC button [aria-label="Altyazı menüsü"]: rel to wrapper x=868, y=537, 40x40  -> right edge 908, bottom 577
- OUR fullscreen button [aria-label="Tam ekran"]: rel x=984, y=537, 40x40 -> right edge 1024
- => our CC button is 1034-908 = 126 px inside the iframe's right edge, 582-577 = 5 px above the bottom edge
- => our fullscreen button is 10 px inside the right edge, 5 px above the bottom edge
- classes: absolute bottom-[5px] right-[126px] / right-[10px], z-30, h-10 w-10, opacity-0 + group-hover:opacity-100
  (controls only visible while the wrapper is hovered) -> real mouse hover is required

## Method notes (for honesty in report)
- CSS group-hover: JS-dispatched mouse events do NOT reveal the buttons; a real pointer hover was used.
- Image->CSS calibration: page-anchored 5x5 markers injected at wrapper-relative (100,200) green, (1000,200) magenta,
  (100,500) cyan; detected at exactly those pixels => element screenshots are 1:1 with the wrapper box.
- window.open hook installed for pop-up counting.

## Evidence files
- shots/01-player-hover.png      viewport, video playing, our controls hidden then (pre-hover state)
- shots/02-player-controls-crop.png  player crop, provider bar + our controls
- shots/03-provider-only.png     player crop, OUR buttons force-hidden -> provider icons only (1034x581)
- shots/04-ours-only.png         player crop, iframe hidden -> our 2 icons only
- shots/05-ours-calibrated.png, 06-provider-calibrated.png, 07-calibration.png (markers verified exact)
- shots/10-both-cal.png, 11-fresh-both-cal.png, 12-viewport-state.png, 13-both-markers.png
- analyze-icons.ps1, analyze-cal.ps1 (pixel analysis scripts)

## Provider icon pixel centres (shot 03, crop coords; band bottom 14%)
- "10" 780.5 | "10" 823 | CC 867.5 (ink 858-877) | gear 911.5 (904-919) | box 955.5 (945-966) | fullscreen ~999.5 (992-1007)
- spacing ~43-44 px
Our icons (shot 04): CC ink 886-903 (centre 894.5), fullscreen ink 1002-1019 (centre 1010.5);
DOM predicts centres 888 and 1004 => shot 04 shows a uniform +6.5 px capture offset. TO BE RESOLVED with a
marker-calibrated frame that contains BOTH sets (shot 13/14 attempt).

## Status
- step 1 (open + hard reload) DONE
- step 2 (Oynat -> video plays) DONE (video playing, e.g. 17:01/22:52)
- step 3 (hover shows our buttons) DONE (real :hover verified, opacity 1)
- step 4 (rect measurement) DONE (see above)
- step 5 (screenshot + over/offset verdict) IN PROGRESS
- steps 6-9 TODO: CC menu rows, Türkçe subtitle, fullscreen test, pop-up count
