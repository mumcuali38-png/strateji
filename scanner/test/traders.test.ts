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
