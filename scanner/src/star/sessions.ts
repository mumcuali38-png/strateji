// ⭐ ortak zaman kuralları (ortak şartname §2). Strateji saati = sabit UTC-5; ETF'ler NY borsa seansı (yerel saat, yaz saatli).
import type { Candle } from '../types.ts';
import { DAY, HOUR, MIN, NY_OFFSET, inNyLocal, nyLocal, nyOffsetMin, parseHM } from '../time.ts';
import { marketOpen as xauOpen } from '../h/setup.ts';
import type { StarCls, StarCommon } from './config.ts';

export interface Grp extends Candle {
  /** Grup anahtarı: seans günü 'YYYY-MM-DD' (bitiş günü) veya 4H blok başlangıcı */
  key: string;
  end: number;
  n: number;
  /** Yeterli mum var (seans günü: 24 saat ≥ 12, ETF ≥ 5; 4H: ≥ 3 / ≥ 2) */
  valid: boolean;
  /** İçindeki son beklenen 1H mum kapandı (§7.1) */
  closed: boolean;
}

const s = (t: number) => t + NY_OFFSET; // strateji saati (UTC-5) kaydırılmış epoch
const dowS = (t: number) => (Math.floor(s(t) / DAY) + 4) % 7; // 0 = Pazar
const minS = (t: number) => Math.floor((((s(t) % DAY) + DAY) % DAY) / MIN);
const dateS = (t: number) => new Date(s(t)).toISOString().slice(0, 10);

/** Hafta sonu boşluğu (XAU, döviz, endeks CFD): Cuma 17:00 – Pazar 18:00 strateji saati arası mumlar yok sayılır. BTC/ETH: çıkarılmaz. */
export function weekendExcluded(cls: StarCls, t: number): boolean {
  if (cls !== 'cfd24' && cls !== 'fx') return false;
  const d = dowS(t), m = minS(t);
  return d === 6 || (d === 5 && m >= 17 * 60) || (d === 0 && m < 18 * 60);
}

/** Piyasa gerçekten açık mı (beklenen mum / veri tazeliği için) — NY yerel saatine bağlı */
export function marketOpen(cls: StarCls, t: number, etf: [string, string] = ['09:30', '16:00']): boolean {
  if (cls === 'crypto') return true;
  if (cls === 'etf') return inNyLocal(t, etf[0], etf[1]);
  if (cls === 'cfd24') return xauOpen('XAUUSD', t);
  // Döviz: Pazar 17:00 → Cuma 17:00 NY yerel
  const { dow, min } = nyLocal(t);
  return !(dow === 6 || (dow === 5 && min >= 17 * 60) || (dow === 0 && min < 17 * 60));
}

/** 1H mum ızgarası: 24 saat piyasalar UTC :00, ETF'ler :30 (09:30 NY açılışı). ETF'de son mum 15:30–16:00 (yarım saat). */
export function gridStart(cls: StarCls, t: number): number {
  const off = cls === 'etf' ? 30 * MIN : 0;
  return Math.floor((t - off) / HOUR) * HOUR + off;
}
export function barEnd(cls: StarCls, t: number, etf: [string, string] = ['09:30', '16:00']): number {
  if (cls !== 'etf') return t + HOUR;
  const close = etfDay(t, etf).end;
  return Math.min(t + HOUR, close);
}
/** Mum bekleniyor mu (piyasa açık ve hafta sonu boşluğunda değil) */
export function expectedBar(cls: StarCls, t: number, etf?: [string, string]): boolean {
  return !weekendExcluded(cls, t) && marketOpen(cls, t + MIN, etf);
}
/** [from, to) aralığındaki beklenen 1H mum başlangıçları */
export function expectedBars(cls: StarCls, from: number, to: number, etf?: [string, string]): number[] {
  const out: number[] = [];
  for (let t = gridStart(cls, from); t < to; t += HOUR) if (t >= from && expectedBar(cls, t, etf)) out.push(t);
  return out;
}
/** Şu ana kadar kapanmış olması gereken son 1H mumun bitişi (yoksa null) */
export function lastExpectedEnd(cls: StarCls, now: number, etf?: [string, string], lookbackH = 24 * 4): number | null {
  for (let t = gridStart(cls, now); t > now - lookbackH * HOUR; t -= HOUR) {
    if (!expectedBar(cls, t, etf)) continue;
    const e = barEnd(cls, t, etf);
    if (e <= now) return e;
  }
  return null;
}

/** Sadece kapanmış 1H mumlar (§7.1: datetime + interval > şimdi ise hesap dışı) */
export function closed1h(cls: StarCls, h1: Candle[], now: number, etf?: [string, string]): Candle[] {
  return h1.filter((x) => barEnd(cls, x.t, etf) <= now);
}

/** ETF borsa günü (NY yerel tarih) — [açılış, kapanış) mutlak zaman */
export function etfDay(t: number, etf: [string, string] = ['09:30', '16:00']): { key: string; start: number; end: number } {
  const off = nyOffsetMin(t) * MIN;
  const day = Math.floor((t + off) / DAY) * DAY - off;
  return { key: new Date(day + off).toISOString().slice(0, 10), start: day + parseHM(etf[0]) * MIN, end: day + parseHM(etf[1]) * MIN };
}

/** 24 saat piyasaların seans günü: 18:00 → ertesi gün 17:00 strateji saati. 17:00–18:00 mumu hiçbir güne girmez. Anahtar = bitiş günü. */
export function session24(t: number): { key: string; start: number; end: number } | null {
  const m = minS(t);
  if (m >= 17 * 60 && m < 18 * 60) return null;
  const dayStartS = Math.floor(s(t) / DAY) * DAY - NY_OFFSET; // strateji günü 00:00 (UTC epoch)
  const endDay = m >= 18 * 60 ? dayStartS + DAY : dayStartS;
  return { key: dateS(endDay), start: endDay - 6 * HOUR, end: endDay + 17 * HOUR };
}

type KeyFn = (t: number) => { key: string; start: number; end: number } | null;

/** 1H mumlarını gruplara topla; kapanış: bitiş geçti ve grubun son beklenen mumu veri içinde (veya sonrası veri var) */
function group(cls: StarCls, h1: Candle[], keyOf: KeyFn, minBars: number, now: number, etf?: [string, string]): Grp[] {
  const out: Grp[] = [];
  for (const b of h1) {
    if (weekendExcluded(cls, b.t)) continue;
    const k = keyOf(b.t);
    if (!k) continue;
    const cur = out[out.length - 1];
    if (!cur || cur.key !== k.key) out.push({ key: k.key, t: k.start, end: k.end, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0, n: 1, valid: false, closed: false });
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v = (cur.v ?? 0) + (b.v ?? 0); cur.n++; }
  }
  const last = h1[h1.length - 1];
  const dataUntil = last ? barEnd(cls, last.t, etf) : -Infinity;
  for (const g of out) {
    g.valid = g.n >= minBars;
    if (now < g.end) { g.closed = false; continue; }
    if (dataUntil >= g.end) { g.closed = true; continue; }
    const exp = expectedBars(cls, g.t, g.end, etf);
    const lastExp = exp.length ? barEnd(cls, exp[exp.length - 1], etf) : g.t;
    g.closed = dataUntil >= lastExp;
  }
  return out;
}

/** Seans günleri (ortak §2): 24 saat ≥ 12 adet 1H, ETF borsa günü ≥ 5 adet 1H. Girdi: kapanmış 1H mumlar. */
export function sessionDays(cls: StarCls, h1: Candle[], now: number, C: Pick<StarCommon, 'minBars24h' | 'minBarsEtf' | 'etfSessionNY'>): Grp[] {
  if (cls === 'etf') {
    const etf = C.etfSessionNY;
    return group(cls, h1.filter((b) => inNyLocal(b.t, etf[0], etf[1])), (t) => etfDay(t, etf), C.minBarsEtf, now, etf);
  }
  return group(cls, h1, session24, C.minBars24h, now);
}

/** 4H mumları (ortak §2): 24 saat 02/06/10/14/18/22 strateji saati (≥ 3 adet 1H); ETF günde 2 blok, 12:30 NY öncesi / sonrası (≥ 2). */
export function bars4h(cls: StarCls, h1: Candle[], now: number, C: Pick<StarCommon, 'minBars4h24' | 'minBars4hEtf' | 'etfSessionNY' | 'etfBlockSplitNY'>): Grp[] {
  const keyOf = key4h(cls, C);
  if (cls === 'etf') { const etf = C.etfSessionNY; return group(cls, h1.filter((b) => inNyLocal(b.t, etf[0], etf[1])), keyOf, C.minBars4hEtf, now, etf); }
  return group(cls, h1, keyOf, C.minBars4h24, now);
}

/** 4H blok anahtarı: 24 saat 02/06/10/14/18/22 strateji saati; ETF 09:30–12:30 / 12:30–16:00 NY */
export function key4h(cls: StarCls, C: Pick<StarCommon, 'etfSessionNY' | 'etfBlockSplitNY'>): KeyFn {
  if (cls === 'etf') {
    const etf = C.etfSessionNY;
    return (t) => {
      const d = etfDay(t, etf);
      const split = d.start - parseHM(etf[0]) * MIN + parseHM(C.etfBlockSplitNY) * MIN;
      return t < split ? { key: `${d.key}#1`, start: d.start, end: split } : { key: `${d.key}#2`, start: split, end: d.end };
    };
  }
  return (t) => {
    const b = Math.floor((s(t) - 2 * HOUR) / (4 * HOUR)) * 4 * HOUR + 2 * HOUR - NY_OFFSET;
    return { key: String(b), start: b, end: b + 4 * HOUR };
  };
}
/** Seans günü anahtarı */
export function keyDay(cls: StarCls, C: Pick<StarCommon, 'etfSessionNY'>): KeyFn {
  return cls === 'etf' ? (t) => etfDay(t, C.etfSessionNY) : session24;
}

/**
 * Kurulumların ihtiyaç duyduğu son mum kapanışı (zaman dilimi: 1h / 4h / 1d). Sinyaller sadece bu kapanışlarda oluşur;
 * veri bu ana kadar gelmiş olmalı. Seçilen grubun beklenen son 1H mumunun bitişi döner.
 */
export function lastDueClose(cls: StarCls, tf: '1h' | '4h' | '1d', now: number, C: Pick<StarCommon, 'etfSessionNY' | 'etfBlockSplitNY'>, lookbackH = 24 * 5): number | null {
  const etf = C.etfSessionNY;
  if (tf === '1h') return lastExpectedEnd(cls, now, etf, lookbackH);
  const keyOf = tf === '4h' ? key4h(cls, C) : keyDay(cls, C);
  for (let t = gridStart(cls, now); t > now - lookbackH * HOUR; t -= HOUR) {
    if (!expectedBar(cls, t, etf) || barEnd(cls, t, etf) > now) continue;
    const g = keyOf(t);
    if (!g) continue;
    let last = true;
    for (let t2 = t + HOUR; t2 < g.end; t2 += HOUR) if (keyOf(t2)?.key === g.key && expectedBar(cls, t2, etf)) { last = false; break; }
    if (last) return barEnd(cls, t, etf);
  }
  return null;
}
