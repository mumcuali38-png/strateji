// Kurulum F çalıştırıcı: veri çek → değerlendir → grafik + 5m kayıt (geçmiş değerlendirme için)
import type { Candle, NewsEvent, Setup } from '../types.ts';
import type { Config } from '../config.ts';
import { ema } from '../indicators.ts';
import { mergeCandles } from '../candles.ts';
import { readCandles, writeCandles, writeJSON } from '../store.ts';
import { fetchF, type FData } from './data.ts';
import { evalF } from './setup.ts';

export const F_CANDLE_KEY = 'BTCUSD_F';
const pack6 = (c: Candle[]) => c.map((x) => [x.t, x.o, x.h, x.l, x.c, x.v ?? 0]);

export function fChart(d: FData, now: number) {
  const e = ema(d.h4.map((x) => x.c), 50);
  return {
    t: now, symbol: 'BTCUSD_F', decimals: 1, source: d.source, volume: true,
    tfs: { '5m': pack6(d.m5), '15m': pack6(d.m15), '1h': pack6(d.h1), '4h': pack6(d.h4), '1d': pack6(d.d1) },
    ema50_4h: d.h4.map((x, i) => [x.t, e[i]]).filter((p) => Number.isFinite(p[1])),
  };
}

export async function runF(conf: Config, now: number, news: NewsEvent[], fetcher = fetchF): Promise<{ setups: Setup[]; errors: string[]; m5: Candle[]; source: string | null }> {
  const { data, errors } = await fetcher(now);
  const setups = evalF(conf, now, data, news, errors);
  let m5 = readCandles(F_CANDLE_KEY, '5min');
  if (data) {
    m5 = mergeCandles(m5, data.m5, conf.params.scan.keep5m);
    writeCandles(F_CANDLE_KEY, '5min', m5);
    writeJSON(`charts/${F_CANDLE_KEY}.json`, fChart(data, now));
  }
  return { setups, errors: data ? [] : errors, m5, source: data?.source ?? null };
}
