import { DATA_BASE, API_STATE } from './config.js';
import { lsGet, lsSet } from './store.js';

const mem = { charts: {} };
export const data = { state: null, news: null, history: null, direction: null, traders: null, offline: false, lastOk: 0, error: '' };

let apiBlockedUntil = 0;
/**
 * state.json: önce GitHub API (anında güncel). `cache: 'no-cache'` ile tarayıcı ETag'le doğrular;
 * değişmeyen yanıt (304) GitHub istek sınırından sayılmaz. Sınır/hata olursa raw adrese düşer.
 */
async function getState() {
  if (API_STATE && Date.now() > apiBlockedUntil) {
    try {
      const r = await fetch(API_STATE, { cache: 'no-cache', headers: { Accept: 'application/vnd.github.raw' } });
      if (r.ok) return r.json();
      if (r.status === 403 || r.status === 429) apiBlockedUntil = Date.now() + 10 * 60000;
    } catch { /* raw'a düş */ }
  }
  return null;
}
async function getJSON(name, api = false) {
  if (name === 'state.json' && api) { const s = await getState(); if (s) return s; }
  const r = await fetch(`${DATA_BASE}${name}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  return r.json();
}
/** Sadece JSON'ları yeniden okur, API'ye gitmez. */
export async function refresh(which = ['state', 'news', 'history'], api = false) {
  const out = {};
  let ok = true;
  await Promise.all(which.map(async (w) => {
    try {
      out[w] = await getJSON(`${w}.json`, api);
      // Önbellekli kaynaktan daha eski durum gelirse geri gitme
      if (w === 'state' && data.state && out[w]?.lastScan < data.state.lastScan) out[w] = data.state;
      lsSet(`cache.${w}`, out[w]);
    }
    catch (e) {
      out[w] = data[w] ?? lsGet(`cache.${w}`, null);
      if (w === 'direction' || w === 'traders') return; // henüz üretilmemiş olabilir — çevrimdışı sayılmaz
      ok = false; data.error = e.message;
    }
  }));
  Object.assign(data, out);
  data.offline = !ok && !navigator.onLine ? true : !ok;
  if (ok) { data.lastOk = Date.now(); data.error = ''; }
  return ok;
}
export function loadCached() {
  for (const w of ['state', 'news', 'history', 'direction', 'traders']) data[w] = lsGet(`cache.${w}`, null);
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
