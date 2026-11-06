/**
 * Piyasa Yönü çalıştırıcı (EK §5): saatte bir (kredi ≥ %90 ise 4 saatte bir) forex ve kripto skorları.
 * Forex: kayıtlı Twelve Data mumları (günlük 1day×300, 1h×1200 + 5m akışından güncel 1H) — saatlik ek kredi yok.
 * Kripto: Binance spot mumları + OKX türev + alternative.me + DefiLlama + Farside (ücretsiz).
 */
import type { Config } from '../config.ts';
import type { Candle, NewsEvent, Setup } from '../types.ts';
import { readCandles, readJSON, writeJSON } from '../store.ts';
import { aggregate, mergeCandles } from '../candles.ts';
import { aggregateUTC } from '../f/data.ts';
import { DAY, HOUR, utcDateStr } from '../time.ts';
import type { Msg } from '../push.ts';
import * as sc from './score.ts';
import * as src from './sources.ts';

export const FOREX = ['EURUSD', 'GBPUSD', 'XAUUSD', 'XAGUSD', 'US100'] as const;
export const CRYPTO = ['BTCUSD', 'ETHUSD'] as const;
const NAMES: Record<string, string> = { EURUSD: 'EUR/USD', GBPUSD: 'GBP/USD', XAUUSD: 'XAU/USD', XAGUSD: 'XAG/USD', US100: 'US100 (QQQ)', BTCUSD: 'BTC', ETHUSD: 'ETH' };

export interface DirItem { symbol: string; name: string; score: number | null; label: string; change24: number | null; spark: number[]; comps: sc.Comp[]; missing: string[] }
export interface DirFile {
  updatedAt: number; forex: { general: { score: number | null; label: string; change24: number | null }; items: DirItem[] };
  crypto: { general: { score: number | null; label: string; change24: number | null }; items: DirItem[] }; sources: Record<string, string>;
}
interface Cache { t: Record<string, number>; v: Record<string, unknown> }

const f2 = (x: number | null | undefined, d = 2) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(d));
const sTxt = (s: sc.S) => (s === null ? 'veri yok' : s > 0.25 ? 'yukarı' : s < -0.25 ? 'aşağı' : 'nötr');

/** Önbellekli kaynak çağrısı: süresi dolmadıysa eski değer; hata olursa eski değer (varsa) + durum notu */
async function cached<T>(c: Cache, key: string, maxAge: number, now: number, f: () => Promise<T>, status: Record<string, string>): Promise<T | null> {
  if (c.t[key] && now - c.t[key] < maxAge) { status[key] = 'önbellek'; return c.v[key] as T; }
  try { const v = await f(); c.v[key] = v; c.t[key] = now; status[key] = v === null ? 'veri yok' : 'ok'; return v; }
  catch (e) { status[key] = `hata: ${(e as Error).message}`; return (c.v[key] as T) ?? null; }
}

export function shouldRun(prev: DirFile | null, now: number, creditsRatio: number): boolean {
  const every = creditsRatio >= 0.9 ? 4 * HOUR : HOUR;
  return !prev || now - prev.updatedAt >= every - 5 * 60_000;
}

export async function runDirection(conf: Config, now: number, opts: { setups: Setup[]; news: NewsEvent[]; m5?: Record<string, Candle[]>; ext?: Partial<Ext> }): Promise<{ file: DirFile; msgs: Msg[] }> {
  const status: Record<string, string> = {};
  const cache = readJSON<Cache>('direction-cache.json', { t: {}, v: {} });
  const ext: Ext = {
    cot: await cached(cache, 'cot', DAY, now, src.cotNets, status),
    myfx: await cached(cache, 'myfxbook', HOUR, now, src.myfxbookLongPct, status),
    oanda: await cached(cache, 'oanda', HOUR, now, src.oandaLongPct, status),
    fng: await cached(cache, 'fng', 6 * HOUR, now, src.fearGreed, status),
    stable: await cached(cache, 'stablecoin', 12 * HOUR, now, src.stablecoin7d, status),
    etfBTC: await cached(cache, 'etf_btc', 12 * HOUR, now, () => src.etfFlow5d('btc'), status),
    etfETH: await cached(cache, 'etf_eth', 12 * HOUR, now, () => src.etfFlow5d('eth'), status),
    derivBTC: await cached(cache, 'okx_btc', 50 * 60_000, now, () => src.okxDeriv('BTC'), status),
    derivETH: await cached(cache, 'okx_eth', 50 * 60_000, now, () => src.okxDeriv('ETH'), status),
    kl: {},
    ...opts.ext,
  };
  for (const s of ['BTCUSDT', 'ETHUSDT']) {
    if (opts.ext?.kl?.[s]) continue;
    try { ext.kl[s] = { h1: await src.binanceKlines(s, '1h', 1000, now), h4: await src.binanceKlines(s, '4h', 300, now), d1: await src.binanceKlines(s, '1d', 300, now) }; status[`binance_${s}`] = 'ok'; }
    catch (e) { status[`binance_${s}`] = `hata: ${(e as Error).message}`; }
  }
  writeJSON('direction-cache.json', cache);
  const hist = readJSON<{ t: number; s: Record<string, number | null> }[]>('direction-history.json', []);
  const file = computeDirection(conf, now, opts.setups, opts.news, ext, (sym) => forexCandles(sym, opts.m5?.[sym]), hist);
  file.sources = status;
  // Saatlik kayıt (30 gün)
  const rec: Record<string, number | null> = { FX: file.forex.general.score, CR: file.crypto.general.score };
  for (const it of [...file.forex.items, ...file.crypto.items]) rec[it.symbol] = it.score;
  const keep = [...hist.filter((h) => now - h.t <= 30 * DAY), { t: now, s: rec }];
  writeJSON('direction-history.json', keep);
  const prev = readJSON<DirFile | null>('direction.json', null);
  writeJSON('direction.json', file);
  return { file, msgs: labelChanges(prev, file, now) };
}

export interface Ext {
  cot: Record<string, number[]> | null; myfx: Record<string, number> | null; oanda?: Record<string, number> | null; fng: number | null; stable: number | null;
  etfBTC: number | null; etfETH: number | null; derivBTC: src.Deriv | null; derivETH: src.Deriv | null;
  kl: Record<string, { h1: Candle[]; h4: Candle[]; d1: Candle[] }>;
}

/** Forex mumları: günlük (1day), 1H (günlük 1h×1200 + 5m akışından güncel), 4H (1H'ten, NY hizalı) */
function forexCandles(sym: string, m5?: Candle[]): { d1: Candle[]; h4: Candle[]; h1: Candle[] } {
  const d1 = readCandles(sym, '1day');
  let h1 = readCandles(sym, '1h');
  const m = m5 ?? readCandles(sym, '5min');
  if (m.length) h1 = mergeCandles(h1, aggregate(m, '1h').slice(0, -1), 1500); // son (açık) saat hariç
  return { d1, h4: aggregate(h1, '4h'), h1 };
}

/** Saf hesap (test edilebilir) */
export function computeDirection(conf: Config, now: number, setups: Setup[], news: NewsEvent[], ext: Ext, fx: (sym: string) => { d1: Candle[]; h4: Candle[]; h1: Candle[] }, hist: { t: number; s: Record<string, number | null> }[]): DirFile {
  const uup = sc.trendTF(readCandlesSafe('UUP')), ief = sc.trendTF(readCandlesSafe('IEF'));
  const usd = uup, bond = ief;
  const ours = (sym: string, only?: string[]) => sc.ourSetups(setups.filter((s) => s.symbol === sym && (!only || only.includes(s.strategy))));
  const recent = news.filter((e) => e.impact === 'High' && e.t <= now && now - e.t <= DAY && e.actual && e.forecast);
  const item = (symbol: string, comps: sc.Comp[]): DirItem => {
    const r = sc.combine(comps);
    const past = [...hist].reverse().find((h) => now - h.t >= 23 * HOUR)?.s[symbol];
    const spark = hist.filter((h) => now - h.t <= 7 * DAY).filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 42)) === 0).map((h) => h.s[symbol]).filter((x): x is number => typeof x === 'number');
    return { symbol, name: NAMES[symbol] ?? symbol, score: r.score, label: r.label, change24: r.score !== null && typeof past === 'number' ? r.score - past : null, spark: r.score !== null ? [...spark, r.score] : spark, comps, missing: r.missing };
  };
  // ---- Forex ----
  const fxItems: DirItem[] = FOREX.map((sym) => {
    if (sym === 'XAGUSD') return { ...item(sym, [{ id: 'all', name: 'Fiyat', w: 100, s: null, note: 'XAG/USD Twelve Data ücretsiz planında yok — VERİ YOK' }]), missing: ['XAG/USD Twelve Data ücretsiz planında yok'] };
    const c = fx(sym);
    const T = sc.trend(c.d1, c.h4, c.h1), Y = sc.structure(c.d1, c.h4, c.h1), M = sc.momentum(c.d1, c.h4);
    const O = ours(sym);
    const macro = sym === 'US100' ? sc.mix([[0.6, bond], [0.4, usd === null ? null : -usd]]) : sym === 'XAUUSD' ? sc.mix([[0.6, usd === null ? null : -usd], [0.4, bond]]) : usd === null ? null : -usd;
    const cot = ext.cot?.[sym] ? sc.cotScore(ext.cot[sym]) : { s: null as sc.S };
    // Perakende long %: Myfxbook varsa o, yoksa OANDA pozisyon defteri
    const lpM = ext.myfx?.[sym === 'US100' ? 'NAS100' : sym], lpO = ext.oanda?.[sym];
    const lp = lpM ?? lpO, lpSrc = lpM !== undefined ? 'Myfxbook' : 'OANDA';
    const retail = lp !== undefined && Number.isFinite(lp) ? sc.retailScore(lp) : null;
    const pos = sc.mix([[0.6, cot.s], [0.4, retail]]);
    const ev = recent.map((e) => { const a = sc.parseNum(e.actual), f = sc.parseNum(e.forecast); const d = sc.eventDir(e.title), p = sc.pairEffect(sym, e.currency); return a === null || f === null || !d || !p ? null : { e, v: Math.sign(a - f) * d * p }; }).filter((x): x is { e: NewsEvent; v: number } => !!x);
    const surprise: sc.S = sym === 'US100' ? null : ev.length ? ev.reduce((a, x) => a + x.v, 0) / ev.length : 0;
    return item(sym, ([
      { id: 'trend', name: 'Trend', w: 25, s: T, note: `Günlük/4H/1H EMA50-200 dizilimi: ${sTxt(T)}` },
      { id: 'yapi', name: 'Yapı', w: 20, s: Y, note: `Son kırılan pivot (N=3): ${sTxt(Y)}` },
      { id: 'momentum', name: 'Momentum', w: 10, s: M, note: `RSI14 + MACD(4H): ${sTxt(M)}` },
      { id: 'kurulum', name: 'Bizim kurulumlar', w: 15, s: O, note: O === 0 ? 'Aktif yönlü kurulum yok' : `Aktif kurulumlar ${O > 0 ? 'long' : 'short'} ağırlıklı` },
      { id: 'makro', name: 'Makro / Dolar', w: 15, s: macro, note: `UUP (dolar) trendi ${sTxt(usd)} · IEF (tahvil) trendi ${sTxt(bond)}` },
      { id: 'pozisyon', name: 'Pozisyonlanma', w: 10, s: pos, note: `COT 4 hafta z=${f2((cot as { z?: number }).z)}${retail === null ? ' · perakende verisi yok' : ` · perakende long %${f2(lp, 0)} (${lpSrc})`}` },
      { id: 'haber', name: 'Haber sürprizi', w: 5, s: surprise, note: sym === 'US100' ? 'US100 için uygulanmaz' : ev.length ? ev.map((x) => `${x.e.currency} ${x.e.title} ${x.e.actual} (bek. ${x.e.forecast})`).join(' · ') : 'Son 24 saatte sonuçlanan kırmızı veri yok' },
    ] as sc.Comp[]).filter((c) => !(sym === 'US100' && c.id === 'haber'))); // US100: haber sürprizi uygulanmaz, ağırlığı dağıtılır
  });
  // ---- Kripto ----
  const qqq = sc.trendTF(fx('US100').d1);
  const crItems: DirItem[] = CRYPTO.map((sym) => {
    const k = ext.kl[sym === 'BTCUSD' ? 'BTCUSDT' : 'ETHUSDT'];
    const d = sym === 'BTCUSD' ? ext.derivBTC : ext.derivETH;
    const h1 = k?.h1 ?? [], h4 = k?.h4?.length ? k.h4 : aggregateUTC(h1, 4 * HOUR), d1 = k?.d1 ?? [];
    const T = k ? sc.trend(d1, h4, h1) : null, Y = k ? sc.structure(d1, h4, h1) : null, M = k ? sc.momentum(d1, h4) : null;
    const O = ours(sym, ['D', 'F']);
    const dp = h1.length > 25 ? h1.at(-1)!.c - h1.at(-25)!.c : null;
    const oi = d?.oiNow !== undefined && d?.oi24 !== undefined && dp !== null ? sc.oiScore(dp, d.oiNow - d.oi24) : null;
    const deriv = sc.mix([[0.4, oi], [0.3, d?.funding !== undefined ? sc.fundingScore(d.funding) : null], [0.15, d?.topLS !== undefined ? sc.lsScore(d.topLS) : null], [0.15, d?.globalLS !== undefined ? -sc.lsScore(d.globalLS) : null]]);
    const etf = sym === 'BTCUSD' ? (ext.etfBTC === null ? null : sc.clip(ext.etfBTC / 1000)) : (ext.etfETH === null ? null : sc.clip(ext.etfETH / 300));
    const flow = sc.mix([[0.6, etf], [0.4, ext.stable === null ? null : sc.clip(ext.stable / 1)]]);
    const fng = ext.fng === null ? null : sc.fngScore(ext.fng);
    const macro = sc.mix([[0.6, qqq], [0.4, usd === null ? null : -usd]]);
    const etfV = sym === 'BTCUSD' ? ext.etfBTC : ext.etfETH;
    return item(sym, [
      { id: 'trend', name: 'Trend', w: 20, s: T, note: `Günlük/4H/1H EMA50-200 (Binance): ${sTxt(T)}` },
      { id: 'yapi', name: 'Yapı', w: 15, s: Y, note: `Son kırılan pivot (N=3): ${sTxt(Y)}` },
      { id: 'momentum', name: 'Momentum', w: 10, s: M, note: `RSI14 + MACD(4H): ${sTxt(M)}` },
      { id: 'kurulum', name: 'Bizim kurulumlar', w: 10, s: O, note: O === 0 ? 'Aktif D/F kurulumu yok' : `D/F ${O > 0 ? 'long' : 'short'} ağırlıklı` },
      { id: 'turev', name: 'Türev piyasa', w: 20, s: deriv, note: `Funding %${f2(d?.funding, 4)}${d?.funding !== undefined && d.funding > 0.03 ? ' — piyasa ısınmış' : ''} · OI 24s ${d?.oiNow && d?.oi24 ? `${(((d.oiNow - d.oi24) / d.oi24) * 100).toFixed(1)}%` : '—'} · büyük L/S ${f2(d?.topLS)} · hesap L/S ${f2(d?.globalLS)} (OKX)` },
      { id: 'akis', name: 'Para akışı', w: 10, s: flow, note: `ETF 5 gün ${etfV === null ? 'yok' : `${etfV >= 0 ? '+' : ''}$${etfV.toFixed(0)}m`} · stablecoin 7g ${ext.stable === null ? 'yok' : `${ext.stable.toFixed(2)}%`}` },
      { id: 'duygu', name: 'Duygu', w: 10, s: fng, note: ext.fng === null ? 'Korku & Açgözlülük yok' : `Korku & Açgözlülük ${ext.fng} (uçlarda ters)` },
      { id: 'makro', name: 'Makro', w: 5, s: macro, note: `QQQ trendi ${sTxt(qqq)} · dolar ${sTxt(usd)}` },
    ]);
  });
  const avg = (xs: (number | null)[], ws?: number[]) => { const ok = xs.map((x, i) => [x, ws?.[i] ?? 1] as const).filter(([x]) => x !== null) as [number, number][]; const W = ok.reduce((a, [, w]) => a + w, 0); return W ? Math.round(ok.reduce((a, [x, w]) => a + x * w, 0) / W) : null; };
  const gen = (score: number | null, key: string) => { const past = [...hist].reverse().find((h) => now - h.t >= 23 * HOUR)?.s[key]; return { score, label: score === null ? 'VERİ YOK' : sc.labelOf(score), change24: score !== null && typeof past === 'number' ? score - past : null }; };
  const fxGen = avg(fxItems.filter((i) => i.symbol !== 'US100').map((i) => i.score));
  const crGen = avg(crItems.map((i) => i.score), [0.65, 0.35]);
  return { updatedAt: now, forex: { general: gen(fxGen, 'FX'), items: fxItems }, crypto: { general: gen(crGen, 'CR'), items: crItems }, sources: {} };
}
function readCandlesSafe(sym: string): Candle[] { try { return readCandles(sym, '1day'); } catch { return []; } }

/** Etiket değişimi bildirimleri (düşük öncelik, günde en fazla 3) */
export function labelChanges(prev: DirFile | null, cur: DirFile, now: number): Msg[] {
  if (!prev) return [];
  const old = new Map([...prev.forex.items, ...prev.crypto.items].map((i) => [i.symbol, i.label]));
  const out: Msg[] = [];
  for (const i of [...cur.forex.items, ...cur.crypto.items]) {
    const o = old.get(i.symbol);
    if (!o || o === i.label || i.score === null || o === 'VERİ YOK') continue;
    out.push({ kind: 'direction', title: `🧭 ${i.name}: ${o} → ${i.label}`, body: `Piyasa Yönü ${i.name} skoru ${i.score} (${i.label})`, url: './#/yon', tag: `dir-${i.symbol}-${utcDateStr(now)}-${i.label}` });
  }
  return out;
}
/** Günlük 3 bildirim sınırı (notified içinde sayaç anahtarları) */
export function capDirection(msgs: Msg[], notified: Record<string, number>, now: number, max = 3): Msg[] {
  const day = utcDateStr(now);
  let n = Object.keys(notified).filter((k) => k.startsWith(`dirn-${day}-`)).length;
  const out: Msg[] = [];
  for (const m of msgs) { if (n >= max || m.tag in notified) continue; notified[m.tag] = now; notified[`dirn-${day}-${n}`] = now; n++; out.push(m); }
  return out;
}
