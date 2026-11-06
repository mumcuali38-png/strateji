// ⭐T4-S — docs/kurulum_T4S_Trend4H_spec.md §11 test senaryoları
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../src/types.ts';
import { HOUR, MIN } from '../src/time.ts';
import { loadStar } from '../src/star/config.ts';
import { evalTrend, trackPos, type Bar } from '../src/star/trend.ts';
import { trendParams, trendMessages } from '../src/star/setups.ts';
import { bars4h } from '../src/star/sessions.ts';
import type { Pending } from '../src/star/guard.ts';
import type { Regime } from '../src/star/ind.ts';

const sc = loadStar();
const P = trendParams(sc, 'T4S');
const H4 = 4 * HOUR;
const T0 = Date.UTC(2026, 5, 1, 7); // 02:00 strateji saati
function flat(n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => ({ t: T0 + i * H4, end: T0 + (i + 1) * H4, o: 100, h: 101, l: 99, c: 100 }));
}
const RG = (v: 1 | -1 | 0): Regime => ({ value: v, close: 100, ema50: 99, ema200: 98, ret60: 0.05, day: 'x', days: 260 });
const base = (bars: Bar[], over: Partial<Parameters<typeof evalTrend>[0]> = {}) => ({
  p: P, sym: 'XAUUSD', bars, regime: RG(1), fresh: true, missing: 0, now: bars[bars.length - 1].end + 10_000, scanT: bars[bars.length - 1].end + 10_000,
  price: null, jump: false, pending: {} as Record<string, Pending>, done: new Set<string>(), openPos: null, lastClosedT: null, dec: 2, maxAgeMs: H4, ...over,
});
/** Kırılım + teyit → pozisyon */
function signal(bars: Bar[], price = 101.1) {
  const pending: Record<string, Pending> = {};
  const r1 = evalTrend(base(bars, { pending, price }));
  assert.equal(r1.status, 'TAM_BEKLE');
  const t = bars[bars.length - 1].end + 5 * MIN + 10_000;
  return evalTrend(base(bars, { pending, price, now: t, scanT: t }));
}
const after = (bars: Bar[], rows: number[][]): Bar[] => rows.map((r, i) => { const t = bars[bars.length - 1].end + i * H4; return { t, end: t + H4, o: r[0], h: r[1], l: r[2], c: r[3] }; });
const asH1 = (b: Bar[]): Candle[] => b.map(({ t, o, h, l, c }) => ({ t, o, h, l, c }));

test('T4-S senaryo 1: rejim +1, 4H kapanış DU20 üstünde → teyit → TAM, stop 2 ATR, T1 1,5R (%50)', () => {
  const bars = flat(300); bars[299] = { ...bars[299], h: 101.3, c: 101.2 };
  const r = signal(bars);
  assert.equal(r.status, 'TAM'); assert.equal(r.levels.up, 101);
  const atr = r.levels.atr;
  assert.ok(Math.abs(r.order!.stop - (101.1 - 2 * atr)) < 1e-9);
  assert.ok(Math.abs(r.order!.t1! - (101.1 + 1.5 * 2 * atr)) < 1e-9);
  assert.equal(r.order!.t1_fraction, 0.5);
  const m = trendMessages(P, r.newPos!, r, 2, r.newPos!.notifiedAt);
  assert.match(m[0].body, /^⭐T4-S: XAU ▲ LONG TAM — giriş ~101\.10, stop .*, T1 .* \(%50\)$/);
});

test('T4-S senaryo 2: T1 → %50 kapandı, stop = giriş; fiyat girişe döndü → kalan 0R, toplam +0,75R', () => {
  const bars = flat(300); bars[299] = { ...bars[299], h: 101.3, c: 101.2 };
  const pos0 = signal(bars).newPos!;
  const R = 2 * pos0.atr;
  const e = 101.2;
  const nx = after(bars, [[e, e + 1.6 * R, e - 0.1, e + 1.2 * R], [e + 1.2 * R, e + 1.3 * R, e - 0.05, e + 0.2]]);
  const all = [...bars, ...nx];
  const p1 = trackPos(pos0, 'cfd24', asH1(all.slice(0, 301)), all.slice(0, 301), P, nx[0].end + 60_000, e + 1.2 * R);
  assert.equal(p1.t1Done, true); assert.equal(p1.stopAtBe, true); assert.equal(p1.stop, e); assert.equal(p1.open, true);
  const msgs = trendMessages(P, p1, null, 2, nx[0].end + 60_000);
  assert.ok(msgs.some((m) => m.key.endsWith('+T1') && m.body === `⭐T4-S: T1 — %50 kapat, stop girişe (${e.toFixed(2)})`));
  const p2 = trackPos(pos0, 'cfd24', asH1(all), all, P, nx[1].end + 60_000, e);
  assert.equal(p2.open, false); assert.equal(p2.exit, e);
  assert.ok(Math.abs(p2.r! - 0.75) < 1e-9, `R ${p2.r}`);
});

test('T4-S senaryo 3: aynı 4H mumda stop ve T1 → stop önceliği, −1R', () => {
  const bars = flat(300); bars[299] = { ...bars[299], h: 101.3, c: 101.2 };
  const pos0 = signal(bars).newPos!;
  const R = 2 * pos0.atr, e = 101.2;
  const nx = after(bars, [[e, e + 2 * R, e - 1.2 * R, e]]);
  const all = [...bars, ...nx];
  const p = trackPos(pos0, 'cfd24', asH1(all), all, P, nx[0].end + 60_000, e);
  assert.equal(p.open, false); assert.equal(p.t1Done, false);
  assert.ok(Math.abs(p.r! + 1) < 1e-9); assert.match(p.reason!, /stop önceliği/);
});

test('T4-S senaryo 4: T1 sonrası 4H kapanış DA10 altında → kalan kapanır (sonraki açılışta)', () => {
  const bars = flat(300); bars[299] = { ...bars[299], h: 101.3, c: 101.2 };
  const pos0 = signal(bars).newPos!;
  const R = 2 * pos0.atr, e = 101.2;
  // T1, sonra 10 mum yukarıda yatay, sonra DA10 altına kapanış (stop = giriş'e değmeden)
  const rows: number[][] = [[e, e + 1.6 * R, e + 0.1, e + 1.5 * R]];
  for (let i = 0; i < 10; i++) rows.push([e + 1.5 * R, e + 1.6 * R, e + 1.4 * R, e + 1.5 * R]);
  rows.push([e + 1.5 * R, e + 1.5 * R, e + 0.5 * R, e + 0.6 * R]); // DA10 = e + 1.4R → altında kapanış
  rows.push([e + 0.6 * R, e + 0.7 * R, e + 0.5 * R, e + 0.6 * R]);
  const nx = after(bars, rows);
  const all = [...bars, ...nx];
  const p = trackPos(pos0, 'cfd24', asH1(all), all, P, nx[nx.length - 1].end + 60_000, e + 0.6 * R);
  assert.equal(p.t1Done, true); assert.equal(p.open, false);
  assert.match(p.reason!, /4H kapanış Donchian 10/);
  assert.ok(Math.abs(p.r! - (0.75 + 0.5 * 0.6)) < 1e-6, `R ${p.r}`);
});

test('T4-S senaryo 5: ETF 2. blok, borsa kapanışı öncesi → 4H kapanmamış sayılır (T4.1)', () => {
  const open = Date.UTC(2026, 10, 10, 14, 30); // 09:30 NY (EST)
  const h1 = Array.from({ length: 6 }, (_, i) => ({ t: open + i * HOUR, o: 50, h: 51, l: 49, c: 50 })); // 15:30 mumu yok
  const g = bars4h('etf', h1, open + 6 * HOUR + 20 * MIN, sc.common);
  assert.equal(g[0].closed, true); assert.equal(g[1].closed, false);
  const g2 = bars4h('etf', [...h1, { t: open + 6 * HOUR, o: 50, h: 51, l: 49, c: 50 }], open + 6.5 * HOUR + MIN, sc.common);
  assert.equal(g2[1].closed, true);
});

test('T4-S senaryo 6: BTC Cumartesi 4H kırılımı → geçerli sinyal (T4.5)', () => {
  const sat = Date.UTC(2026, 10, 14, 7); // Cumartesi 02:00 strateji saati
  const h1: Candle[] = [];
  for (let t = sat - 300 * H4; t < sat + 4 * HOUR; t += HOUR) h1.push({ t, o: 100, h: 101, l: 99, c: 100 });
  h1[h1.length - 1] = { ...h1[h1.length - 1], h: 102, c: 101.5 };
  const g = bars4h('crypto', h1, sat + 4 * HOUR + 5 * MIN, sc.common).filter((x) => x.closed && x.valid);
  const last = g[g.length - 1];
  assert.equal(new Date(last.t - 5 * HOUR).getUTCDay(), 6, 'Cumartesi 4H mumu');
  const bars: Bar[] = g.map((x) => ({ t: x.t, end: x.end, o: x.o, h: x.h, l: x.l, c: x.c }));
  const r = signal(bars, 101.5);
  assert.equal(r.status, 'TAM');
});

test('T4.2 KAÇTI: fiyat sinyal kapanışından > 0,5 × ATR14_4H ilerlediyse TAM yok', () => {
  const bars = flat(300); bars[299] = { ...bars[299], h: 101.3, c: 101.2 };
  const pending: Record<string, Pending> = {};
  const r1 = evalTrend(base(bars, { pending, price: 101.2 }));
  const t = bars[299].end + 6 * MIN;
  const r2 = evalTrend(base(bars, { pending, price: 101.2 + 0.6 * r1.levels.atr, now: t, scanT: t }));
  assert.equal(r2.finalCheck, 'KACTI'); assert.equal(r2.newPos, null);
});
