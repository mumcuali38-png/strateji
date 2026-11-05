/**
 * Sadece Kurulum F taraması (Binance, kredi harcamaz). Ana tarama penceresi dışında
 * 15 dk'da bir çalışır (gece + hafta sonu); pencere içindeyse ana tarama F'yi zaten hesaplar.
 */
import { loadConfig } from './config.ts';
import { readJSON, writeJSON } from './store.ts';
import { runF } from './f/run.ts';
import { computeMessages } from './notify.ts';
import { sendAll } from './push.ts';
import { updateHistory, type HistEvent } from './history.ts';
import { inTrRange, trDow } from './time.ts';
import type { NewsFile, Setup } from './types.ts';

const conf = loadConfig();
const S = conf.params.scan;
const now = process.env.SCAN_NOW ? Date.parse(process.env.SCAN_NOW) : Date.now();
const force = process.env.FORCE === '1' || process.env.FORCE === 'true';
const weekday = S.weekdays.includes(trDow(now));
const mainActive = ((weekday || S.cryptoWeekend) && inTrRange(now, S.windowTR[0], S.windowTR[1])) || (weekday && inTrRange(now, S.preWindowTR[0], S.preWindowTR[1]));
if (mainActive && !force) { console.log('Ana tarama penceresi açık — F ana taramada hesaplanıyor.'); process.exit(0); }

const news = readJSON<NewsFile | null>('news.json', null);
const f = await runF(conf, now, news?.events ?? []);
type State = { strategies: Record<string, Record<string, Setup[]>>; summary?: { tam: number; ready: number }; fScan?: number; errors?: string[]; warnings?: string[]; generatedAt?: number; lastScan?: number };
const prev = readJSON<State | null>('state.json', null);
const state: State = prev ?? { strategies: {}, errors: [], warnings: [], generatedAt: now, lastScan: 0 };
const prevF = { strategies: { F: state.strategies.F ?? {} } };
state.strategies.F = { BTCUSD: f.setups.slice(0, 5) };
state.fScan = now;
state.generatedAt = now;
state.errors = (state.errors ?? []).filter((e) => !e.startsWith('F veri:'));
if (f.errors.length) state.errors.push(`F veri: ${f.errors.join(' · ')}`);
const all = Object.values(state.strategies).flatMap((b) => Object.values(b).flat());
state.summary = { tam: all.filter((x) => x.status === 'TAM' || x.status === 'BEKLE').length, ready: all.filter((x) => x.status === 'EKSIK' && x.remaining === 1).length };

const notified = readJSON<Record<string, number>>('notified.json', {});
const msgs = computeMessages(conf, f.setups, prevF, notified, [], now);
const pr = await sendAll(conf, msgs, now);
pr.log.forEach((l) => console.log(l));

const hist = updateHistory(readJSON<HistEvent[]>('history.json', []), f.setups, now, conf.params.history.days, () => f.m5, conf.params.history.evalMaxBars5m).hist;
writeJSON('state.json', state);
writeJSON('history.json', hist);
writeJSON('notified.json', notified);
console.log(`F taraması · kaynak ${f.source ?? 'VERİ YOK'} · ${f.setups.map((s) => `${s.sub}: ${s.status}${s.status === 'EKSIK' ? '(' + s.remaining + ')' : ''}`).join(' | ')} · ${msgs.length} bildirim`);
