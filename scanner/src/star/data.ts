// ⭐ veri katmanı (ortak şartname §3, §5). Sadece 1H çekilir; günlük ve 4H 1H'ten türetilir.
// Twelve Data: her istekte timezone=UTC (TwelveData sınıfı), ortak kredi sayacı. BTC/ETH: Binance (yedek Coinbase), kredi yok.
// Depo: data/star/candles/{SYM}_1h.json (A–H'nin 1H deposundan ayrı — mevcut kurulumlar etkilenmez).
import type { Candle } from '../types.ts';
import type { TwelveData } from '../twelvedata.ts';
import { mergeCandles, pack, unpack } from '../candles.ts';
import { readJSON, writeJSON } from '../store.ts';
import { HOUR, MIN, utcDateStr } from '../time.ts';
import { parseBinance, parseCoinbase } from '../f/data.ts';
import type { StarConfig, StarInstrument } from './config.ts';
import { barEnd, gridStart, lastDueClose } from './sessions.ts';
import { setupsOf } from './config.ts';

export const readStar1h = (sym: string): Candle[] => unpack(readJSON<number[][]>(`star/candles/${sym}_1h.json`, []));
export const writeStar1h = (sym: string, c: Candle[]): void => writeJSON(`star/candles/${sym}_1h.json`, pack(c));

export interface FetchMem { lastTry?: number; fullDate?: string; deepPages?: number; deepDone?: boolean }
export interface PlanStarItem { sym: string; kind: 'refetch' | 'hourly' | 'full' | 'deep'; size: number; endDate?: string; why: string }

/** Twelve Data end_date biçimi (UTC) */
const tdDate = (t: number) => new Date(t).toISOString().slice(0, 19).replace('T', ' ');

/** Enstrümanın ihtiyaç duyduğu en küçük zaman dilimi: M2 → 1h, T4-S → 4h, diğerleri (N7, IB, TD) → seans günü */
export function needTf(sc: StarConfig, sym: string): '1h' | '4h' | '1d' {
  const ids = setupsOf(sc, sym);
  return ids.some((i) => sc.setups[i].tf === '1h') ? '1h' : ids.some((i) => sc.setups[i].tf === '4h') ? '4h' : '1d';
}

/**
 * Bu taramanın ⭐ Twelve Data istek planı. Bir enstrüman, sadece kurulumlarının ihtiyaç duyduğu mum kapanışı (1h / 4h / seans günü)
 * geçmiş ve veri o ana kadar gelmemişse çekilir (sinyaller yalnızca kapanışlarda oluşur — kredi tasarrufu). Günün ilk çekimi
 * 1500 mumluk tam yüklemedir (aynı 1 kredi). Öncelik: teyit için yeniden çekim / açık pozisyon → kapanış (credits.priority sırası)
 * → ilk derin yükleme (5000, 24 saat piyasalarda 2 sayfa). `budget` aşılmaz; sığmayanlar ertelenir (uyarı).
 */
export function planStar(sc: StarConfig, now: number, mem: Record<string, FetchMem>, lastBar: (sym: string) => Candle | undefined, firstBar: (sym: string) => Candle | undefined, budget: number, opts: { urgent?: string[]; warnings?: string[] } = {}): PlanStarItem[] {
  const K = sc.credits, etf = sc.common.etfSessionNY;
  const urgent = new Set(opts.urgent ?? []);
  const syms = [...K.priority].filter((s) => sc.instruments[s]?.source === 'td').sort((a, b) => Number(urgent.has(b)) - Number(urgent.has(a)));
  const out: PlanStarItem[] = [];
  const today = utcDateStr(now);
  for (const sym of syms) {
    const ins = sc.instruments[sym], m = mem[sym] ?? {};
    const last = lastBar(sym);
    const lastEnd = last ? barEnd(ins.cls, last.t, etf) : -Infinity;
    const due = lastDueClose(ins.cls, needTf(sc, sym), now, sc.common) ?? -Infinity;
    const behind = due > lastEnd;
    const retryOk = now - (m.lastTry ?? 0) >= K.retryMin * MIN;
    const size = Math.min(K.deepOutput, Math.max(K.h1Output, gapBars(ins, lastEnd, now)));
    if (!m.deepDone) { out.push({ sym, kind: 'deep', size: K.deepOutput, why: 'ilk derin yükleme', ...((m.deepPages ?? 0) > 0 && firstBar(sym) ? { endDate: tdDate(firstBar(sym)!.t - HOUR) } : {}) }); continue; }
    if (urgent.has(sym)) { out.push({ sym, kind: 'refetch', size: m.fullDate !== today ? Math.max(size, K.fullOutput) : size, why: 'çift tarama teyidi / açık pozisyon' }); continue; }
    if (behind && retryOk) out.push(m.fullDate !== today ? { sym, kind: 'full', size: Math.max(size, K.fullOutput), why: 'kapanış + günlük tam yükleme' } : { sym, kind: 'hourly', size, why: `${needTf(sc, sym)} kapanışı` });
  }
  // Derin yükleme en sona (sinyal taramasını aç bırakmasın)
  const order = { refetch: 0, hourly: 1, full: 1, deep: 3 } as const;
  out.sort((a, b) => order[a.kind] - order[b.kind] || Number(urgent.has(b.sym)) - Number(urgent.has(a.sym)));
  const taken = out.slice(0, Math.max(0, budget));
  for (const x of out.slice(taken.length)) opts.warnings?.push(`⭐ kredi bütçesi: ${x.sym} ${x.why} ertelendi`);
  return taken;
}
function gapBars(ins: StarInstrument, lastEnd: number, now: number): number {
  if (!Number.isFinite(lastEnd)) return 0;
  return Math.ceil((now - lastEnd) / HOUR) + 2;
}

/** Planı uygula: Twelve Data → depo. Hata dönen çağrı da kredi sayılır; tekrar en erken retryMin sonra. */
export async function runStarFetch(sc: StarConfig, td: TwelveData, plan: PlanStarItem[], store: Record<string, Candle[]>, mem: Record<string, FetchMem>, now: number, errors: string[]): Promise<string[]> {
  const fetched: string[] = [];
  for (const p of plan) {
    const ins = sc.instruments[p.sym];
    const m = (mem[p.sym] ??= {});
    m.lastTry = now;
    const r = await td.series(`STAR:${p.sym}`, ins.td!, '1h', p.size, p.endDate ? { endDate: p.endDate } : {});
    if (r.error) { errors.push(`⭐ ${p.sym} 1h: ${r.error}`); if (r.error === 'kredi bitti') break; continue; }
    store[p.sym] = mergeCandles(store[p.sym] ?? [], r.candles, sc.credits.keep1h);
    fetched.push(`${p.sym}/1h×${p.size}${p.endDate ? '(sayfa)' : ''}`);
    if (p.size >= sc.credits.fullOutput) m.fullDate = utcDateStr(now);
    if (p.kind === 'deep') {
      m.deepPages = (m.deepPages ?? 0) + 1;
      const pages = ins.cls === 'etf' ? sc.credits.deepPagesEtf : sc.credits.deepPages24h;
      if (m.deepPages >= pages || r.candles.length < p.size * 0.9) { m.deepDone = true; m.fullDate = utcDateStr(now); }
    }
  }
  return fetched;
}

/**
 * A–H'nin kayıtlı mumlarından ücretsiz 1H (ek kredi yok): 5m akışından TAM dolu saatler (ETF son mum 15:30–16:00: 6 adet 5m).
 * Sadece depoda olmayan saatler eklenir; Twelve Data 1H değeri her zaman önceliklidir.
 */
export function free1hFrom5m(cls: StarInstrument['cls'], m5: Candle[], now: number, etf?: [string, string]): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null, n = 0;
  const flush = () => { if (cur && barEnd(cls, cur.t, etf) <= now && n >= Math.round((barEnd(cls, cur.t, etf) - cur.t) / (5 * MIN))) out.push(cur); };
  for (const b of m5) {
    const g = gridStart(cls, b.t);
    if (!cur || cur.t !== g) { flush(); cur = { t: g, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 }; n = 1; }
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; n++; }
  }
  flush();
  return out;
}
export function addMissing(store: Candle[], extra: Candle[], keep: number): Candle[] {
  const have = new Set(store.map((x) => x.t));
  return mergeCandles(store, extra.filter((x) => !have.has(x.t)), keep);
}

async function getJSON(url: string): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'strateji-radar/1.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
/** BTC/ETH 1H: Binance (geçmiş sayfalı, 260+ seans günü), yedek Coinbase. Kredi harcamaz. */
export async function fetchCrypto1h(ins: StarInstrument, store: Candle[], now: number, keep: number, need = 6500): Promise<{ candles: Candle[]; price: number | null; source: string; error?: string }> {
  let c = store;
  try {
    const last = c[c.length - 1];
    const limit = last ? Math.min(1000, Math.ceil((now - last.t) / HOUR) + 2) : 1000;
    c = mergeCandles(c, parseBinance(await getJSON(`https://data-api.binance.vision/api/v3/klines?symbol=${ins.binance}&interval=1h&limit=${limit}`) as unknown[][]), keep);
    for (let page = 0; page < 7 && c.length < need; page++) {
      const before = c.length;
      c = mergeCandles(parseBinance(await getJSON(`https://data-api.binance.vision/api/v3/klines?symbol=${ins.binance}&interval=1h&limit=1000&endTime=${c[0].t - 1}`) as unknown[][]), c, keep);
      if (c.length === before) break;
    }
    const t = await getJSON(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${ins.binance}`) as { price: string };
    return { candles: c, price: Number(t.price) || null, source: 'Binance' };
  } catch (e) {
    try {
      const rows = parseCoinbase(await getJSON(`https://api.exchange.coinbase.com/products/${ins.coinbase}/candles?granularity=3600`) as number[][]);
      c = mergeCandles(c, rows, keep);
      return { candles: c, price: c[c.length - 1]?.c ?? null, source: 'Coinbase', error: `Binance: ${(e as Error).message}` };
    } catch (e2) { return { candles: c, price: null, source: '—', error: `Binance: ${(e as Error).message} · Coinbase: ${(e2 as Error).message}` }; }
  }
}
