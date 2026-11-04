import type { Candle } from './types.ts';
import { parseTD } from './candles.ts';
import { utcDateStr } from './time.ts';
import type { Params } from './config.ts';

export interface Credits {
  date: string;
  used: number;
  hardStop: number;
  bootstrapDate?: string;
  exhausted?: boolean;
  lastHeaders?: { used?: string | null; left?: string | null; at: number };
  log: { t: number; sym: string; interval: string; size: number; ok: boolean; err?: string }[];
  days: { date: string; used: number }[];
}

export function freshCredits(prev: Credits | null, now: number, p: Params): Credits {
  const date = utcDateStr(now); // Twelve Data günlük sıfırlaması UTC 00:00
  if (prev && prev.date === date) return { ...prev, hardStop: p.scan.creditHardStop };
  const days = [...(prev?.days ?? [])];
  if (prev) days.push({ date: prev.date, used: prev.used });
  return { date, used: 0, hardStop: p.scan.creditHardStop, bootstrapDate: prev?.bootstrapDate, log: [], days: days.slice(-14) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TwelveData {
  private times: number[] = [];
  constructor(private key: string, private credits: Credits, private p: Params, private clock: () => number = Date.now) {}

  get remaining(): number { return this.credits.hardStop - this.credits.used; }

  /** Dakikada en fazla perMinute istek; günlük sert sınır creditHardStop. 429 → bir sonraki dakikaya kadar bekle, tekrar deneme. */
  async series(sym: string, tdSymbol: string, interval: '1min' | '5min' | '1day', outputsize: number): Promise<{ candles: Candle[]; error?: string }> {
    if (this.credits.used >= this.credits.hardStop) { this.credits.exhausted = true; return { candles: [], error: 'kredi bitti' }; }
    const now = this.clock();
    this.times = this.times.filter((t) => now - t < 60_000);
    if (this.times.length >= this.p.scan.perMinute) {
      const wait = 60_000 - (now - this.times[0]) + 1500;
      console.log(`  ⏱  dakika sınırı — ${Math.ceil(wait / 1000)} sn bekleniyor`);
      await sleep(wait);
    }
    const url = new URL('https://api.twelvedata.com/time_series');
    url.searchParams.set('symbol', tdSymbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('outputsize', String(outputsize));
    url.searchParams.set('timezone', 'UTC'); // her istekte UTC — dönüşüm kodda yapılır
    url.searchParams.set('order', 'asc');
    url.searchParams.set('format', 'JSON');
    url.searchParams.set('apikey', this.key);
    this.times.push(this.clock());
    this.credits.used++;
    const entry = { t: this.clock(), sym, interval, size: outputsize, ok: false } as Credits['log'][number];
    this.credits.log.push(entry);
    if (this.credits.log.length > 200) this.credits.log.splice(0, this.credits.log.length - 200);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      this.credits.lastHeaders = { used: res.headers.get('api-credits-used'), left: res.headers.get('api-credits-left'), at: this.clock() };
      const j = (await res.json()) as { status?: string; code?: number; message?: string; values?: Parameters<typeof parseTD>[0] };
      if (res.status === 429 || j.code === 429) {
        entry.err = '429';
        const n = this.clock();
        await sleep(60_000 - (n % 60_000) + 500);
        return { candles: [], error: '429 — dakika sınırı' };
      }
      if (j.status === 'error' || !j.values) { entry.err = j.message ?? `HTTP ${res.status}`; return { candles: [], error: entry.err }; }
      entry.ok = true;
      return { candles: parseTD(j.values) };
    } catch (e) {
      entry.err = (e as Error).message;
      return { candles: [], error: entry.err };
    }
  }
}
