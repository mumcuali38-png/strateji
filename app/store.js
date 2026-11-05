// Ayarlar (localStorage) ve günlük/bildirim geçmişi (IndexedDB). Hepsi sadece bu cihazda.
const KEY = 'strateji.settings.v1';
export const DEFAULTS = {
  balance: 10000, riskPct: 0.5, currency: 'USD', maxTradesPerDay: '', maxDailyLossPct: '',
  contracts: {}, buffers: {}, us100Price: '',
  notify: { ready: true, news: true, cancel: true, quiet: { from: '', to: '' }, strategies: { A: true, B: true, C: true, D: true, E: true }, matrix: {} },
  theme: 'dark', fontSize: 'normal', chartTf: '', layers: { zones: true, liq: true, trade: true, kz: true, ema: true },
  onboarded: false, lastBackup: 0, paramsDraft: null,
};
function merge(a, b) { const o = { ...a }; for (const k of Object.keys(b || {})) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' ? merge(a[k], b[k]) : b[k]; return o; }
export function loadSettings() { try { return merge(DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return structuredClone(DEFAULTS); } }
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* özel pencere */ } }
export function lsGet(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }
export function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* yok say */ } }

let dbp = null;
export function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open('strateji', 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('trades')) d.createObjectStore('trades', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('notifs')) d.createObjectStore('notifs', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = () => rej(t.error);
  });
}
export const trades = {
  all: async () => { try { return (await tx('trades', 'readonly', (s) => s.getAll())) || []; } catch { return []; } },
  put: (x) => tx('trades', 'readwrite', (s) => s.put(x)),
  del: (id) => tx('trades', 'readwrite', (s) => s.delete(id)),
  clear: () => tx('trades', 'readwrite', (s) => s.clear()),
};
export const notifs = {
  all: async () => { try { return (await tx('notifs', 'readonly', (s) => s.getAll())) || []; } catch { return []; } },
};
