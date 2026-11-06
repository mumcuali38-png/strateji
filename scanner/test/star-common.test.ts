// ⭐ ortak altyapı — docs/kurulum_P_Portfoy_ortak_spec.md (§2 zaman, §4 göstergeler, §5 kredi, §7 koruma)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../src/types.ts';
import { HOUR, MIN, DAY } from '../src/time.ts';
import { loadStar } from '../src/star/config.ts';
import { weekendExcluded, session24, sessionDays, bars4h, closed1h, lastDueClose, expectedBars } from '../src/star/sessions.ts';
import { donchian, regime, isNR, isInside, atr, ema } from '../src/star/ind.ts';
import { freshness, missingBars, priceJump, signalId, doubleScan, kacti, newsRisk, removeBadTicks, type Pending } from '../src/star/guard.ts';
import { planStar, needTf, free1hFrom5m, type FetchMem } from '../src/star/data.ts';
import { existingReserve, starBudget } from '../src/star/budget.ts';
import { weekStart } from '../src/star/run.ts';
import { freshCredits } from '../src/twelvedata.ts';
import { conf } from './helpers.ts';

const sc = loadStar();
const C = sc.common;
/** Strateji saati (UTC-5) → UTC epoch */
const S = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h + 5, mi);
/** [from, to) her saat bir mum (UTC :00 ızgarası), fiyat f(i) */
function bars(from: number, to: number, f: (i: number, t: number) => number = () => 100, step = HOUR, keep: (t: number) => boolean = () => true): Candle[] {
  const out: Candle[] = [];
  let i = 0;
  for (let t = from; t < to; t += step) { if (!keep(t)) continue; const p = f(i++, t); out.push({ t, o: p, h: p + 1, l: p - 1, c: p, v: 0 }); }
  return out;
}

test('§2 hafta sonu boşluğu: Cuma 17:00 – Pazar 18:00 (XAU/FX); kripto çıkarılmaz', () => {
  assert.equal(weekendExcluded('cfd24', S(2026, 11, 13, 16)), false); // Cuma 16:00
  assert.equal(weekendExcluded('cfd24', S(2026, 11, 13, 17)), true); // Cuma 17:00
  assert.equal(weekendExcluded('fx', S(2026, 11, 14, 12)), true); // Cumartesi
  assert.equal(weekendExcluded('fx', S(2026, 11, 15, 17)), true); // Pazar 17:00
  assert.equal(weekendExcluded('fx', S(2026, 11, 15, 18)), false); // Pazar 18:00
  assert.equal(weekendExcluded('crypto', S(2026, 11, 14, 12)), false);
});

test('§2 seans günü 18:00 → 17:00 (strateji saati), anahtar = bitiş günü; 17:00–18:00 mumu hiçbir güne girmez', () => {
  assert.equal(session24(S(2026, 11, 9, 18))?.key, '2026-11-10');
  assert.equal(session24(S(2026, 11, 10, 16))?.key, '2026-11-10');
  assert.equal(session24(S(2026, 11, 10, 17)), null);
  assert.equal(session24(S(2026, 11, 10, 0))?.start, S(2026, 11, 9, 18));
});

test('§2 seans günü ≥ 12 adet 1H (24 saat); eksik gün geçersiz (N7 senaryo 7: 10 mum → geçersiz)', () => {
  const now = S(2026, 11, 12, 20);
  const h1 = bars(S(2026, 11, 9, 18), S(2026, 11, 12, 17), () => 100, HOUR, (t) => !(t >= S(2026, 11, 10, 18) && t < S(2026, 11, 11, 7))); // 11 Kasım günü: 07:00–16:00 → 10 mum
  const d = sessionDays('cfd24', h1, now, C);
  const k = Object.fromEntries(d.map((x) => [x.key, x]));
  assert.equal(k['2026-11-10'].n, 23); assert.equal(k['2026-11-10'].valid, true);
  assert.equal(k['2026-11-11'].n, 10); assert.equal(k['2026-11-11'].valid, false);
  assert.ok(d.every((x) => x.closed));
});

test('§7.1 / TD.1 günlük mum: 17:00 mumu kapanmadan kapanmış sayılmaz', () => {
  const h1 = bars(S(2026, 11, 9, 18), S(2026, 11, 10, 16)); // 16:00 mumu henüz yok
  const d1 = sessionDays('cfd24', h1, S(2026, 11, 10, 16, 30), C);
  assert.equal(d1[d1.length - 1].closed, false);
  const h2 = bars(S(2026, 11, 9, 18), S(2026, 11, 10, 17));
  const d2 = sessionDays('cfd24', closed1h('cfd24', h2, S(2026, 11, 10, 17, 1)), S(2026, 11, 10, 17, 1), C);
  assert.equal(d2[d2.length - 1].closed, true);
  const d3 = sessionDays('cfd24', h2, S(2026, 11, 10, 16, 59), C);
  assert.equal(d3[d3.length - 1].closed, false, 'bitişten önce kapanmaz');
});

test('§2 ETF borsa günü (NY yerel, ≥ 5 mum) ve kapanış: 15:30–16:00 mumu gelmeden kapanmamış (TD senaryo 4)', () => {
  // Kış (EST): 09:30 NY = 14:30 UTC; ETF mumları :30 ızgarasında
  const open = Date.UTC(2026, 10, 10, 14, 30);
  const h1 = bars(open, open + 6 * HOUR); // 09:30 … 14:30 (6 mum), 15:30 yok
  const d = sessionDays('etf', h1, open + 6.6 * HOUR, C);
  assert.equal(d.length, 1); assert.equal(d[0].n, 6); assert.equal(d[0].valid, true); assert.equal(d[0].closed, false);
  const h2 = bars(open, open + 7 * HOUR);
  const d2 = sessionDays('etf', closed1h('etf', h2, open + 6.5 * HOUR), open + 6.5 * HOUR, C);
  assert.equal(d2[0].n, 7); assert.equal(d2[0].closed, true);
  // Yaz (EDT): 09:30 NY = 13:30 UTC — yerel saat kullanılır
  const so = Date.UTC(2026, 6, 14, 13, 30);
  const d3 = sessionDays('etf', bars(so, so + 7 * HOUR), so + 8 * HOUR, C);
  assert.equal(d3[0].key, '2026-07-14'); assert.equal(d3[0].n, 7); assert.equal(d3[0].closed, true);
});

test('§2 4H: 24 saat 02/06/10/14/18/22 sınırları (≥ 3 mum); ETF 2 blok, 2. blok borsa kapanışıyla kapanır (T4-S senaryo 5)', () => {
  const h1 = bars(S(2026, 11, 9, 18), S(2026, 11, 10, 15));
  const b = bars4h('cfd24', h1, S(2026, 11, 10, 15), C);
  const starts = b.map((x) => new Date(x.t - 5 * HOUR).getUTCHours());
  assert.deepEqual(starts.slice(0, 5), [18, 22, 2, 6, 10]);
  assert.equal(b[b.length - 1].closed, false); // 14:00 bloğu açık
  assert.ok(b.slice(0, -1).every((x) => x.closed && x.valid));
  const open = Date.UTC(2026, 10, 10, 14, 30);
  const e = bars4h('etf', bars(open, open + 6 * HOUR), open + 6.6 * HOUR, C);
  assert.equal(e.length, 2);
  assert.deepEqual(e.map((x) => x.n), [3, 3]);
  assert.equal(e[0].closed, true);
  assert.equal(e[1].closed, false, '15:30 mumu yok → 2. blok kapanmamış');
});

test('§4 Donchian mevcut mum hariç; ATR Wilder; EMA ilk değer SMA', () => {
  const c = bars(0, 20 * HOUR, (i) => 100 + i);
  const d = donchian(c, 10);
  assert.ok(Number.isNaN(d.up[9]));
  assert.equal(d.up[10], 101 + 9); // mum 0..9'un en yükseği (109+1)
  assert.equal(d.dn[10], 99); // mum 0'ın low'u
  const a = atr(c, 14);
  assert.ok(Math.abs(a[13] - (2 + 13 * 2) / 14) < 1e-9); // TR0 = 2, sonra max(H−L=2, |H−C₋₁|=2) = 2
  const e = ema([1, 2, 3, 4, 5], 3);
  assert.equal(e[2], 2); assert.equal(e[3], 2 + (4 - 2) * 0.5);
});

test('§4 rejim: +1 / −1 / 0 ve ısınma yoksa ⏳ (null)', () => {
  const mkDays = (f: (i: number) => number, n = 260) => Array.from({ length: n }, (_, i) => ({ t: i * DAY, o: f(i), h: f(i) + 1, l: f(i) - 1, c: f(i), key: `d${i}` }));
  assert.equal(regime(mkDays((i) => 100 + i), C.regime).value, 1);
  assert.equal(regime(mkDays((i) => 400 - i), C.regime).value, -1);
  assert.equal(regime(mkDays((i) => (i < 230 ? 100 + i : 330 - 3 * (i - 230))), C.regime).value, 0); // C < EMA50 ama ret60 > 0 değil / EMA sırası bozuk
  assert.equal(regime(mkDays((i) => 100 + i, 150), C.regime).value, null);
});

test('§4 NR7 (eşitlik dahil) ve iç gün (kesin, fiyat adımına yuvarlanmış)', () => {
  const d = [10, 9, 8, 7, 6, 5, 5].map((r, i) => ({ t: i, o: 100, h: 100 + r / 2, l: 100 - r / 2, c: 100 }));
  assert.equal(isNR(d, 6, 7, 0.01), true); // eşit en küçük
  assert.equal(isNR(d, 5, 7, 0.01), null); // 7 gün yok
  const g = [{ t: 0, o: 0, h: 110, l: 90, c: 0 }, { t: 1, o: 0, h: 109.99, l: 90.01, c: 0 }, { t: 2, o: 0, h: 109.99, l: 95, c: 0 }];
  assert.equal(isInside(g, 1, 0.01), true);
  assert.equal(isInside(g, 2, 0.01), false, 'H = dün H → iç gün değil (IB senaryo 2)');
});

test('§7.4 veri tazeliği ve §7.6 eksik mum (hafta sonu beklenen boşluk)', () => {
  const now = S(2026, 11, 10, 12, 5);
  const h1 = bars(S(2026, 11, 10, 0), S(2026, 11, 10, 9)); // son mum 08:00 → bitiş 09:00, beklenen 12:00
  assert.equal(freshness('cfd24', h1, now, C.staleHours).fresh, false);
  const h2 = bars(S(2026, 11, 10, 0), S(2026, 11, 10, 11));
  assert.equal(freshness('cfd24', h2, now, C.staleHours).fresh, true);
  // Cuma 16:00 → Pazar 18:00 boşluğu eksik değil
  const wk = [...bars(S(2026, 11, 13, 10), S(2026, 11, 13, 17)), ...bars(S(2026, 11, 15, 18), S(2026, 11, 15, 22))];
  assert.deepEqual(missingBars('fx', wk, 30), []);
  const gap = bars(S(2026, 11, 10, 0), S(2026, 11, 10, 12), () => 100, HOUR, (t) => t !== S(2026, 11, 10, 5));
  assert.deepEqual(missingBars('fx', gap, 30), [S(2026, 11, 10, 5)]);
  assert.deepEqual(missingBars('fx', gap, 30, [S(2026, 11, 10, 5)]), [], 'kötü tick olarak çıkarılan mum eksik sayılmaz');
});

test('§7.5 kötü tick ve anlık fiyat sıçraması', () => {
  const c = bars(0, 40 * HOUR, () => 100);
  c[30] = { t: c[30].t, o: 100, h: 140, l: 99, c: 130, v: 0 };
  c[31] = { t: c[31].t, o: 130, h: 131, l: 99, c: 101, v: 0 };
  const r = removeBadTicks(c, C.badTickAtr);
  assert.deepEqual(r.removed, [c[30].t]);
  assert.equal(priceJump('cfd24', 100.4, 100, C), true);
  assert.equal(priceJump('cfd24', 100.2, 100, C), false);
  assert.equal(priceJump('crypto', 100.9, 100, C), false);
});

test('§7.3 çift tarama teyidi, §7.7 kimlik, §7.8 KAÇTI, §7.9 haber etiketi', () => {
  const mem: Record<string, Pending> = {};
  const t = Date.UTC(2026, 10, 10, 14, 0, 10);
  assert.equal(doubleScan(mem, 'x', 'L|100', t).seq, 1);
  assert.equal(doubleScan(mem, 'x', 'L|100', t).seq, 1, 'aynı tarama iki kez sayılmaz');
  assert.equal(doubleScan(mem, 'x', 'L|100', t + 5 * MIN).seq, 2);
  assert.equal(doubleScan(mem, 'x', 'L|101', t + 10 * MIN).seq, 1, 'sonuç değişti → baştan');
  assert.equal(signalId('M2', 'XAUUSD', Date.UTC(2026, 10, 6, 14)), 'M2-XAUUSD-2026-11-06T14:00:00Z');
  assert.equal(kacti(1, 100, 100.6, 0.5), true);
  assert.equal(kacti(-1, 100, 100.6, 0.5), false);
  const ev = [{ id: 'a', t: t + 20 * MIN, currency: 'USD', impact: 'High' as const, title: 'CPI', source: 'FF' }];
  assert.equal(newsRisk(ev, t, C).risk, true);
  assert.equal(newsRisk(ev, t - 15 * MIN, C).risk, false);
});

test('§6 hafta: Pazartesi 00:00 strateji saati (TR Pazartesi 08:00)', () => {
  assert.equal(weekStart(S(2026, 11, 12, 10)), S(2026, 11, 9, 0));
  assert.equal(weekStart(S(2026, 11, 15, 23)), S(2026, 11, 9, 0));
  assert.equal(new Date(S(2026, 11, 9, 0) + 3 * HOUR).getUTCHours(), 8);
});

test('§5 kredi planı: kapanışta 1 çağrı (M2 → 1h, T4-S ETF → 4h blok, diğerleri seans sonu), bütçe aşılmaz', () => {
  assert.equal(needTf(sc, 'USDJPY'), '1h');
  assert.equal(needTf(sc, 'US30'), '4h');
  assert.equal(needTf(sc, 'AUDUSD'), '1d');
  assert.equal(needTf(sc, 'WTI'), '1d');
  const now = S(2026, 11, 10, 11, 0) + 10_000;
  const mem: Record<string, FetchMem> = Object.fromEntries(Object.keys(sc.instruments).map((s) => [s, { deepDone: true, fullDate: '2026-11-10' }]));
  // Hepsi 1 saat önce güncel
  const lastBar = (s: string) => ({ t: sc.instruments[s].cls === 'etf' ? Date.UTC(2026, 10, 9, 20, 30) : S(2026, 11, 10, 9), o: 1, h: 1, l: 1, c: 1 });
  const plan = planStar(sc, now, mem, lastBar, lastBar, 100);
  const syms = plan.map((p) => p.sym).sort();
  assert.deepEqual(syms, ['US100', 'USDJPY', 'XAUUSD'], 'sadece 1H kapanışı gereken (M2) enstrümanlar; T4-S ETF 4H bloğu (12:30) henüz kapanmadı, AUDUSD/US500/WTI günlük');
  assert.ok(plan.every((p) => p.size <= 5000));
  assert.equal(planStar(sc, now, mem, lastBar, lastBar, 1).length, 1, 'bütçe');
  // AUDUSD: seans günü kapanışından sonra 1 çağrı
  const after = S(2026, 11, 10, 17, 5);
  const p2 = planStar(sc, after, mem, (s) => ({ t: S(2026, 11, 9, 16), o: 1, h: 1, l: 1, c: 1 }), lastBar, 100);
  assert.ok(p2.some((p) => p.sym === 'AUDUSD'));
  // Teyit: acil yeniden çekim önce
  const p3 = planStar(sc, now, mem, lastBar, lastBar, 1, { urgent: ['US500'] });
  assert.equal(p3[0].sym, 'US500'); assert.equal(p3[0].kind, 'refetch');
  // İlk derin yükleme
  const p4 = planStar(sc, now, {}, () => undefined, () => undefined, 100);
  assert.ok(p4.every((p) => p.kind === 'deep' && p.size === 5000));
});

test('§5 ücretsiz 1H: A–H 5m akışından sadece tam dolu saatler', () => {
  const t0 = S(2026, 11, 10, 9);
  const m5 = bars(t0, t0 + 2 * HOUR - 10 * MIN, (i) => 100 + i, 5 * MIN);
  const h = free1hFrom5m('cfd24', m5, t0 + 3 * HOUR);
  assert.equal(h.length, 1); assert.equal(h[0].t, t0); assert.equal(h[0].o, 100); assert.equal(h[0].c, 111);
});

test('§5 / §6 kredi: mevcut kurulumlara (A–H) günün kalanı ayrılır, ⭐ kalanı kullanır, 760 aşılmaz', () => {
  const cfg = conf();
  const t = Date.UTC(2026, 10, 4, 12, 0);
  const credits = freshCredits(null, t, cfg.params);
  credits.bootstrapDate = '2026-11-04';
  credits.used = 400;
  const reserve = existingReserve(cfg, t, credits);
  assert.ok(reserve > 100 && reserve < 500, `ayrılan ${reserve}`);
  const b = starBudget(credits, reserve);
  assert.equal(b.signal, Math.max(0, 760 - 400 - reserve));
  assert.equal(b.position, 360);
  assert.ok(credits.used + Math.min(reserve, 360) + b.signal <= credits.hardStop);
  // Pencere sonrası: ayrılacak yok
  assert.equal(existingReserve(cfg, Date.UTC(2026, 10, 4, 22, 0), credits), 0);
});

test('§5 bekleyen kapanış: 4H blok / seans günü', () => {
  const C2 = sc.common;
  assert.equal(lastDueClose('cfd24', '4h', S(2026, 11, 10, 11, 0) + 10_000, C2), S(2026, 11, 10, 10));
  assert.equal(lastDueClose('cfd24', '1d', S(2026, 11, 10, 18), C2), S(2026, 11, 10, 17));
  const close = Date.UTC(2026, 10, 10, 21, 0); // 16:00 NY (EST)
  assert.equal(lastDueClose('etf', '1d', close + 5 * MIN, C2), close);
  assert.equal(lastDueClose('etf', '4h', Date.UTC(2026, 10, 10, 17, 35), C2), Date.UTC(2026, 10, 10, 17, 30)); // 12:30 NY
  assert.equal(expectedBars('etf', Date.UTC(2026, 10, 10, 14, 0), Date.UTC(2026, 10, 10, 22, 0)).length, 7);
});

test('§5 kredi simülasyonu: ⭐ bir iş günü ≤ 50 kredi (XAU 07–17 UTC ve QQQ seans boyunca A–H 5m akışından ücretsiz)', () => {
  const day = Date.UTC(2026, 10, 11);
  const mem: Record<string, FetchMem> = Object.fromEntries(Object.keys(sc.instruments).map((s) => [s, { deepDone: true, fullDate: '2026-11-10' }]));
  const last: Record<string, number> = {};
  const upd = (s: string, t: number) => { const cls = sc.instruments[s].cls; const e = lastDueClose(cls, '1h', t, sc.common); if (e) last[s] = e - HOUR; };
  for (const s of Object.keys(sc.instruments)) upd(s, day);
  let n = 0;
  for (let t = day + 10_000; t < day + DAY; t += 5 * MIN) {
    const h = new Date(t).getUTCHours();
    upd('US100', t); if (h >= 7 && h < 17) upd('XAUUSD', t);
    const plan = planStar(sc, t, mem, (s) => ({ t: last[s], o: 1, h: 1, l: 1, c: 1 }), () => undefined, 100);
    for (const p of plan) { n++; mem[p.sym].lastTry = t; mem[p.sym].fullDate = '2026-11-11'; upd(p.sym, t); }
  }
  console.log(`  ⭐ simülasyon: ${n} kredi/gün`);
  assert.ok(n <= 50, `⭐ ${n} kredi/gün`);
});
