import { DATA_BASE } from './config.js';
import { lsGet, lsSet } from './store.js';

const mem = { charts: {} };
export const data = { state: null, news: null, history: null, offline: false, lastOk: 0, error: '' };

async function getJSON(name) {
  const r = await fetch(`${DATA_BASE}${name}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}
/** Sadece JSON'ları yeniden okur, API'ye gitmez. */
export async function refresh(which = ['state', 'news', 'history']) {
  const out = {};
  let ok = true;
  await Promise.all(which.map(async (w) => {
    try { out[w] = await getJSON(`${w}.json`); lsSet(`cache.${w}`, out[w]); }
    catch (e) { ok = false; data.error = e.message; out[w] = data[w] ?? lsGet(`cache.${w}`, null); }
  }));
  Object.assign(data, out);
  data.offline = !ok && !navigator.onLine ? true : !ok;
  if (ok) { data.lastOk = Date.now(); data.error = ''; }
  return ok;
}
export function loadCached() {
  for (const w of ['state', 'news', 'history']) data[w] = lsGet(`cache.${w}`, null);
}
export async function chart(sym, force = false) {
  const c = mem.charts[sym];
  if (c && !force && c.t === data.state?.generatedAt) return c;
  try {
    const j = await getJSON(`charts/${sym}.json`);
    mem.charts[sym] = j;
    return j;
  } catch { return c ?? null; }
}
export async function stateVersion() {
  try { const s = await getJSON('state.json'); return s; } catch { return null; }
}
