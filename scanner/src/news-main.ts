import { loadConfig } from './config.ts';
import { fetchNews } from './news.ts';
import { readJSON, writeJSON } from './store.ts';
import type { NewsFile } from './types.ts';

const conf = loadConfig();
const prev = readJSON<NewsFile | null>('news.json', null);
const news = await fetchNews(prev, conf.params.news.currencies, process.env.FMP_KEY || undefined);
writeJSON('news.json', news, true);
console.log(`Haber: ${news.events.length} olay · FF ${news.stale ? 'ESKİ' : 'güncel'} · FMP ${news.fmp}${news.error ? ' · ' + news.error : ''}`);
