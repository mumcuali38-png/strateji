import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planFetch } from '../src/plan.ts';
import { freshCredits } from '../src/twelvedata.ts';
import { MIN, DAY } from '../src/time.ts';
import { conf } from './helpers.ts';

test('Kredi simülasyonu: tam bir iş günü (08:00 ön pencere dahil) < 790', () => {
  const cfg = conf();
  const day = Date.UTC(2026, 10, 4); // Çarşamba
  let credits = freshCredits(null, day + 5 * 3600_000, cfg.params);
  const last: Record<string, number> = {};
  let total = 0, pre = 0;
  for (let t = day + 5 * 3600_000; t < day + 17 * 3600_000; t += 5 * MIN) {
    const plan = planFetch(cfg, t, credits, (sym, iv) => last[`${sym}${iv}`]);
    for (const p of plan) { last[`${p.sym}${p.interval === '1day' || p.interval === '1h' ? '' : p.interval}`] = t; }
    if (t < day + 7 * 3600_000) { pre += plan.length; assert.ok(plan.every((p) => p.sym === 'XAUUSD' || p.bootstrap), 'ön pencerede sadece XAU (+ günlük bootstrap)'); }
    credits.used += plan.length;
    total += plan.length;
    if (plan.some((p) => p.bootstrap)) credits.bootstrapDate = new Date(t).toISOString().slice(0, 10);
  }
  assert.ok(total < 790, `günlük istek ${total} ≥ 790`);
  assert.ok(total >= 600, `beklenenden az istek (${total}) — tarama eksik olabilir`);
  console.log(`  simülasyon: ${total} kredi/gün (ön pencere ${pre})`);
  credits = freshCredits(credits, day + DAY + 60_000, cfg.params);
  assert.equal(credits.used, 0);
});

test('Kredi azaldığında öncelik: XAU korunur, ETH önce atlanır', () => {
  const cfg = conf();
  const t = Date.UTC(2026, 10, 4, 12, 0);
  const credits = freshCredits(null, t, cfg.params);
  credits.bootstrapDate = '2026-11-04';
  credits.used = 700;
  const plan = planFetch(cfg, t, credits, () => t - 5 * MIN);
  const syms = plan.map((p) => p.sym);
  assert.ok(syms.includes('XAUUSD'));
  assert.ok(!syms.includes('ETHUSD'));
});

test('Sert sınır: 790 kullanıldıysa hiç istek yok', () => {
  const cfg = conf();
  const t = Date.UTC(2026, 10, 4, 12, 0);
  const credits = freshCredits(null, t, cfg.params);
  credits.bootstrapDate = '2026-11-04';
  credits.used = 790;
  assert.equal(planFetch(cfg, t, credits, () => t - 5 * MIN).length, 0);
});

test('Planda olmayan sembol (XAG) istenmez; pencere öncesi elle taramada ETH atlanmaz', () => {
  const cfg = conf();
  const t = Date.UTC(2026, 10, 5, 5, 46); // 08:46 TR, pencere öncesi
  const credits = freshCredits(null, t, cfg.params);
  credits.unavailable = { XAGUSD: '2026-11-05' };
  const plan = planFetch(cfg, t, credits, () => undefined);
  const syms = plan.map((p) => p.sym);
  assert.ok(!syms.includes('XAGUSD'));
  assert.ok(syms.includes('ETHUSD'), syms.join(','));
});

test('Hafta sonu kripto: sadece BTC/ETH, ~240 kredi', () => {
  const cfg = conf();
  cfg.params.scan.cryptoWeekend = true;
  const day = Date.UTC(2026, 10, 7); // Cumartesi
  const credits = freshCredits(null, day + 7 * 3600_000, cfg.params);
  const last: Record<string, number> = {};
  let total = 0; const syms = new Set<string>();
  for (let t = day + 7 * 3600_000; t < day + 17 * 3600_000; t += 5 * MIN) {
    const plan = planFetch(cfg, t, credits, (s, iv) => last[`${s}${iv}`]);
    for (const p of plan) { last[`${p.sym}${p.interval === '1day' ? '' : p.interval}`] = t; syms.add(p.sym); }
    credits.used += plan.length; total += plan.length;
    if (plan.some((p) => p.bootstrap)) credits.bootstrapDate = new Date(t).toISOString().slice(0, 10);
  }
  assert.deepEqual([...syms].sort(), ['BTCUSD', 'ETHUSD']);
  assert.ok(total <= 245, `hafta sonu ${total} kredi`);
});
