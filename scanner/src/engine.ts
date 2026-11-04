import type { Candle, NewsEvent, Setup, StrategyId } from './types.ts';
import type { Config } from './config.ts';
import { Ctx } from './context.ts';
import { evalA } from './strategies/a.ts';
import { evalB } from './strategies/b.ts';
import { evalC } from './strategies/c.ts';
import { evalD } from './strategies/d.ts';
import { evalE } from './strategies/e.ts';

export type SymData = { m5: Candle[]; m1: Candle[]; d1: Candle[] };
export type Results = Record<StrategyId, Record<string, Setup[]>>;
export const STRATEGIES: StrategyId[] = ['A', 'B', 'C', 'D', 'E'];

export function runEngine(conf: Config, now: number, data: Record<string, SymData>, news: NewsEvent[], prior: { strategy: string; symbol: string; id: string; t: number }[] = []): { results: Results; ctxs: Record<string, Ctx>; errors: string[] } {
  const results = { A: {}, B: {}, C: {}, D: {}, E: {} } as Results;
  const ctxs: Record<string, Ctx> = {};
  const errors: string[] = [];
  for (const [sym, cfg] of Object.entries(conf.symbols)) {
    const d = data[sym];
    if (!d || d.m5.length < 50) { errors.push(`${sym}: yetersiz veri (${d?.m5.length ?? 0} adet 5m mum)`); continue; }
    const ctx = new Ctx(sym, conf, now, d, news);
    ctxs[sym] = ctx;
    for (const s of cfg.strategies) {
      try {
        const r = s === 'A' ? evalA(ctx) : s === 'B' ? evalB(ctx) : s === 'C' ? evalC(ctx, prior.filter((x) => x.strategy === 'C' && x.symbol === sym)) : s === 'D' ? evalD(ctx) : evalE(ctx);
        results[s][sym] = r;
      } catch (e) {
        errors.push(`${s}/${sym}: ${(e as Error).message}`);
        console.error(e);
      }
    }
  }
  return { results, ctxs, errors };
}
