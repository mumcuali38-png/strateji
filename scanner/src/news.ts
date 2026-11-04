import type { NewsEvent, NewsFile } from './types.ts';
import { HOUR, MIN, nyDayStart, utcDateStr } from './time.ts';

const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const FMP = 'https://financialmodelingprep.com';
const BIG_TECH = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'GOOG', 'META', 'TSLA', 'AVGO', 'NFLX'];

interface FFItem { title: string; country: string; date: string; impact: string; forecast?: string; previous?: string }

export function parseFF(items: FFItem[], currencies: string[]): NewsEvent[] {
  return items
    .filter((x) => currencies.includes(x.country) && (x.impact === 'High' || x.impact === 'Medium'))
    .map((x) => {
      const t = Date.parse(x.date);
      return { id: `ff-${x.country}-${t}-${x.title.replace(/\W+/g, '').slice(0, 24)}`, t, currency: x.country, impact: x.impact as NewsEvent['impact'], title: x.title, forecast: x.forecast || undefined, previous: x.previous || undefined, source: 'Forex Factory' };
    })
    .filter((e) => Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t);
}

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'strateji-radar/1.0' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

export async function fetchNews(prev: NewsFile | null, currencies: string[], fmpKey?: string, now = Date.now()): Promise<NewsFile> {
  const out: NewsFile = { fetchedAt: now, fmp: 'yok', events: prev?.events ?? [], headlines: prev?.headlines ?? [], ffFetchedAt: prev?.ffFetchedAt };
  try {
    const items = await getJSON<FFItem[]>(FF_URL);
    out.events = parseFF(items, currencies);
    out.ffFetchedAt = now;
    out.stale = false;
  } catch (e) {
    out.stale = true;
    out.error = `Forex Factory çekilemedi: ${(e as Error).message} — son kopya kullanılıyor`;
  }
  if (fmpKey) {
    try {
      const from = utcDateStr(now - 2 * 86400_000), to = utcDateStr(now + 7 * 86400_000);
      let cal: { date: string; country?: string; currency?: string; event: string; actual?: number | string | null; estimate?: unknown; previous?: unknown; impact?: string }[] = [];
      try { cal = await getJSON(`${FMP}/stable/economic-calendar?from=${from}&to=${to}&apikey=${fmpKey}`); }
      catch { cal = await getJSON(`${FMP}/api/v3/economic_calendar?from=${from}&to=${to}&apikey=${fmpKey}`); }
      if (Array.isArray(cal)) {
        for (const ev of out.events) {
          const m = cal.find((c) => (c.currency ?? '') === ev.currency && Math.abs(Date.parse(c.date.replace(' ', 'T') + 'Z') - ev.t) <= 5 * MIN && c.actual !== null && c.actual !== undefined && c.actual !== '');
          if (m) ev.actual = String(m.actual);
        }
      }
      try {
        const earn = await getJSON<{ symbol: string; date: string; time?: string }[]>(`${FMP}/stable/earnings-calendar?from=${from}&to=${to}&apikey=${fmpKey}`);
        if (Array.isArray(earn)) {
          for (const e of earn.filter((x) => BIG_TECH.includes(x.symbol))) {
            const day = Date.parse(`${e.date}T12:00:00Z`);
            const t = nyDayStart(day) + (e.time === 'bmo' ? 8 * HOUR : 16 * HOUR + 5 * MIN);
            out.events.push({ id: `fmp-earn-${e.symbol}-${e.date}`, t, currency: 'USD', impact: 'High', title: `${e.symbol} bilançosu${e.time ? '' : ' (saat belirsiz)'}`, source: 'FMP', symbols: ['US100'] });
          }
          out.events.sort((a, b) => a.t - b.t);
        }
      } catch { /* bilanço takvimi opsiyonel */ }
      try {
        const hl = await getJSON<{ publishedDate: string; title: string; site?: string; url?: string }[]>(`${FMP}/stable/news/general-latest?page=0&limit=25&apikey=${fmpKey}`);
        if (Array.isArray(hl)) out.headlines = hl.map((h) => ({ t: Date.parse(h.publishedDate.replace(' ', 'T') + 'Z'), title: h.title, source: h.site ?? 'FMP', url: h.url }));
      } catch { /* başlıklar opsiyonel */ }
      out.fmp = 'ok';
    } catch {
      out.fmp = 'hata';
    }
  }
  return out;
}
