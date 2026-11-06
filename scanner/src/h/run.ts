// KURULUM H çalıştırıcı: veri hazırla → değerlendir (§10 koruma dahil) → grafik + durum hafızası + açık işlem bildirimleri.
// XAU/US100: kayıtlı Twelve Data mumları (günlük 1day, 1h×1200 + 5m akışı) — ek kredi yok. BTC: Binance (ücretsiz).
import type { Candle, NewsEvent, Setup } from '../types.ts';
import type { Config } from '../config.ts';
import type { HistEvent } from '../history.ts';
import { aggregate, aggregateClosed, mergeCandles, splitClosed } from '../candles.ts';
import { readJSON, writeJSON } from '../store.ts';
import { ema } from '../indicators.ts';
import { HOUR, DAY } from '../time.ts';
import { annotateDeadlines } from '../deadline.ts';
import { closedOnly, parseBinance, type FTf } from '../f/data.ts';
import { h4G } from '../g/judas.ts';
import { mirror } from '../f/wyckoff.ts';
import { evalH, type HInput, type HMem, type HSym } from './setup.ts';
import { bos4h, last } from './core.ts';

export const H_SYMBOLS: HSym[] = ['XAUUSD', 'US100', 'BTCUSD'];
type SymData = { m5: Candle[]; d1: Candle[]; h1?: Candle[] };

/** XAU / US100 serileri: sadece kapanmış mumlar (§10.1) */
export function tdInput(sym: 'XAUUSD' | 'US100', d: SymData | undefined, now: number, qqqRatio?: number): HInput | null {
  if (!d || !d.m5.length) return null;
  const m5c = splitClosed(d.m5, '5m', now).closed;
  const h1 = mergeCandles((d.h1 ?? []).filter((x) => x.t + HOUR <= now), aggregateClosed(d.m5, '5m', '1h', now).closed, 1500);
  const m15 = aggregateClosed(d.m5, '5m', '15m', now).closed;
  const d1 = d.d1.filter((x) => x.t + DAY <= now);
  const h4 = sym === 'XAUUSD' ? h4G(h1).filter((x) => x.t + 4 * HOUR <= now) : aggregate(h1, '4h').filter((x) => x.t + 4 * HOUR <= now);
  void m5c;
  return { sym, d1, h4, h1, m15: m15.slice(-400), m5: d.m5, price: last(d.m5)?.c ?? null, source: 'Twelve Data', qqqRatio: sym === 'US100' ? qqqRatio : undefined };
}

async function getJSON(url: string): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'strateji-radar/1.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
/** BTC: Binance spot (anahtarsız). 1d×1000 (EMA200 ısınması 3n), 4h×1000, 1h×1000, 15m×400 + anlık fiyat */
export async function btcInput(now: number, m5: Candle[] = []): Promise<{ input: HInput | null; error?: string }> {
  try {
    const k = async (tf: FTf, n: number) => closedOnly(parseBinance(await getJSON(`https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=${tf}&limit=${n}`) as unknown[][]), tf, now);
    const [d1, h4, h1, m15] = [await k('1d', 1000), await k('4h', 1000), await k('1h', 1000), await k('15m', 400)];
    const t = await getJSON('https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT') as { price: string };
    return { input: { sym: 'BTCUSD', d1, h4, h1, m15, m5, price: Number(t.price) || null, source: 'Binance' } };
  } catch (e) { return { input: null, error: `Binance: ${(e as Error).message}` }; }
}

const pack = (c: Candle[]) => c.map((x) => [x.t, x.o, x.h, x.l, x.c]);
const series = (c: Candle[], v: number[]) => c.map((x, i) => [x.t, v[i]]).filter((p) => Number.isFinite(p[1]));
export function hChart(inp: HInput, now: number) {
  const c1 = inp.h1.map((x) => x.c);
  const h1 = inp.h1.slice(-500);
  const e20 = ema(c1, 20).slice(-500), e50 = ema(c1, 50).slice(-500);
  const e4 = ema(inp.h4.map((x) => x.c), 50);
  return {
    t: now, symbol: `${inp.sym}_H`, decimals: inp.sym === 'BTCUSD' ? 1 : 2, source: inp.source,
    tfs: { '15m': pack(inp.m15.slice(-300)), '1h': pack(h1), '4h': pack(inp.h4.slice(-300)), '1d': pack(inp.d1.slice(-300)) },
    ema50_4h: series(inp.h4, e4).slice(-300),
    lines: [{ name: 'EMA20 (1H)', tf: '1h', color: '--info', pts: series(h1, e20) }, { name: 'EMA50 (1H)', tf: '1h', color: '--eksik', pts: series(h1, e50) }],
  };
}

/**
 * Açık H işleminde trend sonu (§8): 4H kapanış EMA50'nin ters tarafında veya ters 4H BOS → "kalanı kapat".
 * İşlem takibi tarama geçmişinden (history.json → track ACIK).
 */
function trendEndNotices(inp: HInput, hist: HistEvent[]): NonNullable<Setup['notices']> {
  const out: NonNullable<Setup['notices']> = [];
  for (const h of hist) {
    if (h.strategy !== 'H' || h.symbol !== inp.sym || h.kind !== 'TAM' || h.track?.status !== 'ACIK') continue;
    const D = h.dir === 1 ? inp.h4 : mirror(inp.h4);
    const e = last(ema(D.map((x) => x.c), 50)), c = last(D);
    const b = bos4h(D);
    const revBos = b.dir === -1 && b.t !== null && b.t >= (h.track?.events[0]?.t ?? h.t);
    if (c && e !== undefined && (c.c < e || revBos)) out.push({ key: `${h.id}+TRENDSON`, title: `⛔ H · ${inp.sym === 'XAUUSD' ? 'XAU' : inp.sym === 'US100' ? 'US100' : 'BTC'} ÇIKIŞ`, body: revBos ? 'H: ters 4H BOS — kalanı kapat' : 'H: 4H EMA50 kırıldı — kalanı kapat' });
  }
  return out;
}

export async function runH(conf: Config, now: number, opts: { data: Record<string, SymData>; news: NewsEvent[]; others: Setup[]; hist: HistEvent[]; symbols?: HSym[]; btcM5?: Candle[]; btc?: (now: number, m5: Candle[]) => Promise<{ input: HInput | null; error?: string }> }): Promise<{ setups: Record<string, Setup[]>; errors: string[] }> {
  const mem = readJSON<Record<string, HMem>>('h-state.json', {});
  const out: Record<string, Setup[]> = {}, errors: string[] = [];
  for (const sym of opts.symbols ?? H_SYMBOLS) {
    let inp: HInput | null;
    if (sym === 'BTCUSD') { const r = await (opts.btc ?? btcInput)(now, opts.btcM5 ?? []); inp = r.input; if (r.error) errors.push(`H ${r.error}`); }
    else inp = tdInput(sym, opts.data[sym], now, conf.params.us100PerQqq);
    const r = evalH(conf, inp, now, opts.news, mem[sym] ?? {}, opts.others, sym);
    mem[sym] = r.mem;
    if (inp) {
      r.setup.notices = [...(r.setup.notices ?? []), ...trendEndNotices(inp, opts.hist)];
      writeJSON(`charts/${sym}_H.json`, hChart(inp, now));
    }
    annotateDeadlines(conf, [r.setup], now);
    out[sym] = [r.setup];
  }
  writeJSON('h-state.json', mem);
  return { setups: out, errors };
}
