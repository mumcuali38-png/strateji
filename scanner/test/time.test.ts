import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucketStart, fmtNY, fmtTR, inNyRange, nyMinutes } from '../src/time.ts';
import { aggregate } from '../src/candles.ts';
import { Ctx } from '../src/context.ts';
import { conf, mk } from './helpers.ts';

test('4H mum sınırları NY (UTC-5) gece yarısından hizalı', () => {
  // 2026-11-04 13:30 UTC = 08:30 NY → 4H kovası 08:00 NY = 13:00 UTC
  const t = Date.UTC(2026, 10, 4, 13, 30);
  assert.equal(bucketStart(t, '4h'), Date.UTC(2026, 10, 4, 13, 0));
  assert.equal(fmtNY(bucketStart(t, '4h')), '08:00');
  // Gün kovası NY 00:00 = 05:00 UTC
  assert.equal(bucketStart(t, '1d'), Date.UTC(2026, 10, 4, 5, 0));
  // Yaz saati uygulanmaz: Temmuz'da da sabit UTC-5
  assert.equal(fmtNY(Date.UTC(2026, 6, 1, 12, 0)), '07:00');
  // Haftalık kova Pazartesi NY 00:00
  assert.equal(new Date(bucketStart(t, '1w') - 5 * 3600_000).getUTCDay(), 1);
});

test('TR gösterimi = NY + 8 saat', () => {
  const t = Date.UTC(2026, 10, 4, 15, 0); // 10:00 NY
  assert.equal(fmtNY(t), '10:00');
  assert.equal(fmtTR(t), '18:00');
});

test('5m → 4H toplama sınırları', () => {
  const t0 = Date.UTC(2026, 10, 4, 5, 0); // NY 00:00
  const c = mk(Array.from({ length: 96 }, () => [1, 2, 0.5, 1.5]), t0); // 8 saat
  const h4 = aggregate(c, '4h');
  assert.equal(h4.length, 2);
  assert.deepEqual(h4.map((x) => fmtNY(x.t)), ['00:00', '04:00']);
});

test('Killzone sınırları (UTC-5)', () => {
  const cfg = conf();
  const at = (h: number, m = 0) => Date.UTC(2026, 10, 4, h + 5, m);
  const data = { m5: mk([[1, 1, 1, 1]]), m1: [], d1: [] };
  const kz = (t: number) => new Ctx('XAUUSD', cfg, t, data, []).killzoneAt(t, 'A')?.id ?? null;
  assert.equal(kz(at(1, 59)), null);
  assert.equal(kz(at(2, 0)), 'LO');
  assert.equal(kz(at(4, 59)), 'LO');
  assert.equal(kz(at(5, 0)), null);
  assert.equal(kz(at(7, 0)), 'NYO');
  assert.equal(kz(at(10, 0)), 'LC');
  assert.equal(kz(at(12, 0)), null);
  // E: London Close yok
  assert.equal(new Ctx('EURUSD', cfg, at(10, 30), data, []).killzoneAt(at(10, 30), 'E'), null);
  assert.ok(inNyRange(at(10, 30), '10:00', '11:00'));
  assert.equal(nyMinutes(at(10, 30)), 630);
});
