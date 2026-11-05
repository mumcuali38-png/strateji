import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SymbolCfg, TF, StrategyId } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, '..', '..');
const CONFIG_DIR = process.env.CONFIG_DIR || join(ROOT, 'config');

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(CONFIG_DIR, name), 'utf8')) as T;
}

export interface Params {
  risk: { riskPct: number; minRR: number; balance: number; currency: string; maxTradesPerDay: number | null; maxDailyLossPct: number | null };
  swing: Record<TF, number>;
  displacementMult: number;
  displacementLookback: number;
  strongBodyRatio: number;
  atrPeriod: number;
  emaTrend: number;
  equalTolAtr: number;
  fvgMinAtr: number;
  targetMinAtr15m: number;
  consolidation: { bars: number; maxBos: number; rangeAtrMult: number };
  trend: { minBos: number; strongBos: number };
  news: { beforeMin: number; afterMin: number; currencies: string[] };
  A: { maxOutsideBars: number; maxExcursionAtr1h: number; lineLifeCandles: number; signalValidityBars: number };
  B: { zoneTfs: TF[]; zonesPerTf: number; maxZoneDistAtr: number; liqMinAtr: number; liqMaxAtr: number; confirmMaxBars: number; confirmMaxDistAtr: number; mitigationMaxHeightAtr: number; signalValidityBars: number };
  C: { tnmCandleMode: 'from10' | 'aligned'; maxTradesPerDay: number; stdv: number[] };
  D: {
    d1: { momentumBodyPct: number; rejectWickBody: number; retestTolAtr1m: number; maxPerDay: number };
    d2: { tfs: TF[]; minBars: number; maxBars: number; minTests: number; narrowAtrMult: number; edgeZoneAtr: number; confirmMaxBars: number; signalValidityBars: number; breakoutValidityBars: number };
  };
  E: { tfs: TF[]; maxCandles: number; limitInsidePct: number; fib: number[]; lookbackBars: number; returnMaxBars: number };
  extra: { rsiPeriod: number; rsiHigh: number; rsiLow: number; emaLong: number; macd: number[]; bb: number[]; kc: number[] };
  scan: {
    windowTR: [string, string]; oneMinuteTR: [string, string]; qqqTR: [string, string]; weekdays: number[];
    cryptoWeekend: boolean; intervalMin: number; creditDailyLimit: number; creditHardStop: number; perMinute: number;
    incrementalOutput: number; maxIncrementalOutput: number; bootstrap5m: number; bootstrap1d: number; bootstrap1dSymbols: string[];
    keep5m: number; keep1m: number; preWindowTR: [string, string]; preWindowSymbols: string[]; bootstrap1h: number; bootstrap1hSymbols: string[]; fxPairs: string[]; directionDaily?: string[]; priority: string[]; oneMinuteSymbols: string[]; staleWarnMin: number; staleErrorMin: number;
  };
  history: { days: number; evalMaxBars5m: number };
  general: { maxSignalAgeHours: number; maxEntryDistR: number };
  G: { minAsiaBars: number; emaWarm: number; rangeMin: number; rangeMax: number; earlyMax: number; backInsideBars: number; dispBody: number; bufferPct: number; roundStep: number; roundDist: number; minRR1: number; minRR2: number; newsExitMin: number; smt: boolean };
  F: {
    ltf: '15m' | '5m'; springLookback1h: number; chochMaxHours: number; phaseCBars: number; lpsSosBars: number;
    trLookback: number; trMinBars: number; trMinAtr: number; trMaxAtr: number; trInsidePct: number; priorTrendBars: number; priorTrendAtr: number;
    staleBars: number; deleteBars: number; springMaxDepthAtr: number; rvLow: number; rvHigh: number; cpStrong: number;
    stopAtr: number; minRR3: number; minRR2: number; lpsMinRR: number; trMiddlePct: number; zoneDistAtr4h: number;
    bestWindowUTC: [string, string]; fundingUTC: string[]; fundingBlockMin: number; liqAtrMult: number; liqBarAtr: number; liqWaitBars: number; maxLeverage: number; maxDataAgeMin: number;
  };
  us100PerQqq: number;
}

export interface Sessions {
  killzones: { id: string; name: string; start: string; end: string }[];
  strategyKillzones: Partial<Record<StrategyId, string[]>>;
  C: { start: string; end: string };
  D1: { rangeStart: string; rangeEnd: string; entryEnd: string };
}

export interface Config { params: Params; symbols: Record<string, SymbolCfg>; sessions: Sessions }

export function loadConfig(): Config {
  return { params: load<Params>('params.json'), symbols: load<Record<string, SymbolCfg>>('symbols.json'), sessions: load<Sessions>('sessions.json') };
}
