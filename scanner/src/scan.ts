import { loadConfig } from './config.ts';
import { readCandles, readJSON, writeCandles, writeJSON } from './store.ts';
import { TwelveData, freshCredits, type Credits } from './twelvedata.ts';
import { aggregate, mergeCandles, splitClosed } from './candles.ts';
import { runEngine, type SymData } from './engine.ts';
import { buildChart, buildState } from './state.ts';
import { sendAll } from './push.ts';
import { computeMessages } from './notify.ts';
import { openSignalIds, trackMessages } from './track.ts';
import { planFetch } from './plan.ts';
import { runF } from './f/run.ts';
import { updateHistory, type HistEvent } from './history.ts';
import { MIN, TF_MS, inTrRange, trDow, trMinutes, utcDateStr } from './time.ts';
import type { Candle, NewsFile, Setup } from './types.ts';

const conf = loadConfig();
const P = conf.params, S = P.scan;
const now = process.env.SCAN_NOW ? Date.parse(process.env.SCAN_NOW) : Date.now();
const force = process.env.FORCE === '1' || process.env.FORCE === 'true';
const pushTest = process.env.PUSH_TEST === '1' || process.env.PUSH_TEST === 'true';
const key = process.env.TWELVE_DATA_KEY;

const dow = trDow(now);
const weekday = S.weekdays.includes(dow);
const inWindow = inTrRange(now, S.windowTR[0], S.windowTR[1]);
const weekendCrypto = !weekday && S.cryptoWeekend;
// Ön pencere (hafta içi 08:00–10:00 TR): sadece XAU (Kurulum G — Asya seviyeleri ve süpürme penceresi kaçmasın)
const inPre = weekday && !inWindow && inTrRange(now, S.preWindowTR[0], S.preWindowTR[1]);
const active = ((weekday || weekendCrypto) && inWindow) || inPre;
console.log(`Tarama ${new Date(now).toISOString()} · TR ${String(Math.floor(trMinutes(now) / 60)).padStart(2, '0')}:${String(trMinutes(now) % 60).padStart(2, '0')} · pencere ${inPre ? 'ÖN PENCERE (XAU)' : active ? 'AÇIK' : 'kapalı'}${force ? ' · FORCE' : ''}`);

if (pushTest) {
  const r = await sendAll(conf, [{ kind: 'test', title: '🔔 Test bildirimi', body: 'Strateji Radar bildirimleri çalışıyor. Karar her zaman senin.', url: './#/ozet', tag: `test-${now}` }], now);
  r.log.forEach((l) => console.log(l));
  if (!force && !active) process.exit(3);
}
// Çıkış kodu 3 = pencere dışında (döngü durur)
if (!active && !force) { console.log('Tarama penceresi dışında — çekim yok.'); process.exit(3); }

// --- Kredi ---
let credits: Credits = freshCredits(readJSON<Credits | null>('credits.json', null), now, P);
const td = key ? new TwelveData(key, credits, P) : null;
const errors: string[] = [], warnings: string[] = [], fetched: string[] = [];
if (!key) warnings.push('TWELVE_DATA_KEY yok — veri çekilmedi, kayıtlı veriyle hesaplandı');

const data: Record<string, SymData> = {};
for (const sym of Object.keys(conf.symbols)) data[sym] = { m5: readCandles(sym, '5min'), m1: readCandles(sym, '1min'), d1: readCandles(sym, '1day'), h1: readCandles(sym, '1h') };

if (td && !credits.exhausted) {
  const today = utcDateStr(now);
  const plan = planFetch(conf, now, credits, (sym, iv) => { const st = iv === '1min' ? data[sym].m1 : data[sym].m5; return st[st.length - 1]?.t; }, warnings);
  const needBootstrap = plan.some((p) => p.size === S.bootstrap5m && p.interval === '5min' && p.bootstrap);
  console.log(`Plan: ${plan.map((p) => `${p.sym}/${p.interval}×${p.size}`).join(', ') || '—'} · kalan kredi ${credits.hardStop - credits.used}`);
  const fx = readJSON<Record<string, { rate: number; t: number }>>('fx.json', {});
  for (const p of plan) {
    if (p.sym.startsWith('FX:')) { // hesap para birimi kuru
      const pair = p.sym.slice(3);
      const r = await td.series(p.sym, pair, '1day', p.size);
      const last = r.candles[r.candles.length - 1];
      if (last) { fx[pair] = { rate: last.c, t: now }; writeJSON('fx.json', fx); } else if (r.error) errors.push(`${pair}: ${r.error}`);
      continue;
    }
    const cfg = conf.symbols[p.sym];
    const r = await td.series(p.sym, cfg.td, p.interval, p.size);
    if (r.error && /available starting with|upgrad|plan/i.test(r.error)) {
      credits.unavailable = { ...(credits.unavailable ?? {}), [p.sym]: utcDateStr(now) };
      warnings.push(`${cfg.label} Twelve Data ücretsiz planında yok — 7 gün boyunca istenmeyecek (kredi korunur)`);
      continue;
    }
    if (r.error) { errors.push(`${p.sym} ${p.interval}: ${r.error}`); if (r.error === 'kredi bitti') break; continue; }
    fetched.push(`${p.sym}/${p.interval}`);
    if (p.interval === '1day') { data[p.sym].d1 = mergeCandles(data[p.sym].d1, r.candles, 400); continue; }
    if (p.interval === '1h') { data[p.sym].h1 = mergeCandles(data[p.sym].h1 ?? [], r.candles, 1500); continue; }
    if (p.interval === '5min') { data[p.sym].m5 = mergeCandles(data[p.sym].m5, r.candles, S.keep5m); continue; }
    data[p.sym].m1 = mergeCandles(data[p.sym].m1, r.candles, S.keep1m);
    // 5m, 1m'lerden üretilir (ek kredi yok) — sadece tamamlanmış kovalar
    const closed1 = splitClosed(data[p.sym].m1, '1m', now).closed.filter((c) => c.t >= now - 2 * 3600_000);
    let agg = aggregate(closed1, '5m');
    const lc = closed1[closed1.length - 1];
    if (lc && agg.length && lc.t + MIN < agg[agg.length - 1].t + TF_MS['5m']) agg = agg.slice(0, -1);
    data[p.sym].m5 = mergeCandles(data[p.sym].m5, agg, S.keep5m);
  }
  if (needBootstrap && !errors.some((e) => e.includes('5min'))) credits.bootstrapDate = today;
  for (const sym of Object.keys(data)) { writeCandles(sym, '5min', data[sym].m5); writeCandles(sym, '1min', data[sym].m1); writeCandles(sym, '1day', data[sym].d1); if (data[sym].h1?.length) writeCandles(sym, '1h', data[sym].h1!); }
}
if (credits.used >= credits.hardStop) { credits.exhausted = true; warnings.push(`Günlük kredi sınırı (${credits.hardStop}) doldu — tarama UTC 00:00 (03:00 TR) sonrası yeniden başlar`); }

// --- Hesap ---
const news = readJSON<NewsFile | null>('news.json', null);
let hist = readJSON<HistEvent[]>('history.json', []);
const prior = hist.filter((h) => h.kind === 'TAM').map((h) => ({ strategy: h.strategy, symbol: h.symbol, id: h.id, t: h.signalAt ?? h.t }));
// Hafta sonu (kripto açık): sadece BTC/ETH değerlendirilir; diğerlerinin Cuma verisiyle eski sinyal üretmesi engellenir
const evalData = inPre ? Object.fromEntries(Object.entries(data).filter(([s]) => S.preWindowSymbols.includes(s))) : weekday ? data : Object.fromEntries(Object.entries(data).filter(([s]) => conf.symbols[s]?.crypto));
if (inPre) warnings.push('Ön pencere (08:00–10:00 TR): sadece XAU taranıyor — diğerleri 10:00\'da');
if (!weekday) warnings.push('Hafta sonu: sadece BTC/ETH taranıyor');
const { results, ctxs, errors: engErr } = runEngine(conf, now, evalData, news?.events ?? [], prior);
const fRun = await runF(conf, now, news?.events ?? []);
results.F = { BTCUSD: fRun.setups };
if (fRun.errors.length) errors.push(`F veri: ${fRun.errors.join(' · ')}`);
errors.push(...engErr.filter((e) => !Object.keys(credits.unavailable ?? {}).some((u) => e.startsWith(`${u}:`))));
for (const u of Object.keys(credits.unavailable ?? {}).filter((x) => conf.symbols[x])) if (!warnings.some((w) => w.includes(conf.symbols[u]?.label ?? u))) warnings.push(`${conf.symbols[u]?.label ?? u} Twelve Data ücretsiz planında yok — taranmıyor`);
const all: Setup[] = Object.values(results).flatMap((bySym) => Object.values(bySym).flat());

// --- Bildirimler ---
const prev = readJSON<{ strategies?: Record<string, Record<string, Setup[]>> } | null>('state.json', null);
const notified = readJSON<Record<string, number>>('notified.json', {});
const msgs = computeMessages(conf, all, prev, notified, news?.events ?? [], now, openSignalIds(hist));

// --- Geçmiş + işlem takibi ---
const candlesOf = (sym: string, strategy?: string): Candle[] => (strategy === 'F' ? fRun.m5 : data[sym]?.m5 ?? []);
const h = updateHistory(hist, all, now, P.history.days, candlesOf, P.history.evalMaxBars5m);
hist = h.hist;
msgs.push(...trackMessages(conf, hist, notified, news?.events ?? [], now));
const pr = await sendAll(conf, msgs, now);
pr.log.forEach((l) => console.log(l));
if (pr.failed) warnings.push(`${pr.failed} bildirim gönderilemedi`);

// --- Yaz ---
const state = buildState(conf, now, results, ctxs, credits, news, { errors, warnings, fetched, window: { active, pre: inPre, oneMin: inTrRange(now, S.oneMinuteTR[0], S.oneMinuteTR[1]), weekday, start: S.windowTR[0], end: S.windowTR[1] } });
writeJSON('state.json', state);
writeJSON('history.json', hist);
writeJSON('credits.json', credits, true);
writeJSON('notified.json', notified);
for (const [sym, ctx] of Object.entries(ctxs)) writeJSON(`charts/${sym}.json`, buildChart(ctx, now));
console.log(`Bitti · TAM ${state.summary.tam} · Hazırlan ${state.summary.ready} · ${msgs.length} bildirim adayı · kredi ${credits.used}/${credits.hardStop}${errors.length ? ' · hatalar: ' + errors.join(' | ') : ''}`);
