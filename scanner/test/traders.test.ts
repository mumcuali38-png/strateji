import { test } from 'node:test';
import assert from 'node:assert/strict';
import { passes, disagreement, DEFAULT_FILTERS, type TradersFile } from '../src/traders.ts';
// @ts-expect-error — uygulama modülü saf JS
import { agreement } from '../../app/traders.js';
import type { Setup } from '../src/types.ts';

const y = { userName: 'a', gain: 34, riskScore: 4, maxMonthlyRiskScore: 5, trades: 420, peakToValley: -12, weeksSinceRegistration: 120 };
const q = { userName: 'a', gain: 6, riskScore: 4, trades: 80, instrumentPct: 20 };

test('Başarılı filtresi (EK §6.3)', () => {
  assert.equal(passes(y, q, DEFAULT_FILTERS), true);
  assert.equal(passes({ ...y, weeksSinceRegistration: 40 }, q, DEFAULT_FILTERS), false, '< 12 ay');
  assert.equal(passes({ ...y, peakToValley: -25 }, q, DEFAULT_FILTERS), false, 'DD > %20');
  assert.equal(passes({ ...y, trades: 90 }, q, DEFAULT_FILTERS), false, '< 100 işlem');
  assert.equal(passes({ ...y, maxMonthlyRiskScore: 7 }, q, DEFAULT_FILTERS), false, 'risk > 6');
  assert.equal(passes(y, { ...q, gain: -1 }, DEFAULT_FILTERS), false, 'son 3 ay negatif');
  assert.equal(passes(y, { ...q, instrumentPct: 10 }, DEFAULT_FILTERS), false, 'paritede 90 günde < 10 işlem');
  assert.equal(passes(y, undefined, DEFAULT_FILTERS), false);
});

const file = (long: number, short: number): TradersFile => ({ updatedAt: 0, status: 'ok', source: '', filters: DEFAULT_FILTERS, crowd: {}, cot: {}, pairs: { XAUUSD: { traders: [], long, short, candidates: 0 } } });
const s = { id: 'G-1', strategy: 'G', symbol: 'XAUUSD', dir: 1, status: 'TAM', remaining: 0 } as unknown as Setup;

test('Uyumsuzluk bildirimi: TAM LONG, trader\'ların ≥%70\'i SHORT → tek bildirim', () => {
  const n: Record<string, number> = {};
  assert.equal(disagreement([s], file(2, 5), n, 0).length, 1);
  assert.equal(disagreement([s], file(2, 5), n, 0).length, 0, 'tekrar yok');
  assert.equal(disagreement([s], file(3, 4), {}, 0).length, 0, '%57 → yok');
  assert.equal(disagreement([s], file(0, 2), {}, 0).length, 0, '3\'ten az trader');
});

test('Uyum satırı: "G LONG TAM — trader\'ların %71\'i LONG → uyumlu ✅"', () => {
  const a = agreement([s], { long: 5, short: 2 });
  assert.equal(a[0].text, "G LONG TAM — trader'ların %71'i LONG → uyumlu ✅");
  assert.equal(agreement([s], { long: 1, short: 5 })[0].ok, false);
  assert.match(agreement([s], { long: 0, short: 0 })[0].text, /trader verisi yok/);
});

test('OKX büyük trader oranı (BTC/ETH): oran → long %, uyum ve uyumsuzluk', async () => {
  const { lsToPct } = await import('../src/traders.ts');
  assert.equal(lsToPct(2), 66.7); assert.equal(lsToPct(0.9), 47.4); assert.equal(lsToPct(null), null);
  const b = { id: 'F-1', strategy: 'F', symbol: 'BTCUSD', dir: 1, status: 'TAM', remaining: 0 } as unknown as Setup;
  const f: TradersFile = { ...file(0, 0), pairs: { BTCUSD: { traders: [], long: 0, short: 0, candidates: 0 } }, okx: { BTCUSD: { topLS: 0.35, allLS: 2.8, topLongPct: 25.9, allLongPct: 73.7 } } };
  const m = disagreement([b], f, {}, 0);
  assert.equal(m.length, 1); assert.match(m[0].body, /OKX büyük trader pozisyonlarının %74'i SHORT/);
  assert.match(agreement([b], { long: 0, short: 0 }, 66.7)[0].text, /OKX büyük trader'ların %67'i LONG → uyumlu ✅/);
});
