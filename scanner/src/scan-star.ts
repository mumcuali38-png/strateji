/**
 * ⭐ kurulumların taraması (M2, T4-S, N7, IB, TD) — docs/kurulum_P_Portfoy_ortak_spec.md §5.
 * Tarama döngüsü (scripts/scan-loop.sh) her 5 dakikada, ana taramadan (scan.ts) hemen sonra çalıştırır; 7/24.
 * Twelve Data: ortak kredi sayacı (credits.json) ve dakika sınırı. Mevcut kurulumlar (A–H) bu dosyadan etkilenmez.
 */
import { loadConfig } from './config.ts';
import { readJSON, writeJSON } from './store.ts';
import { TwelveData, freshCredits, type Credits } from './twelvedata.ts';
import { loadStar } from './star/config.ts';
import { runStar } from './star/run.ts';
import type { NewsFile, StrategyId } from './types.ts';
import { sendAll, type Msg } from './push.ts';
import { starMsgsToSend } from './star/notify.ts';

const conf = loadConfig();
const sc = loadStar();
if (!sc.enabled) { console.log('⭐ kurulumlar kapalı (config/star.json enabled=false)'); process.exit(0); }
const now = process.env.SCAN_NOW ? Date.parse(process.env.SCAN_NOW) : Date.now();
const key = process.env.TWELVE_DATA_KEY;
const credits: Credits = freshCredits(readJSON<Credits | null>('credits.json', null), now, conf.params);
const td = key && credits.used < credits.hardStop ? new TwelveData(key, credits, conf.params) : null;
if (key && !td) credits.exhausted = true;
const news = readJSON<NewsFile | null>('news.json', null);
const errors: string[] = [], warnings: string[] = [];
if (credits.exhausted) warnings.push('⭐ Günlük kredi sınırı doldu — kayıtlı veriyle hesaplandı');

const r = await runStar(conf, sc, now, { td, credits, news: news?.events ?? [], errors, warnings });
// Bildirimler (tekrar yok: notified.json anahtarları; sessiz saatte TAM / ÇIKIŞ / STOP sesli)
const notified = readJSON<Record<string, number>>('notified.json', {});
const send = starMsgsToSend(r.msgs, notified, now);
if (send.length) {
  const out: Msg[] = send.map((m) => ({ kind: m.title.startsWith('🔵') ? 'tam' : 'info', title: m.title, body: m.body, url: m.url, tag: m.key, strategy: m.setup as unknown as StrategyId, symbol: m.symbol, signal: m.key.split('+')[0] }));
  (await sendAll(conf, out, now)).log.forEach((l) => console.log(l));
  writeJSON('notified.json', notified);
}
for (const [k, v] of Object.entries(r.charts)) writeJSON(`charts/star/${k}.json`, v);
writeJSON('star.json', r.file);
writeJSON('star-state.json', r.mem);
writeJSON('credits.json', credits, true);
const ins = r.file.instruments as Record<string, { status: string; regime: { value: number | null } | null }>;
console.log(`⭐ tarama · ${Object.entries(ins).map(([s, x]) => `${s}:${x.status}${x.regime ? `/R${x.regime.value ?? '⏳'}` : ''}`).join(' ')} · kredi ${credits.used}/${credits.hardStop} (⭐ ${r.mem.credit.used})${errors.length ? ' · hatalar: ' + errors.join(' | ') : ''}`);
