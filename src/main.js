import { PdfViewerSource } from './pdfViewer.js';
import { Stage, PEN_COLORS } from './stage.js';
import { Palette } from './palette.js';
import { LegendPanel } from './legend.js';
import { preloadAllSymbolImages, SYMBOLS_BY_ID } from './symbols.js';
import { saveProject, loadProject, debounce } from './storage.js';
import { exportAnnotatedPdf, legendToCsv, downloadBlob } from './export.js';
import * as symbolPrefs from './symbolPrefs.js';

const CURRENT_PROJECT_ID = 'current'; // Phase 1: single active project, autosaved on-device.

// Baked-in version identifier for the JS THIS PAGE is currently running --
// deliberately separate from Cache Storage's list of cache names. Those two
// can disagree: a service worker can finish installing (and even activating
// + deleting old caches) entirely in the background while an already-open
// tab keeps executing the OLD main.js/palette.js it loaded at last
// navigation, since only an actual reload re-fetches and re-runs page JS.
// checkOfflineReadiness() below compares this against the active cache's
// name to tell "a new version is ready" apart from "this page is already
// running it" -- without that, the on-screen version badge could report
// e.g. "(v14)" the instant the new cache exists, even on a tab that's still
// showing v13's UI, which is exactly as confusing as having no badge at all.
// MUST be bumped in lockstep with CACHE_VERSION in sw.js -- see the ONE RULE
// comment there.
const APP_VERSION = 'v16';

const el = {
  uploadScreen: document.getElementById('upload-screen'),
  editorScreen: document.getElementById('editor-screen'),
  fileInput: document.getElementById('file-input'),
  dropZone: document.getElementById('drop-zone'),
  stageContainer: document.getElementById('stage-container'),
  paletteContainer: document.getElementById('palette-container'),
  legendContainer: document.getElementById('legend-container'),
  projectName: document.getElementById('project-name'),
  stampToggle: document.getElementById('stamp-toggle'),
  newProjectBtn: document.getElementById('new-project-btn'),
  zoomInBtn: document.getElementById('zoom-in-btn'),
  zoomOutBtn: document.getElementById('zoom-out-btn'),
  fitBtn: document.getElementById('fit-btn'),
  exportPdfBtn: document.getElementById('export-pdf-btn'),
  exportCsvBtn: document.getElementById('export-csv-btn'),
  saveStatus: document.getElementById('save-status'),
  selectionToolbar: document.getElementById('selection-toolbar'),
  paletteToggleBtn: document.getElementById('palette-toggle-btn'),
  legendToggleBtn: document.getElementById('legend-toggle-btn'),
  panelScrim: document.getElementById('panel-scrim'),
  palettePanel: document.getElementById('palette-panel'),
  legendPanelEl: document.getElementById('legend-panel'),
  rotateLeftBtn: document.getElementById('rotate-left-btn'),
  rotateRightBtn: document.getElementById('rotate-right-btn'),
  deleteBtn: document.getElementById('delete-btn'),
  contextMenu: document.getElementById('context-menu'),
  ctxFavoriteBtn: document.getElementById('ctx-favorite-btn'),
  ctxCutBtn: document.getElementById('ctx-cut-btn'),
  ctxCopyBtn: document.getElementById('ctx-copy-btn'),
  ctxDeleteBtn: document.getElementById('ctx-delete-btn'),
  pencilToggleBtn: document.getElementById('pencil-toggle-btn'),
  undoStrokeBtn: document.getElementById('undo-stroke-btn'),
  pencilPalette: document.getElementById('pencil-palette'),
  pageNav: document.getElementById('page-nav'),
  pagePrevBtn: document.getElementById('page-prev-btn'),
  pageNextBtn: document.getElementById('page-next-btn'),
  pageIndicator: document.getElementById('page-indicator'),
  pastePill: document.getElementById('paste-pill'),
  swToast: document.getElementById('sw-toast'),
  offlineIndicator: document.getElementById('offline-indicator'),
};

let pdfSource = null;
let stage = null;
let palette = null;
let legendPanel = null;
let projectName = 'Untitled Project';

// The whole project's symbols/strokes, across every page — the source of
// truth for autosave/export/legend totals. Each item carries a `page` number
// (1-based; missing means page 1, so projects saved before multi-page
// support existed still load correctly). Stage itself only ever sees the
// slice for whichever page is currently on screen (see switchToPage/
// reconcilePageData below) — it has no concept of "other pages" at all.
let allSymbols = [];
let allStrokes = [];
let currentPage = 1;
let numPages = 1;

function setSaveStatus(text) {
  el.saveStatus.textContent = text;
}

async function flushSave() {
  if (!pdfSource || !pdfSource.pdfBytes || !stage) return;
  setSaveStatus('Saving…');
  try {
    await saveProject({
      id: CURRENT_PROJECT_ID,
      name: projectName,
      pdfBytes: pdfSource.pdfBytes,
      symbols: allSymbols,
      strokes: allStrokes,
      currentPage,
    });
    setSaveStatus('Saved to this device');
  } catch (err) {
    console.error(err);
    setSaveStatus('Save failed — see console');
  }
}

const persist = debounce(flushSave, 1000);

// Safety net: if the tab is closed/reloaded/backgrounded inside the ~1s
// autosave debounce window, flush immediately instead of losing the last edit.
function flushOnExit() {
  flushSave();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushOnExit();
});
window.addEventListener('pagehide', flushOnExit);

// Pull the current page's live symbols/strokes out of Stage and merge them
// back into the full project arrays, replacing whatever was previously
// stored for this page and leaving every other page's data untouched. Stage
// mutates its own arrays in place (drag/rotate/etc.) and only calls back out
// (via onSymbolsChanged) once a change is finalized, so by the time this
// runs stage.getSymbols()/getStrokes() already reflect the final values —
// copying them here (rather than keeping the same references) keeps
// `allSymbols`/`allStrokes` decoupled from whatever Stage goes on to mutate
// next, which matters once Stage starts editing a *different* page's array.
function reconcilePageData() {
  const otherSymbols = allSymbols.filter((s) => (s.page || 1) !== currentPage);
  const pageSymbols = stage.getSymbols().map((s) => ({ ...s, page: currentPage }));
  allSymbols = otherSymbols.concat(pageSymbols);

  const otherStrokes = allStrokes.filter((s) => (s.page || 1) !== currentPage);
  const pageStrokes = stage.getStrokes().map((s) => ({ ...s, page: currentPage }));
  allStrokes = otherStrokes.concat(pageStrokes);
}

function renderLegend() {
  const pageSymbols = allSymbols.filter((s) => (s.page || 1) === currentPage);
  legendPanel.render(pageSymbols, allSymbols, { current: currentPage, total: numPages });
}

function renderPageNav() {
  const multi = numPages > 1;
  el.pageNav.classList.toggle('hidden', !multi);
  if (!multi) return;
  el.pageIndicator.textContent = `Page ${currentPage} of ${numPages}`;
  el.pagePrevBtn.disabled = currentPage <= 1;
  el.pageNextBtn.disabled = currentPage >= numPages;
}

// Loading a page's raster + swapping its symbols/strokes into Stage is async
// (goToPage awaits pdf.js fetching/rendering that page). pdfSource and
// currentPage are both shared, mutable module state, so two switches running
// at once would race on it — whichever happened to resolve last would
// silently win regardless of which tap came first. That's what produced the
// mismatched "This Page (9/9)" vs "Page 1 of 9" state on a real device: a
// couple of quick taps overlapped and their renders landed out of order.
//
// Fix: every call is queued onto `navChain` and only actually runs once the
// previous one has fully finished — so however fast someone taps, the
// switches themselves always execute one at a time, in order. Taking a
// *delta* (-1/+1) rather than an absolute target page matters here too: each
// queued step reads `currentPage` only once it actually runs (not at tap
// time), so five quick taps on "next" correctly walk forward five pages
// instead of all computing "current+1" against the same stale starting page.
let navChain = Promise.resolve();

function switchToPage(delta) {
  navChain = navChain.then(() => doSwitchToPage(delta)).catch((err) => console.error(err));
  return navChain;
}

async function doSwitchToPage(delta) {
  const target = Math.min(Math.max(1, currentPage + delta), numPages);
  if (!stage || !pdfSource || target === currentPage) return;
  closeContextMenu();
  el.selectionToolbar.classList.add('hidden');
  currentPage = target;
  await pdfSource.goToPage(currentPage);
  const pageSymbols = allSymbols.filter((s) => (s.page || 1) === currentPage);
  const pageStrokes = allStrokes.filter((s) => (s.page || 1) === currentPage);
  await stage.loadPageData(pageSymbols, pageStrokes);
  renderPageNav();
  renderLegend();
  persist();
}

function onSymbolsChanged() {
  reconcilePageData();
  renderLegend();
  persist();
}

function onSelectionChanged(symbol) {
  // Any selection change (including a plain tap on the already-selected
  // symbol, or deselecting) invalidates whatever the long-press menu was
  // showing for — always close it here rather than trying to track every
  // path that should dismiss it separately.
  closeContextMenu();
  if (!symbol) {
    el.selectionToolbar.classList.add('hidden');
    return;
  }
  el.selectionToolbar.classList.remove('hidden');
  positionSelectionToolbar();
}

// Strokes get no persistent mini-toolbar (there's no rotate to offer, and
// Delete is already reachable via the long-press menu below) — this just
// needs to close a stale context menu on any selection change, same as
// onSelectionChanged does for symbols.
function onStrokeSelectionChanged() {
  closeContextMenu();
}

function positionSelectionToolbar() {
  if (stage && stage.selectedStrokeId) {
    // No toolbar to position for a stroke — just keep an already-open
    // context menu glued to it if the view moves (pinch/pan) while it's up.
    if (!el.contextMenu.classList.contains('hidden')) positionContextMenu();
    return;
  }
  if (!stage || !stage.selectedId) return;
  const bounds = stage.selectionBoundsScreen(stage.selectedId);
  if (!bounds) return;
  // Sit clear above the topmost handle (rotation can put any corner up top),
  // not just above the icon center — otherwise the toolbar can overlap and
  // steal pointer events from the handles beneath it.
  el.selectionToolbar.style.left = bounds.centerX + 'px';
  el.selectionToolbar.style.top = bounds.minY - 52 + 'px';
  if (!el.contextMenu.classList.contains('hidden')) positionContextMenu();
}

function onLongPress() {
  el.contextMenu.classList.remove('hidden');
  updateContextMenuFavoriteBtn();
  positionContextMenu();
}

// A stroke has no palette definition to favorite, so the button only shows
// for a placed symbol. Reflects the current favorited state in its own
// label/style, same as the palette's star, so the two stay visually in sync.
function updateContextMenuFavoriteBtn() {
  const defId = stage ? stage.getSelectedDefId() : null;
  el.ctxFavoriteBtn.classList.toggle('hidden', !defId);
  if (!defId) return;
  const fav = symbolPrefs.isFavorite(defId);
  el.ctxFavoriteBtn.textContent = fav ? '★ Favorited' : '☆ Favorite';
  el.ctxFavoriteBtn.classList.toggle('active', fav);
}

function positionContextMenu() {
  if (!stage) return;
  if (stage.selectedStrokeId) {
    const bounds = stage.strokeSelectionBoundsScreen(stage.selectedStrokeId);
    if (!bounds) return;
    // No selection toolbar sits below a stroke's menu (see
    // onStrokeSelectionChanged), so it only needs to clear the stroke's own
    // bounding box, not stack above a toolbar too.
    el.contextMenu.style.left = bounds.centerX + 'px';
    el.contextMenu.style.top = bounds.minY - 46 + 'px';
    return;
  }
  if (!stage.selectedId) return;
  const bounds = stage.selectionBoundsScreen(stage.selectedId);
  if (!bounds) return;
  // Stack above the selection toolbar (which itself sits above the rotate
  // handle) so both are visible at once, per the design: long-press adds
  // this menu alongside the existing toolbar rather than replacing it.
  el.contextMenu.style.left = bounds.centerX + 'px';
  el.contextMenu.style.top = bounds.minY - 52 - 46 + 'px';
}

function closeContextMenu() {
  el.contextMenu.classList.add('hidden');
}

// Holding after a Copy/Cut shows a small "Paste" pill at the hold point
// instead of placing immediately (a quick tap still places right away) —
// tapping the pill places the copy there and leaves the paste armed, so
// holding again elsewhere brings the pill back up for another placement.
function onPastePillRequested(screenPos) {
  el.pastePill.classList.remove('hidden');
  el.pastePill.style.left = screenPos.x + 'px';
  el.pastePill.style.top = screenPos.y - 44 + 'px'; // float above the finger, not under it
}

function onPastePillDismissed() {
  el.pastePill.classList.add('hidden');
}

async function openPdf(bytes, name) {
  pdfSource = new PdfViewerSource();
  const info = await pdfSource.loadFromBytes(bytes);
  numPages = info.numPages;
  currentPage = 1;
  // Fresh upload starts empty; a restore (tryRestoreProject) overwrites these
  // right after this call returns, once it knows what was actually saved.
  allSymbols = [];
  allStrokes = [];

  el.uploadScreen.classList.add('hidden');
  el.editorScreen.classList.remove('hidden');

  if (stage) stage.destroy();
  el.stageContainer.innerHTML = '';
  stage = new Stage(el.stageContainer, pdfSource, {
    onSymbolsChanged,
    onSelectionChanged,
    onStrokeSelectionChanged,
    onArmedChanged: (defId) => {
      palette.setArmed(defId);
      syncPencilUI();
    },
    onLongPress,
    onPastePillRequested,
    onPastePillDismissed,
  });
  el.stageContainer.addEventListener('stage:overlay-rendered', positionSelectionToolbar);
  syncPencilUI(); // fresh Stage always starts with pen mode off

  projectName = name || projectName;
  el.projectName.value = projectName;

  await preloadAllSymbolImages();
  await stage.fitToScreen();

  renderPageNav();
  renderLegend();
}

async function handleFile(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const name = file.name.replace(/\.pdf$/i, '');
  await openPdf(buf, name);
  // Route through the same debounced persist() used for every later edit —
  // it always reads live state at the moment it actually fires, so it can
  // never race ahead of (and clobber) symbols the user places in the
  // meantime while this initial save is still settling.
  persist();
}

function initUploadZone() {
  el.dropZone.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => {
    if (el.fileInput.files[0]) handleFile(el.fileInput.files[0]);
  });
  ['dragover', 'dragenter'].forEach((evt) =>
    el.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.dropZone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    el.dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      el.dropZone.classList.remove('dragover');
    })
  );
  el.dropZone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') handleFile(file);
  });
}

function initToolbar() {
  el.projectName.addEventListener('change', () => {
    projectName = el.projectName.value.trim() || 'Untitled Project';
    persist();
  });

  el.stampToggle.addEventListener('click', () => {
    const active = el.stampToggle.classList.toggle('active');
    stage.setStampMode(active);
    el.stampToggle.setAttribute('aria-pressed', String(active));
  });

  el.newProjectBtn.addEventListener('click', () => {
    if (!confirm('Start a new project? This clears the current plan and markups from this device.')) return;
    el.editorScreen.classList.add('hidden');
    el.uploadScreen.classList.remove('hidden');
    el.fileInput.value = '';
  });

  el.zoomInBtn.addEventListener('click', () => stage.zoomBy(1.25));
  el.zoomOutBtn.addEventListener('click', () => stage.zoomBy(0.8));
  el.fitBtn.addEventListener('click', () => stage.fitToScreen());

  el.exportPdfBtn.addEventListener('click', async () => {
    el.exportPdfBtn.disabled = true;
    el.exportPdfBtn.textContent = 'Exporting…';
    try {
      const bytes = await exportAnnotatedPdf({
        pdfBytes: pdfSource.pdfBytes,
        symbols: allSymbols,
        strokes: allStrokes,
        projectName,
      });
      downloadBlob(bytes, `${projectName || 'markup'}.pdf`, 'application/pdf');
    } catch (err) {
      console.error(err);
      alert('Export failed: ' + err.message);
    } finally {
      el.exportPdfBtn.disabled = false;
      el.exportPdfBtn.textContent = 'Export PDF';
    }
  });

  el.exportCsvBtn.addEventListener('click', () => {
    const csv = legendToCsv(allSymbols, { numPages });
    downloadBlob(new TextEncoder().encode(csv), `${projectName || 'markup'}-legend.csv`, 'text/csv');
  });
}

function initPageNav() {
  el.pagePrevBtn.addEventListener('click', () => switchToPage(-1));
  el.pageNextBtn.addEventListener('click', () => switchToPage(1));
}

function initPastePill() {
  el.pastePill.addEventListener('click', () => stage.confirmPendingPaste());
}

function closeSidePanels() {
  el.palettePanel.classList.remove('open');
  el.legendPanelEl.classList.remove('open');
  el.panelScrim.classList.add('hidden');
}

function initMobilePanels() {
  el.paletteToggleBtn.addEventListener('click', () => {
    const willOpen = !el.palettePanel.classList.contains('open');
    closeSidePanels();
    if (willOpen) {
      el.palettePanel.classList.add('open');
      el.panelScrim.classList.remove('hidden');
    }
  });
  el.legendToggleBtn.addEventListener('click', () => {
    const willOpen = !el.legendPanelEl.classList.contains('open');
    closeSidePanels();
    if (willOpen) {
      el.legendPanelEl.classList.add('open');
      el.panelScrim.classList.remove('hidden');
    }
  });
  el.panelScrim.addEventListener('click', closeSidePanels);
}

function initSelectionToolbar() {
  el.rotateLeftBtn.addEventListener('click', () => stage.rotateSelected(-15));
  el.rotateRightBtn.addEventListener('click', () => stage.rotateSelected(15));
  el.deleteBtn.addEventListener('click', () => stage.deleteSelected());
}

function initContextMenu() {
  el.ctxFavoriteBtn.addEventListener('click', () => {
    const defId = stage ? stage.getSelectedDefId() : null;
    if (!defId) return;
    symbolPrefs.toggleFavorite(defId);
    updateContextMenuFavoriteBtn(); // toggle, not one-shot — keep the menu open and update the label live
    if (palette) palette.refresh(); // reflect it in the palette's star + Favorites section immediately
  });
  el.ctxCutBtn.addEventListener('click', () => {
    stage.cutSelected();
    closeContextMenu();
  });
  el.ctxCopyBtn.addEventListener('click', () => {
    stage.copySelected();
    closeContextMenu();
  });
  el.ctxDeleteBtn.addEventListener('click', () => {
    stage.deleteSelected();
    closeContextMenu();
  });
}

// Reflects stage.penMode/penColor in the toolbar — called after every
// armed/pen-mode change, since arming a palette symbol also silently exits
// pen mode (see Stage#armSymbol) and this is the one place that needs to
// notice that happened, not just the explicit toggle-button click.
function syncPencilUI() {
  const on = !!(stage && stage.penMode);
  el.pencilToggleBtn.classList.toggle('active', on);
  el.pencilToggleBtn.setAttribute('aria-pressed', String(on));
  el.pencilPalette.classList.toggle('hidden', !on);
  el.undoStrokeBtn.classList.toggle('hidden', !on);
}

function initPencilTool() {
  for (const color of PEN_COLORS) {
    const btn = document.createElement('button');
    btn.className = 'color-swatch' + (color === PEN_COLORS[0] ? ' active' : '');
    btn.style.background = color;
    btn.title = color;
    btn.addEventListener('click', () => {
      stage.setPenColor(color);
      el.pencilPalette.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('active'));
      btn.classList.add('active');
    });
    el.pencilPalette.appendChild(btn);
  }

  el.pencilToggleBtn.addEventListener('click', () => {
    stage.setPenMode(!stage.penMode);
    syncPencilUI();
  });
  el.undoStrokeBtn.addEventListener('click', () => stage.undoLastStroke());
}

async function tryRestoreProject() {
  const existing = await loadProject(CURRENT_PROJECT_ID);
  if (existing && existing.pdfBytes) {
    projectName = existing.name || 'Untitled Project';
    await openPdf(existing.pdfBytes, projectName);

    // openPdf() above always resets allSymbols/allStrokes to empty (that's
    // correct for a brand-new upload) — now that it's done and we know what
    // was actually saved, overwrite with the real data. Projects saved before
    // multi-page support existed have no `.page` on each item (treated as
    // page 1 everywhere else) and no `currentPage` (defaults to 1 here too).
    allSymbols = existing.symbols || [];
    allStrokes = existing.strokes || [];
    const restoredPage = Math.min(Math.max(1, existing.currentPage || 1), numPages);
    if (restoredPage !== currentPage) {
      currentPage = restoredPage;
      await pdfSource.goToPage(currentPage);
    }
    const pageSymbols = allSymbols.filter((s) => (s.page || 1) === currentPage);
    const pageStrokes = allStrokes.filter((s) => (s.page || 1) === currentPage);
    await stage.loadPageData(pageSymbols, pageStrokes);

    renderPageNav();
    renderLegend();
    setSaveStatus('Restored from this device');
  }
}

let swToastTimer = null;
function showSwToast(text, opts = {}) {
  el.swToast.textContent = text;
  el.swToast.classList.remove('hidden');
  el.swToast.classList.toggle('sw-toast-error', !!opts.error);
  el.swToast.onclick = opts.onClick || null;
  el.swToast.classList.toggle('sw-toast-clickable', !!opts.onClick);
  clearTimeout(swToastTimer);
  // Sticky toasts (an update is ready, waiting on a tap to reload) stay up
  // until acted on instead of vanishing after a few seconds unnoticed.
  if (!opts.sticky) {
    swToastTimer = setTimeout(() => el.swToast.classList.add('hidden'), opts.duration || 4000);
  }
}

// Registers the offline app-shell service worker (see sw.js) so the app can
// be added to the Home Screen and keep working with zero network access —
// no need to keep a-Shell's local server running just to use it day to day.
// An earlier version of this app actively fought having a service worker at
// all (unregistering one on every load) because during active development a
// caching SW meant Safari confidently replaying stale code — that's why an
// unusual number of past updates in this project needed a fresh port or a
// manual cache-clear to actually take effect. That churn is over now, so
// this restores the normal, expected PWA behavior. Shipping a future update
// still requires bumping CACHE_VERSION in sw.js — see that file for the full
// explanation — and briefly running the local server again so the browser
// has a chance to notice and fetch the new version.
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    showSwToast('This browser has no offline support — Home Screen install will need a network connection every time', { error: true, duration: 8000 });
    checkOfflineReadiness();
    return;
  }
  // Was some version of this app already controlling the page before this
  // registration call? If so, any update we detect below is a genuine "a
  // newer version just showed up" event, not the very first install (which
  // also fires 'updatefound' but has nothing to prompt a reload for).
  const hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      // navigator.serviceWorker.ready only resolves once a worker is ACTIVE
      // and controlling this page — which (by the SW lifecycle spec) can't
      // happen until install's waitUntil, including sw.js's cache.addAll of
      // every app file, has already finished. There's no dev console on an
      // iPad to check this any other way, so this on-screen confirmation is
      // the real signal to watch for before trusting Airplane Mode or Add to
      // Home Screen to work. If this never appears, offline mode is NOT
      // ready yet — stay on this page (don't background/quit a-Shell) and
      // wait, or reload once and try again.
      navigator.serviceWorker.ready.then(() => {
        showSwToast('Offline ready ✓ — safe to Add to Home Screen or go offline now');
        checkOfflineReadiness();
      });

      // Safari (especially a Home-Screen-installed one) can go a very long
      // time before it decides on its own to re-fetch sw.js and notice
      // CACHE_VERSION changed — sometimes it takes a fully-quit-and-reopen,
      // sometimes what looks like forever. Explicitly asking right now,
      // every load, instead of waiting on the browser's own schedule, is
      // the fix: reg.update() forces an immediate check.
      reg.update().catch(() => {});
      watchForUpdate(reg, hadController);
    })
    .catch((err) => {
      console.error('Service worker registration failed — offline support will be unavailable:', err);
      showSwToast('Offline setup failed — reload the page while the a-Shell server is running', { error: true, duration: 8000 });
      checkOfflineReadiness();
    });
  navigator.serviceWorker.addEventListener('controllerchange', checkOfflineReadiness);
}

// Watches a registration for a new worker showing up and taking over, and —
// only when this is a real update (there was already a version running,
// i.e. hadController) rather than the first-ever install — puts up a sticky
// "tap to reload" toast once it's fully activated. sw.js calls skipWaiting()
// + clients.claim() itself, so the new worker takes control on its own
// within a second or two; what it can't do is re-run the page's already-
// loaded JS, so a reload is still the one manual step left to actually see
// the update.
function watchForUpdate(reg, hadController) {
  reg.addEventListener('updatefound', () => {
    const newWorker = reg.installing;
    if (!newWorker) return;
    newWorker.addEventListener('statechange', () => {
      if (newWorker.state === 'activated' && hadController) {
        showSwToast('Update installed — tap to reload', { sticky: true, onClick: () => location.reload() });
      }
    });
  });
}

// Actually inspects THIS browsing context's own Cache Storage and SW
// controller state, rather than just trusting that registration succeeded
// somewhere. This matters because on iOS a Home Screen icon and a regular
// Safari tab for the exact same URL can end up with DIFFERENTLY-answered
// checks here — this is the one on-screen way (no dev tools needed) to see
// whether the window you're looking at *right now* actually has a working
// offline cache, independent of whatever any other tab/icon showed earlier.
async function checkOfflineReadiness() {
  el.offlineIndicator.textContent = 'Offline: checking…';
  el.offlineIndicator.classList.remove('offline-indicator-ready', 'offline-indicator-bad');
  if (!('serviceWorker' in navigator) || !('caches' in window)) {
    el.offlineIndicator.textContent = 'Offline: unsupported here';
    el.offlineIndicator.classList.add('offline-indicator-bad');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration('./');
    // A tap on this badge is as much "check for updates now" as it is
    // "show me current status" -- ask the registration to re-fetch sw.js
    // right now rather than only ever reporting what was already known.
    // (The 'updatefound' listener that actually surfaces a result is
    // attached once, in registerServiceWorker -- this just re-triggers it.)
    if (reg) reg.update().catch(() => {});
    const controlled = !!navigator.serviceWorker.controller;
    const cacheKeys = await caches.keys();
    const ourCacheName = cacheKeys.find((k) => k.startsWith('sprinkler-markup-'));
    let hasShell = false;
    if (ourCacheName) {
      const cache = await caches.open(ourCacheName);
      hasShell = !!(await cache.match('./index.html'));
    }
    if (controlled && hasShell) {
      // Surface the cache version (e.g. "v9") right in the indicator -- the
      // one way, with no dev tools, to tell "ready ✓" apart from "ready ✓
      // but still on yesterday's code" after pushing an update. Compare
      // this against CACHE_VERSION in sw.js to know if a reload actually
      // picked up the latest push yet.
      const versionSuffix = ourCacheName ? ourCacheName.replace('sprinkler-markup-', '') : '';
      const staleTab = versionSuffix && versionSuffix !== APP_VERSION;
      el.offlineIndicator.textContent = staleTab
        ? `Offline: ready ✓ (${versionSuffix} installed, this tab is still ${APP_VERSION})`
        : `Offline: ready ✓${versionSuffix ? ' (' + versionSuffix + ')' : ''}`;
      el.offlineIndicator.classList.add('offline-indicator-ready');
      // A newer cache exists than what THIS tab is actually running -- this
      // happens when the update finished installing in the background (see
      // watchForUpdate) while this tab sat open unattended, so the sticky
      // "updatefound" listener's toast either already scrolled past or never
      // got noticed. Surface it again right now, on every manual re-check,
      // rather than leaving someone staring at a "ready ✓" badge that quietly
      // means "ready, but not for you yet."
      if (staleTab) {
        showSwToast('Update installed — tap to reload', { sticky: true, onClick: () => location.reload() });
      }
    } else if (hasShell && !controlled) {
      el.offlineIndicator.textContent = 'Offline: cached, reload to activate';
      el.offlineIndicator.classList.add('offline-indicator-bad');
    } else if (!reg) {
      el.offlineIndicator.textContent = 'Offline: NOT set up in this window';
      el.offlineIndicator.classList.add('offline-indicator-bad');
    } else {
      el.offlineIndicator.textContent = 'Offline: not cached yet';
      el.offlineIndicator.classList.add('offline-indicator-bad');
    }
  } catch (err) {
    console.error('Offline-readiness check failed:', err);
    el.offlineIndicator.textContent = 'Offline: check failed';
    el.offlineIndicator.classList.add('offline-indicator-bad');
  }
}

async function init() {
  registerServiceWorker();
  el.offlineIndicator.addEventListener('click', checkOfflineReadiness);

  palette = new Palette(el.paletteContainer, {
    onArm: (defId) => {
      if (stage) stage.armSymbol(defId);
      if (defId && window.matchMedia('(max-width: 900px)').matches) closeSidePanels();
    },
  });
  legendPanel = new LegendPanel(el.legendContainer);

  initUploadZone();
  initToolbar();
  initSelectionToolbar();
  initContextMenu();
  initPencilTool();
  initPageNav();
  initPastePill();
  initMobilePanels();

  await tryRestoreProject();
}

init();
