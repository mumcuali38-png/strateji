import type { Setup, StrategyId, NewsFile } from './types.ts';
import type { Config } from './config.ts';
import type { Results } from './engine.ts';
import type { Ctx } from './context.ts';
import type { Credits } from './twelvedata.ts';
import { pack } from './candles.ts';
import { readJSON } from './store.ts';
import type { TF } from './types.ts';

export const VERSION = 1;

export function buildState(conf: Config, now: number, res: Results, ctxs: Record<string, Ctx>, credits: Credits, news: NewsFile | null, extra: { errors: string[]; warnings: string[]; fetched: string[]; window: Record<string, unknown> }) {
  const strategies: Record<string, Record<string, Setup[]>> = {};
  let tam = 0, ready = 0;
  for (const [s, bySym] of Object.entries(res)) {
    strategies[s] = {};
    for (const [sym, list] of Object.entries(bySym)) {
      strategies[s][sym] = list.slice(0, 5);
      tam += list.filter((x) => x.status === 'TAM' || x.status === 'BEKLE').length;
      ready += list.filter((x) => x.status === 'EKSIK' && x.remaining === 1).length;
    }
  }
  const symbols: Record<string, unknown> = {};
  for (const [sym, cfg] of Object.entries(conf.symbols)) {
    const c = ctxs[sym];
    symbols[sym] = {
      label: cfg.label, name: cfg.name, decimals: cfg.decimals, strategies: cfg.strategies,
      price: c ? c.price : null, lastBar: c ? c.lastBarTime : null,
      newsRisk: c ? c.newsRisk() : null,
      atr: c ? { '5m': c.atr('5m'), '1h': c.atr('1h') } : null,
    };
  }
  return {
    version: VERSION, generatedAt: now, lastScan: now, fScan: now,
    window: extra.window,
    credits: { date: credits.date, used: credits.used, hardStop: credits.hardStop, limit: conf.params.scan.creditDailyLimit, exhausted: !!credits.exhausted, lastHeaders: credits.lastHeaders, days: credits.days },
    vapidPublic: process.env.VAPID_PUBLIC || null,
    params: { risk: conf.params.risk, us100PerQqq: conf.params.us100PerQqq, news: conf.params.news, F: { maxLeverage: conf.params.F.maxLeverage, ltf: conf.params.F.ltf } },
    newsMeta: news ? { fetchedAt: news.fetchedAt, ffFetchedAt: news.ffFetchedAt, stale: news.stale, fmp: news.fmp } : null,
    summary: { tam, ready },
    symbols, strategies: strategies as Record<StrategyId, Record<string, Setup[]>>,
    fx: readJSON<Record<string, { rate: number; t: number }>>('fx.json', {}),
    fetched: extra.fetched, errors: extra.errors, warnings: extra.warnings,
  };
}

const CHART_BARS: Partial<Record<TF, number>> = { '1m': 300, '5m': 400, '15m': 300, '1h': 300, '4h': 200, '1d': 150 };
export function buildChart(ctx: Ctx, now: number) {
  const tfs: Record<string, number[][]> = {};
  for (const [tf, n] of Object.entries(CHART_BARS) as [TF, number][]) {
    if (tf === '1m' && (!ctx.base1.length || now - ctx.base1[ctx.base1.length - 1].t > 86400_000)) continue;
    const s = ctx.series(tf);
    const arr = [...s.closed.slice(-n), ...(s.live ? [s.live] : [])];
    tfs[tf] = pack(arr).map((r) => r.slice(0, 5));
  }
  return { t: now, symbol: ctx.sym, decimals: ctx.dec, tfs, ema50_4h: ctx.ema4hSeries().slice(-200) };
}
