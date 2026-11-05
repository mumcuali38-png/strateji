/** Piyasa Yönü sekmesi (EK §5.7): Forex Genel + Kripto Genel, enstrüman kartları, bileşen dökümü */
import { esc, tr, dateTR, ago } from './fmt.js';

const cls = (s) => (s === null || s === undefined ? 'n' : s >= 80 ? 'l2' : s >= 60 ? 'l1' : s >= 41 ? 'n' : s >= 21 ? 's1' : 's2');
const arrow = (s) => ({ l2: '▲▲', l1: '▲', n: '●', s1: '▼', s2: '▼▼' })[cls(s)];
const chg = (c) => (c === null || c === undefined ? '' : `<span class="chg ${c > 0 ? 'up' : c < 0 ? 'down' : ''}">${c > 0 ? '▲' : c < 0 ? '▼' : '•'} ${c > 0 ? '+' : ''}${c} (24s)</span>`);

function spark(vals) {
  if (!vals || vals.length < 2) return '<div class="muted small">7 günlük grafik birikiyor</div>';
  const w = 160, h = 36, n = vals.length;
  const pts = vals.map((v, i) => `${((i / (n - 1)) * w).toFixed(1)},${(h - (v / 100) * h).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="7 günlük skor"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" class="mid"/><polyline points="${pts}" class="${cls(vals.at(-1))}"/></svg>`;
}
function gauge(title, g, note) {
  return `<div class="card dirgauge ${cls(g.score)}"><div class="muted">${esc(title)}</div>
    <div class="row" style="align-items:baseline;gap:12px"><span class="score">${g.score ?? '—'}</span><span class="dirchip ${cls(g.score)}">${arrow(g.score)} ${esc(g.label)}</span></div>
    <div>${chg(g.change24)}</div>${note ? `<div class="muted small">${esc(note)}</div>` : ''}</div>`;
}
function itemCard(it, open) {
  const W = it.comps.filter((c) => c.s !== null).reduce((a, c) => a + c.w, 0) || 1;
  return `<div class="card dircard" data-dir="${esc(it.symbol)}">
    <div class="row" style="justify-content:space-between"><b>${esc(it.name)}</b><span class="dirchip ${cls(it.score)}">${arrow(it.score)} ${it.score ?? '—'} · ${esc(it.label)}</span></div>
    <div class="row" style="justify-content:space-between;margin-top:4px">${chg(it.change24) || '<span></span>'}${spark(it.spark)}</div>
    ${it.missing.length ? `<div class="muted small">${it.missing.map(esc).join(' · ')}</div>` : ''}
    ${open ? `<div class="comps">${it.comps.map((c) => {
      const s = c.s ?? 0, pts = c.s === null ? null : (50 * c.w * c.s) / W; // skora katkı (puan)
      return `<div class="comp"><span class="nm">${esc(c.name)} <span class="muted small">w${c.w}</span></span>
        <span class="cbar"><i class="${s >= 0 ? 'pos' : 'neg'}" style="${s >= 0 ? 'left:50%' : `left:${50 + s * 50}%`};width:${Math.abs(s) * 50}%"></i></span>
        <span class="num small" title="s değeri ve skora katkı">${c.s === null ? 'yok' : `${c.s >= 0 ? '+' : ''}${c.s.toFixed(2)} · ${pts >= 0 ? '+' : ''}${pts.toFixed(1)}p`}</span>
        <span class="muted small note">${esc(c.note)}</span></div>`;
    }).join('')}</div>` : '<div class="muted small">Bileşenler için dokun</div>'}
  </div>`;
}

export function renderDirection(App, el, openSym) {
  const d = App.data.direction;
  if (!d) { el.innerHTML = '<div class="h1">Piyasa Yönü</div><div class="card empty">Henüz hesaplanmadı — tarama saatte bir günceller (ilk sonuç bir sonraki taramada)</div>'; return; }
  const src = Object.entries(d.sources ?? {});
  el.innerHTML = `<div class="row" style="justify-content:space-between"><div class="h1">Piyasa Yönü</div><div class="muted small">Güncelleme ${dateTR(d.updatedAt)} ${tr(d.updatedAt)} TR (${ago(d.updatedAt)})</div></div>
    <div class="grid2">${gauge('Forex Genel', d.forex.general, 'Yüksek = dolar genel olarak zayıf')}${gauge('Kripto Genel', d.crypto.general, '0,65 × BTC + 0,35 × ETH')}</div>
    <h2>Forex</h2><div class="dirgrid">${d.forex.items.map((it) => itemCard(it, openSym === it.symbol)).join('')}</div>
    <h2>Kripto</h2><div class="dirgrid">${d.crypto.items.map((it) => itemCard(it, openSym === it.symbol)).join('')}</div>
    <details class="card"><summary>Veri kaynakları</summary><div class="small">${src.map(([k, v]) => `<div>${esc(k)}: <b>${esc(v)}</b></div>`).join('') || '—'}</div>
      <div class="muted small">Skor = 50 + 50 × ağırlıklı ortalama (her bileşen −1…+1). Verisi olmayan bileşenin ağırlığı diğerlerine dağıtılır. Sinyal değildir; kurulumları değiştirmez.</div></details>`;
  el.querySelectorAll('[data-dir]').forEach((c) => c.addEventListener('click', () => App.go(openSym === c.dataset.dir ? '#/yon' : `#/yon/${c.dataset.dir}`)));
}
