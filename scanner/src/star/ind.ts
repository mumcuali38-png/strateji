// ⭐ ortak göstergeler (ortak şartname §4) — kesin formüller.
import type { Candle } from '../types.ts';
import { atr as atrW, ema as emaS } from '../indicators.ts';

const fin = Number.isFinite;
/** Wilder ATR14: TR = max(H−L, |H−C₋₁|, |L−C₋₁|); ilk = ilk 14 TR ortalaması; sonra (ATR₋₁×13 + TR)/14 */
export const atr = (c: Candle[], p = 14): number[] => atrW(c, p);
/** EMA(n): ilk değer ilk n kapanışın ortalaması, sonra k = 2/(n+1) */
export const ema = (v: number[], n: number): number[] => emaS(v, n);

/** Donchian üst/alt(n): MEVCUT MUM HARİÇ önceki n mumun en yüksek High / en düşük Low'u. i < n → NaN */
export function donchian(c: Candle[], n: number): { up: number[]; dn: number[] } {
  const up = new Array(c.length).fill(NaN), dn = new Array(c.length).fill(NaN);
  for (let i = n; i < c.length; i++) {
    let h = -Infinity, l = Infinity;
    for (let k = i - n; k < i; k++) { if (c[k].h > h) h = c[k].h; if (c[k].l < l) l = c[k].l; }
    up[i] = h; dn[i] = l;
  }
  return { up, dn };
}

export interface Regime { value: 1 | -1 | 0 | null; close: number; ema50: number; ema200: number; ret60: number; day: string | null; days: number }
/**
 * Günlük rejim (§4), son KAPANMIŞ ve geçerli seans gününe göre:
 *   C > EMA50 > EMA200 ve C/C₋₆₀ − 1 > 0 → +1 (sadece LONG)
 *   C < EMA50 < EMA200 ve C/C₋₆₀ − 1 < 0 → −1 (sadece SHORT)
 *   aksi halde 0. Isınma (warmDays) yoksa null (⏳ veri eksik).
 */
export function regime(days: (Candle & { key?: string })[], P: { emaFast: number; emaSlow: number; retDays: number; warmDays: number }): Regime {
  const c = days.map((d) => d.c);
  const e1 = ema(c, P.emaFast), e2 = ema(c, P.emaSlow);
  const i = c.length - 1;
  const close = c[i] ?? NaN, ema50 = e1[i] ?? NaN, ema200 = e2[i] ?? NaN;
  const ret60 = i >= P.retDays ? close / c[i - P.retDays] - 1 : NaN;
  const base = { close, ema50, ema200, ret60, day: days[i]?.key ?? null, days: days.length };
  if (days.length < P.warmDays || !fin(ema200) || !fin(ret60)) return { value: null, ...base };
  const value = close > ema50 && ema50 > ema200 && ret60 > 0 ? 1 : close < ema50 && ema50 < ema200 && ret60 < 0 ? -1 : 0;
  return { value, ...base };
}

/** Fiyat adımına yuvarlama (IB.1) */
export const roundTick = (x: number, tick: number): number => Math.round(x / tick) * tick;
const rng = (d: Candle, tick: number) => roundTick(roundTick(d.h, tick) - roundTick(d.l, tick), tick);

/** NR7: i. günün aralığı kendisi dahil son n günün en küçüğüne EŞİT (eşitlik dahil). i < n−1 → null */
export function isNR(days: Candle[], i: number, n = 7, tick = 1e-9): boolean | null {
  if (i < n - 1 || i >= days.length) return null;
  const r = rng(days[i], tick);
  let min = Infinity;
  for (let k = i - n + 1; k <= i; k++) min = Math.min(min, rng(days[k], tick));
  return Math.abs(r - min) < tick / 2;
}
/** İç gün: H_bugün < H_dün ve L_bugün > L_dün (kesin; fiyat adımına yuvarlanmış). Eşitlik iç gün değil. */
export function isInside(days: Candle[], i: number, tick: number): boolean | null {
  if (i < 1 || i >= days.length) return null;
  const h = roundTick(days[i].h, tick), l = roundTick(days[i].l, tick), hp = roundTick(days[i - 1].h, tick), lp = roundTick(days[i - 1].l, tick);
  return h < hp - tick / 2 && l > lp + tick / 2;
}
