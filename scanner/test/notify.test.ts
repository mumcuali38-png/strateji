import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMessages } from '../src/notify.ts';
import type { Setup } from '../src/types.ts';
import { conf } from './helpers.ts';

function setup(status: Setup['status'], remaining = 0): Setup {
  return {
    id: 'B-XAUUSD-1h-OB-1', key: `B+XAUUSD+1+1h-OB-1+${status}`, strategy: 'B', symbol: 'XAUUSD', sub: '1H OB · 5m onay', dir: 1, status, remaining,
    conditions: [{ id: 'confirm', label: 'LTF onay', status: status === 'TAM' ? 'ok' : 'wait', detail: '5m CHoCH 4016.20 üstü' }],
    methods: [{ id: 'breaker', label: 'Breaker', type: 'limit', entry: 4012.4, stopStructural: 4007.4, stop: 4006.9, tp1: 4024.1, rr: 2.13 }], defaultMethod: 'breaker',
    overlays: [], chartTf: '5m', tfs: ['5m'], evaluatedAt: 0, zoneId: '1h-OB-1',
  };
}

test('Aynı durum iki taramada → tek bildirim', () => {
  const c = conf();
  const notified: Record<string, number> = {};
  const m1 = computeMessages(c, [setup('TAM')], null, notified, [], 1000);
  const m2 = computeMessages(c, [setup('TAM')], { strategies: { B: { XAUUSD: [setup('TAM')] } } }, notified, [], 2000);
  assert.equal(m1.length, 1);
  assert.equal(m2.length, 0);
  assert.match(m1[0].body, /XAU B LONG · Giriş 4012\.40 · SL 4006\.90 · TP 4024\.10 · RR 2\.1 · 0\.\d\d lot/);
});

test('Durum değişince (EKSİK→TAM) yeni bildirim', () => {
  const c = conf();
  const notified: Record<string, number> = {};
  const a = computeMessages(c, [setup('EKSIK', 1)], null, notified, [], 1000);
  const b = computeMessages(c, [setup('TAM')], null, notified, [], 2000);
  assert.equal(a[0].kind, 'ready');
  assert.equal(b[0].kind, 'tam');
});

test('TAM setup stop ile geçersiz olursa iptal bildirimi', () => {
  const c = conf();
  const notified: Record<string, number> = {};
  const dead = setup('YOK');
  dead.conditions.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: 'Stop seviyesi delindi — senaryo bitti' });
  const m = computeMessages(c, [dead], { strategies: { B: { XAUUSD: [setup('TAM')] } } }, notified, [], 1000);
  assert.equal(m.length, 1);
  assert.equal(m[0].kind, 'cancel');
});

test('Haber riski bildirimi 30 dk içinde bir kez', () => {
  const c = conf();
  const notified: Record<string, number> = {};
  const ev = [{ id: 'cpi', t: 25 * 60_000, currency: 'USD', impact: 'High' as const, title: 'CPI', source: 'FF' }];
  assert.equal(computeMessages(c, [], null, notified, ev, 0).length, 1);
  assert.equal(computeMessages(c, [], null, notified, ev, 60_000).length, 0);
});
