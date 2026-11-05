// Ayarlar (localStorage) ve günlük/bildirim geçmişi (IndexedDB). Hepsi sadece bu cihazda.
const KEY = 'strateji.settings.v1';
export const DEFAULTS = {
  schema: 2,
  balance: '', riskPct: 0.5, currency: 'USD', maxTradesPerDay: '', maxDailyLossPct: 2, maxOpenRiskPct: 1.5,
  contracts: {}, buffers: {}, us100Price: '', instr: {}, instrConfirmed: 0, broker: 'off',
  notify: { ready: true, news: true, cancel: true, quiet: { from: '00:00', to: '07:00' }, strategies: { A: true, B: true, C: true, D: true, E: true, F: true, G: true }, matrix: {} },
  theme: 'dark', fontSize: 'normal', chartTf: '', layers: { zones: true, liq: true, trade: true, kz: true, ema: true },
  onboarded: false, lastBackup: 0, paramsDraft: null,
};
function merge(a, b) { const o = { ...a }; for (const k of Object.keys(b || {})) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' ? merge(a[k], b[k]) : b[k]; return o; }
export function loadSettings() {
  let s;
  try { s = merge(DEFAULTS, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return structuredClone(DEFAULTS); }
  // Göç (EK v1): eski boş değerlere yeni varsayılanlar
  if ((s.schema ?? 1) < 2) {
    if (!s.notify.quiet?.from && !s.notify.quiet?.to) s.notify.quiet = { from: '00:00', to: '07:00' };
    if (s.maxDailyLossPct === '' || s.maxDailyLossPct === undefined) s.maxDailyLossPct = 2;
    if (s.maxOpenRiskPct === '' || s.maxOpenRiskPct === undefined) s.maxOpenRiskPct = 1.5;
    s.schema = 2;
  }
  return s;
}
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
/** "Girmedim" kayıtları (EK §3.11) — tablette, son 300 */
const SKIP_KEY = 'strateji.skipped.v1';
const skipList = () => { try { return JSON.parse(localStorage.getItem(SKIP_KEY) || '[]'); } catch { return []; } };
export const skipped = {
  all: skipList,
  map: () => Object.fromEntries(skipList().map((x) => [x.signal_id, x])),
  put: (x) => { const l = skipList().filter((y) => y.signal_id !== x.signal_id); l.push(x); try { localStorage.setItem(SKIP_KEY, JSON.stringify(l.slice(-300))); } catch { /* depolama dolu */ } },
};
export const trades = {
  all: async () => { try { return (await tx('trades', 'readonly', (s) => s.getAll())) || []; } catch { return []; } },
  put: (x) => tx('trades', 'readwrite', (s) => s.put(x)),
  del: (id) => tx('trades', 'readwrite', (s) => s.delete(id)),
  clear: () => tx('trades', 'readwrite', (s) => s.clear()),
};
export const notifs = {
  all: async () => { try { return (await tx('notifs', 'readonly', (s) => s.getAll())) || []; } catch { return []; } },
};
