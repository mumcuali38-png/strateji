import type { Candle } from './types.ts';
import { MIN, DAY, nyDayStart, nyDow } from './time.ts';

/** Tekrarlanabilir rastgele sayı üreteci */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

/** Sentetik 1m mum dizisi (trend + range rejimleri, NY seans oynaklığı). Test ve demo içindir. */
export function synth1m(start: number, end: number, p0: number, vol: number, seed: number, opts: { weekends?: boolean; hours?: [number, number] } = {}): Candle[] {
  const r = rng(seed);
  const out: Candle[] = [];
  let p = p0, drift = 0, regimeLeft = 0;
  for (let t = start; t < end; t += MIN) {
    const dow = nyDow(t);
    if (!opts.weekends && (dow === 0 || dow === 6)) continue;
    const m = Math.floor((t - nyDayStart(t)) / MIN);
    if (opts.hours && (m < opts.hours[0] || m >= opts.hours[1])) continue;
    if (regimeLeft-- <= 0) { regimeLeft = 120 + Math.floor(r() * 600); drift = (r() - 0.5) * vol * 0.12 * (r() < 0.35 ? 0 : 1); }
    const sess = m >= 420 && m < 720 ? 1.6 : m >= 120 && m < 300 ? 1.3 : 0.7;
    const o = p;
    const step = (r() - 0.5) * 2 * vol * sess + drift;
    const c = o + step;
    const h = Math.max(o, c) + r() * vol * 0.6 * sess;
    const l = Math.min(o, c) - r() * vol * 0.6 * sess;
    out.push({ t, o, h, l, c, v: Math.round(100 + r() * 900) });
    p = c;
  }
  return out;
}
export const _D = DAY;
