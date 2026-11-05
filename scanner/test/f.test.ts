// Kurulum F testleri — docs/KURULUM_F.md §18 senaryoları
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../src/types.ts';
import { evalF } from '../src/f/setup.ts';
import { aggregateUTC, type FData } from '../src/f/data.ts';
import { blocksF, cp, rv, springAt, targets, type TR } from '../src/f/wyckoff.ts';
import { HOUR, MIN } from '../src/time.ts';
import { conf } from './helpers.ts';

import { scenario, to15 } from './support/f-scenario.ts';
function data(h1: Candle[]): FData { return { h1, m15: to15(h1), m5: to15(h1).map((x) => ({ ...x })), h4: aggregateUTC(h1, 4 * HOUR), d1: aggregateUTC(h1, 24 * HOUR), source: 'binance' }; }
const springOf = (res: ReturnType<typeof evalF>) => res.find((s) => s.id.startsWith('F-BTCUSD-spring'))!;
const why = (s: ReturnType<typeof evalF>[number]) => s.conditions.map((c) => `${c.status} ${c.label}: ${c.detail}`).join('\n');

test('F temel senaryo: birikim → spring → CHoCH → düşük hacimli test = TAM (long)', () => {
  const sc = scenario();
  const res = evalF(conf(), sc.now, data(sc.h1), []);
  const s = springOf(res);
  assert.equal(s.dir, 1);
  assert.equal(s.status, 'TAM', why(s));
  const m = s.methods[0];
  assert.ok(m.fixedStop && m.tp3 !== undefined);
  assert.ok((m.rr3 ?? 0) >= 3 && (m.rr2 ?? 0) >= 1.5);
  assert.ok(s.notices?.some((n) => n.body.startsWith('F: BTC spring adayı')));
});

test('1) 4H EMA50 altında + negatif eğim: long aranmaz', () => {
  const sc = scenario({ trend: -1 });
  const res = evalF(conf(), sc.now, data(sc.h1), []);
  assert.ok(res.every((s) => s.dir !== 1), res.map((s) => `${s.dir} ${s.status}`).join(','));
});

test('2) Spring dibi TR.low − 2×ATR → spring değil (kırılım)', () => {
  const sc = scenario({ depthAtr: 2 });
  const trd: TR = { tf: '1h', low: sc.L - 8, high: sc.H + 8, eq: 0, touchesLow: 3, touchesHigh: 3, first: 0, last: 0, firstT: 0, lastT: 0, bars: 0, stale: false, atr: 66, lowPivots: [] };
  assert.equal(springAt(sc.h1, sc.sIdx, trd, 66, conf().params.F), null);
});

test('3) CP 0.4 + sonraki mum CP ≥ 0.5 ve dip altına inmedi → 2 mumlu spring', () => {
  const sc = scenario({ twoBar: true });
  assert.ok(cp(sc.h1[sc.sIdx]) < 0.5);
  const s = springOf(evalF(conf(), sc.now, data(sc.h1), []));
  const trig = s.conditions.find((c) => c.id === 'trigger')!;
  assert.equal(trig.status, 'ok', why(s));
  assert.match(trig.detail, /2 mumlu/);
});

test('4) Spring sonrası 2. mum kapanış < spring dibi → başarısız spring, iptal', () => {
  const sc = scenario({ failAfter: true });
  const s = springOf(evalF(conf(), sc.now, data(sc.h1), []));
  assert.equal(s.status, 'YOK');
  assert.match(s.conditions.find((c) => c.id === 'trigger')!.detail, /Başarısız/);
});

test('5) Spring RV ≈ 1.1 → hacim ⏳ (EKSİK)', () => {
  const sc = scenario({ springVol: 110 });
  assert.ok(Math.abs(rv(sc.h1, sc.sIdx) - 1.1) < 0.05);
  const s = springOf(evalF(conf(), sc.now, data(sc.h1), []));
  assert.equal(s.conditions.find((c) => c.id === 'volume')!.status, 'wait');
  assert.equal(s.status, 'EKSIK');
});

test('6) CHoCH 24 adet 1H mum içinde gelmedi → zaman aşımı, YOK', () => {
  const sc = scenario({ noChoch: true });
  const s = springOf(evalF(conf(), sc.now, data(sc.h1), []));
  assert.equal(s.status, 'YOK', why(s));
  assert.match(s.conditions.find((c) => c.id === 'choch')!.detail, /zaman aşımı/);
});

test('7) Test 1H hacmi > spring hacmi → giriş tetiklenmez (⏳)', () => {
  const sc = scenario({ testVol: 60 });
  const s = springOf(evalF(conf(), sc.now, data(sc.h1), []));
  const tc = s.conditions.find((c) => c.id === 'test')!;
  assert.equal(tc.status, 'wait', why(s));
  assert.match(tc.detail, /test hacmi yüksek/);
});

test('8) RR(T3) = 2.6 → RR yetersiz', () => {
  const tr: TR = { tf: '1h', low: 100, high: 110, eq: 105, touchesLow: 2, touchesHigh: 2, first: 0, last: 0, firstT: 0, lastT: 0, bars: 20, stale: false, atr: 1, lowPivots: [] };
  const tg = targets(tr, 101, 101 - 19 / 2.6);
  assert.ok(Math.abs(tg.rr3 - 2.6) < 1e-9);
  assert.ok(tg.rr3 < conf().params.F.minRR3);
});

test('9) Her şey ✅, saat 15:55 UTC → TAM – BEKLE (FUNDING)', () => {
  const sc = scenario();
  const now = Date.UTC(2026, 10, 4, 15, 55);
  const s = springOf(evalF(conf(), now, data(sc.h1.filter((x) => x.t + HOUR <= now)), []));
  assert.equal(s.status, 'BEKLE', why(s));
  assert.match(s.conditions.find((c) => c.id === 'filters')!.detail, /funding/);
});

test('10) Her şey ✅, Cumartesi → TAM – BEKLE (CUMARTESI)', () => {
  const sc = scenario({ shiftDays: 3 }); // Çarşamba → Cumartesi
  const s = springOf(evalF(conf(), sc.now, data(sc.h1), []));
  assert.equal(s.status, 'BEKLE', why(s));
  assert.match(s.conditions.find((c) => c.id === 'filters')!.detail, /Cumartesi/);
});

test('11) Spring Pazar → PAZAR_TEYIDI ⏳, Pazartesi pivot dip ile kalkar', () => {
  const F = conf().params.F;
  const sun = Date.UTC(2026, 10, 8, 14, 0);
  const h1 = Array.from({ length: 60 }, (_, i) => ({ t: sun - 30 * HOUR + i * HOUR, o: 100, h: 101, l: 99, c: 100, v: 100 }));
  assert.ok(blocksF(sun + 3 * HOUR, h1, [], F, 30, 15, { t: sun, okAfter: () => false }).blocks.includes('PAZAR_TEYIDI'));
  assert.ok(!blocksF(sun + 3 * HOUR, h1, [], F, 30, 15, { t: sun, okAfter: () => true }).blocks.includes('PAZAR_TEYIDI'));
});

test('12) ATR14 ≈ 2.3 × SMA20(ATR) → LIKIDASYON bloğu', () => {
  const F = conf().params.F;
  const t0 = Date.UTC(2026, 10, 2, 0, 0); // Pazartesi
  const h1: Candle[] = Array.from({ length: 80 }, (_, i) => ({ t: t0 + i * HOUR, o: 100, h: 101, l: 99, c: 100, v: 100 }));
  for (let i = 70; i < 80; i++) h1[i] = { ...h1[i], h: 112, l: 88 }; // aralık 2 → 24: ATR ≈ 2.3× ortalaması
  const b = blocksF(t0 + 81 * HOUR, h1, [], F);
  assert.ok(b.blocks.includes('LIKIDASYON'), b.text.join(','));
});

test('13) Binance ve Coinbase cevap vermiyor → VERİ YOK', () => {
  const res = evalF(conf(), Date.now(), null, [], ['Binance: HTTP 451', 'Coinbase: timeout']);
  assert.equal(res.length, 1);
  assert.equal(res[0].status, 'YOK');
  assert.match(res[0].conditions[0].detail, /VERİ YOK/);
});

test('Short: aynalanmış birikim (dağıtım) → UTAD TAM (short), fiyatlar gerçek', () => {
  const sc = scenario();
  const mir = sc.h1.map((x) => ({ t: x.t, o: 200000 - x.o, h: 200000 - x.l, l: 200000 - x.h, c: 200000 - x.c, v: x.v }));
  const res = evalF(conf(), sc.now, data(mir), []);
  const s = res.find((x) => x.id.startsWith('F-BTCUSD-spring'))!;
  assert.equal(s.dir, -1);
  assert.equal(s.status, 'TAM', why(s));
  const m = s.methods[0];
  assert.ok(m.stop > m.entry && m.tp1 < m.entry && m.tp3! < m.tp2!, `${m.entry} ${m.stop} ${m.tp1} ${m.tp3}`);
  assert.match(s.sub, /UTAD/);
});
