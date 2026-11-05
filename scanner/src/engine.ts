import type { Candle, NewsEvent, Setup, StrategyId } from './types.ts';
import type { Config } from './config.ts';
import { Ctx } from './context.ts';
import { evalA } from './strategies/a.ts';
import { evalB } from './strategies/b.ts';
import { evalC } from './strategies/c.ts';
import { evalD } from './strategies/d.ts';
import { evalE } from './strategies/e.ts';
import { evalG } from './g/judas.ts';

export type SymData = { m5: Candle[]; m1: Candle[]; d1: Candle[]; h1?: Candle[] };
export type Results = Record<StrategyId, Record<string, Setup[]>>;
export const STRATEGIES: StrategyId[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

export function runEngine(conf: Config, now: number, data: Record<string, SymData>, news: NewsEvent[], prior: { strategy: string; symbol: string; id: string; t: number }[] = []): { results: Results; ctxs: Record<string, Ctx>; errors: string[] } {
  const results = { A: {}, B: {}, C: {}, D: {}, E: {}, F: {}, G: {} } as Results;
  const ctxs: Record<string, Ctx> = {};
  const errors: string[] = [];
  for (const [sym, cfg] of Object.entries(conf.symbols)) {
    const d = data[sym];
    if (!d) continue;
    if (d.m5.length < 50) { errors.push(`${sym}: yetersiz veri (${d?.m5.length ?? 0} adet 5m mum)`); continue; }
    const ctx = new Ctx(sym, conf, now, d, news);
    ctxs[sym] = ctx;
    for (const s of cfg.strategies) {
      if (s === 'F') continue; // F ayrı veriyle (Binance) f/run.ts içinde
      try {
        const r = s === 'A' ? evalA(ctx) : s === 'B' ? evalB(ctx) : s === 'C' ? evalC(ctx, prior.filter((x) => x.strategy === 'C' && x.symbol === sym)) : s === 'D' ? evalD(ctx) : s === 'G' ? evalG(conf, ctx, d.h1 ?? [], news) : evalE(ctx);
        results[s][sym] = r;
      } catch (e) {
        errors.push(`${s}/${sym}: ${(e as Error).message}`);
        console.error(e);
      }
    }
  }
  mergeGB(results);
  return { results, ctxs, errors };
}

/** G ve B aynı gün aynı yönde TAM ise tek işlem sayılır (çift risk yok): G "B ile birleşik" işaretlenir, ayrı TAM bildirimi gitmez. */
export function mergeGB(results: Results): void {
  const g = results.G?.XAUUSD?.[0];
  if (!g || (g.status !== 'TAM' && g.status !== 'BEKLE')) return;
  const b = (results.B?.XAUUSD ?? []).find((x) => (x.status === 'TAM' || x.status === 'BEKLE') && x.dir === g.dir);
  if (!b) return;
  g.info = { ...(g.info ?? {}), mergedWithB: b.id };
  g.warnings = [...(g.warnings ?? []), 'Aynı fikir — B ile birleşik: tek işlem sayılır (çift risk yok)'];
  g.tags = [...(g.tags ?? []), 'B ile birleşik'];
}
