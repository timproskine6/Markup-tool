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
export function getGroupedSymbols(query, opts) {
  const includeEmpty = !!(opts && opts.includeEmpty);
  const q = (query || '').trim().toLowerCase();
  const matches = (s) => !q || s.name.toLowerCase().includes(q) || s.abbr.toLowerCase().includes(q);

  const groups = [];
  if (state.favorites.length > 0) {
    const items = SYMBOLS.filter((s) => state.favorites.includes(s.id) && matches(s));
    if (items.length > 0) groups.push({ id: '__favorites__', label: 'Favorites', isFavorites: true, items });
  }
  for (const cat of state.categories) {
    const items = SYMBOLS.filter((s) => state.symbolCategory[s.id] === cat.id && matches(s));
    if (items.length > 0 || includeEmpty) groups.push({ id: cat.id, label: cat.label, isFavorites: false, items });
  }
  return groups;
}

// Exposed for tests / a possible future "reset symbol organization" button.
export function resetToDefaults() {
  state = defaultState();
  persist();
}
