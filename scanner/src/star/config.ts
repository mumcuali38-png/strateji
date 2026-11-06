// ⭐ kurulumlar — kilitli yapılandırma (config/star.json). Şartname: docs/kurulum_P_Portfoy_ortak_spec.md
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.ts';
import type { StarId, SymbolCfg } from '../types.ts';

/** Enstrüman sınıfı: cfd24 = XAU (Pazar 18:00 → Cuma 17:00, günlük ara), fx = döviz, etf = ABD borsa seansı, crypto = 7/24 */
export type StarCls = 'cfd24' | 'fx' | 'etf' | 'crypto';
export const STAR_IDS: StarId[] = ['M2', 'T4S', 'N7', 'IB', 'TD'];

export interface StarInstrument {
  source: 'td' | 'binance';
  td?: string; binance?: string; coinbase?: string;
  cls: StarCls; label: string; decimals: number; tick: number;
  ratioDefault?: number; ratioWeekly?: boolean; ratioMandatoryWeekly?: boolean;
}
export interface StarCommon {
  riskPct: number; riskMinPct: number; riskMaxPct: number; openRiskWarnPct: number;
  minBars24h: number; minBarsEtf: number; minBars4h24: number; minBars4hEtf: number;
  etfSessionNY: [string, string]; etfBlockSplitNY: string; sessionStartNY: string; sessionEndNY: string;
  staleHours: number; badTickAtr: number; badTickRetrace: number; jumpPct: Record<StarCls, number>;
  newsWarnMin: number; newsBlock: boolean; ratioMaxAgeDays: number; slipWarnR: number; slipWindow: number;
  regime: { emaFast: number; emaSlow: number; retDays: number; warmDays: number };
  atrPeriod: number;
}
export interface StarCredits {
  h1Output: number; fullOutput: number; deepOutput: number; deepPages24h: number; deepPagesEtf: number;
  keep1h: number; deepVersion?: number; retryMin: number; priceMin: number; priceSlowMin: number; slowAtPct: number; priority: string[];
}
export interface StarSetupCfg { name: string; title: string; doc: string; tf: '1h' | '4h' | '1d'; regime: boolean; symbols: string[]; p: Record<string, number> }
export interface StarConfig {
  locked: boolean; enabled: boolean;
  common: StarCommon; credits: StarCredits;
  instruments: Record<string, StarInstrument>;
  newSymbols: Record<string, SymbolCfg>;
  setups: Record<StarId, StarSetupCfg>;
  expectation: Record<string, unknown>;
}

const CONFIG_DIR = process.env.CONFIG_DIR || join(ROOT, 'config');
export function loadStar(): StarConfig {
  return JSON.parse(readFileSync(join(CONFIG_DIR, 'star.json'), 'utf8')) as StarConfig;
}
/** Bir enstrümanı kullanan ⭐ kurulumlar */
export function setupsOf(sc: StarConfig, sym: string): StarId[] {
  return STAR_IDS.filter((id) => sc.setups[id].symbols.includes(sym));
}
/** Rejim gereken enstrümanlar (M2, T4-S, TD) */
export function needsRegime(sc: StarConfig, sym: string): boolean {
  return setupsOf(sc, sym).some((id) => sc.setups[id].regime);
}
