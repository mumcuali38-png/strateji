/**
 * Geriye dönük kuru çalıştırma (MASTERPROMPT §18): kayıtlı mumlarla son N iş günü,
 * tarama penceresinde 5 dakikada bir motor çalıştırılır. API'ye gitmez.
 * Kullanım: DATA_DIR=... npx tsx src/backtest.ts [günSayısı=10]
 * Çıktı: backtest.json ve backtest.md (DATA_DIR içinde)
 */
import { loadConfig } from './config.ts';
import { readCandles, readJSON, writeJSON } from './store.ts';
import { runEngine, type SymData } from './engine.ts';
import { evaluate, toEvent, type HistEvent } from './history.ts';
import { DAY, MIN, TF_MS, fmtTR, inTrRange, trDayStart, trDow } from './time.ts';
import type { NewsFile } from './types.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './store.ts';

const conf = loadConfig();
const days = Number(process.argv[2] ?? 10);
const S = conf.params.scan;
const full: Record<string, SymData> = {};
let lastT = 0;
for (const sym of Object.keys(conf.symbols)) {
  full[sym] = { m5: readCandles(sym, '5min'), m1: readCandles(sym, '1min'), d1: readCandles(sym, '1day') };
  lastT = Math.max(lastT, full[sym].m5[full[sym].m5.length - 1]?.t ?? 0);
}
if (!lastT) { console.log('Kayıtlı veri yok — önce tarama çalışmalı.'); process.exit(0); }
const news = readJSON<NewsFile | null>('news.json', null)?.events ?? [];
// İş günlerini geriye doğru topla
const dayStarts: number[] = [];
for (let d = trDayStart(lastT); dayStarts.length < days && d > lastT - 40 * DAY; d -= DAY) if (S.weekdays.includes(trDow(d + 12 * 3600_000))) dayStarts.unshift(d);
const events: HistEvent[] = [];
const seen = new Set<string>();
const prior: { strategy: string; symbol: string; id: string; t: number }[] = [];
let runs = 0;
const t0 = Date.now();
for (const ds of dayStarts) {
  for (let now = ds; now < ds + DAY; now += S.intervalMin * MIN) {
    if (!inTrRange(now, S.windowTR[0], S.windowTR[1]) || now > lastT) continue;
    const cut: Record<string, SymData> = {};
    for (const [sym, d] of Object.entries(full)) cut[sym] = { m5: d.m5.filter((c) => c.t + TF_MS['5m'] <= now), m1: d.m1.filter((c) => c.t + MIN <= now), d1: d.d1.filter((c) => c.t + DAY <= now) };
    const { results } = runEngine(conf, now, cut, news, prior);
    runs++;
    for (const bySym of Object.values(results)) for (const list of Object.values(bySym)) for (const s of list) {
      if (s.status !== 'TAM' || seen.has(s.key)) continue;
      seen.add(s.key);
      const ev = toEvent(s, 'TAM', now);
      if (!ev) continue;
      events.push(ev);
      if (s.strategy === 'C') prior.push({ strategy: 'C', symbol: s.symbol, id: s.id, t: now });
    }
  }
}
for (const ev of events) ev.result = evaluate(ev, full[ev.symbol].m5, conf.params.history.evalMaxBars5m);
writeJSON('backtest.json', { generatedAt: Date.now(), days: dayStarts.map((d) => new Date(d + 3 * 3600_000).toISOString().slice(0, 10)), runs, events }, true);
const lines = [`# Geriye dönük kuru çalıştırma`, '', `Günler: ${dayStarts.map((d) => new Date(d + 3 * 3600_000).toISOString().slice(0, 10)).join(', ')} · ${runs} tarama · ${((Date.now() - t0) / 1000).toFixed(0)} sn`, '', '| Tarih (TR) | Strateji | Sembol | Yön | Model | Giriş | Stop | TP1 | RR | Sonuç | MFE R | MAE R |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
for (const e of events) {
  const dec = conf.symbols[e.symbol].decimals;
  const m = e.method!;
  lines.push(`| ${new Date(e.t + 3 * 3600_000).toISOString().slice(0, 10)} ${fmtTR(e.t)} | ${e.strategy} | ${e.symbol} | ${e.dir === 1 ? 'LONG' : 'SHORT'} | ${e.sub} | ${m.entry.toFixed(dec)} | ${m.stop.toFixed(dec)} | ${m.tp1.toFixed(dec)} | ${m.rr.toFixed(2)} | ${e.result?.outcome ?? '—'} | ${e.result?.mfeR ?? '—'} | ${e.result?.maeR ?? '—'} |`);
}
const by = (k: string) => events.filter((e) => e.strategy === k);
lines.push('', '**Özet:** ' + ['A', 'B', 'C', 'D', 'E'].map((k) => { const ev = by(k); const tp = ev.filter((e) => e.result?.outcome === 'TP').length, sl = ev.filter((e) => e.result?.outcome === 'SL').length; return `${k}: ${ev.length} setup · ${tp} TP · ${sl} SL`; }).join(' · '));
writeFileSync(join(DATA_DIR, 'backtest.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
