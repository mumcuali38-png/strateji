// ⭐ çalıştırıcı (ortak altyapı): veri → koruma (§7) → seans günleri / 4H / rejim → star.json.
// Kurulum değerlendirmeleri (M2, T4-S, TD, N7, IB) bu altyapının üstüne ayrı modüller olarak eklenir.
import type { Candle, NewsEvent, StarId } from '../types.ts';
import type { Config } from '../config.ts';
import type { Credits, TwelveData } from '../twelvedata.ts';
import { readCandles, readJSON, writeJSON } from '../store.ts';
import { DAY, HOUR, NY_OFFSET, utcDateStr } from '../time.ts';
import { STAR_IDS, needsRegime, setupsOf, type StarConfig, type StarInstrument } from './config.ts';
import { addMissing, fetchCrypto1h, free1hFrom5m, needTf, planStar, readStar1h, runStarFetch, writeStar1h, type FetchMem } from './data.ts';
import { bars4h, closed1h, lastDueClose, sessionDays, type Grp } from './sessions.ts';
import { freshness, missingBars, newsRisk, removeBadTicks, type Pending } from './guard.ts';
import { atr, regime, type Regime } from './ind.ts';
import { existingReserve, starBudget } from './budget.ts';
import { TREND_IDS, portfolio, runTrend, type SigLog, type StarMsg } from './setups.ts';
import { OCO_IDS, runOco } from './setups-oco.ts';
import type { OcoOrder } from './oco.ts';
import type { StarPos } from './trend.ts';

export interface StarMem {
  fetch: Record<string, FetchMem>;
  /** Çift tarama teyidi (§7.3) */
  pending: Record<string, Pending>;
  /** Bir sonraki taramada yeniden çekilecek enstrümanlar (teyit / açık pozisyon) */
  urgent: string[];
  /** Bu UTC gününde ⭐'ın harcadığı kredi */
  credit: { date: string; used: number };
  /** Sanal pozisyonlar (testteki gibi; açık + son 120 gün kapanan) */
  positions: StarPos[];
  /** Sinyal kaydı (§7.2: gösterilen sinyal değiştirilmez; KAÇTI/iptal kayıtta kalır) */
  signals: SigLog[];
  /** Son Twelve Data anlık fiyat çağrısı (sembol → zaman) */
  priceAt: Record<string, number>;
  /** N7 / IB OCO emir kayıtları */
  oco: OcoOrder[];
  /** Bekleyen emir / açık pozisyon: seans boyunca saatlik 1H çekilecek enstrümanlar */
  watch: string[];
}
export const emptyMem = (): StarMem => ({ fetch: {}, pending: {}, urgent: [], credit: { date: '', used: 0 }, positions: [], signals: [], priceAt: {}, oco: [], watch: [] });

/** Bir enstrümanın hesaplanmış serileri — kurulum modülleri bunu kullanır */
export interface StarSeries {
  sym: string; ins: StarInstrument;
  /** Kapanmış, kötü tick'ten arındırılmış 1H */
  h1: Candle[];
  /** Kapanmış + geçerli seans günleri (en son kapanmış gün sonda) */
  days: Grp[];
  /** Tüm seans günleri (geçersizler dahil; N7.1 / IB.2 için) */
  daysAll: Grp[];
  /** Kapanmış + geçerli 4H */
  h4: Grp[];
  live?: { day?: Grp; h4?: Grp };
  price: number | null; priceSource: string;
  fresh: boolean; lagMin: number; missing: number[]; badTicks: number[];
  regime: Regime | null;
  atr1h: number; source: string;
}

/** Hafta: Pazartesi 00:00 strateji saati (TR Pazartesi 08:00) – Pazar (§6) */
export function weekStart(t: number): number {
  const sh = t + NY_OFFSET;
  const days = Math.floor(sh / DAY);
  const dow = (days + 4) % 7;
  return (days - ((dow + 6) % 7)) * DAY - NY_OFFSET;
}

export function analyze(sc: StarConfig, sym: string, raw: Candle[], now: number, price: number | null, priceSource: string, source: string): StarSeries {
  const ins = sc.instruments[sym], C = sc.common, etf = C.etfSessionNY;
  const closed = closed1h(ins.cls, raw, now, etf);
  const bt = removeBadTicks(closed, C.badTickAtr);
  const h1 = bt.clean;
  const fr = freshness(ins.cls, h1, now, C.staleHours, etf, ins.source === 'td' ? lastDueClose(ins.cls, needTf(sc, sym), now, C) : undefined);
  const missing = missingBars(ins.cls, h1, 30, bt.removed, etf);
  const all = sessionDays(ins.cls, h1, now, C);
  const days = all.filter((d) => d.closed && d.valid);
  const g4 = bars4h(ins.cls, h1, now, C);
  const h4 = g4.filter((d) => d.closed && d.valid);
  const lastDay = all[all.length - 1], last4 = g4[g4.length - 1];
  const a = atr(h1, C.atrPeriod);
  return {
    sym, ins, h1, days, daysAll: all.filter((d) => d.closed), h4,
    live: { day: lastDay && !lastDay.closed ? lastDay : undefined, h4: last4 && !last4.closed ? last4 : undefined },
    price: price ?? h1[h1.length - 1]?.c ?? null, priceSource: price !== null ? priceSource : 'son 1H kapanış',
    fresh: fr.fresh, lagMin: fr.lagMin, missing, badTicks: bt.removed,
    regime: needsRegime(sc, sym) ? regime(days, C.regime) : null,
    atr1h: a[a.length - 1] ?? NaN, source,
  };
}

export interface StarRunOut { file: Record<string, unknown>; series: Record<string, StarSeries>; mem: StarMem; msgs: StarMsg[]; charts: Record<string, unknown> }

export async function runStar(conf: Config, sc: StarConfig, now: number, o: { td: TwelveData | null; credits: Credits; news: NewsEvent[]; errors: string[]; warnings: string[]; crypto?: (ins: StarInstrument, store: Candle[], now: number, keep: number) => ReturnType<typeof fetchCrypto1h> }): Promise<StarRunOut> {
  const mem: StarMem = { ...emptyMem(), ...readJSON<Partial<StarMem>>('star-state.json', {}) };
  const today = utcDateStr(now);
  if (mem.credit.date !== today) mem.credit = { date: today, used: 0 };
  const etf = sc.common.etfSessionNY;
  const store: Record<string, Candle[]> = {};
  for (const sym of Object.keys(sc.instruments)) store[sym] = readStar1h(sym);
  // Ücretsiz 1H: A–H'nin kayıtlı XAU / QQQ verisi (ek kredi yok)
  for (const sym of ['XAUUSD', 'US100']) {
    const ins = sc.instruments[sym];
    if (!ins) continue;
    store[sym] = addMissing(store[sym], [...readCandles(sym, '1h').filter((x) => x.t % HOUR === (ins.cls === 'etf' ? HOUR / 2 : 0)), ...free1hFrom5m(ins.cls, readCandles(sym, '5min'), now, etf)], sc.credits.keep1h);
  }
  // Twelve Data
  const fetched: string[] = [];
  let reserve = 0;
  if (o.td && !o.credits.exhausted) {
    reserve = existingReserve(conf, now, o.credits);
    const b = starBudget(o.credits, reserve);
    const urgent = mem.urgent.filter((s) => sc.instruments[s]?.source === 'td');
    const plan = planStar(sc, now, mem.fetch, (s) => store[s][store[s].length - 1], (s) => store[s][0], b.signal + Math.min(urgent.length, b.position - b.signal), { urgent, warnings: o.warnings, watch: mem.watch });
    const before = o.credits.used;
    fetched.push(...await runStarFetch(sc, o.td, plan, store, mem.fetch, now, o.errors));
    mem.credit.used += o.credits.used - before;
    if (plan.length) console.log(`⭐ plan: ${plan.map((p) => `${p.sym}/${p.kind}×${p.size}`).join(', ')} · ayrılan (A–H) ${reserve}`);
  } else if (!o.td) o.warnings.push('⭐ TWELVE_DATA_KEY yok — kayıtlı veriyle hesaplandı');
  // Kripto
  const prices: Record<string, { p: number | null; src: string }> = {};
  for (const [sym, ins] of Object.entries(sc.instruments)) {
    if (ins.source !== 'binance') continue;
    const r = await (o.crypto ?? fetchCrypto1h)(ins, store[sym], now, sc.credits.keep1h);
    store[sym] = r.candles; prices[sym] = { p: r.price, src: r.source };
    if (r.error) (r.price === null ? o.errors : o.warnings).push(`⭐ ${sym}: ${r.error}`);
    fetched.push(`${sym}/1h (${r.source})`);
  }
  for (const sym of Object.keys(sc.instruments)) if (store[sym].length) writeStar1h(sym, store[sym]);

  // Analiz
  const series: Record<string, StarSeries> = {};
  const instruments: Record<string, unknown> = {};
  for (const [sym, ins] of Object.entries(sc.instruments)) {
    const s = analyze(sc, sym, store[sym], now, prices[sym]?.p ?? null, prices[sym]?.src ?? '', ins.source === 'td' ? 'Twelve Data' : prices[sym]?.src ?? 'Binance');
    series[sym] = s;
    const lastDay = s.days[s.days.length - 1];
    instruments[sym] = {
      label: ins.label, cls: ins.cls, decimals: ins.decimals, source: s.source, setups: setupsOf(sc, sym),
      price: s.price, priceSource: s.priceSource, lastBar: s.h1[s.h1.length - 1]?.t ?? null, bars1h: s.h1.length,
      days: s.days.length, lastDay: lastDay?.key ?? null, h4: s.h4.length,
      status: !s.h1.length ? 'VERI_YOK' : !s.fresh ? 'VERI_GECIKMESI' : s.missing.length ? 'VERI_EKSIK' : 'OK',
      lagMin: s.lagMin, missing: s.missing.slice(-5), badTicks: s.badTicks.slice(-5),
      regime: s.regime, atr1h: s.atr1h,
      ratioDefault: ins.ratioDefault ?? null, ratioWeekly: !!ins.ratioWeekly, ratioMandatoryWeekly: !!ins.ratioMandatoryWeekly,
    };
    if (s.h1.length && !s.fresh) o.warnings.push(`⭐ ${ins.label}: VERİ GECİKMESİ (${Math.round(s.lagMin / 60)} saat) — bu enstrümanda sinyal yok`);
  }
  const nr = newsRisk(o.news, now, sc.common);
  const newsLabel = nr.risk ? { title: nr.event!.title, t: nr.event!.t, minutes: nr.minutes } : null;
  const setups: Record<string, { name: string; title: string; symbols: string[]; rows: Record<string, unknown>; active: boolean }> = Object.fromEntries(STAR_IDS.map((id: StarId) => [id, { name: sc.setups[id].name, title: sc.setups[id].title, symbols: sc.setups[id].symbols, rows: {}, active: TREND_IDS.includes(id) || OCO_IDS.includes(id) }]));

  // Anlık fiyat (§5 C, §7.8): kripto → Binance; XAU/QQQ → A–H'nin 5m akışı (≤ 10 dk, ücretsiz);
  // diğer → Twelve Data price (1 kredi): son kontrolde her zaman, açık pozisyonda 15 dk'da bir ve sadece bütçe izin verirse.
  const livePrice = async (sym: string, why: 'final' | 'pos'): Promise<{ price: number | null; src: string; live: boolean }> => {
    const s = series[sym], ins = sc.instruments[sym];
    if (ins.source === 'binance') return { price: s.price, src: s.priceSource, live: s.price !== null };
    if (sym === 'XAUUSD' || sym === 'US100') {
      const m5 = readCandles(sym, '5min'), lb = m5[m5.length - 1];
      if (lb && lb.t + 5 * 60_000 <= now && now - (lb.t + 5 * 60_000) <= 10 * 60_000) return { price: lb.c, src: 'A–H 5m', live: true };
    }
    const b = starBudget(o.credits, reserve);
    const slowOk = now - (mem.priceAt[sym] ?? 0) >= sc.credits.priceSlowMin * 60_000;
    if (o.td && !o.credits.exhausted && (why === 'final' ? b.position > 0 : b.signal > 0 && slowOk)) {
      const r = await o.td.price(`STAR:${sym}`, ins.td!);
      mem.priceAt[sym] = now; mem.credit.used++;
      if (r.price !== null) return { price: r.price, src: 'Twelve Data price', live: true };
      o.warnings.push(`⭐ ${sym} anlık fiyat: ${r.error}`);
    }
    return { price: s.h1[s.h1.length - 1]?.c ?? null, src: 'son 1H kapanış', live: false };
  };

  // Kurulumlar
  const msgs: StarMsg[] = [], charts: Record<string, unknown> = {};
  const urgent = new Set<string>();
  for (const id of TREND_IDS) {
    const r = await runTrend(id, { sc, now, series, positions: mem.positions, pending: mem.pending, signals: mem.signals, livePrice, urgent, newsLabel });
    setups[id].rows = r.rows; msgs.push(...r.msgs); Object.assign(charts, r.charts);
  }
  const watch = new Set<string>();
  for (const id of OCO_IDS) {
    const r = await runOco(id, { sc, now, series, orders: mem.oco, positions: mem.positions, pending: mem.pending, signals: mem.signals, livePrice, urgent, watch, newsLabel, symCfg: (x) => conf.symbols[x] ?? sc.newSymbols[x] });
    setups[id].rows = r.rows; msgs.push(...r.msgs); Object.assign(charts, r.charts);
    setups[id].active = true;
  }
  mem.watch = [...watch];
  mem.oco = mem.oco.filter((x) => now - x.sessEnd <= 30 * DAY);
  mem.urgent = [...urgent];
  // M2.4 / §6: aynı enstrümanda aynı yönde başka ⭐ pozisyon → bilgi (engellemez)
  for (const [id, x] of Object.entries(setups)) for (const [sym, row] of Object.entries(x.rows) as [string, { dir?: number | null; position?: StarPos | null; sameDir?: string[] }][]) {
    const d = row.position?.dir ?? row.dir;
    row.sameDir = mem.positions.filter((p) => p.open && p.sym === sym && p.setup !== id && p.dir === d).map((p) => sc.setups[p.setup].name);
  }
  // Temizlik
  mem.positions = mem.positions.filter((p) => p.open || now - (p.closedT ?? now) <= 120 * DAY);
  mem.signals = mem.signals.filter((x) => now - x.t <= 60 * DAY);
  for (const [k, v] of Object.entries(mem.pending)) if (now - v.t > 3 * DAY) delete mem.pending[k];
  const pf = portfolio(mem.positions, weekStart(now), sc.common.riskPct, now);
  const file = {
    version: 1, generatedAt: now, lastScan: now, locked: sc.locked,
    weekStart: weekStart(now),
    instruments, setups,
    portfolio: { ...pf, openRiskWarn: pf.openRiskPct > sc.common.openRiskWarnPct },
    signals: mem.signals.slice(-50),
    news: newsLabel ? { label: 'HABER RİSKİ', ...newsLabel } : null,
    credits: { date: o.credits.date, used: o.credits.used, hardStop: o.credits.hardStop, star: mem.credit.used },
    fetched, errors: o.errors, warnings: o.warnings,
  };
  return { file, series, mem, msgs, charts };
}
