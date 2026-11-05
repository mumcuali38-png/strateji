import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Candle } from './types.ts';
import { pack, unpack } from './candles.ts';
import { ROOT } from './config.ts';

export const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'data-out');

export function readJSON<T>(name: string, fallback: T): T {
  const f = join(DATA_DIR, name);
  if (!existsSync(f)) return fallback;
  try { return JSON.parse(readFileSync(f, 'utf8')) as T; } catch { return fallback; }
}
export function writeJSON(name: string, v: unknown, pretty = false): void {
  const f = join(DATA_DIR, name);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, pretty ? JSON.stringify(v, null, 1) : JSON.stringify(v));
}
export type Interval = '1min' | '5min' | '1day';
export function readCandles(sym: string, interval: Interval): Candle[] {
  return unpack(readJSON<number[][]>(`candles/${sym}_${interval}.json`, []));
}
export function writeCandles(sym: string, interval: Interval, c: Candle[]): void {
  writeJSON(`candles/${sym}_${interval}.json`, pack(c));
}
