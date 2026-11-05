// Kurulum G için sentetik Judas günü (test ve demo). Gerçek piyasa verisi DEĞİL.
// İşlem günü: Çarşamba 2026-11-04 (strateji saati UTC-5). Asya 4024.8–4060.2, MO 4040.
import type { Candle } from '../types.ts';
import { HOUR, MIN, NY_OFFSET } from '../time.ts';

export interface GOpt {
  noSpike?: boolean; asiaNarrow?: boolean; earlyMove?: boolean; earlySweep?: boolean; biasSideFirst?: boolean;
  lateSweep?: boolean; deepSweep?: boolean; noBack?: boolean; cancelAfterBack?: boolean; noMoClose?: boolean;
  weakMss?: boolean; noFill?: boolean; asiaBars?: number; tail?: [number, number][]; nowNY?: [number, number];
}
const NY0 = Date.UTC(2026, 10, 4) - NY_OFFSET; // 2026-11-04 00:00 NY (UTC 05:00)
export const atNY = (h: number, m = 0) => NY0 + h * HOUR + m * MIN;

/** 1H geçmiş (18 Eylül → 3 Kasım 17:00 NY): yükseliş + günlük salınım; önceki hafta Çarşamba bir iğne (WH) */
export function gHistory(o: GOpt = {}): Candle[] {
  const out: Candle[] = [];
  const start = atNY(-24 * 47 - 6); // ~47 gün önce 18:00
  const end = atNY(-7); // Salı 17:00 NY
  for (let t = start; t < end; t += HOUR) {
    const nyd = new Date(t + NY_OFFSET), dow = nyd.getUTCDay(), h = nyd.getUTCHours();
    if (dow === 6 || (dow === 5 && h >= 17) || (dow === 0 && h < 18) || h === 17) continue;
    const f = (t - start) / (end - start);
    const base = 3700 + 320 * f;
    const ph = ((h + 6) % 24) / 23;
    const p = base + 35 * Math.sin(2 * Math.PI * ph);
    const p2 = base + 35 * Math.sin(2 * Math.PI * (ph + 1 / 23));
    const c: Candle = { t, o: p, c: p2, h: Math.max(p, p2) + 3, l: Math.min(p, p2) - 3, v: 0 };
    if (!o.noSpike && t === atNY(-24 * 7 + 10)) c.h += 300; // önceki hafta Çarşamba 10:00 iğne
    out.push(c);
  }
  return out;
}

/** 5m: Salı 18:00 NY'den itibaren işlem günü */
export function gDay(o: GOpt = {}): { m5: Candle[]; now: number } {
  const bars: Candle[] = [];
  let t = atNY(-6);
  const push = (op: number, cl: number, h?: number, l?: number) => { bars.push({ t, o: op, c: cl, h: h ?? Math.max(op, cl) + 0.2, l: l ?? Math.min(op, cl) - 0.2, v: 0 }); t += 5 * MIN; };
  const path = (pts: [number, number][], untilT: number) => { // [zaman, fiyat] noktaları arası doğrusal
    for (let k = 0; k < pts.length - 1; k++) {
      const [t1, p1] = pts[k], [t2, p2] = pts[k + 1];
      const n = Math.round((t2 - t1) / (5 * MIN));
      for (let i = 0; i < n && t < untilT; i++) { const a = p1 + ((p2 - p1) * i) / n, b = p1 + ((p2 - p1) * (i + 1)) / n; push(a, b); }
    }
  };
  const [lo, hi] = o.asiaNarrow ? [4036, 4044] : [4025, 4060];
  path([[atNY(-6), 4040], [atNY(-4), 4041], [atNY(-3), hi], [atNY(-1, -30), lo], [atNY(0), 4040]], atNY(0));
  if (o.asiaBars !== undefined) { const drop = (16 - o.asiaBars) * 3; const s = bars.findIndex((x) => x.t >= atNY(-4)); bars.splice(s, drop); }
  t = atNY(0);
  if (o.earlyMove) path([[atNY(0), 4040], [atNY(1, 45), 4014]], atNY(1, 45));
  else path([[atNY(0), 4040], [atNY(1), 4044], [atNY(1, 45), 4038]], atNY(1, 45));
  if (o.earlySweep) { const i = bars.findIndex((x) => x.t === atNY(1, 30)); bars[i] = { ...bars[i], l: 4020 }; }
  const seq: [number, number, number?, number?][] = [];
  const S = (op: number, cl: number, h?: number, l?: number) => seq.push([op, cl, h, l]);
  S(o.earlyMove ? 4014 : 4038, o.earlyMove ? 4013 : 4036); S(4036, 4034); S(4034, 4035);
  S(4035, 4039, 4039.5); S(4039, 4032, o.biasSideFirst ? 4061 : undefined); S(4032, 4029);
  if (o.lateSweep) for (let k = 0; k < 24; k++) S(4029, 4030 + (k % 2));
  S(4029, 4020, undefined, o.deepSweep ? 3982 : 4018);
  if (o.noBack) { for (let k = 0; k < 12; k++) S(4020, 4021); }
  else {
    S(4020, 4024); S(4024, 4028);
    if (o.cancelAfterBack) { S(4028, 4026); S(4026, 4023); S(4023, 4022); }
    else if (o.noMoClose) { for (let k = 0; k < 30; k++) S(4028 + (k % 3), 4030 + (k % 3)); }
    else if (o.weakMss) { S(4028, 4031); S(4031, 4034); S(4034, 4037); S(4037, 4040); S(4040, 4041); S(4041, 4042); }
    else {
      S(4028, 4031); S(4031, 4043); S(4043, 4044, undefined, 4042.8); S(4044, 4043, undefined, 4042.8);
      if (o.noFill) { for (let k = 0; k < 26; k++) S(4043 + (k % 3), 4045 + (k % 3)); }
      else { S(4043, 4041); S(4041, 4038, undefined, 4036.8); S(4038, 4044); S(4044, 4047); }
    }
  }
  for (const [a, b] of o.tail ?? []) S(a, b);
  for (const [op, cl, h, l] of seq) push(op, cl, h, l);
  const now = o.nowNY ? atNY(o.nowNY[0], o.nowNY[1]) + 20_000 : t + 20_000;
  return { m5: bars, now };
}
