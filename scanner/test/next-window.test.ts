import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minutesToWindow } from '../src/next-window.ts';
import { conf } from './helpers.ts';

const TR = (d: number, h: number, m = 0) => Date.UTC(2026, 10, d, h - 3, m); // TR = UTC+3
test('Sonraki pencere: hafta içi 06:30 TR → 90 dk (08:00 ön pencere); 09:00 → 0; 21:00 Cuma NY seansı, 23:50 → hafta sonu 10:00', () => {
  const c = conf();
  assert.equal(minutesToWindow(c, TR(6, 6, 30)), 90); // Cuma
  assert.equal(minutesToWindow(c, TR(6, 9, 0)), 0);
  assert.equal(minutesToWindow(c, TR(6, 15, 0)), 0);
  assert.equal(minutesToWindow(c, TR(6, 21, 0)), 0, 'NY seansı (US100 / H) 23:45 TR\'ye kadar açık');
  assert.equal(minutesToWindow(c, TR(6, 23, 50)), 10 * 60 + 10, 'Cumartesi 10:00 (kripto hafta sonu)');
  assert.equal(minutesToWindow(c, TR(7, 7, 0)), 180, 'Cumartesi ön pencere yok → 10:00');
});
