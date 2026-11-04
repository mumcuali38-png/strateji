// Depo ve veri adresleri. Pages: https://<owner>.github.io/<repo>/  → veri: raw.githubusercontent.com/<owner>/<repo>/data/
const qs = new URLSearchParams(location.search);
function derive() {
  const host = location.hostname;
  if (host.endsWith('github.io')) {
    const owner = host.split('.')[0];
    const repo = location.pathname.split('/').filter(Boolean)[0] || `${owner}.github.io`;
    return { owner, repo };
  }
  return { owner: 'mumcuali38-png', repo: 'strateji' };
}
export const REPO = derive();
let override = null;
try { override = qs.get('data') || sessionStorage.getItem('dataOverride'); if (qs.get('data')) sessionStorage.setItem('dataOverride', qs.get('data')); } catch { override = qs.get('data'); }
export const DATA_BASE = override || (location.hostname.endsWith('github.io') ? `https://raw.githubusercontent.com/${REPO.owner}/${REPO.repo}/data/` : './data/');
export const GH = `https://github.com/${REPO.owner}/${REPO.repo}`;
export const RULES_URL = `${GH}/blob/main/MASTERPROMPT.md`;
export const ACTIONS_URL = `${GH}/actions/workflows/scan.yml`;
export const SECRETS_URL = `${GH}/settings/secrets/actions`;
export const PARAMS_EDIT_URL = `${GH}/edit/main/config/params.json`;
export const VERSION = '__BUILD__';

export const STRATS = {
  A: { name: 'A · 4H fake-out', short: 'A', tab: 'AB' },
  B: { name: 'B · HTF bölge + LTF onay', short: 'B', tab: 'AB' },
  C: { name: 'C · Nasdaq 10 AM (TNM)', short: 'C', tab: 'C' },
  D: { name: 'D · Range (ORB + konsolidasyon)', short: 'D', tab: 'D' },
  E: { name: 'E · Rejection Block', short: 'E', tab: 'E' },
};
export const TABS = [
  { id: 'AB', label: 'A/B XAU', icon: '🥇', strategies: ['A', 'B'], symbols: ['XAUUSD'] },
  { id: 'C', label: 'C 10AM', icon: '🕙', strategies: ['C'], symbols: ['US100'] },
  { id: 'D', label: 'D Range', icon: '📏', strategies: ['D'], symbols: ['US100', 'XAUUSD', 'GBPUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD'] },
  { id: 'E', label: 'E RB', icon: '🧱', strategies: ['E'], symbols: ['EURUSD', 'XAUUSD', 'GBPUSD'] },
];
export const SHORT = { XAUUSD: 'XAU', XAGUSD: 'XAG', EURUSD: 'EUR', GBPUSD: 'GBP', BTCUSD: 'BTC', ETHUSD: 'ETH', US100: 'US100' };

export async function loadStaticConfig() {
  const get = async (n) => { try { const r = await fetch(`./config/${n}`, { cache: 'no-cache' }); return await r.json(); } catch { return null; } };
  const [params, symbols, sessions] = await Promise.all([get('params.json'), get('symbols.json'), get('sessions.json')]);
  return { params, symbols, sessions };
}
