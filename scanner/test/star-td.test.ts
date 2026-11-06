// ⭐TD — docs/kurulum_TD_Turtle_spec.md §11 test senaryoları
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../src/types.ts';
import { HOUR, MIN, DAY } from '../src/time.ts';
import { loadStar } from '../src/star/config.ts';
import { evalTrend, trackPos, type Bar } from '../src/star/trend.ts';
import { trendParams, trendMessages } from '../src/star/setups.ts';
import { sessionDays } from '../src/star/sessions.ts';
import type { Pending } from '../src/star/guard.ts';
import type { Regime } from '../src/star/ind.ts';

const sc = loadStar();
const P0 = trendParams(sc, 'TD');
const P = { ...P0, exitAt: 'close' as const }; // XAU 24 saat: çıkış "teyitten sonra hemen"
const T0 = Date.UTC(2025, 6, 1, 23); // seans günü başlangıcı 18:00 strateji saati
/** Ardışık seans günleri (24 saat: 18:00 → 17:00) */
function days(n: number): Bar[] {
  return Array.from({ length: n }, (_, i) => ({ t: T0 + i * DAY, end: T0 + i * DAY + 23 * HOUR, o: 100, h: 101, l: 99, c: 100 }));
}
const RG = (v: 1 | -1 | 0): Regime => ({ value: v, close: 100, ema50: 99, ema200: 98, ret60: 0.05, day: 'x', days: 300 });
const base = (bars: Bar[], over: Partial<Parameters<typeof evalTrend>[0]> = {}) => ({
  p: P, sym: 'XAUUSD', bars, regime: RG(1), fresh: true, missing: 0, now: bars[bars.length - 1].end + 10_000, scanT: bars[bars.length - 1].end + 10_000,
  price: null, jump: false, pending: {} as Record<string, Pending>, done: new Set<string>(), openPos: null, lastClosedT: null, dec: 2, maxAgeMs: DAY, ...over,
});
function signal(bars: Bar[], price = 101.2) {
  const pending: Record<string, Pending> = {};
  assert.equal(evalTrend(base(bars, { pending, price })).status, 'TAM_BEKLE');
  const t = bars[bars.length - 1].end + 5 * MIN + 10_000;
  return evalTrend(base(bars, { pending, price, now: t, scanT: t }));
}
const next = (bars: Bar[], rows: number[][]): Bar[] => rows.map((r, i) => { const t = bars[bars.length - 1].t + (i + 1) * DAY; return { t, end: t + 23 * HOUR, o: r[0], h: r[1], l: r[2], c: r[3] }; });
const asH1 = (b: Bar[]): Candle[] => b.map(({ t, o, h, l, c }) => ({ t, o, h, l, c }));

test('TD senaryo 1: rejim +1, günlük kapanış DU55 üstünde → teyit → ertesi açılışta giriş', () => {
  const bars = days(300); bars[299] = { ...bars[299], h: 101.4, c: 101.2 };
  const r = signal(bars);
  assert.equal(r.status, 'TAM'); assert.equal(r.order!.type, 'MARKET_NEXT_OPEN'); assert.equal(r.levels.up, 101);
  assert.ok(Math.abs(r.order!.stop - (101.2 - 2 * r.levels.atr)) < 1e-9);
  assert.ok(Math.abs(r.order!.t1! - (101.2 + 3 * r.levels.atr)) < 1e-9);
  const nx = next(bars, [[101.3, 101.6, 101.0, 101.4]]);
  const p = trackPos(r.newPos!, 'cfd24', asH1([...bars, ...nx]), bars, P, nx[0].t + HOUR, 101.4);
  assert.equal(p.entry, 101.3); assert.equal(p.entryT, nx[0].t);
  const m = trendMessages(P, r.newPos!, r, 2, r.newPos!.notifiedAt);
  assert.match(m[0].body, /^⭐TD: XAU ▲ LONG TAM — giriş ~101\.20 \(ertesi açılış\), stop .*, T1 .* \(%50\)$/);
});

test('TD senaryo 2: T1 → %50 kapat, stop girişe; sonra DA20 altında kapanış → kalan kapanır', () => {
  const bars = days(300); bars[299] = { ...bars[299], h: 101.4, c: 101.2 };
  const pos0 = signal(bars).newPos!;
  const R = 2 * pos0.atr, e = 101.3;
  const rows: number[][] = [[e, e + 1.6 * R, e + 0.05, e + 1.5 * R]];
  for (let i = 0; i < 20; i++) rows.push([e + 1.5 * R, e + 1.6 * R, e + 1.4 * R, e + 1.5 * R]);
  rows.push([e + 1.5 * R, e + 1.5 * R, e + 0.8 * R, e + 0.9 * R]); // DA20 = e + 1,4R → altında kapanış
  const nx = next(bars, rows);
  const all = [...bars, ...nx];
  const p = trackPos(pos0, 'cfd24', asH1(all), all, P, nx[nx.length - 1].end + MIN, e + 0.9 * R);
  assert.equal(p.t1Done, true); assert.equal(p.open, false);
  assert.match(p.reason!, /günlük kapanış Donchian 20/);
  assert.equal(p.exit, e + 0.9 * R, '24 saat: kapanış fiyatından (teyitten sonra hemen)');
  assert.ok(Math.abs(p.r! - (0.75 + 0.5 * 0.9)) < 1e-6, `R ${p.r}`);
  // ETF: ertesi açılış
  const pe = trackPos(pos0, 'etf', asH1([...all, ...next(all, [[e + 0.7 * R, e + 0.8 * R, e + 0.6 * R, e + 0.7 * R]])]), all, { ...P, exitAt: 'nextOpen' }, nx[nx.length - 1].end + DAY, e + 0.7 * R);
  assert.equal(pe.exit, e + 0.7 * R);
});

test('TD senaryo 3: rejim 0 iken DU55 kırılımı → YOK', () => {
  const bars = days(300); bars[299] = { ...bars[299], h: 101.4, c: 101.2 };
  const r = evalTrend(base(bars, { regime: RG(0) }));
  assert.equal(r.status, 'YOK'); assert.equal(r.newPos, null);
});

test('TD senaryo 4: ETF borsa kapanışı öncesi → günlük mum kapanmamış, sinyal yok (TD.1)', () => {
  const open = Date.UTC(2026, 10, 10, 14, 30);
  const h1 = Array.from({ length: 6 }, (_, i) => ({ t: open + i * HOUR, o: 50, h: 51, l: 49, c: 50 }));
  const d = sessionDays('etf', h1, open + 6 * HOUR + 15 * MIN, sc.common);
  assert.equal(d[0].closed, false);
});

test('TD senaryo 5: açılış boşluğu > 1 ATR → KAÇTI (işlem yok, R sayılmaz)', () => {
  const bars = days(300); bars[299] = { ...bars[299], h: 101.4, c: 101.2 };
  const pos0 = signal(bars).newPos!;
  const nx = next(bars, [[101.2 + 1.1 * pos0.atr, 104, 103, 103.5]]);
  const p = trackPos(pos0, 'cfd24', asH1([...bars, ...nx]), bars, P, nx[0].t + HOUR, 103.5);
  assert.equal(p.open, false); assert.equal(p.r, null); assert.match(p.reason!, /KAÇTI/);
  const m = trendMessages(P, p, null, 2, nx[0].t + HOUR);
  assert.ok(m.some((x) => x.key.endsWith('+KACTI')));
  // 0,9 ATR → giriş yapılır
  const ok = trackPos(pos0, 'cfd24', asH1([...bars, ...next(bars, [[101.2 + 0.9 * pos0.atr, 104, 103, 103.5]])]), bars, P, nx[0].t + HOUR, 103.5);
  assert.equal(ok.open, true); assert.notEqual(ok.entry, null);
});

test('TD.3: açık pozisyonda Cuma "hafta sonu taşınıyor" bilgisi (sessiz, engel değil)', () => {
  const bars = days(300); bars[299] = { ...bars[299], h: 101.4, c: 101.2 };
  const pos0 = signal(bars).newPos!;
  const nx = next(bars, [[101.3, 101.6, 101.0, 101.4]]);
  const p = trackPos(pos0, 'cfd24', asH1([...bars, ...nx]), bars, P, nx[0].t + HOUR, 101.4);
  const fri = Date.UTC(2026, 10, 13, 15); // Cuma 10:00 strateji saati
  const m = trendMessages(P, p, null, 2, fri);
  const c = m.find((x) => x.key.includes('+CUMA+'));
  assert.ok(c); assert.equal(c!.loud, false);
  assert.equal(trendMessages(P, p, null, 2, fri - DAY).some((x) => x.key.includes('+CUMA+')), false);
});
