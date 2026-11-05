// KURULUM F — BTCUSD Wyckoff (Spring / UTAD). Şartname: docs/KURULUM_F.md
// Short tarafı long kurallarının fiyat-aynasıdır (fiyatlar −1 ile çarpılır, hacim aynı);
// spec'teki "daha sıkı" farklar `side.short` ile uygulanır.
import type { Candle, Condition, Dir, EntryMethod, NewsEvent, Overlay } from '../types.ts';
import type { Params } from '../config.ts';
import { atr as atrSeries, ema, sma } from '../indicators.ts';
import { DAY, HOUR, MIN, parseHM } from '../time.ts';
import { F_MS, type FData, type FTf } from './data.ts';

// ---------- Göstergeler (§2) ----------
export const cp = (x: Candle) => { const r = x.h - x.l; return r > 0 ? (x.c - x.l) / r : 0.5; };
/** RV(i) = volume(i) / SMA20(volume, i−20 … i−1) */
export function rv(c: Candle[], i: number): number {
  if (i < 20) return NaN;
  let s = 0;
  for (let k = i - 20; k < i; k++) s += c[k].v ?? 0;
  return s > 0 ? ((c[i].v ?? 0) * 20) / s : NaN;
}
export interface Pivot { i: number; t: number; price: number; type: 'H' | 'L' }
/** Kesin pivot: önceki N ve sonraki N mumdan büyük (tepe) / küçük (dip). N mum sonra kesinleşir. */
export function pivots(c: Candle[], N: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = N; i < c.length - N; i++) {
    let H = true, L = true;
    for (let k = 1; k <= N && (H || L); k++) {
      if (!(c[i].h > c[i - k].h && c[i].h > c[i + k].h)) H = false;
      if (!(c[i].l < c[i - k].l && c[i].l < c[i + k].l)) L = false;
    }
    if (H) out.push({ i, t: c[i].t, price: c[i].h, type: 'H' });
    if (L) out.push({ i, t: c[i].t, price: c[i].l, type: 'L' });
  }
  return out;
}
const lastFinite = (a: number[]) => { for (let i = a.length - 1; i >= 0; i--) if (Number.isFinite(a[i])) return a[i]; return NaN; };
export const mirror = (c: Candle[]): Candle[] => c.map((x) => ({ t: x.t, o: -x.o, h: -x.l, l: -x.h, c: -x.c, v: x.v }));
export const mirrorData = (d: FData): FData => ({ d1: mirror(d.d1), h4: mirror(d.h4), h1: mirror(d.h1), m15: mirror(d.m15), m5: mirror(d.m5), source: d.source });

// ---------- Yön filtresi (§3) ----------
export function biasOf(h4: Candle[]): { value: Dir | 0; ema: number; close: number; slope: number } {
  const e = ema(h4.map((x) => x.c), 50);
  const n = h4.length - 1;
  const close = h4[n]?.c ?? NaN, em = e[n], slope = e[n] - e[n - 5];
  const value: Dir | 0 = !Number.isFinite(em) || !Number.isFinite(slope) ? 0 : close > em && slope >= 0 ? 1 : close < em && slope <= 0 ? -1 : 0;
  return { value, ema: em, close, slope };
}

// ---------- HTF talep bölgeleri (§4, long uzayında) ----------
export interface FZone { tf: string; type: 'OB' | 'FVG' | 'EQUAL_LOWS'; low: number; high: number; t: number }
export function demandZones(c: Candle[], tf: string, N = 3): FZone[] {
  const A = lastFinite(atrSeries(c, 14));
  if (!Number.isFinite(A) || c.length < 10) return [];
  const piv = pivots(c, N);
  const out: FZone[] = [];
  const alive = (low: number, from: number) => { for (let k = from; k < c.length; k++) if (c[k].c < low) return false; return true; };
  for (let i = 1; i < c.length - 1; i++) {
    const x = c[i];
    // OB: son düşüş mumu + hemen ardından yükseliş, hareket ≥ 1.5 ATR ve önceki pivot tepeyi kapanışla kırmış
    if (x.c < x.o && c[i + 1].c > c[i + 1].o) {
      const end = Math.min(c.length - 1, i + 10);
      let top = -Infinity;
      for (let j = i + 1; j <= end; j++) top = Math.max(top, c[j].h);
      const prevHigh = [...piv].reverse().find((p) => p.type === 'H' && p.i + N <= i);
      if (top - x.l >= 1.5 * A && prevHigh) {
        let bos = false;
        for (let j = i + 1; j <= end; j++) if (c[j].c > prevHigh.price) { bos = true; break; }
        if (bos && alive(x.l, i + 1)) out.push({ tf, type: 'OB', low: x.l, high: x.o, t: x.t });
      }
    }
    // Bullish FVG: low(i+1) > high(i−1)
    if (c[i + 1].l > c[i - 1].h && alive(c[i - 1].h, i + 2)) out.push({ tf, type: 'FVG', low: c[i - 1].h, high: c[i + 1].l, t: c[i].t });
  }
  // HTF eşit dipler
  const lows = piv.filter((p) => p.type === 'L');
  for (let a = 0; a < lows.length; a++) for (let b = a + 1; b < lows.length; b++) {
    if (Math.abs(lows[a].price - lows[b].price) > 0.25 * A) continue;
    const lo = Math.min(lows[a].price, lows[b].price) - 0.25 * A, hi = Math.max(lows[a].price, lows[b].price);
    if (alive(lo, lows[b].i + 1) && !out.some((z) => z.type === 'EQUAL_LOWS' && Math.abs(z.low - lo) < 0.1 * A)) out.push({ tf, type: 'EQUAL_LOWS', low: lo, high: hi, t: lows[b].t });
  }
  return out;
}
export function zoneNear(z: FZone, level: number, dist: number): boolean {
  return (level >= z.low && level <= z.high) || Math.abs(level - z.low) <= dist || Math.abs(level - z.high) <= dist;
}

// ---------- TR (§5) ----------
export interface TR {
  tf: '1h' | '4h'; low: number; high: number; eq: number; touchesLow: number; touchesHigh: number;
  first: number; last: number; firstT: number; lastT: number; bars: number; stale: boolean; atr: number; lowPivots: Pivot[];
}
/** endIdx'ten önceki mumlarla (pivotlar o ana kadar kesinleşmiş) TR bul. */
export function findTR(c0: Candle[], endIdx: number, tf: '1h' | '4h', F: Params['F']): TR | null {
  const c = c0.slice(0, endIdx);
  const A = lastFinite(atrSeries(c, 14));
  if (!Number.isFinite(A) || c.length < 40) return null;
  const tol = 0.25 * A;
  const piv = pivots(c, 3).filter((p) => p.i >= c.length - F.trLookback);
  const clusters = (type: 'H' | 'L') => {
    const ps = piv.filter((p) => p.type === type);
    const seen = new Set<string>(), out: Pivot[][] = [];
    for (const a of ps) {
      const m = ps.filter((p) => Math.abs(p.price - a.price) <= tol);
      const key = m.map((p) => p.i).join(',');
      if (m.length >= 2 && !seen.has(key)) { seen.add(key); out.push(m); }
    }
    return out;
  };
  let best: TR | null = null;
  for (const lc of clusters('L')) for (const hc of clusters('H')) {
    const low = Math.min(...lc.map((p) => p.price)), high = Math.max(...hc.map((p) => p.price));
    if (Math.max(...lc.map((p) => p.price)) >= Math.min(...hc.map((p) => p.price))) continue;
    const idx = [...lc, ...hc].map((p) => p.i);
    const first = Math.min(...idx), last = Math.max(...idx);
    if (last - first < F.trMinBars) continue;
    const hgt = high - low;
    if (hgt < F.trMinAtr * A || hgt > F.trMaxAtr * A) continue;
    let inside = 0;
    for (let k = first; k <= last; k++) if (c[k].c >= low && c[k].c <= high) inside++;
    if (inside / (last - first + 1) < F.trInsidePct) continue;
    // Önceki trend: TR başlangıcından önceki 48 mumda ≥ 3×ATR tek yönlü düşüş (birikim)
    let maxH = -Infinity, drop = 0;
    for (let k = Math.max(0, first - F.priorTrendBars); k <= first; k++) { maxH = Math.max(maxH, c[k].h); drop = Math.max(drop, maxH - c[k].l); }
    if (drop < F.priorTrendAtr * A) continue;
    const since = c.length - 1 - last;
    if (since > F.deleteBars) continue;
    const tr: TR = { tf, low, high, eq: (low + high) / 2, touchesLow: lc.length, touchesHigh: hc.length, first, last, firstT: c[first].t, lastT: c[last].t, bars: last - first, stale: since > F.staleBars, atr: A, lowPivots: lc };
    if (!best || tr.last > best.last || (tr.last === best.last && tr.touchesLow + tr.touchesHigh > best.touchesLow + best.touchesHigh)) best = tr;
  }
  return best;
}

// ---------- Wyckoff olayları (§5.2, §5.3) ----------
export function wyckoffEvents(h1: Candle[], tr: TR, tol: number) {
  if (tr.tf !== '1h') return { sc: undefined, ar: undefined, st: undefined, bonus: 0, notes: [] as string[] };
  let sc = -1;
  for (let k = Math.max(0, tr.first - 48); k <= Math.min(h1.length - 1, tr.first + 3); k++) if (sc < 0 || h1[k].l < h1[sc].l) sc = k;
  const scOk = sc >= 0 && rv(h1, sc) >= 1.5;
  const piv = pivots(h1, 3);
  const stP = piv.find((p) => p.type === 'L' && p.i > sc + 3 && Math.abs(p.price - h1[sc].l) <= tol && rv(h1, p.i) < rv(h1, sc));
  const arP = piv.filter((p) => p.type === 'H' && p.i > sc && (!stP || p.i < stP.i)).sort((a, b) => b.price - a.price)[0];
  const notes: string[] = [];
  let bonus = 0;
  if (scOk && arP && stP) { bonus++; notes.push('SC + AR + ST'); }
  return { sc: scOk ? h1[sc] : undefined, ar: arP, st: stP, bonus, notes };
}

// ---------- Spring (§7) ----------
export interface Spring { i: number; end: number; t: number; low: number; high: number; close: number; cp: number; rv: number; vol: number; type: 'DUSUK' | 'EMILIM' | 'KARARSIZ'; twoBar: boolean }
export function springAt(h1: Candle[], s: number, tr: TR, A: number, F: Params['F']): Spring | null {
  const x = h1[s];
  if (!x || !(x.l < tr.low && x.l >= tr.low - F.springMaxDepthAtr * A)) return null;
  const vt = (r: number, p: number): Spring['type'] => (r <= F.rvLow ? 'DUSUK' : r >= F.rvHigh && p >= F.cpStrong ? 'EMILIM' : 'KARARSIZ');
  if (x.c > tr.low && cp(x) >= 0.5) { const r = rv(h1, s); return { i: s, end: s, t: x.t, low: x.l, high: x.h, close: x.c, cp: cp(x), rv: r, vol: x.v ?? 0, type: vt(r, cp(x)), twoBar: false }; }
  const y = h1[s + 1];
  if (cp(x) < 0.5 && y && y.l >= x.l && y.c > tr.low && cp(y) >= 0.5) {
    const r = Math.max(rv(h1, s), rv(h1, s + 1));
    return { i: s, end: s + 1, t: x.t, low: x.l, high: Math.max(x.h, y.h), close: y.c, cp: cp(y), rv: r, vol: Math.max(x.v ?? 0, y.v ?? 0), type: vt(r, cp(y)), twoBar: true };
  }
  return null;
}
/** §7.1 başarısız spring: sonraki 3 kapanmış 1H mum */
export function springFailed(h1: Candle[], sp: Spring, tr: TR): string | null {
  for (let k = sp.end + 1; k <= Math.min(h1.length - 1, sp.end + 3); k++) {
    const x = h1[k];
    if (x.c < sp.low) return 'kapanış spring dibinin altında';
    if (x.c < tr.low && rv(h1, k) >= 1.5) return 'yüksek hacimle TR altında kapanış';
    const p = h1[k - 1];
    if (k - 1 > sp.end && cp(p) < 0.3 && cp(x) < 0.3 && p.c < tr.low && x.c < tr.low) return 'art arda 2 zayıf kapanış TR altında';
  }
  return null;
}

// ---------- LTF CHoCH ve giriş bölgesi (§8.1) ----------
export function chochAfter(ltf: Candle[], fromT: number, deadline: number): { i: number; t: number; level: number } | 'nopivot' | null {
  const lh = pivots(ltf, 2).filter((p) => p.type === 'H' && p.t < fromT).pop();
  if (!lh) return 'nopivot';
  for (let j = 0; j < ltf.length; j++) {
    const x = ltf[j];
    if (x.t < fromT) continue;
    if (x.t > deadline) break;
    if (x.c > lh.price) return { i: j, t: x.t, level: lh.price };
  }
  return null;
}
export function lastPivotHighBefore(ltf: Candle[], t: number): number | undefined { return pivots(ltf, 2).filter((p) => p.type === 'H' && p.t < t).pop()?.price; }
export function entryZone(ltf: Candle[], fromT: number, chochI: number): { low: number; high: number; kind: 'OB' | 'FVG' } | null {
  const s = ltf.findIndex((x) => x.t >= fromT);
  if (s < 0 || chochI <= s) return null;
  let leg = s;
  for (let k = s; k <= chochI; k++) if (ltf[k].l < ltf[leg].l) leg = k;
  let k = leg;
  while (k >= Math.max(0, leg - 5) && !(ltf[k].c < ltf[k].o)) k--;
  const ob = k >= Math.max(0, leg - 5) ? { low: ltf[k].l, high: ltf[k].o } : { low: ltf[leg].l, high: Math.max(ltf[leg].o, ltf[leg].c) };
  for (let q = leg + 1; q < chochI; q++) {
    if (ltf[q + 1].l > ltf[q - 1].h) {
      const f = { low: ltf[q - 1].h, high: ltf[q + 1].l };
      if (f.low > ob.high) return { ...f, kind: 'FVG' };
    }
  }
  return { ...ob, kind: 'OB' };
}
/** §8.1 adım 5-6: zone'a dönüş ve test hacmi */
export function testZone(ltf: Candle[], h1: Candle[], zone: { low: number; high: number }, afterI: number, maxVol: number | null, now: number):
  { state: 'ok'; t: number } | { state: 'broken'; t: number } | { state: 'wait'; why: string } {
  const hours: number[] = [];
  const firstTouch = new Map<number, number>(); // 1H → o saatteki ilk dokunan LTF mumu (dolum anı)
  const okAt = (hh: number) => firstTouch.get(hh)!;
  for (let j = afterI + 1; j < ltf.length; j++) {
    const x = ltf[j];
    if (x.c < zone.low) {
      // kapanışla altına kırıldı — ondan önce geçerli test yoksa iptal
      const okH = hours.find((hh) => { const H = h1.find((y) => y.t === hh); return H && (maxVol === null || (H.v ?? 0) < maxVol); });
      return okH !== undefined ? { state: 'ok', t: okAt(okH) } : { state: 'broken', t: x.t };
    }
    if (x.l <= zone.high) { const hh = Math.floor(x.t / HOUR) * HOUR; if (!hours.includes(hh)) { hours.push(hh); firstTouch.set(hh, x.t); } }
  }
  if (!hours.length) return { state: 'wait', why: 'zone\'a geri dönüş bekleniyor' };
  let pending = false;
  for (const hh of hours) {
    const H = h1.find((y) => y.t === hh);
    if (!H) { if (hh + HOUR > now) pending = true; continue; }
    if (maxVol === null || (H.v ?? 0) < maxVol) return { state: 'ok', t: okAt(hh) };
  }
  return { state: 'wait', why: pending ? 'temas var — 1H mum kapanışı bekleniyor (test hacmi)' : 'test hacmi yüksek — sonraki 1H mumda tekrar bakılır' };
}

// ---------- Zaman / ortam filtreleri (§12) ----------
export function blocksF(now: number, h1: Candle[], news: NewsEvent[], F: Params['F'], beforeMin = 30, afterMin = 15, sunday?: { t: number; okAfter: () => boolean }): { blocks: string[]; notes: string[]; text: string[] } {
  const blocks: string[] = [], notes: string[] = [], text: string[] = [];
  const m = Math.floor((now % DAY) / MIN);
  for (const f of F.fundingUTC) {
    const fm = parseHM(f);
    const d = Math.min(Math.abs(m - fm), 1440 - Math.abs(m - fm));
    if (d <= F.fundingBlockMin) { blocks.push('FUNDING'); text.push(`funding ${f} UTC ±${F.fundingBlockMin} dk`); break; }
  }
  if (new Date(now).getUTCDay() === 6) { blocks.push('CUMARTESI'); text.push('Cumartesi (UTC) yeni giriş yok'); }
  if (sunday && new Date(sunday.t).getUTCDay() === 0 && !sunday.okAfter()) { blocks.push('PAZAR_TEYIDI'); text.push('Pazar oluşumu — Pazartesi yeni pivot teyidi bekleniyor'); }
  const a = atrSeries(h1, 14), am = sma(a.map((x) => (Number.isFinite(x) ? x : 0)), 20);
  for (let k = h1.length - 1; k >= Math.max(0, h1.length - 1 - F.liqWaitBars); k--) {
    const x = h1[k];
    if (!Number.isFinite(a[k]) || !Number.isFinite(am[k])) continue;
    if (a[k] > F.liqAtrMult * am[k] || x.h - x.l > F.liqBarAtr * a[k]) { blocks.push('LIKIDASYON'); text.push('likidasyon dalgası — bekle'); break; }
  }
  const ev = news.find((e) => e.impact === 'High' && e.currency === 'USD' && now >= e.t - beforeMin * MIN && now <= e.t + afterMin * MIN);
  if (ev) { blocks.push('HABER'); text.push(`HABER RİSKİ: ${ev.title}`); }
  const [ws, we] = F.bestWindowUTC.map(parseHM);
  if (m < ws || m >= we) notes.push('pencere dışı (en iyi 15:30–19:00 TR)');
  return { blocks, notes, text };
}
export function nextFunding(now: number, F: Params['F']): number {
  const d0 = Math.floor(now / DAY) * DAY;
  const all = [0, 1].flatMap((d) => F.fundingUTC.map((f) => d0 + d * DAY + parseHM(f) * MIN));
  return all.filter((t) => t > now).sort((a, b) => a - b)[0];
}

// ---------- Hedef / RR (§10) ----------
export function targets(tr: TR, entry: number, stop: number) {
  const h = tr.high - tr.low;
  const t1 = tr.eq, t2 = tr.high, t3 = tr.high + h;
  const risk = entry - stop;
  const r = (x: number) => (risk > 0 ? (x - entry) / risk : 0);
  return { t1, t2, t3, rr1: r(t1), rr2: r(t2), rr3: r(t3) };
}
export const _x = { F_MS } as { F_MS: Record<FTf, number> };
export type { EntryMethod, Overlay, Condition };
