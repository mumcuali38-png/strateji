/**
 * Piyasa Yönü dış kaynakları (EK §1.3). Hepsi ücretsiz; erişilemezse null döner ve bileşen
 * "veri yok" olur (ağırlık dağıtılır). Binance/Bybit vadeli GitHub sunucularından engelli (451/403),
 * bu yüzden türev verisi OKX'ten (ölçüldü: 05.11.2026).
 */
import type { Candle } from '../types.ts';
import { HOUR, DAY } from '../time.ts';
import { parseBinance } from '../f/data.ts';

async function get(url: string, init?: RequestInit): Promise<Response> {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000), ...init, headers: { 'user-agent': 'Mozilla/5.0 (strateji-radar)', ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}
const json = async (url: string) => (await get(url)).json() as Promise<unknown>;

/** Binance spot mumları (anahtar yok) — kapanmış mumlar */
export async function binanceKlines(sym: string, interval: '1h' | '4h' | '1d', limit: number, now: number): Promise<Candle[]> {
  const ms = interval === '1h' ? HOUR : interval === '4h' ? 4 * HOUR : DAY;
  const rows = await json(`https://data-api.binance.vision/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`) as unknown[][];
  return parseBinance(rows).filter((c) => c.t + ms <= now);
}

export interface Deriv { funding?: number; topLS?: number; globalLS?: number; oiNow?: number; oi24?: number }
/** OKX türev verisi: funding, büyük trader L/S (pozisyon), tüm hesaplar L/S, açık pozisyon 24 sa */
export async function okxDeriv(ccy: 'BTC' | 'ETH'): Promise<Deriv> {
  const inst = `${ccy}-USDT-SWAP`, base = 'https://www.okx.com/api/v5';
  const out: Deriv = {};
  const tryGet = async (f: () => Promise<void>) => { try { await f(); } catch { /* bu parça yok */ } };
  const data = async (u: string) => { const j = await json(u) as { code: string; data: unknown[] }; if (j.code !== '0') throw new Error(j.code); return j.data; };
  await tryGet(async () => { const d = await data(`${base}/public/funding-rate?instId=${inst}`) as { fundingRate: string }[]; out.funding = Number(d[0].fundingRate) * 100; });
  await tryGet(async () => { const d = await data(`${base}/rubik/stat/contracts/long-short-position-ratio-contract-top-trader?instId=${inst}&period=1H&limit=1`) as string[][]; out.topLS = Number(d[0][1]); });
  await tryGet(async () => { const d = await data(`${base}/rubik/stat/contracts/long-short-account-ratio-contract?instId=${inst}&period=1H&limit=1`) as string[][]; out.globalLS = Number(d[0][1]); });
  await tryGet(async () => { const d = await data(`${base}/rubik/stat/contracts/open-interest-history?instId=${inst}&period=1H&limit=25`) as string[][]; if (d.length >= 25) { out.oiNow = Number(d[0][2]); out.oi24 = Number(d[24][2]); } });
  return out;
}
export async function fearGreed(): Promise<number | null> {
  const j = await json('https://api.alternative.me/fng/?limit=1') as { data?: { value: string }[] };
  const v = Number(j.data?.[0]?.value);
  return Number.isFinite(v) ? v : null;
}
/** Stablecoin toplam arzının 7 günlük değişimi (%) — DefiLlama */
export async function stablecoin7d(): Promise<number | null> {
  const a = await json('https://stablecoins.llama.fi/stablecoincharts/all') as { date: string; totalCirculatingUSD?: { peggedUSD?: number } }[];
  const v = a.map((x) => x.totalCirculatingUSD?.peggedUSD ?? 0).filter((x) => x > 0);
  if (v.length < 8) return null;
  return ((v.at(-1)! - v.at(-8)!) / v.at(-8)!) * 100;
}
/** Farside spot ETF akışları: son 5 işlem gününün "Total" toplamı (US$m). Tablo yoksa null. */
export function parseFarside(html: string): number | null {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()));
  const daily = rows.filter((r) => r.length > 2 && /^\d{1,2} [A-Za-z]{3} \d{4}$/.test(r[0]));
  const val = (s: string) => { if (!s || s === '-') return 0; const neg = /^\(.*\)$/.test(s); const n = Number(s.replace(/[(),]/g, '')); return Number.isFinite(n) ? (neg ? -n : n) : null; };
  const tot = daily.map((r) => val(r[r.length - 1])).filter((x): x is number => x !== null);
  if (tot.length < 5) return null;
  return tot.slice(-5).reduce((a, b) => a + b, 0);
}
export async function etfFlow5d(ccy: 'btc' | 'eth'): Promise<number | null> {
  return parseFarside(await (await get(`https://farside.co.uk/${ccy}/`)).text());
}
/** CFTC COT (Legacy, sadece vadeli): spekülatif (non-commercial) net pozisyon, eskiden yeniye */
export const COT_CODES: Record<string, string> = { EURUSD: '099741', GBPUSD: '096742', XAUUSD: '088691', XAGUSD: '084691', US100: '209742' };
export async function cotNets(): Promise<Record<string, number[]>> {
  const codes = Object.values(COT_CODES).map((c) => `'${c}'`).join(',');
  const url = `https://publicreporting.cftc.gov/resource/6dca-aqww.json?$where=${encodeURIComponent(`cftc_contract_market_code in(${codes})`)}&$order=${encodeURIComponent('report_date_as_yyyy_mm_dd DESC')}&$limit=600&$select=${encodeURIComponent('cftc_contract_market_code,report_date_as_yyyy_mm_dd,noncomm_positions_long_all,noncomm_positions_short_all')}`;
  const rows = await json(url) as { cftc_contract_market_code: string; report_date_as_yyyy_mm_dd: string; noncomm_positions_long_all: string; noncomm_positions_short_all: string }[];
  const out: Record<string, number[]> = {};
  for (const [sym, code] of Object.entries(COT_CODES)) {
    out[sym] = rows.filter((r) => r.cftc_contract_market_code === code).sort((a, b) => a.report_date_as_yyyy_mm_dd.localeCompare(b.report_date_as_yyyy_mm_dd))
      .map((r) => Number(r.noncomm_positions_long_all) - Number(r.noncomm_positions_short_all)).filter(Number.isFinite);
  }
  return out;
}
/**
 * OANDA pozisyon defteri (resmi v20 REST API): OANDA müşterilerinin açık pozisyonlarının fiyat kovalarına
 * göre long/short yüzdesi; kovalar toplanınca toplam long %. OANDA_TOKEN secret'ı yoksa null.
 * Demo (practice) hesabın anahtarı varsayılan; canlı hesap için OANDA_ENV=live.
 */
export const OANDA_INSTR: Record<string, string> = { EURUSD: 'EUR_USD', GBPUSD: 'GBP_USD', XAUUSD: 'XAU_USD', XAGUSD: 'XAG_USD', US100: 'NAS100_USD' };
export function positionBookLongPct(buckets: { longCountPercent: string | number; shortCountPercent: string | number }[]): number | null {
  let L = 0, S = 0;
  for (const b of buckets) { L += Number(b.longCountPercent) || 0; S += Number(b.shortCountPercent) || 0; }
  return L + S > 0 ? +((L / (L + S)) * 100).toFixed(1) : null;
}
export async function oandaLongPct(): Promise<Record<string, number> | null> {
  const token = process.env.OANDA_TOKEN;
  if (!token) return null;
  const host = process.env.OANDA_ENV === 'live' ? 'https://api-fxtrade.oanda.com' : 'https://api-fxpractice.oanda.com';
  const out: Record<string, number> = {};
  const errs: string[] = [];
  for (const [sym, inst] of Object.entries(OANDA_INSTR)) {
    try {
      const j = await (await get(`${host}/v3/instruments/${inst}/positionBook`, { headers: { authorization: `Bearer ${token}`, 'accept-datetime-format': 'UNIX' } })).json() as { positionBook?: { buckets?: { longCountPercent: string; shortCountPercent: string }[] } };
      const p = positionBookLongPct(j.positionBook?.buckets ?? []);
      if (p !== null) out[sym] = p;
    } catch (e) { errs.push(`${inst}: ${(e as Error).message}`); }
  }
  if (!Object.keys(out).length) throw new Error(errs.join(' · ') || 'pozisyon defteri boş');
  return out;
}
/** Myfxbook topluluk görünümü (perakende long %). MYFXBOOK_EMAIL / MYFXBOOK_PASSWORD secret'ı yoksa null. */
export async function myfxbookLongPct(): Promise<Record<string, number> | null> {
  const e = process.env.MYFXBOOK_EMAIL, p = process.env.MYFXBOOK_PASSWORD;
  if (!e || !p) return null;
  const lg = await json(`https://www.myfxbook.com/api/login.json?email=${encodeURIComponent(e)}&password=${encodeURIComponent(p)}`) as { error: boolean; session: string };
  if (lg.error || !lg.session) return null;
  try {
    const o = await json(`https://www.myfxbook.com/api/get-community-outlook.json?session=${encodeURIComponent(lg.session)}`) as { symbols?: { name: string; longPercentage: number }[] };
    return Object.fromEntries((o.symbols ?? []).map((s) => [s.name.toUpperCase(), Number(s.longPercentage)]));
  } finally { await json(`https://www.myfxbook.com/api/logout.json?session=${encodeURIComponent(lg.session)}`).catch(() => null); }
}
