// ⭐IB — docs/kurulum_IB_IcMum_spec.md §11 test senaryoları
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Candle } from '../src/types.ts';
import { HOUR, MIN, DAY } from '../src/time.ts';
import { loadStar } from '../src/star/config.ts';
import { sessionDays, type Grp } from '../src/star/sessions.ts';
import { detect, nextSession, simulate, type OcoOrder } from '../src/star/oco.ts';
import { runOco } from '../src/star/setups-oco.ts';
import { analyze } from '../src/star/run.ts';
import type { Pending } from '../src/star/guard.ts';
import type { StarPos } from '../src/star/trend.ts';
import { conf } from './helpers.ts';

const sc = loadStar();
const C = sc.common;
const S = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h + 5, mi);
/** Geçerli seans günleri: [H, L] listesi */
const days = (hl: number[][]): Grp[] => hl.map(([h, l], i) => ({ key: `d${i}`, t: i * DAY, end: i * DAY + 23 * HOUR, o: (h + l) / 2, h, l, c: (h + l) / 2, n: 23, valid: true, closed: true }));
const base7 = [[101, 99], [111, 89], [112, 88], [113, 87], [114, 86]]; // ilk gün dar (aralık 2) → iç gün NR7 olmasın

test('IB senaryo 1: bugün H < dün H ve L > dün L, NR7 değil → sinyal (TAM)', () => {
  const d = detect('IB', days([...base7, [110, 90], [109, 92]]), 0.01);
  assert.equal(d.inside, true); assert.equal(d.nr7, false); assert.equal(d.ok, true);
});

test('IB senaryo 2: bugün H = dün H → iç gün değil (IB.1, fiyat adımına yuvarlanmış)', () => {
  assert.equal(detect('IB', days([...base7, [110, 90], [110, 92]]), 0.01).ok, false);
  // 110.004 → 0,01 adımında 110.00 = dün H → iç gün değil
  assert.equal(detect('IB', days([...base7, [110, 90], [110.004, 92]]), 0.01).ok, false);
  // AUDUSD adımı 0,00001
  assert.equal(detect('IB', days([[0.6601, 0.66], [0.67, 0.64], [0.67, 0.64], [0.67, 0.64], [0.67, 0.64], [0.66012, 0.65001], [0.66011, 0.65002]]), 0.00001).ok, true);
});

test('IB senaryo 3: iç gün aynı zamanda NR7 → IB sinyali yok (⭐N7\'nin alanı)', () => {
  const d = detect('IB', days([...base7, [110, 90], [101, 99]]), 0.01);
  assert.equal(d.inside, true); assert.equal(d.nr7, true); assert.equal(d.ok, false); assert.match(d.why, /NR7/);
});

test('IB senaryo 4: boşluk, giriş mumu stopu, hedef giriş mumunda, seans sonu → ⭐N7 ile aynı sonuçlar', () => {
  const st = S(2026, 11, 10, 18) - DAY, en = st + 23 * HOUR;
  const o: OcoOrder = { id: 'IB-X', setup: 'IB', sym: 'XAUUSD', dayKey: 'd', dayT: st - DAY, dayEnd: st - HOUR, H: 102, L: 98, R: 4, sessStart: st, sessEnd: en, sessKey: 'k', notifiedAt: st };
  const bar = (rows: number[][]): Candle[] => rows.map((r, i) => ({ t: st + i * HOUR, o: r[0], h: r[1], l: r[2], c: r[3] }));
  const gap = simulate(o, 'cfd24', bar([[103, 103.5, 102.8, 103.2]]), st + HOUR + MIN, 1.5, null);
  assert.equal(gap.entry, 103); assert.equal(gap.R, 5); assert.equal(gap.target, 110.5);
  assert.equal(simulate(o, 'cfd24', bar([[103, 103.5, 97.5, 99]]), st + HOUR + MIN, 1.5, null).r, -1);
  const rows = [[101, 109, 100, 104]]; for (let i = 1; i < 23; i++) rows.push([104, 105, 103, 104.5]);
  const s = simulate(o, 'cfd24', bar(rows), en + MIN, 1.5, null);
  assert.equal(s.k, 'SEANS_SONU'); assert.equal(s.r, (104.5 - 102) / 4);
  assert.equal(simulate(o, 'cfd24', bar([[100, 103, 97, 100]]), st + HOUR + MIN, 1.5, null).state, 'CIFT');
});

test('IB senaryo 5: BTC Pazar günü iç gün → Pazartesi seansı geçerli (7/24, hafta sonu dahil)', () => {
  const sunEnd = S(2026, 11, 15, 17); // Pazar seans günü bitişi (17:00 strateji saati)
  const n = nextSession('crypto', sunEnd, C)!;
  assert.equal(n.key, '2026-11-16'); assert.equal(n.start, S(2026, 11, 15, 18));
  // Kripto seans günleri hafta sonu da üretilir
  const h1: Candle[] = [];
  for (let t = S(2026, 11, 13, 18); t < sunEnd; t += HOUR) h1.push({ t, o: 100, h: 101, l: 99, c: 100 });
  const g = sessionDays('crypto', h1, sunEnd + MIN, C).filter((x) => x.closed);
  assert.deepEqual(g.map((x) => x.key), ['2026-11-14', '2026-11-15']);
  assert.ok(g.every((x) => x.valid));
});

test('IB.2: dün veya bugün eksik mumlu → sinyal yok', () => {
  const d = days([...base7, [110, 90], [109, 92]]);
  d[6] = { ...d[6], n: 8, valid: false };
  assert.equal(detect('IB', d, 0.01).ok, null);
});

test('IB uçtan uca: teyit → "⭐IB: XAU iç gün — al-stop …, sat-stop …, hedef ±1,5R"', async () => {
  // 7 seans günü: geniş günler + dün geniş + bugün iç gün (NR7 değil)
  const spec = [[101, 99], [111, 89], [112, 88], [113, 87], [114, 86], [110, 90], [109, 92]];
  const h1: Candle[] = [];
  let end = S(2026, 11, 2, 17);
  for (const [hh, ll] of spec) {
    while ([0, 6].includes(new Date(end - 5 * HOUR).getUTCDay())) end += DAY;
    for (let i = 0; i < 23; i++) { const t = end - 23 * HOUR + i * HOUR; h1.push({ t, o: 100, h: i === 3 ? hh : 101, l: i === 4 ? ll : 99, c: 100 }); }
    end += DAY;
  }
  const now = h1[h1.length - 1].t + HOUR + 10_000;
  const series = { XAUUSD: analyze(sc, 'XAUUSD', h1, now, null, '', 't') };
  const orders: OcoOrder[] = [], positions: StarPos[] = [], pending: Record<string, Pending> = {};
  const cfg = conf();
  const deps = (t: number) => ({ sc, now: t, series: series as never, orders, positions, pending, signals: [], urgent: new Set<string>(), watch: new Set<string>(), newsLabel: null, symCfg: (x: string) => cfg.symbols[x], livePrice: async () => ({ price: null, src: '', live: false }) });
  assert.equal(((await runOco('IB', deps(now))).rows.XAUUSD as { status: string }).status, 'TAM_BEKLE');
  const r = await runOco('IB', deps(now + 5 * MIN));
  assert.equal((r.rows.XAUUSD as { status: string }).status, 'TAM');
  assert.equal(r.msgs.find((m) => m.key.endsWith('+TAM'))!.body, '⭐IB: XAU iç gün — al-stop 109.00, sat-stop 92.00, hedef ±1,5R');
  const j = (r.rows.XAUUSD as { json: { inside_day: { prev_high: number; is_nr7: boolean } } }).json;
  assert.equal(j.inside_day.prev_high, 110); assert.equal(j.inside_day.is_nr7, false);
});
