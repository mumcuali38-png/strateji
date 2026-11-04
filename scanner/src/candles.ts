import type { Candle, TF } from './types.ts';
import { TF_MS, bucketStart } from './time.ts';

/** Zaman damgasına göre birleştir (yeni veri eskisinin üstüne yazar), sıralı döndür */
export function mergeCandles(old: Candle[], fresh: Candle[], keep?: number): Candle[] {
  const map = new Map<number, Candle>();
  for (const c of old) map.set(c.t, c);
  for (const c of fresh) map.set(c.t, c);
  const out = [...map.values()].sort((a, b) => a.t - b.t);
  return keep && out.length > keep ? out.slice(out.length - keep) : out;
}

/** Alt zaman diliminden üst zaman dilimi üret (NY gece yarısı hizalı). */
export function aggregate(base: Candle[], tf: TF): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const b of base) {
    const s = bucketStart(b.t, tf);
    if (!cur || cur.t !== s) {
      if (cur) out.push(cur);
      cur = { t: s, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 };
    } else {
      if (b.h > cur.h) cur.h = b.h;
      if (b.l < cur.l) cur.l = b.l;
      cur.c = b.c;
      cur.v = (cur.v ?? 0) + (b.v ?? 0);
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * Kapanmış mumlar: bitiş zamanı (t + tf) <= now olanlar.
 * Henüz kapanmamış (canlı) mum hiçbir şartı sağlamaz (MASTERPROMPT §1.4).
 */
export function splitClosed(candles: Candle[], tf: TF, now: number): { closed: Candle[]; live?: Candle } {
  const ms = TF_MS[tf];
  let n = candles.length;
  while (n > 0 && candles[n - 1].t + ms > now) n--;
  return { closed: candles.slice(0, n), live: n < candles.length ? candles[candles.length - 1] : undefined };
}

/** Üst TF mumu, alt TF verisi kovanın sonuna kadar gelmediyse canlıdır. */
export function aggregateClosed(base: Candle[], baseTf: TF, tf: TF, now: number): { closed: Candle[]; live?: Candle } {
  const baseClosed = splitClosed(base, baseTf, now).closed;
  const agg = aggregate(baseClosed, tf);
  const ms = tf === '1w' ? TF_MS['1w'] : TF_MS[tf];
  if (agg.length === 0) return { closed: [] };
  const last = agg[agg.length - 1];
  const lastBase = baseClosed[baseClosed.length - 1];
  const bucketEnd = last.t + ms;
  const complete = lastBase.t + TF_MS[baseTf] >= bucketEnd || now >= bucketEnd + TF_MS[baseTf] * 3;
  if (complete && bucketEnd <= now) return { closed: agg };
  return { closed: agg.slice(0, -1), live: last };
}

export function body(c: Candle): number { return Math.abs(c.c - c.o); }
export function range(c: Candle): number { return c.h - c.l; }
export function isBull(c: Candle): boolean { return c.c > c.o; }
export function isBear(c: Candle): boolean { return c.c < c.o; }
export function upperWick(c: Candle): number { return c.h - Math.max(c.o, c.c); }
export function lowerWick(c: Candle): number { return Math.min(c.o, c.c) - c.l; }

/** Twelve Data değerlerini mumlara çevir (timezone=UTC ile istenmiş olmalı) */
export function parseTD(values: { datetime: string; open: string; high: string; low: string; close: string; volume?: string }[]): Candle[] {
  const out: Candle[] = [];
  for (const v of values) {
    const iso = v.datetime.length <= 10 ? `${v.datetime}T00:00:00Z` : `${v.datetime.replace(' ', 'T')}Z`;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    const c: Candle = { t, o: +v.open, h: +v.high, l: +v.low, c: +v.close };
    if (v.volume !== undefined) c.v = +v.volume;
    if ([c.o, c.h, c.l, c.c].every(Number.isFinite)) out.push(c);
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Depolama için sıkıştırılmış biçim: [t, o, h, l, c, v] */
export function pack(c: Candle[]): number[][] { return c.map((x) => [x.t, x.o, x.h, x.l, x.c, x.v ?? 0]); }
export function unpack(a: number[][]): Candle[] { return a.map((x) => ({ t: x[0], o: x[1], h: x[2], l: x[3], c: x[4], v: x[5] ?? 0 })); }
