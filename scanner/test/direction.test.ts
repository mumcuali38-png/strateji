import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sc from '../src/direction/score.ts';
import { parseFarside } from '../src/direction/sources.ts';
import { shouldRun, labelChanges, capDirection, type DirFile } from '../src/direction/run.ts';
import { fromCloses } from './helpers.ts';

const comps = (vals: Record<string, sc.S>): sc.Comp[] => [['trend', 25], ['yapi', 20], ['momentum', 10], ['kurulum', 15], ['makro', 15], ['pozisyon', 10], ['haber', 5]]
  .map(([id, w]) => ({ id: id as string, name: id === 'pozisyon' ? 'Pozisyonlanma' : (id as string), w: w as number, s: id in vals ? vals[id as string] : 0, note: '' }));

test('EK test 15: forex trend +1, yapı +1, diğerleri 0 → S 0,45 → 73 Bullish', () => {
  const r = sc.combine(comps({ trend: 1, yapi: 1 }));
  assert.equal(r.score, 73); assert.equal(r.label, 'Bullish');
});
test('EK test 13: COT verisi yok → pozisyonlanma ağırlığı dağıtılır + not', () => {
  const r = sc.combine(comps({ trend: 1, yapi: 1, pozisyon: null }));
  assert.equal(r.score, Math.round(50 + 50 * (45 / 90)));
  assert.deepEqual(r.missing, ['Pozisyonlanma verisi yok']);
  assert.equal(sc.mix([[0.6, null], [0.4, 0.5]]), 0.5, 'alt parça da dağıtılır');
});
test('EK test 16–17: Myfxbook long %82 → −1; funding %0,08 → −1', () => {
  assert.equal(sc.retailScore(82), -1);
  assert.equal(sc.fundingScore(0.08), -1);
  assert.equal(sc.fundingScore(0.045), -0.5);
  assert.equal(sc.fundingScore(-0.02), 0.3);
  assert.equal(sc.oiScore(1, 1), 1); assert.equal(sc.oiScore(-1, 1), -1); assert.equal(sc.oiScore(1, -1), 0.3);
  assert.equal(sc.fngScore(15), 0.7); assert.equal(sc.fngScore(85), -0.7); assert.equal(sc.fngScore(50), 0);
});
test('EK test 14: kredi %90 → forex güncellemesi 4 saatte bir', () => {
  const prev = { updatedAt: 0 } as DirFile;
  assert.equal(shouldRun(prev, 3600_000, 0.5), true);
  assert.equal(shouldRun(prev, 3600_000, 0.9), false);
  assert.equal(shouldRun(prev, 4 * 3600_000, 0.9), true);
});
test('Etiketler ve trend/yapı/COT', () => {
  assert.deepEqual([85, 65, 50, 30, 10].map(sc.labelOf), ['Güçlü Bullish', 'Bullish', 'Nötr', 'Bearish', 'Güçlü Bearish']);
  const up = fromCloses(Array.from({ length: 260 }, (_, i) => 100 + i * 0.5 + Math.sin(i / 3) * 5));
  assert.equal(sc.trendTF(up), 1);
  assert.equal(sc.trendTF(fromCloses(Array.from({ length: 260 }, (_, i) => 300 - i * 0.5 + Math.sin(i / 3) * 2))), -1);
  assert.equal(sc.structTF(up), 1);
  assert.equal(sc.trendTF(up.slice(0, 100)), null, '200 mumdan az → veri yok');
  const net = Array.from({ length: 60 }, (_, i) => (i % 2 ? 1000 : -1000));
  assert.ok(Math.abs(sc.cotScore(net).s!) <= 1);
  assert.equal(sc.cotScore([...Array(56).fill(0).map((_, i) => (i % 4) * 10), 5000]).s, -0.5, 'aşırı uç (z>2) → ters düzeltme');
  assert.equal(sc.eventDir('Unemployment Rate'), -1); assert.equal(sc.eventDir('CPI m/m'), 1); assert.equal(sc.eventDir('Speech'), 0);
  assert.equal(sc.pairEffect('EURUSD', 'USD'), -1); assert.equal(sc.pairEffect('XAUUSD', 'USD'), -1);
  assert.equal(sc.ourSetups([{ status: 'TAM', remaining: 0, dir: 1 }, { status: 'EKSIK', remaining: 1, dir: -1 }]), 0.25);
});
test('Farside tablo ayrıştırma ve etiket değişimi bildirimi (günde en fazla 3)', () => {
  const row = (d: string, v: string) => `<tr><td>${d}</td><td>1.0</td><td>${v}</td></tr>`;
  const html = `<table>${row('29 Oct 2026', '100.5')}${row('30 Oct 2026', '(50.0)')}${row('31 Oct 2026', '-')}${row('03 Nov 2026', '200')}${row('04 Nov 2026', '1,000.0')}<tr><td>Total</td><td>9</td><td>9</td></tr></table>`;
  assert.equal(parseFarside(html), 1250.5);
  assert.equal(parseFarside('<html>yok</html>'), null);
  const mk = (labels: string[]): DirFile => ({ updatedAt: 0, sources: {}, forex: { general: { score: 50, label: 'Nötr', change24: null }, items: labels.map((l, i) => ({ symbol: `S${i}`, name: `S${i}`, score: 60, label: l, change24: null, spark: [], comps: [], missing: [] })) }, crypto: { general: { score: 50, label: 'Nötr', change24: null }, items: [] } });
  const msgs = labelChanges(mk(['Nötr', 'Nötr', 'Nötr', 'Nötr']), mk(['Bullish', 'Bullish', 'Bullish', 'Bullish']), 0);
  assert.equal(msgs.length, 4);
  const notified: Record<string, number> = {};
  assert.equal(capDirection(msgs, notified, 0).length, 3);
  assert.equal(capDirection(msgs, notified, 0).length, 0);
});

test('OANDA pozisyon defteri: kovaların toplamı → long %', async () => {
  const { positionBookLongPct } = await import('../src/direction/sources.ts');
  assert.equal(positionBookLongPct([{ longCountPercent: '0.30', shortCountPercent: '0.10' }, { longCountPercent: '0.40', shortCountPercent: '0.20' }]), 70);
  assert.equal(positionBookLongPct([]), null);
});
