import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — uygulama modülleri saf JS (tarayıcı + node ortak)
import { splitLot, orderText, spreadRR, orderSide, openRiskPct, rrRules } from '../../app/order.js';
// @ts-expect-error
import { recompute } from '../../app/calc.js';
// @ts-expect-error
import { DisabledAdapter, getAdapter, orderComment, MAGIC } from '../../app/broker.js';
import { conf } from './helpers.ts';

const c = conf();
const settings = { balance: 10000, riskPct: 0.5, currency: 'USD', instrConfirmed: 1, buffers: {}, instr: {} };
const m = (entry: number, stop: number, tp1: number, tp2?: number) => ({ id: 'x', label: 'x', type: 'limit', entry, stop, stopStructural: stop, fixedStop: true, tp1, tp2, rr: 0 });

test('EK test 1: bakiye $10.000, XAU stop $8, risk %0,5 → 0,06 lot (2×0,03)', () => {
  const r = recompute(m(4056.85, 4048.85, 4072.85), { symbol: 'XAUUSD', strategy: 'B', dir: 1 }, c.symbols.XAUUSD, settings, {});
  assert.equal(r.lotOk, true);
  assert.equal(+r.lot.toFixed(2), 0.06);
  assert.deepEqual(splitLot(r.lot, 0.01), [0.03, 0.03]);
});

test('EK test 2: EURUSD stop 12 pip → 0,41 lot → 0,21 (TP1) + 0,20 (TP2)', () => {
  const r = recompute(m(1.1, 1.0988, 1.1024), { symbol: 'EURUSD', strategy: 'B', dir: 1 }, c.symbols.EURUSD, settings, {});
  assert.equal(+r.lot.toFixed(2), 0.41);
  assert.deepEqual(splitLot(r.lot, 0.01), [0.21, 0.2]);
});

test('EK test 3: hesaplanan lot 0,004 → "Risk çok küçük", lot 0,01 ve gerçek risk %', () => {
  const r = recompute(m(4056.85, 3931.85, 4306.85), { symbol: 'XAUUSD', strategy: 'B', dir: 1 }, c.symbols.XAUUSD, { ...settings, balance: 10000, riskPct: 0.05 }, {});
  assert.equal(+r.lot.toFixed(2), 0.01);
  assert.match(r.lotNote, /Risk çok küçük — min lot 0.01 ile risk %1\.25/);
});

test('Bakiye yok / doğrulanmadı → AYAR GEREKLİ', () => {
  const r = recompute(m(4056.85, 4048.85, 4072.85), { symbol: 'XAUUSD', strategy: 'B', dir: 1 }, c.symbols.XAUUSD, { ...settings, balance: '' }, {});
  assert.equal(r.lotOk, false); assert.match(r.lotNote, /AYAR GEREKLİ/);
  const r2 = recompute(m(4056.85, 4048.85, 4072.85), { symbol: 'XAUUSD', strategy: 'B', dir: 1 }, c.symbols.XAUUSD, { ...settings, instrConfirmed: 0 }, {});
  assert.equal(r2.lotOk, false);
});

test('EK test 8: Kopyala formatı', () => {
  const txt = orderText({ symbol: 'XAUUSD', side: 'BUY LIMIT', dec: 2, step: 0.01, entry: 4056.85, stop: 4045.6, tp1: 4071.2, tp2: 4088, lot: 0.06, parts: [0.03, 0.03] });
  assert.equal(txt, 'XAUUSD BUY LIMIT 4056.85 SL 4045.60 TP1 4071.20 TP2 4088.00 LOT 0.06 (2×0.03)');
  assert.equal(orderText({ symbol: 'EURUSD', side: 'SELL', dec: 5, step: 0.01, entry: 1.1, stop: 1.1012, tp1: 1.0976, lot: 0.41, parts: [0.21, 0.2] }), 'EURUSD SELL 1.10000 SL 1.10120 TP1 1.09760 LOT 0.41 (0.21+0.20)');
});

test('Emir tipi: limit fiyatın altında BUY LIMIT, üstünde BUY STOP; short tersi', () => {
  assert.equal(orderSide(1, 'limit', 4050, 4060), 'BUY LIMIT');
  assert.equal(orderSide(1, 'limit', 4070, 4060), 'BUY STOP');
  assert.equal(orderSide(-1, 'limit', 4070, 4060), 'SELL LIMIT');
  assert.equal(orderSide(-1, 'market', 4060, 4060), 'SELL');
});

test('EK test 6: spread dahil RR minimumun altına düşer', () => {
  const r = spreadRR({ entry: 100, stop: 99, tp1: 102 }, 1, 0.1);
  assert.ok(r.rr! < 2); // (102 − 100.1) / 1.1 = 1.73
  assert.equal(r.rr!.toFixed(2), '1.73');
  assert.deepEqual(rrRules('B', c.params)[0].slice(0, 2), ['rr', 2]);
  assert.deepEqual(rrRules('G', c.params).map((x: unknown[]) => x[0]), ['rr', 'rr2']);
});

test('EK test 5: açık risk %1,2 + yeni %0,5 > %1,5 → RİSK DOLU', () => {
  const open = openRiskPct([{ riskUsd: 70, result: null }, { riskUsd: 50, result: null }, { riskUsd: 500, result: 'SL' }], 10000);
  assert.equal(open.toFixed(2), '1.20');
  assert.ok(open + 0.5 > 1.5);
});

test('EK test 7: MT5 kapalı — DisabledAdapter emir göndermez', async () => {
  const a = getAdapter({ broker: 'off' });
  assert.ok(a instanceof DisabledAdapter);
  assert.equal(a.status(), 'DISABLED');
  const r = await a.placeOrder({});
  assert.equal(r.ok, false); assert.match(r.message, /henüz aktif değil/);
  assert.equal(MAGIC.G, 1007);
  assert.equal(orderComment('G', 1, Date.UTC(2026, 10, 6, 6)), 'G-LONG-20261106');
});
