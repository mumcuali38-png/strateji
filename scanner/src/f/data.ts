// Kurulum F veri kaynağı: Binance (BTCUSDT, anahtar gerekmez), yedek Coinbase (BTC-USD).
// Sadece kapanmış mumlar döner. Twelve Data kredisi harcanmaz.
import type { Candle } from '../types.ts';
import { HOUR, MIN, DAY } from '../time.ts';

export type FTf = '5m' | '15m' | '1h' | '4h' | '1d';
export interface FData { d1: Candle[]; h4: Candle[]; h1: Candle[]; m15: Candle[]; m5: Candle[]; source: 'binance' | 'coinbase' }

export const F_MS: Record<FTf, number> = { '5m': 5 * MIN, '15m': 15 * MIN, '1h': HOUR, '4h': 4 * HOUR, '1d': DAY };
const LIMITS: Record<FTf, number> = { '1d': 120, '4h': 300, '1h': 300, '15m': 300, '5m': 300 };

async function getJSON(url: string): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'strateji-radar/1.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Kapanmamış (canlı) mumu çıkar: açılış + TF süresi > now ise açıktır */
export function closedOnly(c: Candle[], tf: FTf, now: number): Candle[] {
  return c.filter((x) => x.t + F_MS[tf] <= now);
}

export function parseBinance(rows: unknown[][]): Candle[] {
  return rows.map((r) => ({ t: Number(r[0]), o: +String(r[1]), h: +String(r[2]), l: +String(r[3]), c: +String(r[4]), v: +String(r[5]) }))
    .filter((x) => [x.o, x.h, x.l, x.c, x.v].every(Number.isFinite)).sort((a, b) => a.t - b.t);
}
/** Coinbase: [time(s), low, high, open, close, volume] — sıra farklı */
export function parseCoinbase(rows: number[][]): Candle[] {
  return rows.map((r) => ({ t: r[0] * 1000, l: r[1], h: r[2], o: r[3], c: r[4], v: r[5] })).sort((a, b) => a.t - b.t);
}
/** UTC sınırlarında toplama (Coinbase'de 4H yok → 1H'ten) */
export function aggregateUTC(c: Candle[], ms: number): Candle[] {
  const out: Candle[] = [];
  for (const x of c) {
    const b = Math.floor(x.t / ms) * ms;
    const cur = out[out.length - 1];
    if (!cur || cur.t !== b) out.push({ ...x, t: b });
    else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.v = (cur.v ?? 0) + (x.v ?? 0); }
  }
  return out;
}

async function binance(now: number): Promise<FData> {
  const get = async (tf: FTf) => closedOnly(parseBinance(await getJSON(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=${tf}&limit=${LIMITS[tf] + 1}`) as unknown[][]), tf, now);
  const [d1, h4, h1, m15, m5] = await Promise.all((['1d', '4h', '1h', '15m', '5m'] as FTf[]).map(get));
  return { d1, h4, h1, m15, m5, source: 'binance' };
}
async function coinbase(now: number): Promise<FData> {
  const get = async (g: number) => parseCoinbase(await getJSON(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${g}`) as number[][]);
  const [d1, h1, m15, m5] = await Promise.all([86400, 3600, 900, 300].map(get));
  return {
    d1: closedOnly(d1, '1d', now), h1: closedOnly(h1, '1h', now), m15: closedOnly(m15, '15m', now), m5: closedOnly(m5, '5m', now),
    h4: closedOnly(aggregateUTC(h1, 4 * HOUR), '4h', now), source: 'coinbase',
  };
}

/** Binance → olmazsa Coinbase → ikisi de yoksa null (VERİ YOK). */
export async function fetchF(now = Date.now()): Promise<{ data: FData | null; errors: string[] }> {
  const errors: string[] = [];
  for (const [name, f] of [['Binance', binance], ['Coinbase', coinbase]] as const) {
    try {
      const d = await f(now);
      if (d.h1.length < 60 || d.h4.length < 60) throw new Error(`yetersiz mum (1H ${d.h1.length}, 4H ${d.h4.length})`);
      return { data: d, errors };
    } catch (e) { errors.push(`${name}: ${(e as Error).message}`); }
  }
  return { data: null, errors };
}
