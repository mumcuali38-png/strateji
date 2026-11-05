import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotateDeadlines, lastEntryOf } from '../src/deadline.ts';
import { computeMessages } from '../src/notify.ts';
import type { Setup } from '../src/types.ts';
import { conf } from './helpers.ts';

const NY = (h: number, m = 0) => Date.UTC(2026, 10, 5, h + 5, m); // 05.11.2026, sabit UTC-5
function setup(over: Partial<Setup> = {}): Setup {
  return {
    id: 'B-XAUUSD-x', key: 'B+XAUUSD+1+z+TAM', strategy: 'B', symbol: 'XAUUSD', sub: '1H OB · 5m onay', dir: 1, status: 'TAM', remaining: 0,
    conditions: [{ id: 'confirm', label: 'LTF onay', status: 'ok', detail: 'ok' }],
    methods: [{ id: 'm', label: 'Breaker', type: 'limit', entry: 4012.4, stopStructural: 4007.4, stop: 4006.9, tp1: 4024.1, rr: 2.13 }], defaultMethod: 'm',
    overlays: [], chartTf: '5m', tfs: ['5m'], evaluatedAt: NY(3), zoneId: 'z', signalAt: NY(3), ...over,
  };
}

test('Son giriş (EK §3.5): B killzone bitişi, C ve D1 11:00 NY, F spring+24 sa, G 13:00 TR', () => {
  const c = conf();
  assert.equal(lastEntryOf(c, setup(), NY(3)), NY(5), 'London Open 02–05 NY');
  assert.equal(lastEntryOf(c, setup({ signalAt: NY(8) }), NY(8)), NY(10), 'NY Open 07–10');
  assert.equal(lastEntryOf(c, setup({ strategy: 'C', signalAt: NY(10, 20) }), NY(10, 20)), NY(11));
  assert.equal(lastEntryOf(c, setup({ strategy: 'D', sub: 'D1 · açılış range (ORB) · 1m', signalAt: NY(9, 50) }), NY(9, 50)), NY(11));
  assert.equal(lastEntryOf(c, setup({ strategy: 'F', zoneId: `S${NY(1)}` }), NY(3)), NY(1) + 24 * 3600_000);
  assert.equal(lastEntryOf(c, setup({ strategy: 'G', info: { g: { timeline: { lastEntry: NY(5) } } } }), NY(3)), NY(5));
  assert.equal(lastEntryOf(c, setup({ strategy: 'D', sub: 'D2 · 1H range kırılımı', signalAt: NY(3) }), NY(3)), NY(3) + c.params.general.maxSignalAgeHours * 3600_000);
});

test('Süre doldu → YOK + tek "SÜRE DOLDU" bildirimi (TAM bildirildiyse); dolmuş G etkilenmez', () => {
  const c = conf();
  const notified: Record<string, number> = { 'B+XAUUSD+1+z+TAM': NY(3) };
  const s = setup(); annotateDeadlines(c, [s], NY(5, 5));
  assert.equal(s.status, 'YOK');
  assert.match(s.none!.why, /SÜRE DOLDU/);
  const m1 = computeMessages(c, [s], null, notified, [], NY(5, 5));
  assert.equal(m1.filter((m) => /SÜRE DOLDU/.test(m.title)).length, 1);
  assert.equal(m1.filter((m) => m.kind === 'cancel').length, 0, 'iptal bildirimiyle karışmaz');
  const s2 = setup(); annotateDeadlines(c, [s2], NY(5, 10));
  assert.equal(computeMessages(c, [s2], null, notified, [], NY(5, 10)).length, 0, 'tekrar yok');
  const g = setup({ strategy: 'G', info: { g: { filled: true, timeline: { lastEntry: NY(5) } } } }); annotateDeadlines(c, [g], NY(6));
  assert.equal(g.status, 'TAM');
  const early = setup(); annotateDeadlines(c, [early], NY(4));
  assert.equal(early.status, 'TAM'); assert.equal(early.lastEntry, NY(5));
});
