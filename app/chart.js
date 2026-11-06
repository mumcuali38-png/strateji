// Mini grafik: TradingView lightweight-charts + bölgeler için üst katman (canvas). Saat ekseni TR.
import { TR, HOUR, DAY, tr, price as fp, nyDayStart, parseHM, MIN } from './fmt.js';

const TF_ORDER = ['1m', '5m', '15m', '1h', '4h', '1d'];
const TF_LABEL = { '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1D' };
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function color(style) {
  return {
    ob: ['--long', 0.16], mb: ['--long', 0.12], breaker: ['--short', 0.14], fvg: ['--info', 0.14], ifvg: ['--info', 0.1], rb: ['--eksik', 0.16],
    range: ['--muted', 0.10], liq: ['--eksik', 0.12], eq: ['--muted', 1], entry: ['--long', 1], stop: ['--short', 1], tp: ['--info', 1], line4h: ['--eksik', 1], level: ['--muted', 1],
  }[style] ?? ['--muted', 0.12];
}
function rgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function mountChart(root, { chartData, setup, sessions, layers, onLayers, tf, onTf, asOf }) {
  root.innerHTML = '';
  const LW = window.LightweightCharts;
  const tfs = TF_ORDER.filter((x) => chartData?.tfs?.[x]?.length);
  const allowed = new Set(setup?.tfs ?? tfs);
  let cur = tf && tfs.includes(tf) ? tf : setup?.chartTf && tfs.includes(setup.chartTf) ? setup.chartTf : tfs.includes('5m') ? '5m' : tfs[0];
  const head = document.createElement('div');
  head.className = 'chart-head';
  head.innerHTML = `<div class="seg">${TF_ORDER.map((x) => `<button class="seg-b ${x === cur ? 'on' : ''}" data-tf="${x}" ${tfs.includes(x) ? '' : 'disabled'} ${allowed.has(x) ? '' : 'data-dim="1"'}>${TF_LABEL[x]}</button>`).join('')}</div>
    <button class="icon-b" data-layers aria-label="Katmanlar">☰ Katman</button>`;
  const menu = document.createElement('div');
  menu.className = 'layer-menu hidden';
  const L = { zones: 'Bölgeler (OB/FVG/RB/range)', liq: 'Likidite ($$)', trade: 'Giriş / Stop / TP', kz: 'Killzone gölgesi', ema: '4H EMA50' };
  menu.innerHTML = Object.entries(L).map(([k, v]) => `<label class="chk"><input type="checkbox" data-layer="${k}" ${layers[k] ? 'checked' : ''}> ${v}</label>`).join('');
  const box = document.createElement('div');
  box.className = 'chart-box';
  const foot = document.createElement('div');
  foot.className = 'chart-foot';
  foot.textContent = asOf ? `Son mum canlı değil · ${tr(asOf)} itibarıyla` : '';
  root.append(head, menu, box, foot);
  if (!LW || !tfs.length) { box.innerHTML = `<div class="empty">${LW ? 'Grafik verisi yok · sonraki taramayı bekleyin' : 'Grafik kütüphanesi yüklenemedi (çevrimdışı?)'}</div>`; return { highlight() {}, destroy() {} }; }

  const chart = LW.createChart(box, {
    autoSize: true,
    layout: { background: { type: 'solid', color: css('--card') }, textColor: css('--muted'), fontFamily: css('--mono') || 'monospace' },
    grid: { vertLines: { color: rgba(css('--border'), 0.5) }, horzLines: { color: rgba(css('--border'), 0.5) } },
    rightPriceScale: { borderColor: css('--border') },
    timeScale: { borderColor: css('--border'), timeVisible: true, secondsVisible: false, rightOffset: 6,
      tickMarkFormatter: (t, type) => { const d = new Date(t * 1000); const p2 = (n) => String(n).padStart(2, '0'); return type <= 2 ? `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}` : `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; } },
    localization: { locale: 'tr-TR', timeFormatter: (t) => { const d = new Date(t * 1000); const p2 = (n) => String(n).padStart(2, '0'); return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} TR`; } },
    crosshair: { mode: 0 },
    handleScale: { pinch: true, mouseWheel: true, axisPressedMouseMove: true },
    handleScroll: { horzTouchDrag: true, vertTouchDrag: false, pressedMouseMove: true },
  });
  const dec = chartData.decimals ?? 2;
  const series = chart.addCandlestickSeries({
    upColor: css('--long'), downColor: css('--short'), borderVisible: false, wickUpColor: css('--long'), wickDownColor: css('--short'),
    priceFormat: { type: 'price', precision: dec, minMove: Math.pow(10, -dec) },
  });
  // Hacim çubukları (F): RV ≥ 1.5 olanlar vurgulu
  const vol = chartData.volume ? chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false }) : null;
  if (vol) chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  const ema = chart.addLineSeries({ color: css('--eksik'), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  // Ek göstergeler (örn. H: EMA20/EMA50 1H) — chartData.lines: [{ name, tf, color, pts: [[t, v]] }]
  const extra = (chartData.lines ?? []).map((l) => ({ l, s: chart.addLineSeries({ color: css(l.color || '--info'), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: l.name }) }));
  const canvas = document.createElement('canvas');
  canvas.className = 'chart-overlay';
  box.appendChild(canvas);
  let bars = [], lines = [], hl = null, alive = true;
  const toT = (ms) => ms / 1000 + TR / 1000;

  function idxOf(ms) {
    let lo = 0, hi = bars.length - 1;
    if (!bars.length) return 0;
    if (ms <= bars[0][0]) return 0 - (bars[0][0] - ms) / ((bars[1]?.[0] ?? bars[0][0] + 60000) - bars[0][0]);
    if (ms >= bars[hi][0]) return hi + (ms - bars[hi][0]) / (bars[hi][0] - (bars[hi - 1]?.[0] ?? bars[hi][0] - 60000));
    while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m][0] < ms) lo = m + 1; else hi = m; }
    return lo;
  }
  function setTf(x) {
    cur = x;
    bars = chartData.tfs[x];
    series.setData(bars.map((b) => ({ time: toT(b[0]), open: b[1], high: b[2], low: b[3], close: b[4] })));
    if (vol) {
      const v = bars.map((b) => b[5] ?? 0);
      vol.setData(bars.map((b, i) => {
        let sum = 0; for (let k = Math.max(0, i - 20); k < i; k++) sum += v[k];
        const rv = i >= 20 && sum > 0 ? (v[i] * 20) / sum : 0;
        return { time: toT(b[0]), value: v[i], color: rv >= 1.5 ? rgba(css('--eksik'), 0.9) : rgba(css('--muted'), 0.35) };
      }));
    }
    if (layers.ema && chartData.ema50_4h?.length) {
      const first = bars[0][0];
      const pts = chartData.ema50_4h.filter((p) => p[0] >= first - 4 * HOUR);
      const data = [];
      for (const b of bars) { let v = null; for (let i = pts.length - 1; i >= 0; i--) if (pts[i][0] + 4 * HOUR <= b[0] + 1) { v = pts[i][1]; break; } if (v !== null) data.push({ time: toT(b[0]), value: v }); }
      ema.setData(data);
    } else ema.setData([]);
    for (const { l, s } of extra) {
      if (!layers.ema) { s.setData([]); continue; }
      const pts = l.pts, out = [];
      let j = 0;
      for (const b of bars) { while (j + 1 < pts.length && pts[j + 1][0] <= b[0]) j++; if (pts[j] && pts[j][0] <= b[0]) out.push({ time: toT(b[0]), value: pts[j][1] }); }
      s.setData(out);
    }
    for (const l of lines) series.removePriceLine(l);
    lines = [];
    for (const o of setup?.overlays ?? []) {
      if (o.kind !== 'line' || o.price === undefined) continue;
      const isTrade = ['entry', 'stop', 'tp'].includes(o.style);
      if (isTrade && !layers.trade) continue;
      if (!isTrade && (o.style === 'liq' ? !layers.liq : !layers.zones)) continue;
      const [cv] = color(o.style);
      const strong = hl && (hl === o.cond || Math.abs(hl - o.price) < 1e-9);
      lines.push(series.createPriceLine({ price: o.price, color: css(cv), lineWidth: strong ? 3 : isTrade ? 2 : 1, lineStyle: o.style === 'liq' || o.style === 'eq' || o.style === 'level' ? 2 : 0, axisLabelVisible: isTrade || strong || o.style === 'line4h', title: o.label }));
    }
    if (typeof hl === 'number') lines.push(series.createPriceLine({ price: hl, color: css('--info'), lineWidth: 3, lineStyle: 1, axisLabelVisible: true, title: 'seçili' }));
    if (setup?.signalAt) {
      const i = idxOf(setup.signalAt);
      const b = bars[Math.max(0, Math.min(bars.length - 1, Math.round(i)))];
      if (b) series.setMarkers([{ time: toT(b[0]), position: setup.dir === -1 ? 'aboveBar' : 'belowBar', color: css('--info'), shape: setup.dir === -1 ? 'arrowDown' : 'arrowUp', text: 'sinyal' }]);
    } else series.setMarkers([]);
    const n = bars.length;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 120), to: n + 5 });
    head.querySelectorAll('[data-tf]').forEach((b) => b.classList.toggle('on', b.dataset.tf === x));
    requestAnimationFrame(draw);
  }
  function draw() {
    if (!alive || !box.isConnected) return;
    try { drawInner(); } catch { /* grafik kaldırıldı */ }
  }
  function drawInner() {
    const w = box.clientWidth, h = box.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr; canvas.height = h * dpr;
    canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const ps = chart.priceScale('right').width();
    const ts = chart.timeScale();
    const paneW = w - ps, paneH = h - ts.height();
    g.save(); g.beginPath(); g.rect(0, 0, paneW, paneH); g.clip();
    const X = (ms) => ts.logicalToCoordinate(idxOf(ms));
    if (layers.kz && setup?.strategy !== 'F' && sessions?.killzones && bars.length && ['1m', '3m', '5m', '15m', '1h'].includes(cur)) {
      const first = bars[0][0], last = bars[bars.length - 1][0];
      for (let d = nyDayStart(first); d <= last; d += DAY) {
        for (const k of sessions.killzones) {
          const a = X(d + parseHM(k.start) * MIN), b = X(d + parseHM(k.end) * MIN);
          if (a === null || b === null) continue;
          g.fillStyle = rgba(css('--info'), 0.05);
          g.fillRect(a, 0, b - a, paneH);
        }
      }
    }
    if (layers.zones || layers.liq) {
      for (const o of setup?.overlays ?? []) {
        if (o.kind !== 'zone' || o.top === undefined) continue;
        if (o.style === 'liq' ? !layers.liq : !layers.zones) continue;
        const y1 = series.priceToCoordinate(o.top), y2 = series.priceToCoordinate(o.bottom);
        if (y1 === null || y2 === null) continue;
        const x1 = o.from ? Math.max(0, X(o.from) ?? 0) : 0;
        const x2 = o.to ? Math.min(paneW, X(o.to) ?? paneW) : paneW;
        const [cv, a] = color(o.style);
        const strong = hl === o.cond;
        g.fillStyle = rgba(css(cv), strong ? a * 2.2 : a);
        g.fillRect(x1, Math.min(y1, y2), Math.max(2, x2 - x1), Math.abs(y2 - y1) || 1);
        g.strokeStyle = rgba(css(cv), strong ? 0.9 : 0.45);
        g.setLineDash(o.style === 'fvg' || o.style === 'ifvg' ? [4, 3] : []);
        g.lineWidth = strong ? 2 : 1;
        g.strokeRect(x1, Math.min(y1, y2), Math.max(2, x2 - x1), Math.abs(y2 - y1) || 1);
        if (o.style === 'fvg') {
          const yc = series.priceToCoordinate((o.top + o.bottom) / 2);
          g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x1, yc); g.lineTo(x2, yc); g.stroke();
        }
        g.setLineDash([]);
        g.fillStyle = css('--muted'); g.font = '11px system-ui';
        g.fillText(o.label, x1 + 4, Math.min(y1, y2) + 12);
      }
    }
    g.restore();
  }
  head.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tf]');
    if (b && !b.disabled) { setTf(b.dataset.tf); onTf?.(b.dataset.tf); }
    if (e.target.closest('[data-layers]')) menu.classList.toggle('hidden');
  });
  menu.addEventListener('change', (e) => {
    const k = e.target.dataset.layer;
    if (!k) return;
    layers[k] = e.target.checked;
    onLayers?.(layers);
    setTf(cur);
  });
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => requestAnimationFrame(draw));
  const ro = new ResizeObserver(() => requestAnimationFrame(draw));
  ro.observe(box);
  setTf(cur);
  return {
    highlight(v) { if (alive) { hl = v; setTf(cur); } },
    destroy() { if (!alive) return; alive = false; ro.disconnect(); chart.remove(); },
  };
}
export const _fp = fp;
