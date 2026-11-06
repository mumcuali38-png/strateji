// Kurulum H için sentetik LONG senaryosu (BTC): günlük/4H trend → 1H geri çekilme → 15m mikro kırılım.
import type { Candle } from '../../src/types.ts';
import type { HInput } from '../../src/h/setup.ts';

const H = 3600_000, M15 = 15 * 60_000, D = 86400_000;
function mk(closes: number[], t0: number, step: number, wick: (i: number) => number): Candle[] {
  return closes.map((c, i) => { const o = i ? closes[i - 1] : c; const w = wick(i); return { t: t0 + i * step, o, h: Math.max(o, c) + w, l: Math.min(o, c) - w, c, v: 100 }; });
}
/**
 * now: değerlendirme anı. 1H: 150 mum itki (yükselen merdiven) + 6 mum sakin geri çekilme (EMA20'ye değer).
 * 15m: geri çekilme içinde pivot tepe, ardından kapanışla kırılım (fiyat < H0) ve `fill` true ise retest.
 */
export function hScenario(now: number, opts: { fill?: boolean; price?: number } = {}): HInput {
  const d1 = mk(Array.from({ length: 700 }, (_, i) => 20000 + i * 60 + Math.sin(i / 5) * 200), now - 700 * D - D, D, () => 150);
  // 4H: sert yükseliş + testere (pivotlar) → son mumlarda yukarı BOS, ADX yükselen
  const c4: number[] = [];
  let p = 40000;
  for (let i = 0; i < 300; i++) { p += (i % 8 < 5 ? 300 : -200) + (i > 270 ? 60 : 0); c4.push(p); }
  const h4 = mk(c4, now - 300 * 4 * H - 4 * H, 4 * H, (i) => (i % 8 < 5 ? 60 : 20));
  const top4 = c4[c4.length - 1];
  // 1H: itki (her mum +60, gölge 40) → H0; geri çekilme 6 mum (−45, gölge 15) EMA20'ye iner
  const c1: number[] = [];
  let q = top4 - 150 * 60;
  for (let i = 0; i < 150; i++) { q += 60; c1.push(q); }
  const H0 = q + 40;
  for (let i = 0; i < 10; i++) { q -= 70; c1.push(q); }
  const h1 = mk(c1, now - c1.length * H, H, (i) => (i < 150 ? 40 : 15));
  // 15m: geri çekilmenin son 6 saatini 24 mum ile örtüşen sakin seri; pivot tepe sonra kırılım
  const pbStart = h1[150].t;
  const c15: number[] = [];
  let r = c1[150] + 30;
  void r;
  const lead = Array.from({ length: 16 }, (_, i) => -i * 40);
  const base = -640;
  const shape = [...lead, ...[0, -20, -40, -30, -10, 10, -5, -25, -45, -60, -50, -40, -30, -45, -55, -50, -35, -20, -10, 5, 25, 15, 5, opts.fill ? -20 : 20].map((x) => base + x)];
  for (const dlt of shape) c15.push(c1[150] + 30 + dlt);
  const m15 = mk(c15, pbStart, M15, (i) => (i > 0 && c15[i] > c15[i - 1] ? 6 : 2)).filter((x) => x.t + M15 <= now);
  void H0;
  return { sym: 'BTCUSD', d1, h4, h1, m15, m5: [], price: opts.price ?? c15[c15.length - 1], source: 'test' };
}
