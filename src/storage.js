// Minimal IndexedDB wrapper for local project storage & autosave.
// (Hand-rolled instead of the `idb` package since this build has no bundler /
// package registry access — see README for why.)

const DB_NAME = 'sprinkler-markup';
const DB_VERSION = 1;
const STORE = 'projects';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const result = fn(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function saveProject(project) {
  project.updatedAt = Date.now();
  return withStore('readwrite', (store) => {
    store.put(project);
  });
}

export async function loadProject(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function listProjects() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      all.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(all);
    };
    req.onerror = () => reject(req.error);
  });
}

export function deleteProject(id) {
  return withStore('readwrite', (store) => {
    store.delete(id);
  });
}

export function newProjectId() {
  return 'proj_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// Simple debounce helper used for autosave.
export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
