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

const conf = loadConfig();
const now = process.argv[2] ? Date.parse(process.argv[2]) : Date.now();
const start = now - 25 * DAY;
const base: Record<string, [number, number]> = { XAUUSD: [4000, 0.45], XAGUSD: [48, 0.012], EURUSD: [1.16, 0.00009], GBPUSD: [1.33, 0.0001], BTCUSD: [104000, 45], ETHUSD: [3600, 2.2], US100: [610, 0.12] };
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
const credits = freshCredits(null, now, conf.params); credits.used = 512;
const state = buildState(conf, now, results, ctxs, credits, news, { errors, warnings: ['DEMO VERİSİ — sentetik mumlar'], fetched: [], window: { active: true, oneMin: false, weekday: true } });
writeJSON('state.json', state);
writeJSON('credits.json', credits, true);
for (const [sym, ctx] of Object.entries(ctxs)) writeJSON(`charts/${sym}.json`, buildChart(ctx, now));
const all = Object.values(results).flatMap((b) => Object.values(b).flat());
const h = updateHistory([], all, now - 3 * HOUR, 30, (s) => data[s].m5, 288);
writeJSON('history.json', h.hist);
console.log(`Demo yazıldı · TAM ${state.summary.tam} · Hazırlan ${state.summary.ready} · hatalar: ${errors.join(' | ') || 'yok'}`);
for (const [s, bySym] of Object.entries(results)) for (const [sym, list] of Object.entries(bySym)) console.log(`  ${s} ${sym}: ${list.map((x) => `${x.status}${x.status === 'EKSIK' ? '(' + x.remaining + ')' : ''}`).join(' ')}`);
