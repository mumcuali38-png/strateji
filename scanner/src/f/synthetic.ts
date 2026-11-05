// Kurulum F için sentetik Wyckoff birikim senaryosu (test ve demo). Gerçek piyasa verisi DEĞİL.
import type { Candle } from '../types.ts';
import { HOUR, MIN } from '../time.ts';

export interface Opt { noTest?: boolean; extra?: { o?: number; c: number; h?: number; l?: number; v?: number }[]; trend?: 1 | -1; depthAtr?: number; twoBar?: boolean; failAfter?: boolean; springVol?: number; noChoch?: boolean; testVol?: number; shiftDays?: number }
/** 1H bar dizisi: yükseliş → düşüş → 4 dalgalı TR → spring → yükseliş (CHoCH) → zone testi */
export function scenario(o: Opt = {}) {
  const h1: Candle[] = [];
  // Test mumu Çarşamba 13:00 UTC'de olacak şekilde başlangıç
  let t = Date.UTC(2026, 10, 4, 13, 0) + (o.shiftDays ?? 0) * 24 * HOUR;
  const bars: { o: number; c: number; h?: number; l?: number; v?: number }[] = [];
  let p = 60000;
  const tr = o.trend ?? 1;
  for (let i = 0; i < 1300; i++) { const up = i % 6 < 4; const c = p + tr * (up ? 40 : -30); bars.push({ o: p, c }); p = c; }
  for (let i = 0; i < 30; i++) { const c = p - 25; bars.push({ o: p, c }); p = c; }
  const L = p, H = L + 400;
  bars[bars.length - 1].v = 250; bars[bars.length - 1].l = L - 20; // SC
  const wave = (lo: number, hi: number) => { for (let k = 0; k < 8; k++) { const c = p + (hi - lo) / 8; bars.push(k === 7 ? { o: p, c, h: c + 20 } : { o: p, c }); p = c; } };
  const down = (to: number, steps: number, wick = true) => { const st = (p - to) / steps; for (let k = 0; k < steps; k++) { const c = p - st; bars.push(k === steps - 1 && wick ? { o: p, c, l: c - 20 } : { o: p, c }); p = c; } };
  wave(L, H); down(L + 4, 8); wave(L + 4, H - 4); down(L + 2, 8); wave(L + 2, H - 2); down(L + 150, 5, false);
  bars.push({ o: p, c: L + 100, h: L + 190 }); p = L + 100; // küçük tepki (LTF pivot tepe)
  bars.push({ o: p, c: L + 70 }); p = L + 70;
  bars.push({ o: p, c: L + 40 }); p = L + 40;
  const A = 66;
  const sLow = L - (o.depthAtr ?? 0.75) * A;
  const sIdx = bars.length;
  if (o.twoBar) { bars.push({ o: p, c: L - 20, l: sLow, h: p + 5, v: o.springVol ?? 50 }); bars.push({ o: L - 20, c: L + 30, l: sLow + 10, h: L + 35, v: 45 }); p = L + 30; }
  else { bars.push({ o: p, c: L + 30, l: sLow, h: p + 5, v: o.springVol ?? 50 }); p = L + 30; }
  if (o.failAfter) { bars.push({ o: p, c: L + 10 }); bars.push({ o: L + 10, c: sLow - 20, v: 100 }); p = sLow - 20; }
  else if (o.noChoch) { for (let k = 0; k < 26; k++) { bars.push({ o: p, c: p + (k % 2 ? -20 : 20) }); p += k % 2 ? -20 : 20; } }
  else {
    for (const c of [L + 90, L + 150, L + 200]) { bars.push({ o: p, c }); p = c; }
    if (o.noTest) { for (const c of [L + 260, L + 300]) { bars.push({ o: p, c }); p = c; } }
    else { bars.push({ o: p, c: L + 60, l: L + 15, v: o.testVol ?? 40 }); p = L + 60; } // zone testi
    for (const b of o.extra ?? []) { bars.push({ o: b.o ?? p, c: L + b.c, h: b.h !== undefined ? L + b.h : undefined, l: b.l !== undefined ? L + b.l : undefined, v: b.v ?? 60 }); p = L + b.c; }
  }
  // Test mumu Çarşamba 13:00 UTC → bar zaman damgaları
  const t0 = t - (bars.length - 1) * HOUR;
  t = t0;
  for (const b of bars) {
    const hi = b.h ?? Math.max(b.o, b.c) + 8, lo = b.l ?? Math.min(b.o, b.c) - 8;
    h1.push({ t, o: b.o, c: b.c, h: hi, l: lo, v: b.v ?? 100 }); t += HOUR;
  }
  const now = h1[h1.length - 1].t + HOUR + 10_000;
  return { h1, now, L, H, sIdx };
}
/** 1H'ten 15m üret: yükselişte o→l→h→c, düşüşte o→h→l→c */
export function to15(h1: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (const x of h1) {
    const pts = x.c >= x.o ? [x.o, x.l, x.h, x.c] : [x.o, x.h, x.l, x.c];
    const seg = [[pts[0], pts[1]], [pts[1], (pts[1] + pts[2]) / 2], [(pts[1] + pts[2]) / 2, pts[2]], [pts[2], pts[3]]];
    seg.forEach(([a, b], k) => out.push({ t: x.t + k * 15 * MIN, o: a, c: b, h: Math.max(a, b) + (b > a ? 1 : 0.5), l: Math.min(a, b) - (b < a ? 1 : 0.5), v: (x.v ?? 0) / 4 }));
  }
  return out;
}
