// User-editable layer on top of the built-in symbol library (symbols.js).
// symbols.js is static, shipped data (id/name/category/abbr/svg) that never
// changes at runtime -- this module holds the per-user customization on top
// of it: custom categories (add/rename/delete/reorder), which category each
// symbol currently lives in (starts at that symbol's built-in default,
// user can move it), and a Favorites set that's pinned to the top of the
// palette. All of it persists in localStorage so it survives reloads and
// carries across every project (it's a device-level preference, not
// per-project -- unlike projects.js's IndexedDB-backed project data).
//
// Deliberately does NOT use window.prompt()/confirm() for anything other
// than delete-category (which mirrors the "New Project" button's existing,
// already-working confirm() call in main.js) -- prompt() specifically has a
// long history of being flaky/no-op in iOS standalone (Home-Screen) PWAs,
// so "add category" is built as an inline text field instead.

import { SYMBOLS, CATEGORIES } from './symbols.js';

const STORAGE_KEY = 'sprinkler-markup-symbol-prefs-v1';
const UNCATEGORIZED_ID = 'uncategorized';

function loadRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.categories) || typeof parsed.symbolCategory !== 'object') return null;
    if (!Array.isArray(parsed.favorites)) parsed.favorites = [];
    if (!Array.isArray(parsed.hidden)) parsed.hidden = [];
    if (!Array.isArray(parsed.collapsed)) parsed.collapsed = [];
    return parsed;
  } catch (_) {
    return null;
  }
}

function saveRaw(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (_) {
    // Storage full/unavailable -- prefs just won't persist this session,
    // not worth surfacing an error for a background convenience feature.
  }
}

function defaultState() {
  return {
    categories: CATEGORIES.map((c) => ({ ...c })),
    symbolCategory: Object.fromEntries(SYMBOLS.map((s) => [s.id, s.category])),
    favorites: [],
    // Soft-delete: hidden symbols never disappear from symbols.js itself (it's
    // shipped/static data), they just stop showing up in normal palette
    // browsing. Reversible on purpose -- Organize mode still surfaces a
    // hidden symbol (dimmed, with a Restore button) so "delete" can't
    // permanently lose access to part of the NFPA library by accident.
    hidden: [],
    // Which section headings (a real category id, or '__favorites__') are
    // currently collapsed in the palette. Persisted like everything else
    // here so a long, mostly-collapsed list stays that way across reloads.
    // Fresh default: every real category starts collapsed (216 symbols
    // across 18 categories is a lot to greet someone with all at once) --
    // Favorites is deliberately left out of this list so it alone starts
    // open, since quick access without digging through a collapsed section
    // is the entire point of pinning something there. This only matters for
    // a device/browser with no saved prefs yet (or after resetToDefaults) --
    // once someone's expanded/collapsed things by hand, THAT arrangement
    // wins and persists from then on, same as before.
    collapsed: CATEGORIES.map((c) => c.id),
  };
}

let state = loadRaw() || defaultState();

function ensureFallbackCategory() {
  if (!state.categories.some((c) => c.id === UNCATEGORIZED_ID)) {
    state.categories.push({ id: UNCATEGORIZED_ID, label: 'Uncategorized' });
  }
}

// Reconcile against symbols.js on every load: a symbol added to the library
// after a user's prefs were first saved won't be in their saved
// symbolCategory map yet (fall back to its built-in default category rather
// than dropping it from the palette), and a symbol whose assigned category
// doesn't exist any more (shouldn't normally happen, but cheap to guard)
// falls back to Uncategorized.
(function reconcile() {
  let changed = false;
  for (const s of SYMBOLS) {
    if (!(s.id in state.symbolCategory)) {
      state.symbolCategory[s.id] = s.category;
      changed = true;
    }
  }
  for (const s of SYMBOLS) {
    const cid = state.symbolCategory[s.id];
    if (!state.categories.some((c) => c.id === cid)) {
      ensureFallbackCategory();
      state.symbolCategory[s.id] = UNCATEGORIZED_ID;
      changed = true;
    }
  }
  // Prune any hidden id that no longer corresponds to a real symbol (only
  // matters if a future library update ever removes an entry outright).
  const validIds = new Set(SYMBOLS.map((s) => s.id));
  const prunedHidden = state.hidden.filter((id) => validIds.has(id));
  if (prunedHidden.length !== state.hidden.length) {
    state.hidden = prunedHidden;
    changed = true;
  }
  // Same for collapsed section ids: a category that's since been deleted
  // (deleteCategory already prunes its own id, but this guards against any
  // other way a stale id could linger, e.g. an interrupted write) shouldn't
  // pile up in storage forever. '__favorites__' is always valid.
  const validSectionIds = new Set([...state.categories.map((c) => c.id), '__favorites__']);
  const prunedCollapsed = state.collapsed.filter((id) => validSectionIds.has(id));
  if (prunedCollapsed.length !== state.collapsed.length) {
    state.collapsed = prunedCollapsed;
    changed = true;
  }
  if (changed) saveRaw(state);
})();

function persist() {
  saveRaw(state);
}

export function getCategories() {
  return state.categories.map((c) => ({ ...c }));
}

export function getSymbolCategory(defId) {
  return state.symbolCategory[defId];
}

export function setSymbolCategory(defId, categoryId) {
  if (!state.categories.some((c) => c.id === categoryId)) return;
  state.symbolCategory[defId] = categoryId;
  persist();
}

export function isFavorite(defId) {
  return state.favorites.includes(defId);
}

export function toggleFavorite(defId) {
  const i = state.favorites.indexOf(defId);
  if (i === -1) state.favorites.push(defId);
  else state.favorites.splice(i, 1);
  persist();
}

export function isHidden(defId) {
  return state.hidden.includes(defId);
}

// "Delete" a symbol from the palette. Deliberately non-destructive: it just
// stops appearing in normal browsing/search (and therefore in Favorites too,
// since that's a filtered view of the same symbols) -- nothing is removed
// from symbols.js, and anything already placed on a plan keeps rendering and
// exporting normally, since placed instances look symbols up by id directly
// rather than through this filtered list. See unhideSymbol to bring it back.
export function hideSymbol(defId) {
  if (!state.hidden.includes(defId)) state.hidden.push(defId);
  persist();
}

export function unhideSymbol(defId) {
  const i = state.hidden.indexOf(defId);
  if (i === -1) return;
  state.hidden.splice(i, 1);
  persist();
}

// sectionId is a real category id, or the virtual '__favorites__' group.
export function isCollapsed(sectionId) {
  return state.collapsed.includes(sectionId);
}

export function toggleCollapsed(sectionId) {
  const i = state.collapsed.indexOf(sectionId);
  if (i === -1) state.collapsed.push(sectionId);
  else state.collapsed.splice(i, 1);
  persist();
}

export function addCategory(label) {
  const trimmed = (label || '').trim();
  if (!trimmed) return null;
  const id = 'cat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  state.categories.push({ id, label: trimmed });
  persist();
  return id;
}

export function renameCategory(id, label) {
  const trimmed = (label || '').trim();
  if (!trimmed) return;
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return;
  cat.label = trimmed;
  persist();
}

export function canDeleteCategory(id) {
  return state.categories.length > 1 && state.categories.some((c) => c.id === id);
}

export function deleteCategory(id) {
  if (!canDeleteCategory(id)) return;
  const idx = state.categories.findIndex((c) => c.id === id);
  if (idx === -1) return;
  state.categories.splice(idx, 1);
  ensureFallbackCategory();
  const fallback = state.categories.find((c) => c.id === UNCATEGORIZED_ID) || state.categories[0];
  for (const defId of Object.keys(state.symbolCategory)) {
    if (state.symbolCategory[defId] === id) state.symbolCategory[defId] = fallback.id;
  }
  const collapsedIdx = state.collapsed.indexOf(id);
  if (collapsedIdx !== -1) state.collapsed.splice(collapsedIdx, 1);
  persist();
}

// direction: -1 to move up (earlier), 1 to move down (later).
export function moveCategory(id, direction) {
  const idx = state.categories.findIndex((c) => c.id === id);
  if (idx === -1) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= state.categories.length) return;
  const [cat] = state.categories.splice(idx, 1);
  state.categories.splice(newIdx, 0, cat);
  persist();
}

// Grouped view for the palette: a virtual "Favorites" group pinned first
// (only present when non-empty), then every real category in the user's
// current order, each carrying its member symbols. A symbol that's both
// favorited AND has a real category shows up in both groups -- Favorites is
// a quick-access shortcut, not a replacement for its regular spot, so
// starring something doesn't make it harder to find by browsing normally.
// opts.includeEmpty: also return real categories with zero matching symbols
// (e.g. a category just created via "+ New category", with nothing moved
// into it yet) -- used by Organize mode so a brand-new/emptied category is
// still visible to rename, reorder, delete, or receive its first symbol via
// another item's category picker. Normal browsing hides empty categories so
// day-to-day use isn't cluttered with blank sections. The virtual Favorites
// group is unaffected -- it never has anywhere to be "created" empty from.
// opts.includeHidden: also return symbols the user has removed from the
// palette (see hideSymbol above) -- used by Organize mode so a hidden symbol
// still shows up (flagged via the returned item's isHidden field) somewhere
// findable to restore. Normal browsing/search always excludes them.
export function getGroupedSymbols(query, opts) {
  const includeEmpty = !!(opts && opts.includeEmpty);
  const includeHidden = !!(opts && opts.includeHidden);
  const q = (query || '').trim().toLowerCase();
  const matches = (s) => !q || s.name.toLowerCase().includes(q) || s.abbr.toLowerCase().includes(q);
  const visible = (s) => includeHidden || !state.hidden.includes(s.id);
  const withFlag = (s) => ({ ...s, isHidden: state.hidden.includes(s.id) });

  const groups = [];
  if (state.favorites.length > 0) {
    const items = SYMBOLS.filter((s) => state.favorites.includes(s.id) && matches(s) && visible(s)).map(withFlag);
    if (items.length > 0) groups.push({ id: '__favorites__', label: 'Favorites', isFavorites: true, items });
  }
  for (const cat of state.categories) {
    const items = SYMBOLS.filter((s) => state.symbolCategory[s.id] === cat.id && matches(s) && visible(s)).map(withFlag);
    if (items.length > 0 || includeEmpty) groups.push({ id: cat.id, label: cat.label, isFavorites: false, items });
  }
  return groups;
}

// Exposed for tests / a possible future "reset symbol organization" button.
export function resetToDefaults() {
  state = defaultState();
  persist();
}
