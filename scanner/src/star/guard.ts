// ⭐ ortak hatalı sinyal koruması (ortak şartname §7.1–7.10). Her ⭐ kurulum bunu uygular, kendi maddelerini ekler.
import type { Candle, NewsEvent } from '../types.ts';
import { HOUR, MIN } from '../time.ts';
import { cleanBadTicks } from '../h/core.ts';
import type { StarCls, StarCommon } from './config.ts';
import { barEnd, expectedBar, lastExpectedEnd } from './sessions.ts';

/** §7.5 Kötü tick: 1H aralığı > 5 × ATR14_1H ve sonraki mum hareketin > %50'sini geri aldıysa çıkar (H §10.5 ile aynı kural) */
export function removeBadTicks(h1: Candle[], k: number): { clean: Candle[]; removed: number[] } {
  return cleanBadTicks(h1, k);
}

/** §7.4 Veri tazeliği: son kapanmış 1H mum, beklenen son mumdan staleHours'tan fazla gerideyse "VERİ GECİKMESİ" */
export function freshness(cls: StarCls, h1: Candle[], now: number, staleHours: number, etf?: [string, string], expected?: number | null): { fresh: boolean; lagMin: number; lastBarEnd: number | null; expectedEnd: number | null } {
  const last = h1[h1.length - 1];
  const lastBarEnd = last ? barEnd(cls, last.t, etf) : null;
  // Beklenen: kurulumların ihtiyaç duyduğu son kapanış (1h / 4h / seans günü). Verilmezse son 1H kapanışı.
  const expectedEnd = expected !== undefined ? expected : lastExpectedEnd(cls, now, etf);
  if (expectedEnd === null) return { fresh: !!last, lagMin: 0, lastBarEnd, expectedEnd };
  if (lastBarEnd === null) return { fresh: false, lagMin: Infinity, lastBarEnd, expectedEnd };
  const lag = expectedEnd - lastBarEnd;
  return { fresh: lag <= staleHours * HOUR, lagMin: Math.max(0, Math.round(lag / MIN)), lastBarEnd, expectedEnd };
}

/**
 * §7.6 Eksik mum: hesap penceresindeki (son `window` mum) beklenmeyen boşluklar. Hafta sonu ve seans dışı beklenen boşluktur;
 * kötü tick olarak çıkarılan mumlar eksik sayılmaz.
 */
export function missingBars(cls: StarCls, h1: Candle[], window: number, removed: number[] = [], etf?: [string, string]): number[] {
  const rm = new Set(removed);
  const out: number[] = [];
  for (let i = Math.max(1, h1.length - window); i < h1.length; i++) {
    for (let t = h1[i - 1].t + HOUR; t < h1[i].t; t += HOUR) if (expectedBar(cls, t, etf) && !rm.has(t)) out.push(t);
  }
  return out;
}

/** §7.5 Anlık fiyat ile son kapanış farkı > %0,3 (XAU, FX, ETF) / > %1 (kripto) → bir sonraki taramayı bekle */
export function priceJump(cls: StarCls, price: number | null, lastClose: number | undefined, C: Pick<StarCommon, 'jumpPct'>): boolean {
  if (price === null || lastClose === undefined || !(lastClose > 0)) return false;
  return Math.abs(price / lastClose - 1) * 100 > C.jumpPct[cls];
}

/** §7.7 Benzersiz sinyal kimliği: {kurulum}-{sembol}-{sinyal mumu UTC} */
export function signalId(name: string, sym: string, barT: number): string {
  return `${name}-${sym}-${new Date(barT).toISOString().replace('.000Z', 'Z')}`;
}

export interface Pending { sig: string; t: number; seq: 1 | 2 }
/**
 * §7.3 Çift tarama teyidi: sinyal, kapanıştan sonraki iki ardışık 5 dk taramada (veri yeniden çekilerek) aynı sonucu vermeli.
 * `sig` = sonucun özeti (yön + seviyeler). İlk görüş → seq 1 (TAM – BEKLE), sonraki taramada aynı → seq 2 (TAM).
 * Sonuç değişirse teyit baştan başlar. Aynı tarama zamanı iki kez sayılmaz.
 */
export function doubleScan(mem: Record<string, Pending>, id: string, sig: string, scanT: number, minGapMs = 2 * MIN): Pending {
  const p = mem[id];
  if (!p || p.sig !== sig) return (mem[id] = { sig, t: scanT, seq: 1 });
  if (p.seq === 1 && scanT - p.t >= minGapMs) return (mem[id] = { sig, t: scanT, seq: 2 });
  return p;
}

/** §7.8 Son kontrol: fiyat sinyal kapanışından yön lehine eşikten fazla ilerlediyse "KAÇTI" */
export function kacti(dir: 1 | -1, ref: number, price: number | null, threshold: number): boolean {
  return price !== null && dir * (price - ref) > threshold;
}

/**
 * §7.9 Haber: testte haber filtresi yoktu → giriş engellenmez. Kırmızı USD haberine ≤ 30 dk varsa "HABER RİSKİ" etiketi.
 * `block` (Ayarlar, varsayılan kapalı) açılırsa engeller ve ⭐ yanına "(H)" eklenir — test dışı kullanım.
 */
export function newsRisk(events: NewsEvent[], now: number, C: Pick<StarCommon, 'newsWarnMin'>): { risk: boolean; event?: NewsEvent; minutes?: number } {
  const e = events.filter((x) => x.impact === 'High' && x.currency === 'USD' && x.t >= now && x.t - now <= C.newsWarnMin * MIN).sort((a, b) => a.t - b.t)[0];
  return e ? { risk: true, event: e, minutes: Math.round((e.t - now) / MIN) } : { risk: false };
}
