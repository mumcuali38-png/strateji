/**
 * Demo/dry-run: sentetik veri üretir, motoru çalıştırır, DATA_DIR'e state/charts/history yazar.
 * Kullanım: DATA_DIR=../demo-data npx tsx src/demo.ts [ISO-zaman]
 * API'ye gitmez, kredi harcamaz. Arayüz denemesi ve testler için.
 */
import { loadConfig } from './config.ts';
import { aggregate } from './candles.ts';
import { runEngine, type SymData } from './engine.ts';
import { buildChart, buildState } from './state.ts';
import { updateHistory } from './history.ts';
import { synth1m } from './synthetic.ts';
import { writeJSON, writeCandles } from './store.ts';
import { freshCredits } from './twelvedata.ts';
import { DAY, HOUR, MIN } from './time.ts';
import type { NewsFile } from './types.ts';
import { runF } from './f/run.ts';
import { aggregateUTC } from './f/data.ts';
import { scenario, to15 } from './f/synthetic.ts';
import { gDay, gHistory } from './g/synthetic.ts';
import { evalG } from './g/judas.ts';
import { computeDirection } from './direction/run.ts';
import { annotateDeadlines } from './deadline.ts';
import { Ctx } from './context.ts';

const conf = loadConfig();
const now = process.argv[2] ? Date.parse(process.argv[2]) : Date.now();
const start = now - 25 * DAY;
const base: Record<string, [number, number]> = { XAUUSD: [4000, 0.45], EURUSD: [1.16, 0.00009], GBPUSD: [1.33, 0.0001], BTCUSD: [104000, 45], ETHUSD: [3600, 2.2], US100: [610, 0.12] };
const data: Record<string, SymData> = {};
let seed = 7;
for (const [sym, [p0, vol]] of Object.entries(base)) {
  const m1 = synth1m(start, now, p0, vol, seed++, { weekends: conf.symbols[sym].crypto, hours: sym === 'US100' ? [570, 960] : undefined });
  data[sym] = { m5: aggregate(m1, '5m'), m1: m1.filter((c) => c.t >= now - 6 * HOUR), d1: aggregate(m1, '1d') };
  writeCandles(sym, '5min', data[sym].m5);
  writeCandles(sym, '1min', data[sym].m1);
}
const news: NewsFile = {
  fetchedAt: now, ffFetchedAt: now, fmp: 'yok', headlines: [],
  events: [
    { id: 'demo-1', t: now + 50 * MIN, currency: 'USD', impact: 'High', title: 'CPI m/m', forecast: '0.3%', previous: '0.4%', source: 'Forex Factory (demo)' },
    { id: 'demo-2', t: now + 3 * HOUR, currency: 'EUR', impact: 'Medium', title: 'ECB Konuşması', source: 'Forex Factory (demo)' },
    { id: 'demo-3', t: now + 26 * HOUR, currency: 'GBP', impact: 'High', title: 'GDP q/q', forecast: '0.2%', previous: '0.1%', source: 'Forex Factory (demo)' },
    { id: 'demo-4', t: now - 2 * HOUR, currency: 'USD', impact: 'High', title: 'Unemployment Claims', forecast: '220K', previous: '218K', actual: '231K', source: 'Forex Factory (demo)' },
  ],
};
writeJSON('news.json', news, true);
const { results, ctxs, errors } = runEngine(conf, now, data, news.events);
// F: sentetik Wyckoff birikimi (test senaryosu) — gerçek veri DEĞİL
const fsc = scenario();
const fd = { h1: fsc.h1, m15: to15(fsc.h1), m5: to15(fsc.h1), h4: aggregateUTC(fsc.h1, 4 * HOUR), d1: aggregateUTC(fsc.h1, 24 * HOUR), source: 'binance' as const };
const fr = await runF(conf, fsc.now, [], async () => ({ data: fd, errors: [] }));
results.F = { BTCUSD: fr.setups };
// G: sentetik Judas günü (gerçek veri DEĞİL)
const gd = gDay({ nowNY: [2, 50] });
results.G = { XAUUSD: evalG(conf, new Ctx('XAUUSD', conf, gd.now, { m5: gd.m5, m1: [], d1: [] }, []), gHistory(), []) };
annotateDeadlines(conf, results.G.XAUUSD, gd.now);
const credits = freshCredits(null, now, conf.params); credits.used = 512;
const state = buildState(conf, now, results, ctxs, credits, news, { errors, warnings: ['DEMO VERİSİ — sentetik mumlar'], fetched: [], window: { active: true, oneMin: false, weekday: true } });
writeJSON('state.json', state);
writeJSON('credits.json', credits, true);
for (const [sym, ctx] of Object.entries(ctxs)) writeJSON(`charts/${sym}.json`, buildChart(ctx, now));
const all = Object.values(results).flatMap((b) => Object.values(b).flat());
const h = updateHistory([], all, now - 3 * HOUR, 30, (s) => data[s].m5, 288);
writeJSON('history.json', h.hist);
// Piyasa Yönü (demo: çevrimdışı örnek dış veriler; mumlar sentetik)
{
  const { aggregateUTC } = await import('./f/data.ts');
  const kl = (sym: string) => { const m5 = data[sym]?.m5 ?? []; const h1 = aggregateUTC(m5, HOUR); return { h1, h4: aggregateUTC(h1, 4 * HOUR), d1: aggregateUTC(h1, 24 * HOUR) }; };
  const ext = { cot: null, myfx: null, fng: 62, stable: 0.4, etfBTC: 850, etfETH: -120, derivBTC: { funding: 0.012, topLS: 1.2, globalLS: 2.5, oiNow: 105, oi24: 100 }, derivETH: { funding: 0.045, topLS: 0.9, globalLS: 3.0, oiNow: 98, oi24: 100 }, kl: { BTCUSDT: kl('BTCUSD'), ETHUSDT: kl('ETHUSD') } };
  const hist = Array.from({ length: 7 * 24 }, (_, i) => ({ t: now - (7 * 24 - i) * HOUR, s: { EURUSD: 50 + Math.round(15 * Math.sin(i / 12)), GBPUSD: 45 + Math.round(10 * Math.sin(i / 9)), XAUUSD: 60 + Math.round(12 * Math.sin(i / 15)), US100: 55, BTCUSD: 58 + Math.round(10 * Math.sin(i / 20)), ETHUSD: 42 + Math.round(8 * Math.sin(i / 11)), FX: 52, CR: 54 } }));
  const df = computeDirection(conf, now, all, news.events, ext, (sym) => { const m5 = data[sym]?.m5 ?? []; const h1 = aggregate(m5, '1h'); return { d1: data[sym]?.d1 ?? [], h4: aggregate(h1, '4h'), h1 }; }, hist);
  df.sources = { demo: 'örnek veri' };
  writeJSON('direction.json', df);
  writeJSON('direction-history.json', hist);
}
console.log(`Demo yazıldı · TAM ${state.summary.tam} · Hazırlan ${state.summary.ready} · hatalar: ${errors.join(' | ') || 'yok'}`);
for (const [s, bySym] of Object.entries(results)) for (const [sym, list] of Object.entries(bySym)) console.log(`  ${s} ${sym}: ${list.map((x) => `${x.status}${x.status === 'EKSIK' ? '(' + x.remaining + ')' : ''}`).join(' ')}`);
