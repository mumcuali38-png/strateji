import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackEvent, trackMessages, openSignalIds } from '../src/track.ts';
import { updateHistory, type HistEvent } from '../src/history.ts';
import { computeMessages } from '../src/notify.ts';
import type { Candle, Setup } from '../src/types.ts';
import { conf } from './helpers.ts';

const T0 = Date.UTC(2026, 10, 5, 8, 0);
const M5 = 5 * 60_000;
/** [h, l, c] dizisinden 5m mumlar (o = önceki kapanış) */
const bars = (rows: [number, number, number][]): Candle[] => rows.map(([h, l, c], i) => ({ t: T0 + i * M5, o: i ? rows[i - 1][2] : c, h, l, c, v: 0 }));
function ev(over: Partial<HistEvent> = {}, type: 'market' | 'limit' = 'market'): HistEvent {
  return { id: 'B-XAU-1', key: 'B+XAUUSD+1+z+TAM', t: T0, strategy: 'B', symbol: 'XAUUSD', dir: 1, kind: 'TAM', sub: 'x', signalAt: T0,
    method: { id: 'm', label: 'm', type, entry: 100, stop: 99, tp1: 102, tp2: 104, rr: 2 }, conditions: [], overlays: [], ...over };
}

test('Takip: TP1 (%50 + BE) → TP2 = 0,5×2 + 0,5×4 = 3R', () => {
  const tr = trackEvent(ev(), bars([[100.5, 99.8, 100.2], [102.2, 100.1, 102], [103, 101.5, 102.5], [104.1, 102.4, 104]]), T0 + 30 * M5)!;
  assert.equal(tr.status, 'KAPANDI');
  assert.deepEqual(tr.events.map((e) => e.type), ['FILL', 'TP1', 'TP2']);
  assert.equal(tr.resultR, 3);
});

test('Takip: TP1 sonrası girişe dönüş → BE, +1R; TP1 öncesi stop → −1R; aynı mumda stop ve TP1 → stop', () => {
  assert.equal(trackEvent(ev(), bars([[102.2, 100.1, 102], [102.5, 99.9, 100.5]]), T0)!.resultR, 1);
  const sl = trackEvent(ev(), bars([[100.5, 98.9, 99.2]]), T0)!;
  assert.equal(sl.resultR, -1); assert.equal(sl.events.at(-1)!.type, 'SL');
  assert.equal(trackEvent(ev(), bars([[102.5, 98.5, 100]]), T0)!.resultR, -1);
});

test('Takip: limit son giriş zamanına kadar dolmazsa DOLMADI; dolarsa ACIK + anlık R', () => {
  const e = ev({ lastEntry: T0 + 2 * M5, method: { id: 'm', label: 'm', type: 'limit', entry: 98, stop: 97, tp1: 100, tp2: 102, rr: 2 } }, 'limit');
  assert.equal(trackEvent(e, bars([[100.5, 99, 100], [100.5, 99, 100], [100, 97.5, 98]]), T0)!.status, 'DOLMADI');
  const open = trackEvent({ ...e, lastEntry: undefined }, bars([[100.5, 99, 100], [99, 97.9, 98.5]]), T0)!;
  assert.equal(open.status, 'ACIK'); assert.equal(open.liveR, 0.5);
});

test('İşlem bildirimleri: TP1 tek sefer, 20 dk\'dan eski olay yok, F/G kendi T1\'ini atar, açık işlemde iptal = ÇIKIŞ', () => {
  const c = conf();
  const cs = bars([[100.5, 99.8, 100.2], [102.2, 100.1, 101.5]]);
  const h = ev(); h.track = trackEvent(h, cs, T0 + 2 * M5);
  const notified: Record<string, number> = { [h.key]: T0 };
  const m1 = trackMessages(c, [h], notified, [], T0 + 2 * M5);
  assert.equal(m1.length, 1); assert.match(m1[0].body, /TP1 — %50 kapat, SL'yi girişe çek/); assert.equal(m1[0].kind, 'trade'); assert.equal(m1[0].signal, h.id);
  assert.equal(trackMessages(c, [h], notified, [], T0 + 3 * M5).length, 0, 'tekrar yok');
  const late = ev(); late.track = trackEvent(late, cs, T0);
  assert.equal(trackMessages(c, [late], { [late.key]: T0 }, [], T0 + 60 * M5).length, 0, 'eski olay bildirilmez');
  const g = ev({ strategy: 'G', key: 'G+k' }); g.track = trackEvent(g, cs, T0);
  assert.equal(trackMessages(c, [g], { 'G+k': T0 }, [], T0 + 2 * M5).length, 0, 'G kendi T1 bildirimini gönderir');
  // Haber kuralı: açık işlemde 15 dk kala
  const o = ev(); o.track = trackEvent(o, bars([[100.5, 99.8, 100.2]]), T0);
  const nm = trackMessages(c, [o], { [o.key]: T0 }, [{ id: 'n1', t: T0 + 10 * 60_000, currency: 'USD', impact: 'High', title: 'CPI', source: 'test' } as never], T0);
  assert.equal(nm.length, 1); assert.match(nm[0].body, /CPI .* TP1 alınmadıysa çık/);
  // ÇIKIŞ
  assert.ok(openSignalIds([o]).has(o.id));
  const s = { id: o.id, key: 'B+XAUUSD+1+z+TAM', strategy: 'B', symbol: 'XAUUSD', sub: '', dir: 1, status: 'TAM', remaining: 0, conditions: [], methods: [], overlays: [], chartTf: '5m', tfs: [], evaluatedAt: T0, zoneId: 'z' } as unknown as Setup;
  const gone = { ...s, status: 'YOK', conditions: [{ id: 'x', label: 'Bölge', status: 'fail', detail: 'bölge tükendi' }] } as unknown as Setup;
  const cm = computeMessages(c, [gone], { strategies: { B: { XAUUSD: [s] } } }, {}, [], T0, openSignalIds([o]));
  assert.equal(cm.length, 1); assert.match(cm[0].title, /⛔ ÇIKIŞ/);
});

test('F taraması diğer sembollerin geçmişini bozmaz (boş mum = değerlendirme yok)', () => {
  const h = ev(); h.result = { outcome: 'ACIK', mfeR: 0.4, maeR: 0.1 };
  const out = updateHistory([h], [], T0 + M5, 30, () => [], 288).hist;
  assert.deepEqual(out[0].result, { outcome: 'ACIK', mfeR: 0.4, maeR: 0.1 });
  assert.equal(out[0].track, undefined);
});
