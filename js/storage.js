const DB_NAME    = 'licketch';
const DB_VER     = 2;
const STORE      = 'phrases';
const DRAFT_STORE = 'draft';
const DRAFT_KEY  = 'current';
const META_KEY   = 'licketch_meta';

export class Storage {
  constructor() { this._db = null; }

  init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(DRAFT_STORE)) {
          db.createObjectStore(DRAFT_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => { this._db = e.target.result; resolve(); };
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  // ── Phrases ────────────────────────────────────────────────

  async savePhrase(blob, meta) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await this._idbPut({ id, blob });
    const list = this.getAllMeta();
    list.unshift({ id, ...meta });
    localStorage.setItem(META_KEY, JSON.stringify(list));
    return id;
  }

  getAllMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY) || '[]'); }
    catch { return []; }
  }

  async getBlob(id) {
    const rec = await this._idbGet(id);
    return rec?.blob ?? null;
  }

  async deletePhrase(id) {
    await this._idbDelete(id);
    const list = this.getAllMeta().filter(m => m.id !== id);
    localStorage.setItem(META_KEY, JSON.stringify(list));
  }

  // ── Draft ──────────────────────────────────────────────────

  saveDraft(blob, marks) {
    return this._idbPut({ id: DRAFT_KEY, blob, marks }, DRAFT_STORE);
  }

  async getDraft() {
    const rec = await this._idbGet(DRAFT_KEY, DRAFT_STORE);
    return rec ?? null;
  }

  clearDraft() {
    return this._idbDelete(DRAFT_KEY, DRAFT_STORE);
  }

  // ── IndexedDB helpers ──────────────────────────────────────

  _idbPut(record, store = STORE) {
    return new Promise((resolve, reject) => {
      const tx  = this._db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).put(record);
      req.onsuccess = () => resolve();
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  _idbGet(id, store = STORE) {
    return new Promise((resolve, reject) => {
      const tx  = this._db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(id);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  _idbDelete(id, store = STORE) {
    return new Promise((resolve, reject) => {
      const tx  = this._db.transaction(store, 'readwrite');
      const req = tx.objectStore(store).delete(id);
      req.onsuccess = () => resolve();
      req.onerror   = (e) => reject(e.target.error);
    });
  }
}
