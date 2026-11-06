// Kurulum G testleri — docs/KURULUM_G.md §15 senaryoları (sentetik veri)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ctx } from '../src/context.ts';
import { evalG, gStop, pickT2, h4G, dailyG } from '../src/g/judas.ts';
import { atNY, gDay, gHistory, type GOpt } from '../src/g/synthetic.ts';
import { mergeGB } from '../src/engine.ts';
import { HOUR, fmtTR } from '../src/time.ts';
import type { Candle, NewsEvent, Setup } from '../src/types.ts';
import { conf } from './helpers.ts';

function run(o: GOpt = {}, news: NewsEvent[] = [], mirror = false) {
  let h1 = gHistory(o);
  let { m5, now } = gDay(o);
  if (mirror) { const M = (c: Candle[]) => c.map((x) => ({ ...x, o: 8000 - x.o, c: 8000 - x.c, h: 8000 - x.l, l: 8000 - x.h })); h1 = M(h1); m5 = M(m5); }
  const ctx = new Ctx('XAUUSD', conf(), now, { m5, m1: [], d1: [] }, news);
  return evalG(conf(), ctx, h1, news)[0];
}
const why = (s: Setup) => s.conditions.map((c) => `${c.status} ${c.label}: ${c.detail}`).join('\n');
const C = (s: Setup, id: string) => s.conditions.find((c) => c.id === id)!;

test('G temel: bias LONG → Asya dibi süpürmesi → içeri + MO kapanışı → MSS + FVG → TAM (limit doldu)', () => {
  const s = run();
  assert.equal(s.status, 'TAM', why(s));
  assert.equal(s.dir, 1);
  const m = s.methods[0];
  assert.ok(Math.abs(m.entry - 4037) < 0.01, `giriş ${m.entry}`);
  assert.ok(m.tp2 !== undefined && (m.rr2 ?? 0) >= 2 && m.rr >= 1);
  assert.ok(s.signalAt && fmtTR(s.signalAt) === '10:55', 'dolum 10:55 TR');
  const bodies = (s.notices ?? []).map((n) => n.body);
  assert.ok(bodies.some((b) => b.startsWith('G: Seviyeler hazır — AH')));
  assert.ok(bodies.some((b) => b.startsWith('G: Asya dibi süpürüldü')));
  assert.ok(bodies.some((b) => b.startsWith('G: Giriş doldu')));
});

test('Seriler: 4H sınırları 02/06/10/14/18/22, gün 18:00→17:00 (strateji saati)', () => {
  const h1 = gHistory();
  const ny = (t: number) => new Date(t - 5 * HOUR).getUTCHours();
  assert.ok(h4G(h1).every((x) => [2, 6, 10, 14, 18, 22].includes(ny(x.t))));
  assert.ok(dailyG(h1).every((x) => ny(x.t) === 18));
});

test('1) B1 LONG ama B2 PREMIUM → YOK (bias uyuşmazlığı)', () => {
  const s = run({ noSpike: true });
  assert.equal(s.status, 'YOK');
  assert.match(C(s, 'bias').detail, /Bias uyuşmazlığı/);
});
test('2) AR ≈ 0.10 × ADR20 → YOK (range dar)', () => {
  const s = run({ asiaNarrow: true });
  assert.equal(s.status, 'YOK');
  assert.match(C(s, 'range').detail, /çok dar/);
});
test('3) Erken hareket −0.30 × ADR20, bias LONG → YOK', () => {
  const s = run({ earlyMove: true });
  assert.equal(s.status, 'YOK');
  assert.equal(C(s, 'early').status, 'fail');
});
test('4) 01:30 NY\'de AL delindi → YOK (erken süpürme)', () => {
  const s = run({ earlySweep: true });
  assert.equal(s.status, 'YOK');
  assert.match(C(s, 'early').detail, /pencere öncesi/);
});
test('5) LONG günü önce AH delindi → YOK (bias tarafı önce)', () => {
  const s = run({ biasSideFirst: true });
  assert.equal(s.status, 'YOK');
  assert.match(C(s, 'sweep').detail, /Bias tarafı önce/);
});
test('6) Süpürme 04:15 NY → YOK (geç süpürme)', () => {
  const s = run({ lateSweep: true });
  assert.equal(s.status, 'YOK', why(s));
  assert.match(C(s, 'sweep').detail, /Geç süpürme/);
});
test('7) Süpürme derinliği > AR → YOK (kırılım)', () => {
  const s = run({ deepSweep: true });
  assert.equal(s.status, 'YOK');
  assert.match(C(s, 'sweep').detail, /Kırılım/);
});
test('8) 4 mumda içeri kapanış yok → YOK', () => {
  const s = run({ noBack: true });
  assert.equal(s.status, 'YOK', why(s));
  assert.match(C(s, 'back').detail, /içeri kapanış yok/);
});
test('9) İçeri kapandı, MO\'dan önce close < AL → YOK (iptal)', () => {
  const s = run({ cancelAfterBack: true });
  assert.equal(s.status, 'YOK', why(s));
  assert.match(C(s, 'mo').detail, /tekrar kapanış/);
});
test('10) 05:00\'e kadar close > MO yok → YOK', () => {
  const s = run({ noMoClose: true, nowNY: [5, 5] });
  assert.equal(s.status, 'YOK', why(s));
  assert.equal(C(s, 'mo').status, 'fail');
});
test('11) MSS gövdesi küçük → MSS ⏳ (05:00\'e kadar)', () => {
  const s = run({ weakMss: true });
  assert.equal(C(s, 'mss').status, 'wait', why(s));
  assert.notEqual(s.status, 'TAM');
});
test('12) Limit 05:00\'e kadar dolmadı → YOK (geri çekilme yok)', () => {
  const s = run({ noFill: true, nowNY: [5, 5] });
  assert.equal(s.status, 'YOK', why(s));
  assert.match(C(s, 'entry').detail, /geri çekilme gelmedi/);
});
test('13) sweepExt 4052.4 → R = 4050, fark 2.4 < 3 → stop 4048.0', () => {
  assert.ok(Math.abs(gStop(4052.4, 4000) - 4048.0) < 1e-9);
  assert.ok(Math.abs(gStop(4057, 4000) - 4055.0) < 1e-9, 'fark ≥ 3 → ext − buffer');
});
test('14) PDH 1.6R, S2 2.3R → T2 = S2', () => {
  assert.equal(pickT2(100, 10, [{ src: 'PDH', price: 116 }, { src: 'S2', price: 123 }, { src: 'S4', price: 146 }])?.src, 'S2');
});
test('15) PDH, S2, S4 hepsi < 2R → T2 yok (RR yetersiz)', () => {
  assert.equal(pickT2(100, 10, [{ src: 'PDH', price: 110 }, { src: 'S2', price: 115 }, { src: 'S4', price: 119 }]), null);
});
test('16) NFP günü, 16:15 TR\'de T1 alınmamış → "pozisyonu kapat" bildirimi', () => {
  const nfp: NewsEvent = { id: 'nfp', t: atNY(8, 30), currency: 'USD', impact: 'High', title: 'Non-Farm Employment Change', source: 'FF' };
  const tail: [number, number][] = Array.from({ length: 64 }, (_, k) => [4044 + (k % 3), 4045 + (k % 3)] as [number, number]);
  const s = run({ tail, nowNY: [8, 20] }, [nfp]);
  assert.ok((s.notices ?? []).some((n) => n.body.startsWith('G: Haber öncesi T1 yok')), why(s));
});
test('17) Aynı gün B aynı yönde TAM → tek işlem, "B ile birleşik"', () => {
  const g = run();
  const b = { ...g, id: 'B-XAUUSD-x', strategy: 'B' as const, info: {} };
  const res = { A: {}, B: { XAUUSD: [b] }, C: {}, D: {}, E: {}, F: {}, G: { XAUUSD: [g] }, H: {} } as Parameters<typeof mergeGB>[0];
  mergeGB(res);
  assert.ok(g.info?.mergedWithB);
  assert.ok(g.warnings?.some((w) => w.includes('B ile birleşik')));
});
test('18) Asya\'da sadece 10 mum → VERİ YOK', () => {
  const s = run({ asiaBars: 10 });
  assert.equal(s.status, 'YOK');
  assert.match(C(s, 'data').detail, /VERİ YOK/);
});
test('Short: aynalanmış gün → G SHORT TAM, fiyatlar gerçek', () => {
  const s = run({}, [], true);
  assert.equal(s.status, 'TAM', why(s));
  assert.equal(s.dir, -1);
  const m = s.methods[0];
  assert.ok(m.stop > m.entry && m.tp1 < m.entry && m.tp2! < m.tp1, `${m.entry} ${m.stop} ${m.tp1} ${m.tp2}`);
  assert.ok((s.notices ?? []).some((n) => n.body.startsWith('G: Asya tepesi süpürüldü')));
});
test('Koruma: dolumdan sonra T1 görüldü → YOK + "T1 — %50 kapat" bildirimi', () => {
  const s = run({ tail: [[4047, 4055], [4055, 4062]] });
  assert.equal(s.status, 'YOK', why(s));
  assert.ok((s.notices ?? []).some((n) => n.body === 'G: T1 — %50 kapat, stop girişe'));
});
test('Koruma: dolumdan sonra stop görüldü → YOK', () => {
  const s = run({ tail: [[4047, 4030], [4030, 4012]] });
  assert.equal(s.status, 'YOK', why(s));
});
test('Koruma: hafta sonu G çalışmaz', () => {
  const sat = Date.UTC(2026, 10, 7, 12);
  const ctx = new Ctx('XAUUSD', conf(), sat, { m5: gDay().m5, m1: [], d1: [] }, []);
  assert.equal(evalG(conf(), ctx, gHistory(), [])[0].status, 'YOK');
});
