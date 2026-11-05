import type { Candle, Dir, TF } from './types.ts';
import { body, isBear, isBull } from './candles.ts';
import { atr as atrSeries } from './indicators.ts';

export interface SwingParams { n: number; dispMult: number; dispLookback: number; atrPeriod: number; equalTolAtr: number; fvgMinAtr: number; consBars: number; consMaxBos: number; consRangeAtr: number; minBos: number; strongBos: number }

export interface Swing { i: number; t: number; type: 'H' | 'L'; price: number }
export interface Break {
  i: number; t: number; dir: Dir; type: 'BOS' | 'CHoCH'; level: number; swing: Swing;
  legStart: number; legExtreme: number; displacement: boolean; mss: boolean;
}
export type ZoneKind = 'OB' | 'FVG' | 'IFVG' | 'BRK' | 'MB';
export interface Zone {
  id: string; kind: ZoneKind; tf: TF; dir: Dir; top: number; bottom: number;
  i: number; t: number; startIdx: number;
  touchedIdx?: number; touchedAt?: number; brokenIdx?: number; brokenAt?: number;
  sweptLiq?: boolean; causedBos?: boolean; inLeg?: boolean; breakIdx?: number; legStart?: number;
}
export interface Liq {
  price: number; side: 'buy' | 'sell'; kind: string; t: number; i?: number; tf: TF;
  takenAt?: number; takenIdx?: number; takenBy?: 'sweep' | 'break';
}
export interface Analysis {
  tf: TF; c: Candle[]; swings: Swing[]; breaks: Break[];
  trend: { dir: Dir | 0; count: number; strong: boolean; label: string };
  zones: Zone[]; liquidity: Liq[]; atr: number; atrArr: number[]; consolidation: boolean;
  avgBody: (i: number) => number; isDisp: (i: number, dir: Dir) => boolean;
}

export const DIR_TXT = (d: Dir | 0) => (d === 1 ? 'yükseliş' : d === -1 ? 'düşüş' : 'net değil');

/** Fraktal swing: solundaki n mumdan büyük, sağındaki n mumdan büyük/eşit değil */
export function findSwings(c: Candle[], n: number): Swing[] {
  const out: Swing[] = [];
  for (let i = n; i < c.length - n; i++) {
    let isH = true, isL = true;
    for (let k = 1; k <= n; k++) {
      if (!(c[i].h > c[i - k].h && c[i].h >= c[i + k].h)) isH = false;
      if (!(c[i].l < c[i - k].l && c[i].l <= c[i + k].l)) isL = false;
      if (!isH && !isL) break;
    }
    if (isH) out.push({ i, t: c[i].t, type: 'H', price: c[i].h });
    if (isL) out.push({ i, t: c[i].t, type: 'L', price: c[i].l });
  }
  return out;
}

export function makeAvgBody(c: Candle[], lookback: number) {
  const pref = [0];
  for (const x of c) pref.push(pref[pref.length - 1] + body(x));
  return (i: number) => {
    const s = Math.max(0, i - lookback);
    const n = i - s;
    return n > 0 ? (pref[i] - pref[s]) / n : body(c[i]);
  };
}

/** Lifecycle: dokunma (mitigasyon) ve kapanışla kırılma */
export function lifecycle(z: Zone, c: Candle[], from: number): void {
  for (let m = from; m < c.length; m++) {
    const x = c[m];
    const touch = z.dir === 1 ? x.l <= z.top : x.h >= z.bottom;
    const broken = z.dir === 1 ? x.c < z.bottom : x.c > z.top;
    if (touch && z.touchedIdx === undefined) { z.touchedIdx = m; z.touchedAt = x.t; }
    if (broken) { z.brokenIdx = m; z.brokenAt = x.t; return; }
  }
}

export function analyze(c: Candle[], tf: TF, p: SwingParams): Analysis {
  const atrArr = atrSeries(c, p.atrPeriod);
  const atrLast = (() => { for (let i = atrArr.length - 1; i >= 0; i--) if (Number.isFinite(atrArr[i])) return atrArr[i]; return NaN; })();
  const atrAt = (i: number) => (Number.isFinite(atrArr[i]) ? atrArr[i] : atrLast);
  const avgBody = makeAvgBody(c, p.dispLookback);
  const isDisp = (i: number, dir: Dir) => {
    const x = c[i];
    if (!x) return false;
    const dirOk = dir === 1 ? isBull(x) : isBear(x);
    return dirOk && i >= 5 && body(x) >= p.dispMult * avgBody(i);
  };

  const swings = findSwings(c, p.n);
  const confirmAt = new Map<number, Swing[]>();
  for (const s of swings) {
    const k = s.i + p.n;
    if (!confirmAt.has(k)) confirmAt.set(k, []);
    confirmAt.get(k)!.push(s);
  }

  const breaks: Break[] = [];
  let lastH: Swing | null = null, lastL: Swing | null = null;
  let dir: Dir | 0 = 0, count = 0;
  for (let k = 0; k < c.length; k++) {
    for (const s of confirmAt.get(k) ?? []) { if (s.type === 'H') lastH = s; else lastL = s; }
    const x = c[k];
    for (const bd of [1, -1] as Dir[]) {
      const s = bd === 1 ? lastH : lastL;
      if (!s || s.i >= k) continue;
      const broke = bd === 1 ? x.c > s.price : x.c < s.price;
      if (!broke) continue;
      let legStart = s.i;
      for (let m = s.i; m <= k; m++) {
        if (bd === 1 ? c[m].l < c[legStart].l : c[m].h > c[legStart].h) legStart = m;
      }
      let displacement = false;
      for (let m = legStart; m <= k; m++) if (isDisp(m, bd)) { displacement = true; break; }
      let type: 'BOS' | 'CHoCH';
      if (dir === bd) { type = 'BOS'; count++; }
      else if (dir === 0) { type = 'BOS'; dir = bd; count = 1; }
      else { type = 'CHoCH'; dir = bd; count = 0; }
      breaks.push({ i: k, t: x.t, dir: bd, type, level: s.price, swing: s, legStart, legExtreme: bd === 1 ? c[legStart].l : c[legStart].h, displacement, mss: type === 'CHoCH' && displacement });
      if (bd === 1) lastH = null; else lastL = null;
    }
  }
  const strong = count >= p.strongBos;
  const trend = {
    dir: count >= p.minBos ? dir : (0 as const),
    count, strong,
    label: count >= p.strongBos ? `güçlü ${DIR_TXT(dir)} (${count} BOS)` : count >= p.minBos ? `${DIR_TXT(dir)} (${count} BOS)` : `net değil (${dir ? DIR_TXT(dir) + ' yönünde ' : ''}${count} BOS)`,
  };

  // --- Bölgeler ---
  const zones: Zone[] = [];
  const seenOB = new Set<number>();
  const swingLows = swings.filter((s) => s.type === 'L');
  const swingHighs = swings.filter((s) => s.type === 'H');
  for (const br of breaks) {
    if (!br.displacement) continue;
    const want = br.dir === 1 ? isBear : isBull;
    let m = br.legStart;
    while (m >= Math.max(0, br.legStart - 5) && !want(c[m])) m--;
    if (m < 0 || m < br.legStart - 5 || !want(c[m])) continue;
    let first = m;
    while (first - 1 >= 0 && want(c[first - 1]) && m - first < 2) first--;
    if (seenOB.has(m)) continue;
    seenOB.add(m);
    let top = -Infinity, bottom = Infinity;
    for (let q = first; q <= m; q++) { top = Math.max(top, c[q].h); bottom = Math.min(bottom, c[q].l); }
    // OB'yi oluşturan swing daha önce likidite aldı mı?
    const ext = br.dir === 1 ? bottom : top;
    const prior = (br.dir === 1 ? swingLows : swingHighs).filter((s) => s.i < first && s.i + p.n < first && s.i > first - 60);
    const sweptLiq = prior.some((s) => (br.dir === 1 ? ext < s.price : ext > s.price));
    const z: Zone = { id: `${tf}-OB-${c[m].t}`, kind: 'OB', tf, dir: br.dir, top, bottom, i: m, t: c[first].t, startIdx: br.i + 1, sweptLiq, causedBos: true, breakIdx: br.i, legStart: br.legStart };
    lifecycle(z, c, br.i + 1);
    zones.push(z);
    if (z.brokenIdx !== undefined) {
      const b = z.brokenIdx;
      const nd = (-br.dir) as Dir;
      const kind: ZoneKind | null = sweptLiq ? 'BRK' : isDisp(b, nd) ? 'MB' : null;
      if (kind) {
        const fz: Zone = { id: `${tf}-${kind}-${c[m].t}`, kind, tf, dir: nd, top, bottom, i: b, t: c[first].t, startIdx: b + 1 };
        lifecycle(fz, c, b + 1);
        zones.push(fz);
      }
    }
  }
  for (let i = 2; i < c.length; i++) {
    const a = c[i - 2], z3 = c[i];
    const minSize = p.fvgMinAtr * atrAt(i);
    for (const d of [1, -1] as Dir[]) {
      const top = d === 1 ? z3.l : a.l;
      const bottom = d === 1 ? a.h : z3.h;
      if (!(top - bottom > minSize)) continue;
      const inLeg = breaks.some((br) => br.dir === d && br.legStart <= i - 1 && i - 1 <= br.i + 1);
      const z: Zone = { id: `${tf}-FVG-${c[i - 1].t}`, kind: 'FVG', tf, dir: d, top, bottom, i, t: c[i - 1].t, startIdx: i + 1, inLeg };
      lifecycle(z, c, i + 1);
      zones.push(z);
      if (z.brokenIdx !== undefined) {
        const iz: Zone = { id: `${tf}-IFVG-${c[i - 1].t}`, kind: 'IFVG', tf, dir: (-d) as Dir, top, bottom, i: z.brokenIdx, t: c[i - 1].t, startIdx: z.brokenIdx + 1 };
        lifecycle(iz, c, z.brokenIdx + 1);
        zones.push(iz);
      }
    }
  }

  // --- Likidite ---
  const liquidity: Liq[] = [];
  const takeStatus = (l: Liq, from: number) => {
    for (let m = from; m < c.length; m++) {
      const x = c[m];
      if (l.side === 'buy' ? x.h > l.price : x.l < l.price) {
        l.takenIdx = m; l.takenAt = x.t;
        l.takenBy = (l.side === 'buy' ? x.c <= l.price : x.c >= l.price) ? 'sweep' : 'break';
        return;
      }
    }
  };
  for (const s of swings) {
    const l: Liq = { price: s.price, side: s.type === 'H' ? 'buy' : 'sell', kind: s.type === 'H' ? 'swing high' : 'swing low', t: s.t, i: s.i, tf };
    takeStatus(l, s.i + 1);
    liquidity.push(l);
  }
  const tol = p.equalTolAtr * atrLast;
  for (const arr of [swingHighs, swingLows]) {
    const recent = arr.slice(-30);
    for (let a = 0; a < recent.length; a++) for (let b = a + 1; b < recent.length; b++) {
      const s1 = recent[a], s2 = recent[b];
      if (s2.i - s1.i < 3 || Math.abs(s1.price - s2.price) > tol) continue;
      // arada seviyeyi geçen mum olmamalı
      const isH = s1.type === 'H';
      const lvl = isH ? Math.max(s1.price, s2.price) : Math.min(s1.price, s2.price);
      let clean = true;
      for (let m = s1.i + 1; m < s2.i; m++) if (isH ? c[m].h > lvl : c[m].l < lvl) { clean = false; break; }
      if (!clean) continue;
      const l: Liq = { price: lvl, side: isH ? 'buy' : 'sell', kind: isH ? 'eşit tepe' : 'eşit dip', t: s2.t, i: s2.i, tf };
      takeStatus(l, s2.i + 1);
      liquidity.push(l);
    }
  }

  // --- Konsolidasyon ---
  let consolidation = false;
  if (c.length >= p.consBars) {
    const s = c.length - p.consBars;
    const nBos = breaks.filter((b) => b.i >= s).length;
    let hh = -Infinity, ll = Infinity;
    for (let m = s; m < c.length; m++) { hh = Math.max(hh, c[m].h); ll = Math.min(ll, c[m].l); }
    consolidation = nBos <= p.consMaxBos && hh - ll < atrLast * p.consRangeAtr;
  }

  return { tf, c, swings, breaks, trend, zones, liquidity, atr: atrLast, atrArr, consolidation, avgBody, isDisp };
}

/** Mumun displacement + güçlü gövde (gövde/boy ≥ oran) olup olmadığı */
export function isStrong(an: Analysis, i: number, dir: Dir, bodyRatio: number): boolean {
  const x = an.c[i];
  const r = x.h - x.l;
  return an.isDisp(i, dir) && r > 0 && body(x) / r >= bodyRatio;
}

/** RSI uyumsuzluğu: son iki swing dibi (long) veya tepesi (short) */
export function rsiDivergence(c: Candle[], swings: Swing[], rsiArr: number[], dir: Dir): boolean {
  const s = swings.filter((x) => x.type === (dir === 1 ? 'L' : 'H')).slice(-2);
  if (s.length < 2) return false;
  const [a, b] = s;
  const ra = rsiArr[a.i], rb = rsiArr[b.i];
  if (!Number.isFinite(ra) || !Number.isFinite(rb)) return false;
  return dir === 1 ? b.price < a.price && rb > ra : b.price > a.price && rb < ra;
}
