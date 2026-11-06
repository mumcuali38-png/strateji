// ⭐N7 — docs/kurulum_N7_Sikisma_spec.md §11 test senaryoları
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../src/types.ts';
import { HOUR, MIN, DAY } from '../src/time.ts';
import { loadStar } from '../src/star/config.ts';
import { sessionDays } from '../src/star/sessions.ts';
import { detect, nextSession, simulate, type OcoOrder } from '../src/star/oco.ts';
import { runOco } from '../src/star/setups-oco.ts';
import { analyze } from '../src/star/run.ts';
import type { Pending } from '../src/star/guard.ts';
import type { StarPos } from '../src/star/trend.ts';
import { conf } from './helpers.ts';

const sc = loadStar();
const C = sc.common;
const S = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h + 5, mi); // strateji saati → UTC
/** 24 saat: verilen seans günleri (aralık listesi), her gün 23 adet 1H; son gün `last` */
function h1Days(ranges: number[], firstEnd = S(2026, 11, 2, 17), n = 23): Candle[] {
  const out: Candle[] = [];
  let end = firstEnd;
  for (const r of ranges) {
    while ([0, 6].includes(new Date(end - 5 * HOUR).getUTCDay())) end += DAY; // hafta sonu yok
    const start = end - 23 * HOUR;
    for (let i = 0; i < n; i++) { const t = start + (23 - n) * HOUR + i * HOUR; const half = i === 5 ? r / 2 : Math.min(r / 2, 0.1); out.push({ t, o: 100, h: 100 + half, l: 100 - half, c: 100 }); }
    end += DAY;
  }
  return out;
}
const order = (H: number, L: number, start: number, end: number): OcoOrder => ({ id: 'N7-X', setup: 'N7', sym: 'XAUUSD', dayKey: 'd', dayT: start - DAY, dayEnd: start - HOUR, H, L, R: H - L, sessStart: start, sessEnd: end, sessKey: 'k', notifiedAt: start - HOUR });
const sess = (start: number, rows: number[][]): Candle[] => rows.map((r, i) => ({ t: start + i * HOUR, o: r[0], h: r[1], l: r[2], c: r[3] }));

test('N7 senaryo 1: dünkü aralık 7 günün en küçüğü → OCO seviyeleri (H, L), hedef ±1,5R', () => {
  const h1 = h1Days([10, 9, 8, 7, 6, 5, 4]);
  const now = h1[h1.length - 1].t + HOUR + 10_000;
  const days = sessionDays('cfd24', h1, now, C).filter((d) => d.closed);
  const det = detect('NR7', days, 0.01);
  assert.equal(det.ok, true); assert.equal(det.day!.h, 102); assert.equal(det.day!.l, 98);
  const o = order(102, 98, 0, 1);
  assert.equal(o.H + 1.5 * o.R, 108); assert.equal(o.L - 1.5 * o.R, 92);
  // eşitlik dahil
  assert.equal(detect('NR7', sessionDays('cfd24', h1Days([10, 9, 8, 7, 6, 4, 4]), now, C).filter((d) => d.closed), 0.01).ok, true);
  assert.equal(detect('NR7', sessionDays('cfd24', h1Days([10, 9, 8, 7, 3, 6, 4]), now, C).filter((d) => d.closed), 0.01).ok, false);
});

const st = S(2026, 11, 10, 18) - DAY; // seans başlangıcı (Pzt 18:00 → Salı 17:00)
const en = st + 23 * HOUR;

test('N7 senaryo 2: seans boşlukla seviyenin üstünde açıldı → giriş = açılış, stop = NR7_L, R ve hedef yeniden', () => {
  const s = simulate(order(102, 98, st, en), 'cfd24', sess(st, [[103, 103.5, 102.8, 103.2], [103.2, 103.4, 103, 103.1]]), st + 2 * HOUR + MIN, 1.5, 103.1);
  assert.equal(s.state, 'DOLDU'); assert.equal(s.dir, 1); assert.equal(s.entry, 103); assert.equal(s.stop, 98);
  assert.equal(s.R, 5); assert.equal(s.target, 110.5); assert.equal(s.gap, true);
});

test('N7 senaryo 3: giriş mumu aynı zamanda stopa değdi → −1R', () => {
  // Boşlukla H üstünde açılış → açılışta dolum; aynı mumda NR7_L (stop) → −1R
  const s = simulate(order(102, 98, st, en), 'cfd24', sess(st, [[103, 103.5, 97.5, 99]]), st + HOUR + MIN, 1.5, null);
  assert.equal(s.state, 'KAPANDI'); assert.equal(s.k, 'STOP'); assert.equal(s.r, -1); assert.equal(s.entry, 103);
  // Giriş sonraki mumda değil, giriş mumunda: önce kırılım (mum içinde), sonra 2. mumda stop
  const s2 = simulate(order(102, 98, st, en), 'cfd24', sess(st, [[101, 102.5, 100.5, 102.2], [102.2, 102.3, 97.9, 98]]), st + 2 * HOUR + MIN, 1.5, null);
  assert.equal(s2.k, 'STOP'); assert.equal(s2.r, -1);
});

test('N7 senaryo 4: giriş mumu hedefe değdi ama sonraki mumlarda değmedi → hedef sayılmaz, seans sonu kapanış', () => {
  const rows = [[101, 109, 100, 104]]; // giriş 102, hedef 108 — giriş mumunda 109
  for (let i = 1; i < 23; i++) rows.push([104, 105, 103, 104.5]);
  const s = simulate(order(102, 98, st, en), 'cfd24', sess(st, rows), en + MIN, 1.5, null);
  assert.equal(s.k, 'SEANS_SONU'); assert.equal(s.exit, 104.5); assert.equal(s.r, (104.5 - 102) / 4);
});

test('N7 senaryo 5: seans sonu → açık pozisyon kapanış fiyatıyla kapanır; kırılım yoksa emirler iptal', () => {
  const rows = Array.from({ length: 23 }, () => [100, 101, 99, 100.5]);
  const s = simulate(order(102, 98, st, en), 'cfd24', sess(st, rows), en + MIN, 1.5, null);
  assert.equal(s.state, 'IPTAL'); assert.equal(s.r, null);
  const pend = simulate(order(102, 98, st, en), 'cfd24', sess(st, rows.slice(0, 10)), st + 10 * HOUR + MIN, 1.5, null);
  assert.equal(pend.state, 'BEKLIYOR');
});

test('N7 senaryo 6: aynı 1H mumda iki seviye → "test dışı (çift kırılım)", işlem yok', () => {
  const s = simulate(order(102, 98, st, en), 'cfd24', sess(st, [[100, 103, 97, 100]]), st + HOUR + MIN, 1.5, null);
  assert.equal(s.state, 'CIFT'); assert.match(s.reason!, /test dışı \(çift kırılım\)/); assert.equal(s.r, null);
});

test('N7 senaryo 7: 7 günden birinde 10 adet 1H mum (XAU) → sinyal yok (N7.1)', () => {
  const h1 = h1Days([10, 9, 8, 7, 6, 5, 4]);
  const third = h1.slice(46, 69).slice(0, 10); // 3. gün 10 mum
  const cut = [...h1.slice(0, 46), ...third, ...h1.slice(69)];
  const now = cut[cut.length - 1].t + HOUR + 10_000;
  const det = detect('NR7', sessionDays('cfd24', cut, now, C).filter((d) => d.closed), 0.01);
  assert.equal(det.ok, null); assert.match(det.why, /N7\.1/);
});

test('N7: ertesi seans — Cuma sinyali → Pazar 18:00 seansı (Pazartesi günü); ETF → ertesi borsa günü', () => {
  const fri = S(2026, 11, 13, 17);
  const n = nextSession('cfd24', fri, C)!;
  assert.equal(n.start, S(2026, 11, 15, 18)); assert.equal(n.key, '2026-11-16');
  const etfClose = Date.UTC(2026, 10, 13, 21); // Cuma 16:00 NY
  const e = nextSession('etf', etfClose, C)!;
  assert.equal(e.key, '2026-11-16'); assert.equal(e.start, Date.UTC(2026, 10, 16, 14, 30));
});

test('N7 uçtan uca: teyit → OCO TAM bildirimi → dolum → seans sonu uyarısı → kapanış', async () => {
  const h1 = h1Days([10, 9, 8, 7, 6, 5, 4]);
  const dayEnd = h1[h1.length - 1].t + HOUR;
  const nowA = dayEnd + 10_000;
  const series = { XAUUSD: analyze(sc, 'XAUUSD', h1, nowA, null, '', 't') };
  const orders: OcoOrder[] = [], positions: StarPos[] = [], pending: Record<string, Pending> = {};
  const cfg = conf();
  const deps = (now: number, ser = series) => ({ sc, now, series: ser as never, orders, positions, pending, signals: [], urgent: new Set<string>(), watch: new Set<string>(), newsLabel: null, symCfg: (x: string) => cfg.symbols[x], livePrice: async () => ({ price: null, src: '', live: false }) });
  const r1 = await runOco('N7', deps(nowA));
  assert.equal((r1.rows.XAUUSD as { status: string }).status, 'TAM_BEKLE');
  const r2 = await runOco('N7', deps(nowA + 5 * MIN));
  assert.equal((r2.rows.XAUUSD as { status: string }).status, 'TAM');
  const tam = r2.msgs.find((m) => m.key.endsWith('+TAM'))!;
  assert.match(tam.body, /^⭐N7: XAU NR7 — al-stop 102\.00, sat-stop 98\.00, hedefler ±1,5R, seans sonu 01:00 TR$/);
  assert.equal(orders.length, 1);
  // Ertesi seans: 3. mumda yukarı kırılım; seans bitimine 10 dk kala
  const s0 = orders[0].sessStart;
  const rows: Candle[] = []; for (let i = 0; i < 22; i++) rows.push({ t: s0 + i * HOUR, o: 100, h: i === 2 ? 102.5 : 101, l: 99.5, c: i >= 2 ? 102.2 : 100 });
  const nowF = s0 + 3 * HOUR + 10_000;
  const rF = await runOco('N7', deps(nowF, { XAUUSD: analyze(sc, 'XAUUSD', [...h1, ...rows.slice(0, 3)], nowF, null, '', 't') }));
  assert.ok(rF.msgs.some((m) => m.key.endsWith('+DOLDU') && /▲ LONG doldu/.test(m.body)));
  const nowB = orders[0].sessEnd - 8 * MIN;
  const ser2 = { XAUUSD: analyze(sc, 'XAUUSD', [...h1, ...rows], nowB, null, '', 't') };
  const r3 = await runOco('N7', deps(nowB, ser2));
  const row = r3.rows.XAUUSD as { status: string; position: { dir: number } };
  assert.equal(row.status, 'AKTIF'); assert.equal(row.position.dir, 1);
  assert.ok(r3.msgs.some((m) => m.key.endsWith('+SEANS10') && m.body.startsWith('⭐N7: seans sonu — pozisyonu kapat')));
  assert.equal(positions.length, 1); assert.equal(positions[0].open, true);
});
