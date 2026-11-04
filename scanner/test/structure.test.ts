import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, findSwings, lifecycle, type Zone } from '../src/structure.ts';
import { fromCloses, mk, SP } from './helpers.ts';
import { findRange } from '../src/strategies/d.ts';

test('swing high/low fraktal (n=2)', () => {
  const c = mk([[10, 11, 9, 10], [10, 12, 9.5, 11], [11, 15, 10, 14], [14, 13.5, 11, 12], [12, 13, 10, 11], [11, 12, 8, 9], [9, 10, 8.5, 9.5], [9.5, 11, 9, 10]]);
  const s = findSwings(c, 2);
  assert.ok(s.some((x) => x.type === 'H' && x.i === 2 && x.price === 15));
  assert.ok(s.some((x) => x.type === 'L' && x.i === 5 && x.price === 8));
});

test('BOS sayımı, trend ve CHoCH', () => {
  // Yükselen merdiven: her dalga bir öncekinin tepesini kapanışla kırar
  const up: number[] = [];
  let p = 100;
  for (let w = 0; w < 5; w++) { for (let k = 0; k < 5; k++) up.push((p += 2)); for (let k = 0; k < 3; k++) up.push((p -= 1.5)); }
  const an = analyze(fromCloses(up), '5m', SP);
  const bos = an.breaks.filter((b) => b.dir === 1 && b.type === 'BOS');
  assert.ok(bos.length >= 2, `en az 2 BOS beklenir, ${bos.length}`);
  assert.equal(an.trend.dir, 1);
  // Sert düşüş: son dip kapanışla kırılır → CHoCH
  const down = [...up];
  for (let k = 0; k < 12; k++) down.push((p -= 3));
  const an2 = analyze(fromCloses(down), '5m', SP);
  const last = an2.breaks[an2.breaks.length - 1];
  assert.ok(an2.breaks.some((b) => b.type === 'CHoCH' && b.dir === -1), 'bearish CHoCH bekleniyordu');
  assert.equal(last.dir, -1);
});

test('sadece iğneyle geçiş BOS sayılmaz (mum kapanışı şart)', () => {
  const c = mk([[10, 11, 9, 10], [10, 11.5, 9.5, 11], [11, 14, 10.5, 13], [13, 13.2, 11, 11.5], [11.5, 12, 10, 10.5], [10.5, 11, 9.8, 10.2],
    [10.2, 16, 10, 12.5], // iğne 14'ü geçti ama kapanış 12.5 < 14
    [12.5, 13, 11, 12]]);
  const an = analyze(c, '5m', SP);
  assert.ok(!an.breaks.some((b) => b.dir === 1 && b.level === 14), 'iğneyle kırılım BOS olmamalı');
  const sweep = an.liquidity.find((l) => l.side === 'buy' && l.price === 14);
  assert.equal(sweep?.takenBy, 'sweep', '14 seviyesi süpürme (sweep) olarak işaretlenmeli');
});

test('FVG tespiti, mitigasyon ve IFVG', () => {
  const base = Array.from({ length: 20 }, (_, i) => [100 + (i % 2), 101 + (i % 2), 99 + (i % 2), 100.5 + (i % 2)]);
  const c = mk([...base, [101, 101.5, 100.8, 101.4], [101.4, 106, 101.3, 105.8], [105.8, 107, 103, 106.5], [106.5, 107, 104, 104.5], [104.5, 104.8, 100, 100.2], [100.2, 100.5, 99, 99.5]]);
  const an = analyze(c, '5m', SP);
  const f = an.zones.find((z) => z.kind === 'FVG' && z.dir === 1 && z.bottom === 101.5 && z.top === 103);
  assert.ok(f, 'bullish FVG 101.5–103 bekleniyordu');
  assert.ok(f!.touchedIdx !== undefined, 'FVG dokunulmuş (mitige) olmalı');
  assert.ok(f!.brokenIdx !== undefined, 'kapanışla içinden geçildi');
  assert.ok(an.zones.some((z) => z.kind === 'IFVG' && z.dir === -1 && z.bottom === 101.5), 'IFVG (ters yön) oluşmalı');
});

test('Order block: displacement öncesi son ters renkli mum, mitige edilmemiş', () => {
  const rows: number[][] = [];
  for (let i = 0; i < 20; i++) rows.push([100 + (i % 3) * 0.2, 100.6 + (i % 3) * 0.2, 99.6 + (i % 3) * 0.2, 100.2 + (i % 3) * 0.2]);
  rows.push([100.4, 101.0, 100.0, 100.8]);  // küçük swing high 101.0? sonraki mumlar daha düşük
  rows.push([100.8, 100.9, 99.8, 100.0]);
  rows.push([100.0, 100.2, 99.0, 99.2]);    // bearish — OB adayı (son ters renkli)
  rows.push([99.2, 99.4, 98.8, 99.1]);      // bearish
  rows.push([99.1, 103.5, 99.0, 103.2]);    // displacement, 101'i kapanışla kırar
  rows.push([103.2, 104, 102.8, 103.8]);
  rows.push([103.8, 104.5, 103.4, 104.2]);
  const an = analyze(mk(rows), '5m', SP);
  const ob = an.zones.find((z) => z.kind === 'OB' && z.dir === 1);
  assert.ok(ob, 'bullish OB bekleniyordu');
  assert.ok(ob!.bottom <= 99.0 && ob!.top >= 99.4);
  assert.equal(ob!.touchedIdx, undefined, 'mitige edilmemiş olmalı');
});

test('Zone lifecycle: kapanışla kırılma', () => {
  const c = mk([[10, 10.5, 9.5, 10], [10, 10.2, 8.9, 9.0], [9, 9.2, 8, 8.5]]);
  const z: Zone = { id: 'x', kind: 'OB', tf: '5m', dir: 1, top: 9.5, bottom: 9.0, i: 0, t: 0, startIdx: 1 };
  lifecycle(z, c, 1);
  assert.equal(z.touchedIdx, 1);
  assert.equal(z.brokenIdx, 2);
});

test('Konsolidasyon range tespiti (her iki uçta ≥2 test)', () => {
  const closes: number[] = [];
  for (let k = 0; k < 4; k++) { for (const v of [100, 102, 104, 106, 108, 109]) closes.push(v); for (const v of [107, 105, 103, 101, 100.5]) closes.push(v); }
  const an = analyze(fromCloses(closes, undefined, 3600_000), '1h', { ...SP, n: 2 });
  const r = findRange(an, 12, 60, 2, 0.25);
  assert.ok(r, 'range bulunmalı');
  assert.ok(r!.top >= 109 && r!.bottom <= 100.5);
});
