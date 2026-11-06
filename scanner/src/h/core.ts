// KURULUM H — Trend Devam (Pullback): saf hesap fonksiyonları. Şartname: docs/KURULUM_H.md
// LONG anlatılır; SHORT için mumlar fiyat-aynası (×−1) ile aynı fonksiyonlardan geçer.
import type { Candle } from '../types.ts';
import { atr as atrSeries, ema, rsi as rsiSeries, adx as adxSeries, sma } from '../indicators.ts';
import { pivots } from '../f/wyckoff.ts';

export const last = <T>(a: T[]): T | undefined => a[a.length - 1];
const fin = (x: number) => Number.isFinite(x);

/** §10.5 Kötü tick: aralığı > k×ATR14 olan mumu, sonraki mum hareketin > %50'sini geri aldıysa çıkar */
export function cleanBadTicks(c: Candle[], k = 5): { clean: Candle[]; removed: number[] } {
  if (c.length < 20) return { clean: c, removed: [] };
  const a = atrSeries(c, 14);
  const removed: number[] = [];
  const out: Candle[] = [];
  for (let i = 0; i < c.length; i++) {
    const ref = a[i - 1];
    if (i > 0 && i < c.length - 1 && fin(ref) && c[i].h - c[i].l > k * ref) {
      const move = c[i].c - c[i - 1].c, back = c[i + 1].c - c[i].c;
      if (Math.abs(move) > 0 && Math.sign(back) === -Math.sign(move) && Math.abs(back) > 0.5 * Math.abs(move)) { removed.push(c[i].t); continue; }
    }
    out.push(c[i]);
  }
  return { clean: out, removed };
}

export interface TrendCheck {
  t1: { ok: boolean | null; close: number; ema50: number; ema200: number; ret60: number };
  t2: { ok: boolean | null; close: number; ema50: number; bos: 1 | -1 | 0; tBOS: number | null };
  t3: { ok: boolean | null; adx: number; rising: boolean; none: boolean };
  quality: number;
}
/**
 * §4 Trend filtreleri (LONG uzayı). `active` = önceki taramada trend aktifti (histerezis §10.6):
 * yeni trend için ADX ≥ adxIn ve yükselen, kapanış EMA'nın 0,1×ATR üstünde; aktifken ADX ≥ adxOut ve
 * kapanış EMA − 0,1×ATR üstünde kaldıkça korunur. ADX < adxNone → trend yok.
 */
export function trendCheck(d1: Candle[], h4: Candle[], active: boolean, P: { adxIn: number; adxOut: number; adxNone: number; adxStrong: number; emaHystAtr: number; ret60: number; warmD1: number; warm4h: number }): TrendCheck {
  const cd = d1.map((x) => x.c), c4 = h4.map((x) => x.c);
  const e50d = ema(cd, 50), e200d = ema(cd, 200), e50 = ema(c4, 50);
  const ad = adxSeries(h4, 14);
  const atrD = last(atrSeries(d1, 14)) ?? NaN, atr4 = last(atrSeries(h4, 14)) ?? NaN;
  const close = last(cd) ?? NaN, ema50 = last(e50d) ?? NaN, ema200 = last(e200d) ?? NaN;
  const ret60 = cd.length > P.ret60 ? close / cd[cd.length - 1 - P.ret60] - 1 : NaN;
  const m = (x: number) => (active ? -1 : 1) * P.emaHystAtr * x; // giriş: +0,1 ATR, aktif: −0,1 ATR
  const warmD = d1.length >= P.warmD1, warm4 = h4.length >= P.warm4h;
  const t1ok = !warmD || !fin(ema200) ? null : close > ema50 + m(atrD) && ema50 > ema200 && ret60 > 0;
  const bos = bos4h(h4);
  const c4l = last(c4) ?? NaN, e50l = last(e50) ?? NaN;
  const t2ok = !warm4 || !fin(e50l) ? null : c4l > e50l + m(atr4) && bos.dir === 1;
  const a0 = ad[ad.length - 1], a3 = ad[ad.length - 4];
  const rising = fin(a0) && fin(a3) && a0 > a3;
  const none = fin(a0) && a0 < P.adxNone;
  const t3ok = !fin(a0) ? null : none ? false : active ? a0 >= P.adxOut : a0 >= P.adxIn && rising;
  return {
    t1: { ok: t1ok, close, ema50, ema200, ret60 },
    t2: { ok: t2ok, close: c4l, ema50: e50l, bos: bos.dir, tBOS: bos.t },
    t3: { ok: t3ok, adx: a0, rising, none },
    quality: fin(a0) && a0 >= P.adxStrong ? 1 : 0,
  };
}

/** 4H BOS: kapanışın son kesinleşmiş (N=3) pivot tepesinin üstünde / dibinin altında olması; en son olay */
export function bos4h(h4: Candle[], N = 3): { dir: 1 | -1 | 0; t: number | null; lastPivotLow: number | null; lastPivotHigh: number | null } {
  const pv = pivots(h4, N);
  let ph: number | null = null, pl: number | null = null, dir: 1 | -1 | 0 = 0, t: number | null = null;
  let lastPL: number | null = null, lastPH: number | null = null;
  let p = 0;
  for (let i = 0; i < h4.length; i++) {
    while (p < pv.length && pv[p].i + N <= i) { // i anında kesinleşmiş pivotlar
      if (pv[p].type === 'H') { ph = pv[p].price; lastPH = pv[p].price; } else { pl = pv[p].price; lastPL = pv[p].price; }
      p++;
    }
    if (ph !== null && h4[i].c > ph) { dir = 1; t = h4[i].t; ph = null; }
    if (pl !== null && h4[i].c < pl) { dir = -1; t = h4[i].t; pl = null; }
  }
  return { dir, t, lastPivotLow: lastPL, lastPivotHigh: lastPH };
}

export interface Pullback { k: number; H0: number; H0t: number; L0: number; startI: number; startT: number; low: number; lowT: number; impulseFrom: number }
/**
 * §5.1 Geri çekilme sayacı (1H, LONG): tBOS'tan sonra bir 1H mumun low'u EMA20'ye dokununca ve bacağın
 * zirvesi (H0) bir önceki geri çekilmenin H0'ından yüksekse yeni geri çekilme başlar (k++). Kapanış H0'ı
 * geçince itki yeniden başlar. Sadece kapanmış mumlar; sonuç her taramada aynı mumlardan aynı çıkar (repaint yok).
 */
export function pullbacks(h1: Candle[], tBOS: number): { k: number; inPB: boolean; cur: Pullback | null } {
  const e20 = ema(h1.map((x) => x.c), 20);
  let i0 = h1.findIndex((x) => x.t >= tBOS);
  if (i0 < 0) return { k: 0, inPB: false, cur: null };
  let k = 0, prevH0 = -Infinity, inPB = false, segStart = i0, cur: Pullback | null = null;
  // İlk itkinin dibi: BOS'tan önceki 24 saatin en düşüğü
  let originLow = Infinity;
  for (let j = Math.max(0, i0 - 24); j <= i0; j++) originLow = Math.min(originLow, h1[j].l);
  for (let i = i0; i < h1.length; i++) {
    if (!fin(e20[i])) continue;
    if (!inPB && h1[i].l <= e20[i] && i > segStart) {
      let H0 = -Infinity, H0i = segStart;
      for (let j = segStart; j < i; j++) if (h1[j].h > H0) { H0 = h1[j].h; H0i = j; }
      const L0: number = cur !== null ? (cur as Pullback).low : originLow;
      inPB = true;
      if (H0 > prevH0) { k++; prevH0 = H0; cur = { k, H0, H0t: h1[H0i].t, L0, startI: i, startT: h1[i].t, low: h1[i].l, lowT: h1[i].t, impulseFrom: segStart }; }
    }
    if (inPB && cur) {
      if (h1[i].l < cur.low) { cur.low = h1[i].l; cur.lowT = h1[i].t; }
      if (h1[i].c > cur.H0) { inPB = false; segStart = i; }
    }
  }
  return { k, inPB, cur };
}

export interface Character { p1: boolean; p2: boolean; p3: boolean; p4: boolean; avgPb: number; avgImp: number; rsiMin: number; depth: number }
/** §5.3 Düzeltmenin karakteri (LONG) */
export function character(h1: Candle[], pb: Pullback, hl4h: number | null, maxDepth = 0.786, rsiMin = 40): Character {
  const r = rsiSeries(h1.map((x) => x.c), 14);
  const iStart = h1.findIndex((x) => x.t === pb.startT), iH0 = h1.findIndex((x) => x.t === pb.H0t);
  const pbBars = h1.slice(iStart), impBars = h1.slice(Math.max(0, pb.impulseFrom), iH0 + 1);
  const avg = (c: Candle[]) => (c.length ? c.reduce((a, x) => a + (x.h - x.l), 0) / c.length : NaN);
  const avgPb = avg(pbBars), avgImp = avg(impBars);
  let rmin = Infinity;
  for (let i = iStart; i < h1.length; i++) if (fin(r[i])) rmin = Math.min(rmin, r[i]);
  const depth = pb.H0 - pb.L0 > 0 ? (pb.H0 - pb.low) / (pb.H0 - pb.L0) : NaN;
  const p4 = hl4h === null || !pbBars.some((x) => x.c < hl4h);
  return { p1: avgPb < avgImp, p2: rmin > rsiMin, p3: depth <= maxDepth, p4, avgPb, avgImp, rsiMin: rmin, depth };
}

export interface Trigger { state: 'none' | 'pending' | 'filled' | 'expired' | 'missed'; lh: number | null; barT: number | null; validUntil: number | null; fillT: number | null }
/**
 * §6.1 Mikro yapı kırılımı (15m, LONG): geri çekilme içindeki son kesinleşmiş 15m pivot tepe (lh) kapanışla
 * kırılır (fiyat < H0); giriş limit = lh; geçerlilik 4 adet 15m mum. Haber mumları (±15 dk) tetik sayılmaz (§10.9).
 */
export function microTrigger(m15: Candle[], pb: Pullback, isNewsBar: (closeT: number) => boolean, validBars = 4, N = 2): Trigger {
  const M15 = 15 * 60_000;
  const seg = m15.filter((x) => x.t >= pb.startT);
  if (seg.length < 2 * N + 2) return { state: 'none', lh: null, barT: null, validUntil: null, fillT: null };
  const pv = pivots(seg, N).filter((p) => p.type === 'H');
  let res: Trigger = { state: 'none', lh: null, barT: null, validUntil: null, fillT: null };
  for (const p of pv) {
    for (let i = p.i + N + 1; i < seg.length; i++) {
      // Önce daha yeni pivot kesinleşirse ona geçilir
      if (pv.some((q) => q.i > p.i && q.i + N < i)) break;
      if (seg[i].c > p.price && !isNewsBar(seg[i].t + M15)) {
        if (seg[i].c >= pb.H0) { res = { state: 'missed', lh: p.price, barT: seg[i].t, validUntil: null, fillT: null }; break; }
        const validUntil = seg[i].t + M15 * (validBars + 1);
        let fillT: number | null = null;
        for (let j = i + 1; j < seg.length && j <= i + validBars; j++) if (seg[j].l <= p.price) { fillT = seg[j].t; break; }
        const done = seg.length - 1 >= i + validBars;
        res = { state: fillT !== null ? 'filled' : done ? 'expired' : 'pending', lh: p.price, barT: seg[i].t, validUntil, fillT };
        break;
      }
    }
  }
  return res;
}

/** §6.2 Holy Grail: EMA20'ye dokunan 1H mumun high'ı + 0,05×ATR14_1H buy stop; geçerlilik 3 adet 1H mum */
export function holyGrail(h1: Candle[], pb: Pullback, atr1h: number, off = 0.05, validBars = 3): Trigger {
  const H = 3600_000;
  const i = h1.findIndex((x) => x.t === pb.startT);
  if (i < 0) return { state: 'none', lh: null, barT: null, validUntil: null, fillT: null };
  const lvl = h1[i].h + off * atr1h;
  let fillT: number | null = null;
  for (let j = i + 1; j < h1.length && j <= i + validBars; j++) if (h1[j].h >= lvl) { fillT = h1[j].t; break; }
  const done = h1.length - 1 >= i + validBars;
  return { state: fillT !== null ? 'filled' : done ? 'expired' : 'pending', lh: lvl, barT: h1[i].t, validUntil: h1[i].t + H * (validBars + 1), fillT };
}

/** §7 Stop, hedef, RR (LONG) */
export function order(entry: number, pb: Pullback, atr1h: number, atr4h: number, P: { stopAtr1h: number; maxStopAtr4h: number; minRR2: number }) {
  const stop = pb.low - P.stopAtr1h * atr1h;
  const R = entry - stop;
  const maxStopOk = R > 0 && R <= P.maxStopAtr4h * atr4h;
  let t1 = pb.H0;
  const rrH0 = R > 0 ? (pb.H0 - entry) / R : 0;
  if (rrH0 < 1) t1 = entry + R;
  const t2 = pb.low + (pb.H0 - pb.L0);
  const rr1 = R > 0 ? (t1 - entry) / R : 0, rr2 = R > 0 ? (t2 - entry) / R : 0;
  return { stop, R, maxStopOk, t1, t2, rr1, rr2, rrH0, rrOk: rr2 >= P.minRR2 };
}

/** §9 Volatilite şoku: ATR14_1H > k × SMA20(ATR14_1H) */
export function volShock(h1: Candle[], k = 2): { shock: boolean; atr: number; avg: number } {
  const a = atrSeries(h1, 14);
  const s = sma(a.map((x) => (fin(x) ? x : 0)), 20);
  const x = last(a) ?? NaN, avg = last(s) ?? NaN;
  return { shock: fin(x) && fin(avg) && avg > 0 && x > k * avg, atr: x, avg };
}
