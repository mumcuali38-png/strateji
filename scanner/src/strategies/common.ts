import type { Condition, Dir } from '../types.ts';
import type { Ctx } from '../context.ts';
import { DIR_TXT } from '../structure.ts';

/** 4H trend + EMA50 filtresi (A ve B). Konsolidasyonda iki yön serbest, EMA yine yön seçer. */
export function htfFilter(ctx: Ctx): { allowed: Dir[]; structDirs: Dir[]; emaDir: Dir | 0; trendCond: (d: Dir) => Condition; emaCond: (d: Dir) => Condition } {
  const an = ctx.an('4h');
  const ema = ctx.ema4h();
  const price = ctx.price;
  const structDirs: Dir[] = an.consolidation ? [1, -1] : an.trend.dir ? [an.trend.dir] : [];
  const emaDir: Dir | 0 = Number.isFinite(ema) ? (price > ema ? 1 : -1) : 0;
  const allowed = structDirs.filter((d) => d === emaDir);
  const trendCond = (d: Dir): Condition => {
    if (an.c.length < 20) return { id: 'trend', label: '4H trend', status: 'wait', detail: 'Veri yetersiz (4H mum sayısı az)' };
    if (an.consolidation) return { id: 'trend', label: '4H trend', status: 'ok', detail: `Konsolidasyon — iki uç da kullanılabilir (${an.trend.label})` };
    if (!an.trend.dir) return { id: 'trend', label: '4H trend', status: 'fail', detail: `Trend ${an.trend.label}` };
    return an.trend.dir === d
      ? { id: 'trend', label: '4H trend', status: 'ok', detail: `Trend ${an.trend.label}` }
      : { id: 'trend', label: '4H trend', status: 'fail', detail: `Trende ters: trend ${DIR_TXT(an.trend.dir)} → sadece ${an.trend.dir === 1 ? 'long' : 'short'}` };
  };
  const emaCond = (d: Dir): Condition => {
    if (!emaDir) return { id: 'ema', label: '4H EMA50', status: 'wait', detail: 'EMA50 için 4H verisi yetersiz' };
    const txt = `Fiyat ${ctx.fmt(price)} · EMA50 ${ctx.fmt(ema)} ${emaDir === 1 ? 'üstünde' : 'altında'}`;
    return emaDir === d ? { id: 'ema', label: '4H EMA50', status: 'ok', detail: txt } : { id: 'ema', label: '4H EMA50', status: 'fail', detail: `${txt} → sadece ${emaDir === 1 ? 'long' : 'short'}` };
  };
  return { allowed, structDirs, emaDir, trendCond, emaCond };
}

export const dirWord = (d: Dir | 0) => (d === 1 ? 'LONG' : d === -1 ? 'SHORT' : '—');
export const beyond = (d: Dir, a: number, b: number) => (d === 1 ? a > b : a < b);
