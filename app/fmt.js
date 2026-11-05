// Biçimlendirme: tüm saatler kullanıcıya TR (UTC+3), strateji saati sabit NY (UTC-5)
export const MIN = 60000, HOUR = 3600000, DAY = 86400000;
export const TR = 3 * HOUR, NY = -5 * HOUR;
const pad = (n) => String(n).padStart(2, '0');
export function hmAt(t, off) { const d = new Date(t + off); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; }
export const tr = (t) => (t ? hmAt(t, TR) : '—');
export const ny = (t) => (t ? hmAt(t, NY) : '—');
export const trny = (t) => `${tr(t)} TR · ${ny(t)} NY`;
export function dateTR(t) { const d = new Date(t + TR); return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}`; }
export function dayNameTR(t) { return ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'][new Date(t + TR).getUTCDay()]; }
export function nyMinutes(t) { const d = new Date(t + NY); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
export function trMinutes(t) { const d = new Date(t + TR); return d.getUTCHours() * 60 + d.getUTCMinutes(); }
export function nyDayStart(t) { return Math.floor((t + NY) / DAY) * DAY - NY; }
export function trDayStart(t) { return Math.floor((t + TR) / DAY) * DAY - TR; }
export function parseHM(s) { const [h, m] = s.split(':').map(Number); return h * 60 + m; }
export function dur(ms) {
  const m = Math.max(0, Math.round(ms / MIN));
  const h = Math.floor(m / 60);
  if (h >= 24) return `${Math.floor(h / 24)}g ${h % 24}s`;
  return h ? `${h}s ${m % 60}dk` : `${m} dk`;
}
export function ago(t, now = Date.now()) { return t ? `${dur(now - t)} önce` : '—'; }
export function price(x, dec) { return x === undefined || x === null || !Number.isFinite(x) ? '—' : Number(x).toFixed(dec); }
export function pct(a, b) { return b ? `${(((a - b) / b) * 100).toFixed(2)}%` : '—'; }
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
export const STATUS = {
  TAM: { icon: '🔵', text: 'TAM', cls: 'tam' },
  BEKLE: { icon: '🟠', text: 'TAM – BEKLE', cls: 'bekle' },
  EKSIK: { icon: '🟡', text: 'EKSİK', cls: 'eksik' },
  YOK: { icon: '⚪', text: 'YOK', cls: 'yok' },
};
export const COND_ICON = { ok: '✅', fail: '❌', wait: '⏳' };
export function badge(s, extra = '') {
  if (!s) return '<span class="badge yok">⚪ —</span>';
  const st = STATUS[s.status];
  const rem = s.status === 'EKSIK' ? ` · ${s.remaining === 1 ? '1 şart kaldı' : s.remaining + ' şart'}` : s.status === 'BEKLE' && s.missing ? ` (${String(s.missing).replace(/^BLOK: /, '').split(' · ')[0]})` : '';
  return `<span class="badge ${st.cls}" ${extra}>${st.icon} ${st.text}${rem}</span>`;
}
/** Yön: renk + ▲/▼ + yazı birlikte (EK §2.1) */
export const dirTxt = (d) => (d === 1 ? '▲ LONG' : d === -1 ? '▼ SHORT' : '● —');
export const dirCls = (d) => (d === 1 ? 'dl' : d === -1 ? 'ds' : '');
