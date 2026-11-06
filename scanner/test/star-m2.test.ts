// ⭐M2 — docs/kurulum_M2_Trend1H_spec.md §11 test senaryoları
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../src/types.ts';
import { HOUR, MIN } from '../src/time.ts';
import { loadStar } from '../src/star/config.ts';
import { evalTrend, trackPos, type Bar } from '../src/star/trend.ts';
import { trendParams, trendMessages, runTrend, portfolio } from '../src/star/setups.ts';
import { analyze, type StarSeries } from '../src/star/run.ts';
import { runStarFetch, type FetchMem } from '../src/star/data.ts';
import { TwelveData, freshCredits } from '../src/twelvedata.ts';
import type { Pending } from '../src/star/guard.ts';
import type { Regime } from '../src/star/ind.ts';
import { conf } from './helpers.ts';

const sc = loadStar();
const P = trendParams(sc, 'M2');
const T0 = Date.UTC(2026, 10, 9, 5); // Pzt 00:00 strateji saati
/** Yatay 1H mumlar (aralık 2 → ATR = 2), son mum özel */
function flat(n: number, last?: Partial<Candle>): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) out.push({ t: T0 + i * HOUR, end: T0 + (i + 1) * HOUR, o: 100, h: 101, l: 99, c: 100 });
  if (last) Object.assign(out[n - 1], last);
  return out;
}
const RG = (v: 1 | -1 | 0): Regime => ({ value: v, close: 100, ema50: 99, ema200: 98, ret60: 0.05, day: 'x', days: 260 });
const base = (bars: Bar[], over: Partial<Parameters<typeof evalTrend>[0]> = {}) => ({
  p: P, sym: 'XAUUSD', bars, regime: RG(1), fresh: true, missing: 0, now: bars[bars.length - 1].end + 10_000, scanT: bars[bars.length - 1].end + 10_000,
  price: null, jump: false, pending: {} as Record<string, Pending>, done: new Set<string>(), openPos: null, lastClosedT: null, dec: 2, maxAgeMs: HOUR, ...over,
});

test('M2 senaryo 1: rejim +1, kapanış DU10 + 0,1 → 1. tarama TAM – BEKLE, 2. tarama TAM; stop = giriş − 2 ATR', () => {
  const bars = flat(300, { o: 100, h: 101.2, l: 99.5, c: 101.1 }); // DU10 = 101
  const pending: Record<string, Pending> = {};
  const r1 = evalTrend(base(bars, { pending, price: 101.1 }));
  assert.equal(r1.status, 'TAM_BEKLE'); assert.equal(r1.scanSeq, 1); assert.equal(r1.newPos, null);
  assert.equal(r1.levels.up, 101);
  const r2 = evalTrend(base(bars, { pending, price: 101.3, now: bars[299].end + 5 * MIN + 10_000, scanT: bars[299].end + 5 * MIN + 10_000 }));
  assert.equal(r2.status, 'TAM'); assert.equal(r2.dir, 1);
  assert.ok(r2.newPos);
  assert.ok(Math.abs(r2.newPos!.stop - (101.3 - 2 * r2.levels.atr)) < 1e-9);
  assert.equal(r2.signalId, `M2-XAUUSD-${new Date(bars[299].t).toISOString().replace('.000Z', 'Z')}`);
  // Pozisyon: giriş = sonraki 1H açılışı, stop yeniden giriş − 2 ATR
  const next: Candle = { t: bars[299].end, o: 101.5, h: 102, l: 101.2, c: 101.8 };
  const pos = trackPos(r2.newPos!, 'cfd24', [...bars, next], bars, P, next.t + HOUR + 60_000, 101.8);
  assert.equal(pos.entry, 101.5); assert.ok(Math.abs(pos.stop - (101.5 - 2 * r2.newPos!.atr)) < 1e-9);
  assert.equal(pos.open, true);
  // Bildirim metni (§7)
  const m = trendMessages(P, pos, r2, 2, r2.newPos!.notifiedAt);
  assert.match(m[0].body, /^⭐M2: XAU ▲ LONG TAM — giriş ~101\.30, stop .* \(2 ATR\), çıkış: 1H kapanış DA5 ötesi$/);
});

test('M2 senaryo 2: rejim −1 iken LONG kırılım → LONG sinyal yok', () => {
  const bars = flat(300, { h: 101.2, c: 101.1 });
  const r = evalTrend(base(bars, { regime: RG(-1) }));
  assert.notEqual(r.dir, 1); assert.equal(r.newPos, null); assert.notEqual(r.status, 'TAM'); assert.notEqual(r.status, 'TAM_BEKLE');
  const r0 = evalTrend(base(bars, { regime: RG(0) }));
  assert.equal(r0.status, 'YOK');
});

function openLong(bars: Bar[]) {
  const pending: Record<string, Pending> = {};
  evalTrend(base(bars, { pending, price: 101.1 }));
  return evalTrend(base(bars, { pending, price: 101.1, scanT: bars[bars.length - 1].end + 6 * MIN, now: bars[bars.length - 1].end + 6 * MIN })).newPos!;
}

test('M2 senaryo 3: açık LONG, 1H kapanış DA5 altında → çıkış bildirimi; sonraki açılışta kapanır', () => {
  const bars = flat(300, { h: 101.2, c: 101.1 });
  const pos0 = openLong(bars);
  const t = bars[299].end;
  const after: Bar[] = [
    { t, end: t + HOUR, o: 101.2, h: 101.6, l: 100.8, c: 101.4 },
    { t: t + HOUR, end: t + 2 * HOUR, o: 101.4, h: 101.5, l: 98.5, c: 98.7 }, // DA5 = 99 → kapanış altında
  ];
  const all = [...bars, ...after];
  const p1 = trackPos(pos0, 'cfd24', all, all, P, t + 2 * HOUR + 10_000, 98.7);
  assert.equal(p1.open, true); assert.equal(p1.exitPending, t + 2 * HOUR);
  const msgs = trendMessages(P, p1, null, 2, t + 2 * HOUR + 10_000);
  assert.ok(msgs.some((m) => m.key.endsWith('+CIKIS') && /1H kapanış Donchian 5 kırıldı/.test(m.body)));
  const nx: Bar = { t: t + 2 * HOUR, end: t + 3 * HOUR, o: 98.6, h: 98.9, l: 98.2, c: 98.4 };
  const p2 = trackPos(pos0, 'cfd24', [...all, nx], [...all, nx], P, t + 3 * HOUR + 10_000, 98.4);
  assert.equal(p2.open, false); assert.equal(p2.exit, 98.6); assert.ok(p2.r! < 0);
});

test('M2 senaryo 4: açık LONG, rejim 0\'a döndü → pozisyon devam (rejim çıkış nedeni değil)', () => {
  const bars = flat(300, { h: 101.2, c: 101.1 });
  const pos0 = openLong(bars);
  const t = bars[299].end;
  const all = [...bars, { t, end: t + HOUR, o: 101.2, h: 101.6, l: 100.9, c: 101.3 }];
  const p = trackPos(pos0, 'cfd24', all, all, P, t + HOUR + 10_000, 101.3);
  assert.equal(p.open, true);
  const r = evalTrend(base(all, { regime: RG(0), openPos: p }));
  assert.equal(r.newPos, null);
  assert.equal(p.open, true);
});

test('M2 senaryo 5: teyit taramasında fiyat 0,6 ATR ilerlemiş → KAÇTI, TAM yok, bildirim yok', () => {
  const bars = flat(300, { h: 101.2, c: 101.1 });
  const pending: Record<string, Pending> = {};
  const r1 = evalTrend(base(bars, { pending, price: 101.1 }));
  const atr = r1.levels.atr;
  const r2 = evalTrend(base(bars, { pending, price: 101.1 + 0.6 * atr, scanT: bars[299].end + 6 * MIN, now: bars[299].end + 6 * MIN }));
  assert.equal(r2.finalCheck, 'KACTI'); assert.equal(r2.newPos, null); assert.notEqual(r2.status, 'TAM');
  // 0,4 ATR → OK
  const p2: Record<string, Pending> = {};
  evalTrend(base(bars, { pending: p2, price: 101.1 }));
  assert.equal(evalTrend(base(bars, { pending: p2, price: 101.1 + 0.4 * atr, scanT: bars[299].end + 6 * MIN })).status, 'TAM');
});

test('M2 senaryo 6: USDJPY her istekte timezone=UTC; saat kayması (gelecekte mum) → hata, veri yok sayılır', async () => {
  const cfg = conf();
  const now = Date.UTC(2026, 10, 10, 12, 0);
  const credits = freshCredits(null, now, cfg.params);
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (u: URL | string) => {
    urls.push(String(u));
    // Sidney saati (UTC+11) UTC gibi etiketlenmiş: son mum 11 saat ileride
    const v = [0, 1, 2].map((i) => ({ datetime: new Date(now + (11 - i) * HOUR).toISOString().slice(0, 19).replace('T', ' '), open: '150', high: '150.2', low: '149.8', close: '150.1' }));
    return new Response(JSON.stringify({ status: 'ok', values: v.reverse() }), { status: 200 });
  }) as typeof fetch;
  try {
    const td = new TwelveData('k', credits, cfg.params, () => now);
    const store: Record<string, Candle[]> = { USDJPY: [] };
    const mem: Record<string, FetchMem> = {};
    const errors: string[] = [];
    await runStarFetch(sc, td, [{ sym: 'USDJPY', kind: 'hourly', size: 3, why: 't' }], store, mem, now, errors);
    assert.match(urls[0], /symbol=USD%2FJPY/); assert.match(urls[0], /timezone=UTC/);
    assert.equal(store.USDJPY.length, 0);
    assert.match(errors[0], /saat kayması/);
  } finally { globalThis.fetch = realFetch; }
});

test('M2 uçtan uca: analyze → runTrend (XAU, 24 saat), M2.3 eski mum sinyal üretmez, portföy R', async () => {
  // 230 seans günü yükselen trend (rejim +1), sonra yatay ve kırılım
  const h1: Candle[] = [];
  let t = Date.UTC(2026, 0, 4, 23); // Pazar 18:00 strateji saati
  let px = 1000;
  const end = Date.UTC(2026, 10, 10, 15); // Salı 10:00 strateji saati
  while (t < end) {
    const d = new Date(t - 5 * HOUR), dow = d.getUTCDay(), m = d.getUTCHours();
    const wk = dow === 6 || (dow === 5 && m >= 17) || (dow === 0 && m < 18) || m === 17;
    if (!wk) { px += 0.05; h1.push({ t, o: px, h: px + 1, l: px - 1, c: px }); }
    t += HOUR;
  }
  h1[h1.length - 1] = { ...h1[h1.length - 1], h: px + 20, c: px + 15 };
  const now = end + 10_000;
  const s: StarSeries = analyze(sc, 'XAUUSD', h1, now, null, '', 'test');
  assert.equal(s.regime?.value, 1, `rejim ${JSON.stringify(s.regime)}`);
  const positions: never[] = [] as never[];
  const pending: Record<string, Pending> = {};
  const deps = (n: number) => ({ sc, now: n, series: { XAUUSD: s, US100: undefined as unknown as StarSeries, USDJPY: undefined as unknown as StarSeries }, positions, pending, signals: [], urgent: new Set<string>(), newsLabel: null, livePrice: async () => ({ price: px + 15, src: 't', live: true }) });
  const r1 = await runTrend('M2', deps(now));
  assert.equal((r1.rows.XAUUSD as { status: string }).status, 'TAM_BEKLE');
  const d2 = deps(now + 5 * MIN);
  const r2 = await runTrend('M2', d2);
  assert.equal((r2.rows.XAUUSD as { status: string }).status, 'TAM');
  assert.equal(r2.msgs.filter((m) => m.key.endsWith('+TAM')).length, 1);
  assert.equal((positions as unknown[]).length, 1);
  assert.ok(r2.charts.M2_XAUUSD);
  // Aynı mum ikinci kez sinyal üretmez (açık pozisyon)
  const r3 = await runTrend('M2', deps(now + 10 * MIN));
  assert.equal(r3.msgs.filter((m) => m.key.endsWith('+TAM')).length, 0);
  // M2.3: 2 saatten eski kırılım mumu sinyal üretmez
  const r4 = await runTrend('M2', { ...deps(now + 2 * HOUR), positions: [] as never[], pending: {} });
  assert.notEqual((r4.rows.XAUUSD as { status: string }).status, 'TAM_BEKLE');
  const pf = portfolio(positions, 0, 0.5, now);
  assert.equal(pf.open.length, 1); assert.equal(pf.openRiskPct, 0.5);
});
