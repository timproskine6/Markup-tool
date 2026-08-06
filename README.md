# Fire Sprinkler Plan Markup — Phase 1 MVP

A client-side-only web app for dropping fire sprinkler symbols onto a PDF building plan, with a live legend count, autosave, and PDF/CSV export. No server, no account — everything runs and stays on the device.

## Running it

This is a plain static site (no build step), but it uses ES modules and a Web Worker, which browsers block from `file://` for security. Serve it over local HTTP:

```
cd sprinkler-markup
python3 -m http.server 8080
# then open http://localhost:8080/
```

Any static server works (`npx serve`, VS Code's Live Server, etc.) — just make sure `vendor/`, `icons/`, and `src/` are served alongside `index.html`.

To try it on an iPad: serve it from a machine on the same network and open `http://<your-computer's-IP>:8080/` in Safari, or deploy the folder to any static host (Netlify, GitHub Pages, S3, etc.) and open it there.

## Install as a Home Screen app (works fully offline)

The app ships with a real offline-caching service worker (`sw.js`), so once it's been opened once it keeps working with zero network access — no need to keep a-Shell's server running just to use it day to day. Steps (a-Shell specific, but the same idea applies to any host):

1. **Pick one port and stick with it.** e.g. always run `python3 -m http.server 8080` from the same project folder. The Home Screen icon you're about to create is bound to the exact URL you install from (`http://localhost:8080/`), so switching ports later would create a second, separate "app" instead of updating the one you already have.
2. Start the server (`python3 -m http.server 8080`) and open `http://localhost:8080/` in Safari.
3. Use the app for a moment (upload a plan, etc.) so the service worker finishes installing — this is what precaches everything it needs. You only need to do this once per install, not every visit.
4. Tap the Share icon, then **Add to Home Screen**.
5. Test it: turn on Airplane Mode (or just quit a-Shell) and open the app from its new Home Screen icon. It should load and work exactly as before — that confirms offline caching is working.

**Shipping a future update:** unzip the new files into the same folder (same port), briefly start the server again, and open the app once in Safari (the Home Screen icon or a regular tab both work) while that server is running. The service worker checks for a new version on that visit, downloads it in the background, and the update takes effect the next time you open the app. You don't need to redo "Add to Home Screen" — the same icon keeps working.

## What's implemented (Phase 1 of the build plan)

- PDF upload & viewing — upload a plan (any page count), pinch-zoom / two-finger pan on touch, scroll-wheel zoom + drag-pan on desktop
- Symbol palette — currently just Addressable Duct Detector under Initiating Devices, trimmed down from a broader NFPA-170-style starter set since this project only ever places duct detectors. Search still works even with one category — new symbols/categories are just data added to `src/symbols.js`, nothing else to wire up, so it's easy to add more back if a future project needs them
- Tap-to-place — arm a symbol, tap the plan to drop it; drag to move; rotate by dragging the dedicated handle floating above the symbol on its dashed stalk (snaps to clean 15° angles when close) or with the ±15° toolbar buttons — the 4 corner dots mark the selection footprint; "stamp mode" keeps a symbol armed for rapid repeat placement
- Press-and-hold a placed symbol for a native-style Cut / Copy / Delete menu (shows alongside the rotate toolbar, not instead of it) — Copy or Cut arms a paste of that symbol (preserving its rotation). A quick tap on the plan drops it there immediately; holding instead shows a "Paste" pill at your finger — tap the pill to place it there, and the paste stays armed afterward, so you can keep holding elsewhere and placing more copies without re-copying each time. Cut also removes the original immediately
- Pencil tool — freeform drawing for call-outs, circles, arrows, etc.; toggle it on from the bottom-right toolbar, drag with one finger to draw (two-finger pinch/pan still works while it's on), pick a color from the palette that appears (default red), undo the last stroke with the ↩ button. Strokes autosave and flatten into the PDF export just like symbols
- Multi-page plans — a bottom-left ‹ Page X of N › control appears automatically once you upload a plan with more than one page (stays hidden for the common single-sheet case). Symbols and pencil strokes are scoped to whichever page they were placed on; the symbol you have armed and stamp mode both carry over when you flip pages, so you can keep stamping the same head across a whole sheet set. Export CSV lists a per-page breakdown plus an "All Pages" project total; Export PDF flattens each page's own markup onto that sheet (with its own small legend box) and appends one extra summary page with the combined project totals and a per-page breakdown
- Live legend — a running groupBy/count of placed symbols, shown for the current page and (once a plan has more than one page) for the whole project side by side
- Autosave — debounced (~1s) writes to IndexedDB, plus a flush-on-exit safety net if you close/reload mid-debounce; reopening the app restores your last project automatically
- Bonus (pulled forward from Phase 2, since the libraries were already in place): **Export PDF** flattens the symbols + a legend table onto a copy of the original PDF; **Export CSV** exports just the legend counts for takeoffs

Not yet built (left for Phase 2/3 per the original plan): undo/redo, scale calibration & measuring, layers, revision duplication, custom user-added symbols, and a multi-project list screen (this MVP autosaves a single active project).

## A build note

The plan's recommended stack was React + PDF.js + Konva.js + pdf-lib + idb, via Vite. This sandbox's network egress doesn't allow npm registry, GitHub, or CDN access (only a few pre-approved domains), so `npm install` / `create-vite` weren't available. I adapted:

- **PDF.js and pdf-lib** are used as planned — they happened to already be present in this environment's global npm cache, so I vendored the built files directly into `vendor/`.
- **Konva.js** wasn't available anywhere locally, so the symbol-placement layer is a hand-rolled second `<canvas>` (pointer events, hit-testing, drag/rotate/delete) instead. Functionally equivalent to what Konva would give you, just without the library.
- **React** was swapped for plain JS/DOM (`src/*.js`, no JSX, no bundler) so the whole thing runs as static files with zero build step.
- **idb** was swapped for a ~40-line hand-rolled IndexedDB wrapper (`src/storage.js`).

If you'd like this rebuilt on the originally-planned React/Konva/Vite stack, that's a straightforward follow-up in an environment (or your own machine) with normal npm access — the app architecture (PDF-point coordinate storage, single symbols-state-array, debounced autosave) would carry over directly.

## Symbol glyphs

The Addressable Duct Detector glyph is a simplified stand-in (shape + category color), not a pixel-exact reproduction of the NFPA 170 / Arizona plan-review key. Swap the SVG in `src/symbols.js` for your jurisdiction's approved glyph when you have it — that's also the natural place to wire up the Phase-3 "custom symbols" feature, or to add back any of the other symbol types (heads, valves, piping, misc devices) if a future project needs them.
