/**
 * Piyasa Yönü skorları (EK §5): her bileşen s ∈ [−1, +1], S = Σ(w·s)/Σw (verisi olmayan
 * bileşenin ağırlığı diğerlerine oransal dağılır), Skor = round(50 + 50·S).
 */
import type { Candle } from '../types.ts';
import { ema, rsi, macd } from '../indicators.ts';

export const clip = (x: number, a = 1) => Math.max(-a, Math.min(a, x));
export type S = number | null;

/** Alt parçaları ağırlıkla birleştirir; hepsi yoksa null (bileşen "veri yok") */
export function mix(parts: [number, S][]): S {
  const ok = parts.filter(([, s]) => s !== null && Number.isFinite(s as number)) as [number, number][];
  const W = ok.reduce((a, [w]) => a + w, 0);
  return W > 0 ? ok.reduce((a, [w, s]) => a + w * s, 0) / W : null;
}

/** Trend (tek TF): close/EMA50/EMA200 dizilimi */
export function trendTF(c: Candle[]): S {
  if (c.length < 200) return null;
  const cl = c.map((x) => x.c);
  const e50 = ema(cl, 50).at(-1)!, e200 = ema(cl, 200).at(-1)!, p = cl.at(-1)!;
  if (p > e50) return e50 > e200 ? 1 : 0.5;
  return e50 > e200 ? -0.5 : -1;
}
/** Yapı (tek TF): son 50 mumda kapanışla kırılan en son pivotun (N=3) yönü */
export function structTF(c: Candle[], N = 3, look = 50): S {
  if (c.length < 2 * N + 5) return null;
  const isPH = (j: number) => { for (let k = 1; k <= N; k++) if (c[j - k].h > c[j].h || c[j + k].h > c[j].h) return false; return true; };
  const isPL = (j: number) => { for (let k = 1; k <= N; k++) if (c[j - k].l < c[j].l || c[j + k].l < c[j].l) return false; return true; };
  let ph: number | null = null, pl: number | null = null, last = 0;
  const from = Math.max(N, c.length - look - 60);
  for (let i = from + N + 1; i < c.length; i++) {
    const j = i - N - 1; // i anında onaylanmış pivot (sağında N mum)
    if (j >= N && isPH(j)) ph = c[j].h;
    if (j >= N && isPL(j)) pl = c[j].l;
    if (ph !== null && c[i].c > ph) { if (i >= c.length - look) last = 1; ph = null; }
    if (pl !== null && c[i].c < pl) { if (i >= c.length - look) last = -1; pl = null; }
  }
  return last;
}
const tfMix = (d: S, h4: S, h1: S) => mix([[0.5, d], [0.3, h4], [0.2, h1]]);
export function trend(d1: Candle[], h4: Candle[], h1: Candle[]): S { return tfMix(trendTF(d1), trendTF(h4), trendTF(h1)); }
export function structure(d1: Candle[], h4: Candle[], h1: Candle[]): S { return tfMix(structTF(d1), structTF(h4), structTF(h1)); }
export function momentum(d1: Candle[], h4: Candle[]): S {
  const r = (c: Candle[]) => (c.length > 30 ? clip((rsi(c.map((x) => x.c), 14).at(-1)! - 50) / 25) : null);
  const rr = mix([[1, r(d1)], [1, r(h4)]]);
  let m: S = null;
  if (h4.length > 40) {
    const h = macd(h4.map((x) => x.c)).hist, a = h.at(-1)!, b = h.at(-2)!;
    m = a > 0 ? (a >= b ? 1 : 0.5) : (a >= b ? -0.5 : -1);
  }
  return mix([[0.6, rr], [0.4, m]]);
}
/** Bizim kurulumlar: TAM ±1, 1 şart kaldı ±0,5, diğer EKSİK ±0,25; ortalama; yoksa 0 */
export function ourSetups(list: { status: string; remaining: number; dir: number }[]): number {
  const v = list.filter((s) => s.dir && (s.status === 'TAM' || s.status === 'BEKLE' || s.status === 'EKSIK'))
    .map((s) => s.dir * (s.status === 'TAM' || s.status === 'BEKLE' ? 1 : s.remaining === 1 ? 0.5 : 0.25));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}
/** COT: net spekülatif pozisyonun 4 haftalık değişimi / son 52 değişimin std'si; |z| > 2 → ters düzeltme */
export function cotScore(netAsc: number[]): { s: S; z?: number } {
  if (netAsc.length < 30) return { s: null };
  const ch = netAsc.slice(4).map((x, i) => x - netAsc[i]);
  const last = ch.at(-1)!, win = ch.slice(-52);
  const mean = win.reduce((a, b) => a + b, 0) / win.length;
  const sd = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length);
  if (!(sd > 0)) return { s: 0, z: 0 };
  const z = last / sd;
  return { s: z > 2 ? -0.5 : z < -2 ? 0.5 : clip(z), z };
}
export const retailScore = (longPct: number) => -clip((longPct - 50) / 30);
/** OI: fiyat↑OI↑ +1, fiyat↑OI↓ +0,3, fiyat↓OI↓ −0,3, fiyat↓OI↑ −1 */
export const oiScore = (dp: number, doi: number) => (dp >= 0 ? (doi >= 0 ? 1 : 0.3) : (doi < 0 ? -0.3 : -1));
/** Funding (8 saatlik, %) */
export function fundingScore(pct: number): number {
  if (pct < -0.01) return 0.3;
  if (pct < 0) return 0;
  if (pct < 0.01) return 0.3;
  if (pct < 0.03) return 0;
  if (pct <= 0.07) return -0.5;
  return -1;
}
export const lsScore = (ratio: number) => clip((ratio - 1) / 0.5);
export function fngScore(v: number): number { return v <= 20 ? 0.7 : v < 40 ? -0.3 : v < 60 ? 0 : v < 80 ? 0.3 : -0.7; }

/** Haber olay yönü (§5.6): +1 "gerçek > beklenti" para birimi için olumlu, −1 olumsuz, 0 tabloda yok */
export function eventDir(title: string): number {
  if (/unemployment|jobless|claimant/i.test(title)) return -1;
  if (/cpi|pce|ppi|non-farm|nfp|adp|retail sales|gdp|ism|pmi|rate decision|interest rate|cash rate|bank rate|refinancing|funds rate/i.test(title)) return 1;
  return 0;
}
export function parseNum(s?: string): number | null {
  if (!s) return null;
  const m = /(-?\d+(?:\.\d+)?)/.exec(s.replace(/,/g, ''));
  return m ? Number(m[1]) : null;
}
/** Para birimi sürprizinin pariteye etkisi: EURUSD/GBPUSD için baz +, USD −; XAU için USD − */
export function pairEffect(sym: string, cur: string): number {
  if (sym === 'EURUSD') return cur === 'EUR' ? 1 : cur === 'USD' ? -1 : 0;
  if (sym === 'GBPUSD') return cur === 'GBP' ? 1 : cur === 'USD' ? -1 : 0;
  if (sym === 'XAUUSD' || sym === 'XAGUSD') return cur === 'USD' ? -1 : 0;
  return 0;
}

export interface Comp { id: string; name: string; w: number; s: S; note: string }
export function combine(comps: Comp[]): { score: number | null; label: string; missing: string[] } {
  const ok = comps.filter((c) => c.s !== null);
  const W = ok.reduce((a, c) => a + c.w, 0);
  const missing = comps.filter((c) => c.s === null).map((c) => `${c.name} verisi yok`);
  if (!(W > 0)) return { score: null, label: 'VERİ YOK', missing };
  const S = ok.reduce((a, c) => a + c.w * (c.s as number), 0) / W;
  const score = Math.round(50 + 50 * S);
  return { score, label: labelOf(score), missing };
}
export function labelOf(score: number): string {
  return score >= 80 ? 'Güçlü Bullish' : score >= 60 ? 'Bullish' : score >= 41 ? 'Nötr' : score >= 21 ? 'Bearish' : 'Güçlü Bearish';
}
