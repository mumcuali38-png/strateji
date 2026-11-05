import type { Candle } from '../src/types.ts';
import { loadConfig, type Config } from '../src/config.ts';

/** [o,h,l,c] dizisinden mumlar; t0'dan itibaren step aralıkla */
export function mk(rows: number[][], t0 = Date.UTC(2026, 10, 2, 7, 0), step = 5 * 60_000): Candle[] {
  return rows.map((r, i) => ({ t: t0 + i * step, o: r[0], h: r[1], l: r[2], c: r[3], v: 100 }));
}
/** Kapanış dizisinden basit mumlar (gövde = fark, küçük iğneler) */
export function fromCloses(closes: number[], t0?: number, step?: number, wick = 0.2): Candle[] {
  const rows: number[][] = [];
  let prev = closes[0];
  for (const c of closes) { rows.push([prev, Math.max(prev, c) + wick, Math.min(prev, c) - wick, c]); prev = c; }
  return mk(rows, t0, step);
}
export function conf(): Config { return loadConfig(); }
export const SP = { n: 2, dispMult: 1.5, dispLookback: 20, atrPeriod: 14, equalTolAtr: 0.1, fvgMinAtr: 0.05, consBars: 20, consMaxBos: 1, consRangeAtr: 3, minBos: 2, strongBos: 3 };
