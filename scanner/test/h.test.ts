import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Candle, Setup } from '../src/types.ts';
import { adx, ema } from '../src/indicators.ts';
import { cleanBadTicks, trendCheck, pullbacks, character, microTrigger, order, volShock } from '../src/h/core.ts';
import { evalH, entryWindow, marketOpen, gapBlock, type HInput, type HParams } from '../src/h/setup.ts';
import { trackEvent } from '../src/track.ts';
import type { HistEvent } from '../src/history.ts';
import { conf } from './helpers.ts';

const H = 3600_000, M15 = 15 * 60_000, DAYMS = 86400_000;
const P = () => (conf().params as unknown as { H: HParams }).H;
const Pt = () => { const p = P(); return { adxIn: p.adxIn, adxOut: p.adxOut, adxNone: p.adxNone, adxStrong: p.adxStrong, emaHystAtr: p.emaHystAtr, ret60: p.ret60, warmD1: p.warmD1, warm4h: p.warm4h }; };
/** Kapanışlardan mum: o = önceki kapanış, gölge ± w */
function bars(closes: number[], t0: number, step: number, w = 0.3): Candle[] {
  return closes.map((c, i) => { const o = i ? closes[i - 1] : c; return { t: t0 + i * step, o, h: Math.max(o, c) + w, l: Math.min(o, c) - w, c, v: 100 }; });
}
const T0 = Date.UTC(2024, 0, 1);

test('H T1 (EK §14-1): 60 günlük getiri negatif → T1 ❌', () => {
  const up = Array.from({ length: 640 }, (_, i) => 100 + i * 0.5);
  const down = Array.from({ length: 60 }, (_, i) => 420 - i * 0.2);
  const t = trendCheck(bars([...up, ...down], T0, DAYMS), bars(Array.from({ length: 300 }, (_, i) => 100 + i), T0, 4 * H), false, Pt());
  assert.ok(t.t1.ret60 < 0);
  assert.equal(t.t1.ok, false);
});

test('H T3 (EK §14-2/3): yeni trend ADX ≥ 25 ve yükselen; aktif trend ADX ≥ 22 ile korunur (histerezis)', () => {
  const closes = Array.from({ length: 300 }, (_, i) => 100 + i * 0.8 + Math.sin(i / 2) * 3 + (i > 280 ? -(i - 280) * 1.5 : 0));
  const h4 = bars(closes, T0, 4 * H, 1);
  const d1 = bars(Array.from({ length: 700 }, (_, i) => 50 + i * 0.3), T0, DAYMS);
  const a = adx(h4, 14), a0 = a[a.length - 1], a3 = a[a.length - 4];
  const tNew = trendCheck(d1, h4, false, Pt()), tAct = trendCheck(d1, h4, true, Pt());
  assert.equal(tNew.t3.ok, a0 < 20 ? false : a0 >= 25 && a0 > a3);
  assert.equal(tAct.t3.ok, a0 < 20 ? false : a0 >= 22);
});

test('H geri çekilme sayacı (§5.1, EK §14-4): üç geri çekilme → k = 3', () => {
  const seq: number[] = [];
  let p = 100;
  for (let leg = 0; leg < 3; leg++) { for (let i = 0; i < 30; i++) seq.push((p += 1)); for (let i = 0; i < 8; i++) seq.push((p -= 1.6)); }
  for (let i = 0; i < 10; i++) seq.push((p += 1));
  const h1 = bars(seq, T0, H, 0.2);
  const r = pullbacks(h1, h1[25].t);
  assert.ok(r.k >= 2, `k=${r.k}`);
  const r3 = pullbacks(h1, h1[0].t);
  assert.equal(r3.k, 3);
});

test('H karakter (§5.3, EK §14-5/6): derinlik %82 → P3 ❌; RSI 37 → P2 ❌', () => {
  const pb = { k: 1, H0: 200, H0t: T0 + 40 * H, L0: 100, startI: 41, startT: T0 + 41 * H, low: 118, lowT: T0 + 45 * H, impulseFrom: 0 };
  const seq = [...Array.from({ length: 41 }, (_, i) => 100 + i * 2.5), ...Array.from({ length: 6 }, (_, i) => 195 - i * 15)];
  const h1 = bars(seq, T0, H, 0.5);
  const ch = character(h1, pb, null, 0.786, 40);
  assert.ok(ch.depth > 0.786 && !ch.p3);
  assert.ok(ch.rsiMin < 40 && !ch.p2);
});

test('H tetik (§6.1): lh kapanışla kırılır → 4×15m içinde retest dolmazsa expired; H0 üstü kapanış → missed; haber mumu sayılmaz', () => {
  const pb = { k: 1, H0: 120, H0t: T0, L0: 90, startI: 0, startT: T0, low: 100, lowT: T0, impulseFrom: 0 };
  // 15m: pivot tepe 106 (i=3), sonra 107 kapanışla kırılım (i=7), sonra yükselmeye devam (retest yok)
  const c = [104, 105, 105.5, 106, 105, 104, 104.5, 107, 108, 109, 110, 111, 112];
  const m15 = c.map((x, i) => ({ t: T0 + i * M15, o: i ? c[i - 1] : x, h: i === 3 ? 106.5 : Math.max(x, i ? c[i - 1] : x) + 0.1, l: Math.min(x, i ? c[i - 1] : x) - 0.1, c: x, v: 1 }));
  const r = microTrigger(m15, pb, () => false, 4);
  assert.equal(r.state, 'expired'); assert.equal(r.lh, 106.5);
  const r2 = microTrigger(m15.map((x) => x), { ...pb, H0: 106.8 }, () => false, 4);
  assert.equal(r2.state, 'missed');
  const r3 = microTrigger(m15, pb, (closeT) => closeT === T0 + 8 * M15, 4);
  assert.ok(r3.barT !== T0 + 7 * M15, 'haber mumu tetik sayılmadı');
});

test('H stop/RR (§7, EK §14-14/15/16): stop geniş, RR yetersiz, RR(H0) < 1 → T1 = giriş + 1R', () => {
  const pb = { k: 1, H0: 110, H0t: 0, L0: 80, startI: 0, startT: 0, low: 95, lowT: 0, impulseFrom: 0 };
  const P7 = { stopAtr1h: 0.5, maxStopAtr4h: 1.5, minRR2: 2 };
  const o = order(100, pb, 2, 10, P7);
  assert.equal(o.stop, 94); assert.equal(o.t2, 125); assert.ok(o.maxStopOk); assert.ok(o.rr2 >= 2);
  assert.equal(order(100, pb, 2, 3, P7).maxStopOk, false, 'stop 6 > 1,5×ATR4H(3)=4,5');
  assert.equal(order(100, { ...pb, H0: 104, L0: 98 }, 2, 10, P7).rrOk, false);
  const o2 = order(100, { ...pb, H0: 104 }, 2, 10, P7); // RR(H0) = 4/6 < 1
  assert.equal(o2.t1, 106);
});

test('H kötü tick (§10.5, EK §14-11): 6×ATR mum, sonraki %70 geri aldı → çıkarılır', () => {
  const c = bars(Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 0.5), T0, M15, 0.3);
  const i = 30;
  c[i] = { ...c[i], h: c[i].o + 12, c: c[i].o + 10 };
  c[i + 1] = { ...c[i + 1], o: c[i].c, c: c[i].c - 7, l: c[i].c - 7.2, h: c[i].c + 0.1 };
  const r = cleanBadTicks(c, 5);
  assert.deepEqual(r.removed, [c[i].t]);
});

test('H saat/ortam (§9, EK §14-19): BTC Cumartesi ve funding ±15 dk giriş yok; XAU killzone; piyasa açık/kapalı', () => {
  const cfg = conf(), p = P();
  assert.equal(entryWindow('BTCUSD', Date.UTC(2026, 10, 7, 12, 0), cfg, p).open, false); // Cumartesi
  assert.equal(entryWindow('BTCUSD', Date.UTC(2026, 10, 6, 8, 10), cfg, p).open, false); // funding 08:00 UTC
  assert.equal(entryWindow('BTCUSD', Date.UTC(2026, 10, 6, 12, 0), cfg, p).open, true);
  assert.equal(entryWindow('XAUUSD', Date.UTC(2026, 10, 6, 8, 0), cfg, p).open, true); // 03:00 NY = London Open
  assert.equal(entryWindow('XAUUSD', Date.UTC(2026, 10, 6, 11, 0), cfg, p).open, false); // 06:00 NY
  assert.equal(marketOpen('XAUUSD', Date.UTC(2026, 10, 7, 12, 0)), false);
  assert.equal(entryWindow('US100', Date.UTC(2026, 10, 6, 15, 0), cfg, p).open, true); // 10:00 EST
  assert.equal(entryWindow('US100', Date.UTC(2026, 10, 6, 14, 40), cfg, p).open, false, 'ilk 15 dk hariç');
});

test('H açılış boşluğu (§10.8, EK §14-12): QQQ gap 1,4×ATR → ilk 30 dk sinyal yok', () => {
  const now = Date.UTC(2026, 10, 6, 14, 50); // 09:50 EST
  const prev = bars([100, 100.5, 101], now - 20 * H, H, 0.2);
  const today = [{ t: now - 20 * 60_000, o: 103.4, h: 103.6, l: 103.2, c: 103.5, v: 1 }];
  assert.match(gapBlock('US100', [...prev, ...today], now, 1.7) ?? '', /10\.8/);
  assert.equal(gapBlock('US100', [...prev, ...today], now + 40 * 60_000, 1.7), null);
});

test('H volatilite şoku (§9)', () => {
  const calm = bars(Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 0.3), T0, H, 0.2);
  const shock = [...calm, ...bars([100, 106, 99, 107], T0 + 60 * H, H, 2)];
  assert.equal(volShock(calm).shock, false);
  assert.equal(volShock(shock).shock, true);
});

test('H veri tazeliği (§10.4, EK §14-10): son 1H mum 3 saat eski → VERİ GECİKMESİ', () => {
  const now = Date.UTC(2026, 10, 6, 12, 0);
  const h1 = bars(Array.from({ length: 200 }, (_, i) => 100 + i * 0.1), now - 203 * H, H);
  const inp: HInput = { sym: 'BTCUSD', d1: bars(Array.from({ length: 700 }, (_, i) => 100 + i), now - 701 * DAYMS, DAYMS), h4: bars(Array.from({ length: 300 }, (_, i) => 100 + i), now - 301 * 4 * H, 4 * H), h1, m15: bars([1, 2, 3], now - 3 * H, M15), m5: [], price: 120, source: 'test' };
  const r = evalH(conf(), inp, now, [], {}, []);
  assert.equal(r.setup.status, 'YOK');
  assert.match(r.setup.sub, /VERİ GECİKMESİ/);
});

test('H trailing (§8, EK §14-17): T1 sonrası yeni tepe, ATR 6 → stop = HH − 18; geri dönüşte TRAIL', () => {
  const t0 = Date.UTC(2026, 10, 6, 10);
  const ev: HistEvent = { id: 'H-x', key: 'k', t: t0, strategy: 'H', symbol: 'XAUUSD', dir: 1, kind: 'TAM', sub: '', signalAt: t0,
    method: { id: 'h', label: '', type: 'market', entry: 100, stop: 90, tp1: 110, tp2: 130, rr: 1, trailAtr: 6 }, conditions: [], overlays: [] };
  const cs: Candle[] = [[100.5, 99.5, 100], [111, 100, 110.5], [125, 110, 124], [124.5, 118, 120], [121, 106, 107]].map(([h, l, c], i) => ({ t: t0 + i * 5 * 60_000, o: c, h, l, c, v: 1 }));
  const tr = trackEvent(ev, cs, t0 + H)!;
  assert.equal(tr.status, 'KAPANDI');
  assert.deepEqual(tr.events.map((e) => e.type), ['FILL', 'TP1', 'TRAIL']);
  assert.equal(tr.events[2].price, 125 - 18);
  assert.equal(tr.resultR, +(0.5 * 1 + 0.5 * 0.7).toFixed(2));
});

test('H çakışma (§10.12, EK §14-20) ve soğuma (§10.11): soğuma süresince yeni H yok', () => {
  // Soğuma hafızası olan sembolde koruma maddesi ❌ — durum TAM olamaz
  const now = Date.UTC(2026, 10, 6, 12, 0);
  const inp: HInput = { sym: 'BTCUSD', d1: [], h4: [], h1: [], m15: [], m5: [], price: null, source: 'test' };
  const r = evalH(conf(), inp, now, [], { cooldownUntil: now + H }, [{ symbol: 'BTCUSD', strategy: 'F', status: 'TAM', dir: -1 } as unknown as Setup]);
  assert.notEqual(r.setup.status, 'TAM');
});

test('ADX: Wilder — düz trendde yüksek, yatay piyasada düşük', () => {
  const trend = bars(Array.from({ length: 120 }, (_, i) => 100 + i), T0, H, 0.2);
  const flat = bars(Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i * 1.7) * 2 + Math.cos(i * 0.9)), T0, H, 0.2);
  assert.ok(adx(trend).at(-1)! > 40);
  assert.ok(adx(flat).at(-1)! < 20);
  assert.ok(Number.isFinite(ema([1, 2, 3, 4, 5], 3).at(-1)!));
});

import { hScenario } from './support/h-scenario.ts';
import { computeMessages } from '../src/notify.ts';

test('H uçtan uca (EK §14-7/8/9/21): teyit 1/2 → TAM–BEKLE (bildirim yok) → 2. tarama TAM + tek bildirim; tekrar yok; stopa yakın → KAÇTI', () => {
  const c = conf(), now = Date.UTC(2026, 10, 4, 12, 0), inp = hScenario(now);
  const notified: Record<string, number> = {};
  const a = evalH(c, inp, now, [], {}, []);
  assert.equal(a.setup.status, 'BEKLE'); assert.match(a.setup.missing ?? '', /10\.3 teyit 1\/2/);
  assert.equal(computeMessages(c, [a.setup], null, notified, [], now).filter((m) => m.kind === 'tam').length, 0, 'teyit 1/2 bildirilmez');
  const b = evalH(c, inp, now + 5 * 60_000, [], a.mem, []);
  assert.equal(b.setup.status, 'TAM');
  const m = computeMessages(c, [b.setup], null, notified, [], now + 5 * 60_000).filter((x) => x.kind === 'tam');
  assert.equal(m.length, 1); assert.match(m[0].body, /^H: BTC LONG TAM — limit .* RR\(T2\) .* kalite/);
  const b2 = evalH(c, inp, now + 10 * 60_000, [], b.mem, []);
  assert.equal(computeMessages(c, [b2.setup], null, notified, [], now + 10 * 60_000).filter((x) => x.kind === 'tam').length, 0, 'aynı kimlik ikinci kez yok');
  const k = evalH(c, hScenario(now, { price: 75480 }), now + 5 * 60_000, [], a.mem, []);
  assert.equal(k.setup.status, 'YOK'); assert.match(k.setup.conditions.at(-1)!.detail, /10\.10 — sinyal kaçtı/);
  assert.ok(k.mem.cooldownUntil! > now, 'iptal sonrası 2×1H soğuma');
  const after = evalH(c, inp, now + 20 * 60_000, [], k.mem, []);
  assert.notEqual(after.setup.status, 'TAM', 'soğumada yeni H yok');
});

test('H BTC Cumartesi (EK §14-19) → TAM–BEKLE; ters yönde başka TAM (EK §14-20) → ÇAKIŞMA', () => {
  const c = conf(), sat = Date.UTC(2026, 10, 7, 12, 0), inp = hScenario(sat);
  const r = evalH(c, inp, sat, [], {}, []);
  assert.equal(r.setup.status, 'BEKLE'); assert.match(r.setup.missing ?? '', /Cumartesi/);
  const now = Date.UTC(2026, 10, 4, 12, 0);
  const x = evalH(c, hScenario(now), now, [], {}, [{ symbol: 'BTCUSD', strategy: 'F', status: 'TAM', dir: -1 } as unknown as Setup]);
  assert.ok(x.setup.tags?.includes('ÇAKIŞMA'));
  assert.match(x.setup.conditions.at(-1)!.detail, /10\.12 ÇAKIŞMA/);
});
