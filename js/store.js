// Three save slots in IndexedDB. Each slot has two records: the full save, and
// a small summary for the start menu so opening the app doesn't load every save.
//
// If IndexedDB isn't available (a private window, some previews), saves are
// kept in memory for the session and `persistent` is false.

const DB_NAME = 'grassroots-manager';
const DB_VERSION = 1;
export const SLOTS = [1, 2, 3];

let dbPromise = null;
const memory = { saves: new Map(), slots: new Map() };
export let persistent = true;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves');
        if (!db.objectStoreNames.contains('slots')) db.createObjectStore('slots');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch (err) {
      resolve(null);
    }
  }).then((db) => {
    if (!db) persistent = false;
    return db;
  });
  return dbPromise;
}

function run(db, stores, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let value;
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
    work(tx, (v) => { value = v; });
  });
}

/** The start-menu summary for each slot, or null where a slot is empty. */
export async function listSlots() {
  const db = await open();
  if (!db) return SLOTS.map((slot) => memory.slots.get(slot) || null);
  return run(db, ['slots'], 'readonly', (tx, done) => {
    const out = SLOTS.map(() => null);
    done(out);
    SLOTS.forEach((slot, i) => {
      const request = tx.objectStore('slots').get(slot);
      request.onsuccess = () => { out[i] = request.result || null; };
    });
  });
}

export async function loadSave(slot) {
  const db = await open();
  if (!db) return memory.saves.get(slot) || null;
  return run(db, ['saves'], 'readonly', (tx, done) => {
    const request = tx.objectStore('saves').get(slot);
    request.onsuccess = () => done(request.result || null);
  });
}

/** Write the save and its summary together, so they can't disagree. */
export async function writeSave(slot, save, summary) {
  const db = await open();
  if (!db) {
    memory.saves.set(slot, save);
    memory.slots.set(slot, summary);
    return;
  }
  return run(db, ['saves', 'slots'], 'readwrite', (tx) => {
    tx.objectStore('saves').put(save, slot);
    tx.objectStore('slots').put(summary, slot);
  });
}

export async function deleteSave(slot) {
  const db = await open();
  if (!db) {
    memory.saves.delete(slot);
    memory.slots.delete(slot);
    return;
  }
  return run(db, ['saves', 'slots'], 'readwrite', (tx) => {
    tx.objectStore('saves').delete(slot);
    tx.objectStore('slots').delete(slot);
  });
}
