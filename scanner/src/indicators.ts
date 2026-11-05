import type { Candle } from './types.ts';
import { nyDayStart } from './time.ts';

export function sma(v: number[], p: number): number[] {
  const out = new Array(v.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= p) s -= v[i - p];
    if (i >= p - 1) out[i] = s / p;
  }
  return out;
}

export function ema(v: number[], p: number): number[] {
  const out = new Array(v.length).fill(NaN);
  if (v.length < p) return out;
  const k = 2 / (p + 1);
  let prev = v.slice(0, p).reduce((a, b) => a + b, 0) / p;
  out[p - 1] = prev;
  for (let i = p; i < v.length; i++) { prev = v[i] * k + prev * (1 - k); out[i] = prev; }
  return out;
}

export function trueRange(c: Candle[]): number[] {
  return c.map((x, i) => (i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1].c), Math.abs(x.l - c[i - 1].c))));
}

/** Wilder ATR */
export function atr(c: Candle[], p = 14): number[] {
  const tr = trueRange(c);
  const out = new Array(c.length).fill(NaN);
  if (c.length < p) {
    if (c.length) out[c.length - 1] = tr.reduce((a, b) => a + b, 0) / c.length;
    return out;
  }
  let prev = tr.slice(0, p).reduce((a, b) => a + b, 0) / p;
  out[p - 1] = prev;
  for (let i = p; i < c.length; i++) { prev = (prev * (p - 1) + tr[i]) / p; out[i] = prev; }
  return out;
}

export function lastAtr(c: Candle[], p = 14): number {
  const a = atr(c, p);
  for (let i = a.length - 1; i >= 0; i--) if (Number.isFinite(a[i])) return a[i];
  return NaN;
}

/** Wilder RSI */
export function rsi(v: number[], p = 14): number[] {
  const out = new Array(v.length).fill(NaN);
  if (v.length <= p) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = v[i] - v[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= p; l /= p;
  out[p] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = p + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    g = (g * (p - 1) + Math.max(d, 0)) / p;
    l = (l * (p - 1) + Math.max(-d, 0)) / p;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export function macd(v: number[], f = 12, s = 26, sig = 9): { macd: number[]; signal: number[]; hist: number[] } {
  const ef = ema(v, f), es = ema(v, s);
  const m = v.map((_, i) => ef[i] - es[i]);
  const firstValid = m.findIndex(Number.isFinite);
  const sigLine = new Array(v.length).fill(NaN);
  if (firstValid >= 0) {
    const e = ema(m.slice(firstValid), sig);
    for (let i = 0; i < e.length; i++) sigLine[firstValid + i] = e[i];
  }
  return { macd: m, signal: sigLine, hist: m.map((x, i) => x - sigLine[i]) };
}

/** Günlük VWAP, NY 00:00'da sıfırlanır. Hacim yoksa (FX) eşit ağırlık kullanılır. */
export function vwap(c: Candle[]): number[] {
  const out: number[] = [];
  let day = -1, pv = 0, vv = 0;
  for (const x of c) {
    const d = nyDayStart(x.t);
    if (d !== day) { day = d; pv = 0; vv = 0; }
    const vol = x.v && x.v > 0 ? x.v : 1;
    const tp = (x.h + x.l + x.c) / 3;
    pv += tp * vol; vv += vol;
    out.push(pv / vv);
  }
  return out;
}

function stdev(v: number[], end: number, p: number): number {
  const s = v.slice(end - p + 1, end + 1);
  const m = s.reduce((a, b) => a + b, 0) / p;
  return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / p);
}

function linregLast(v: number[]): number {
  const n = v.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += v[i]; sxy += i * v[i]; sxx += i * i; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  const icpt = (sy - slope * sx) / n;
  return icpt + slope * (n - 1);
}

/** Squeeze Momentum (LazyBear): BB 20/2, KC 20/1.5. sqzOn = siyah nokta (sıkışma) */
export function squeeze(c: Candle[], bbLen = 20, bbMult = 2, kcLen = 20, kcMult = 1.5): { val: number[]; sqzOn: boolean[] } {
  const close = c.map((x) => x.c);
  const basis = sma(close, bbLen);
  const tr = trueRange(c);
  const rangeMa = sma(tr, kcLen);
  const ma = sma(close, kcLen);
  const val = new Array(c.length).fill(NaN);
  const sqzOn = new Array(c.length).fill(false);
  for (let i = 0; i < c.length; i++) {
    if (i >= bbLen - 1 && i >= kcLen - 1) {
      const dev = bbMult * stdev(close, i, bbLen);
      const upperBB = basis[i] + dev, lowerBB = basis[i] - dev;
      const upperKC = ma[i] + rangeMa[i] * kcMult, lowerKC = ma[i] - rangeMa[i] * kcMult;
      sqzOn[i] = lowerBB > lowerKC && upperBB < upperKC;
    }
    if (i >= kcLen * 2 - 2) {
      const seg: number[] = [];
      for (let j = i - kcLen + 1; j <= i; j++) {
        let hh = -Infinity, ll = Infinity;
        for (let k = j - kcLen + 1; k <= j; k++) { hh = Math.max(hh, c[k].h); ll = Math.min(ll, c[k].l); }
        seg.push(close[j] - ((hh + ll) / 2 + ma[j]) / 2);
      }
      val[i] = linregLast(seg);
    }
  }
  return { val, sqzOn };
}
