import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../src/types.ts';
import { Ctx } from '../src/context.ts';
import { evalA } from '../src/strategies/a.ts';
import { rbZone } from '../src/strategies/e.ts';
import { HOUR, MIN, fmtNY } from '../src/time.ts';
import { conf, mk } from './helpers.ts';

/** 4H yükseliş merdiveni (6 yukarı, 4 aşağı) — 5m mumlar monoton enterpolasyon */
function stairs(end: number, bars = 70): Candle[] {
  const out: Candle[] = [];
  let p = 3500;
  const start = end - bars * 4 * HOUR;
  for (let b = 0; b < bars; b++) {
    const up = b % 10 < 6;
    const o = p, c = up ? p + 10 : p - 7;
    for (let k = 0; k < 48; k++) {
      const a = o + ((c - o) * k) / 48, z = o + ((c - o) * (k + 1)) / 48;
      out.push({ t: start + b * 4 * HOUR + k * 5 * MIN, o: a, h: Math.max(a, z) + 0.01, l: Math.min(a, z) - 0.01, c: z, v: 1 });
    }
    p = c;
  }
  return out;
}
const XEND = Date.UTC(2026, 10, 4, 5, 0) + 8 * HOUR; // son kapanan 4H mumu 04:00–08:00 NY
function fakeout(m5: Candle[]) {
  const lo = Math.min(...m5.slice(-48).map((c) => c.l));
  m5.push({ t: XEND, o: lo + 0.2, h: lo + 0.3, l: lo + 0.05, c: lo + 0.1, v: 1 });
  m5.push({ t: XEND + 5 * MIN, o: lo + 0.1, h: lo + 0.15, l: lo - 0.9, c: lo - 0.8, v: 1 }); // güçlü bearish dışarı kapanış
  m5.push({ t: XEND + 10 * MIN, o: lo - 0.8, h: lo + 0.7, l: lo - 0.85, c: lo + 0.6, v: 1 }); // güçlü bullish içeri kapanış
  return lo;
}
const pick = (res: ReturnType<typeof evalA>) => res.find((s) => s.dir === 1 && s.zoneId.startsWith(`L${XEND - 4 * HOUR}`));

test('A: 4H low altında güçlü 5m kapanış + içeri güçlü kapanış = TAM (long)', () => {
  const m5 = stairs(XEND);
  const lo = fakeout(m5);
  const now = XEND + 15 * MIN + 30_000;
  assert.equal(fmtNY(now - 30_000), '08:15');
  const res = evalA(new Ctx('XAUUSD', conf(), now, { m5, m1: [], d1: [] }, []));
  const long = pick(res);
  assert.ok(long, 'alt çizgi setupı bulunmalı');
  const bad = long!.conditions.filter((c) => c.status !== 'ok').map((c) => `${c.label}: ${c.detail}`);
  assert.equal(long!.status, 'TAM', bad.join(' | '));
  const m = long!.methods[0];
  assert.equal(m.type, 'market');
  assert.ok(Math.abs(m.entry - (lo + 0.6)) < 1e-9);
  assert.ok(m.stop < lo - 0.9, 'stop dış ucun altında (tampon dahil)');
  assert.ok(m.rr >= 2);
  assert.ok(res.filter((s) => s.dir === -1).every((s) => s.status === 'YOK'), 'trend/EMA nedeniyle short yok');
});

test('A: sadece iğneyle dışarı çıkma setup sayılmaz', () => {
  const m5 = stairs(XEND);
  const lo = Math.min(...m5.slice(-48).map((c) => c.l));
  m5.push({ t: XEND, o: lo + 0.2, h: lo + 0.3, l: lo - 2, c: lo + 0.25, v: 1 });
  m5.push({ t: XEND + 5 * MIN, o: lo + 0.25, h: lo + 1.5, l: lo + 0.2, c: lo + 1.4, v: 1 });
  const long = pick(evalA(new Ctx('XAUUSD', conf(), XEND + 10 * MIN + 1000, { m5, m1: [], d1: [] }, [])))!;
  assert.notEqual(long.status, 'TAM');
  assert.equal(long.conditions.find((c) => c.id === 'out')!.status, 'wait');
});

test('A: killzone dışında dönüş geçersiz', () => {
  const m5 = stairs(XEND - 4 * HOUR); // son kapanan mum 00:00–04:00 NY, dönüş 04:05+ (killzone dışı: 05:00 sonrası)
  const lo = Math.min(...m5.slice(-48).map((c) => c.l));
  const t0 = XEND - 4 * HOUR + 65 * MIN; // 05:05 NY
  for (let t = XEND - 4 * HOUR; t < t0; t += 5 * MIN) m5.push({ t, o: lo + 0.2, h: lo + 0.25, l: lo + 0.15, c: lo + 0.2, v: 1 });
  m5.push({ t: t0, o: lo + 0.2, h: lo + 0.25, l: lo - 1.6, c: lo - 1.4, v: 1 });
  m5.push({ t: t0 + 5 * MIN, o: lo - 1.4, h: lo + 1.3, l: lo - 1.5, c: lo + 1.2, v: 1 });
  const res = evalA(new Ctx('XAUUSD', conf(), t0 + 10 * MIN + 1000, { m5, m1: [], d1: [] }, []));
  const long = res.find((s) => s.dir === 1 && s.zoneId.startsWith(`L${XEND - 8 * HOUR}`))!;
  assert.equal(long.status, 'YOK');
});

test('A: haber riski TAM setupı YOK\'a düşürür', () => {
  const m5 = stairs(XEND);
  fakeout(m5);
  const now = XEND + 15 * MIN + 30_000;
  const long = pick(evalA(new Ctx('XAUUSD', conf(), now, { m5, m1: [], d1: [] }, [{ id: 'cpi', t: now + 20 * MIN, currency: 'USD', impact: 'High', title: 'CPI', source: 'FF' }])))!;
  assert.equal(long.status, 'YOK');
  assert.equal(long.conditions.find((c) => c.id === 'news')!.status, 'fail');
});

test('RB bölgesi: bearish = en yüksek gövde ile iğne tepesi, en fazla 3 mum', () => {
  const c = mk([[100, 101, 99.5, 100.8], [100.8, 104, 100.6, 101.2], [101.2, 103.5, 100.9, 101.0], [101.0, 103, 100.5, 100.6], [100.6, 102.8, 100.2, 100.4]]);
  const z = rbZone(c, 1, -1, 3, 102);
  assert.equal(z.j, 3, 'en fazla 3 mum');
  assert.equal(z.top, 104);
  assert.equal(z.bottom, 101.2);
  const b = rbZone(mk([[100, 100.2, 96, 99.5], [99.5, 99.8, 99, 99.6]]), 0, 1, 3, 97);
  assert.equal(b.bottom, 96);
  assert.equal(b.top, 99.5);
});

test('Ortak bayat sinyal kontrolü: eski sinyal, görülen TP1 veya uzak fiyat TAM olamaz', async () => {
  const { finalize } = await import('../src/context.ts');
  const m5 = stairs(XEND);
  const sig = XEND - 7 * HOUR;
  const base = { strategy: 'D' as const, sub: 'test', dir: 1 as const, overlays: [], chartTf: '5m' as const, tfs: ['5m' as const], zoneId: 'z', id: 't' };
  const ok = { id: 'x', label: 'x', status: 'ok' as const, detail: '' };
  const price = m5.at(-1)!.c;
  const meth = (entry: number, stop: number, tp1: number) => [{ id: 'm', label: 'm', type: 'limit' as const, entry, stop, stopStructural: stop, tp1, rr: 2 }];
  // 7 saatlik sinyal → eski
  let ctx = new Ctx('XAUUSD', conf(), XEND, { m5, m1: [], d1: [] }, []);
  assert.equal(finalize(ctx, { ...base, conditions: [ok], methods: meth(price, price - 5, price + 10), signalAt: sig }).status, 'YOK');
  // yeni sinyal ama fiyat girişten 10R uzak
  const s2 = finalize(ctx, { ...base, conditions: [ok], methods: meth(price - 10, price - 11, price + 50), signalAt: XEND - 30 * MIN });
  assert.equal(s2.status, 'YOK');
  assert.match(s2.conditions.at(-1)!.detail, /uzak/);
  // yeni, yakın, hedef görülmemiş → TAM
  ctx = new Ctx('XAUUSD', conf(), XEND, { m5, m1: [], d1: [] }, []);
  assert.equal(finalize(ctx, { ...base, conditions: [ok], methods: meth(price, price - 5, price + 50), signalAt: XEND - 10 * MIN }).status, 'TAM');
});
