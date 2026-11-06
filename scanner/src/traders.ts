/**
 * Başarılı Trader'lar (EK §6). Kaynak: eToro resmi Public API (https://public-api.etoro.com,
 * x-api-key + x-user-key + x-request-id). Uç noktalar OpenAPI'den doğrulandı (05.11.2026):
 *  - GET /api/v2/market-data/instruments?symbols=…        → enstrüman kimlikleri
 *  - GET /api/v1/user-info/people/search                  → filtreli trader arama (dönem, risk, enstrüman payı)
 *  - GET /api/v1/user-info/people/{username}/portfolio/live → açık pozisyonlar (isBuy, openRate, openTimestamp)
 * Limit: uç nokta başına 60 istek/dk. Anahtar yoksa (ETORO_API_KEY / ETORO_USER_KEY) bölme sadece
 * Myfxbook + COT ile çalışır. Kazıma yapılmaz; Binance lider trader verisi kapalı (resmi API yok).
 * Bu veri SİNYAL DEĞİLDİR — sadece teyit.
 */
import { randomUUID } from 'node:crypto';
import type { Config } from './config.ts';
import type { Setup } from './types.ts';
import { readJSON, writeJSON } from './store.ts';
import { HOUR, MIN } from './time.ts';
import { cotScore } from './direction/score.ts';
import { SHORT, type Msg } from './push.ts';

export const PAIRS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'XAGUSD', 'US100', 'BTCUSD', 'ETHUSD'] as const;
/** eToro sembolleri (bulunamazsa serbest metin aramayla) */
const ETORO_SYM: Record<string, string> = { XAUUSD: 'GOLD', EURUSD: 'EURUSD', GBPUSD: 'GBPUSD', XAGUSD: 'SILVER', US100: 'NSDQ100', BTCUSD: 'BTC', ETHUSD: 'ETH' };

export interface TraderFilters { minMonths: number; maxDDPct: number; minTrades: number; last3mPositive: boolean; maxRisk: number; minPairTrades90d: number; perPair: number }
export const DEFAULT_FILTERS: TraderFilters = { minMonths: 12, maxDDPct: 20, minTrades: 100, last3mPositive: true, maxRisk: 6, minPairTrades90d: 10, perPair: 10 };

export interface TraderPos { username: string; dir: 1 | -1; openedAt: string | null; openRate: number | null; gain12m: number | null; maxDD: number | null; riskScore: number | null; trades: number | null; fetchedAt: number }
export interface TradersFile {
  updatedAt: number; status: string; source: string; filters: TraderFilters;
  pairs: Record<string, { traders: TraderPos[]; long: number; short: number; candidates: number; error?: string }>;
  crowd: Record<string, number | null>; cot: Record<string, { net: number; change4w: number; z?: number } | null>;
  /** OKX (BTC/ETH): büyük trader'ların pozisyon L/S oranı ve tüm hesapların L/S oranı → long % */
  /** Kalabalık verisinin kaynağı (Myfxbook / OANDA) */
  crowdSource?: string | null;
  okx?: Record<string, { topLongPct: number | null; allLongPct: number | null; topLS: number | null; allLS: number | null } | null>;
}

interface SearchItem { userName: string; gain: number; riskScore: number; maxMonthlyRiskScore?: number; trades: number; peakToValley?: number; weeksSinceRegistration?: number; instrumentPct?: number; activeWeeks?: number; dailyDd?: number }

class Etoro {
  constructor(private key: string, private user: string) {}
  calls = 0;
  async get<T>(path: string): Promise<T> {
    this.calls++;
    const r = await fetch(`https://public-api.etoro.com${path}`, { signal: AbortSignal.timeout(20_000), headers: { 'x-request-id': randomUUID(), 'x-api-key': this.key, 'x-user-key': this.user, accept: 'application/json' } });
    if (!r.ok) throw new Error(`eToro HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 1100)); // 60/dk sınırının altında kal
    return r.json() as Promise<T>;
  }
}

/** Filtre (EK §6.3): ≥12 ay, DD ≤ %20, ≥100 işlem (12 ay), son 3 ay pozitif, risk ≤ 6, paritede son 90 günde ≥10 işlem */
export function passes(y: SearchItem, q: SearchItem | undefined, f: TraderFilters): boolean {
  if ((y.weeksSinceRegistration ?? 0) < f.minMonths * 4.33) return false;
  if (Math.abs(y.peakToValley ?? 100) > f.maxDDPct) return false;
  if ((y.trades ?? 0) < f.minTrades) return false;
  if ((y.maxMonthlyRiskScore ?? y.riskScore ?? 10) > f.maxRisk) return false;
  if (f.last3mPositive && !(q && q.gain > 0)) return false;
  if (!q || ((q.trades ?? 0) * (q.instrumentPct ?? 0)) / 100 < f.minPairTrades90d) return false;
  return true;
}

export async function runTraders(conf: Config, now: number, setups: Setup[], notified: Record<string, number>): Promise<{ file: TradersFile; msgs: Msg[] }> {
  const f: TraderFilters = { ...DEFAULT_FILTERS, ...((conf.params as unknown as { traders?: Partial<TraderFilters> }).traders ?? {}) };
  const dcache = readJSON<{ v: Record<string, unknown> }>('direction-cache.json', { v: {} });
  const myfx = (dcache.v.myfxbook ?? null) as Record<string, number> | null;
  const oanda = (dcache.v.oanda ?? null) as Record<string, number> | null;
  const cotRaw = (dcache.v.cot ?? null) as Record<string, number[]> | null;
  const crowd: TradersFile['crowd'] = {}, cot: TradersFile['cot'] = {};
  for (const p of PAIRS) {
    crowd[p] = myfx?.[p === 'US100' ? 'NAS100' : p] ?? oanda?.[p] ?? null;
    const n = cotRaw?.[p];
    cot[p] = n && n.length > 5 ? { net: n.at(-1)!, change4w: n.at(-1)! - n.at(-5)!, z: cotScore(n).z } : null;
  }
  // OKX büyük trader / tüm hesaplar oranı (Piyasa Yönü önbelleğinden; ek istek yok)
  const okx: NonNullable<TradersFile['okx']> = {};
  for (const [p, k] of [['BTCUSD', 'okx_btc'], ['ETHUSD', 'okx_eth']] as const) {
    const d = dcache.v[k] as { topLS?: number; globalLS?: number } | undefined;
    okx[p] = d ? { topLS: d.topLS ?? null, allLS: d.globalLS ?? null, topLongPct: lsToPct(d.topLS), allLongPct: lsToPct(d.globalLS) } : null;
  }
  const crowdSource = myfx ? 'Myfxbook' : oanda ? 'OANDA pozisyon defteri' : null;
  const file: TradersFile = { updatedAt: now, status: 'ok', source: 'eToro Public API', filters: f, pairs: {}, crowd, cot, okx, crowdSource };
  for (const p of PAIRS) file.pairs[p] = { traders: [], long: 0, short: 0, candidates: 0 };
  const key = process.env.ETORO_API_KEY, user = process.env.ETORO_USER_KEY;
  if (!key || !user) { file.status = 'no_keys'; file.source = `eToro anahtarı yok — ${crowdSource ?? 'kalabalık verisi yok'} + COT + OKX (BTC/ETH)`; writeJSON('traders.json', file); return { file, msgs: disagreement(setups, file, notified, now) }; }
  const api = new Etoro(key, user);
  const cache = readJSON<{ ids?: Record<string, number>; idsAt?: number; picks?: Record<string, { u: string; y: SearchItem }[]>; picksAt?: number }>('traders-cache.json', {});
  try {
    // 1) Enstrüman kimlikleri (günde bir)
    if (!cache.ids || now - (cache.idsAt ?? 0) > 24 * HOUR) {
      const ids: Record<string, number> = {};
      const r = await api.get<{ results: { instrumentId: number; symbol: string }[] }>(`/api/v2/market-data/instruments?symbols=${encodeURIComponent(Object.values(ETORO_SYM).join(','))}`).catch(() => ({ results: [] }));
      for (const [p, s] of Object.entries(ETORO_SYM)) {
        const hit = r.results.find((x) => x.symbol?.toUpperCase() === s);
        if (hit) { ids[p] = hit.instrumentId; continue; }
        const q = await api.get<{ results: { instrumentId: number; symbol: string }[] }>(`/api/v2/market-data/instruments/search?query=${encodeURIComponent(s)}&limit=5`).catch(() => ({ results: [] }));
        const h2 = q.results.find((x) => x.symbol?.toUpperCase() === s) ?? q.results[0];
        if (h2) ids[p] = h2.instrumentId;
      }
      cache.ids = ids; cache.idsAt = now;
    }
    // 2) Aday trader'lar (6 saatte bir): 12 ay ve son 3 ay aramalarının kesişimi + filtre
    if (!cache.picks || now - (cache.picksAt ?? 0) > 6 * HOUR) {
      const picks: Record<string, { u: string; y: SearchItem }[]> = {};
      for (const p of PAIRS) {
        const id = cache.ids?.[p];
        if (!id) { file.pairs[p].error = 'eToro enstrüman kimliği bulunamadı'; continue; }
        const qs = (period: string) => `/api/v1/user-info/people/search?period=${period}&isTestAccount=false&blocked=false&page=1&pageSize=100&sort=-gain&instrumentId=${id}&instrumentPctMin=5&maxMonthlyRiskScoreMax=${f.maxRisk}&weeksSinceRegistrationMin=${Math.ceil(f.minMonths * 4.33)}`;
        const y = (await api.get<{ items: SearchItem[] }>(qs('OneYearAgo'))).items ?? [];
        const q = new Map(((await api.get<{ items: SearchItem[] }>(qs('ThreeMonthsAgo'))).items ?? []).map((x) => [x.userName, x]));
        picks[p] = y.filter((x) => passes(x, q.get(x.userName), f)).sort((a, b) => b.gain - a.gain).slice(0, f.perPair).map((x) => ({ u: x.userName, y: x }));
        file.pairs[p].candidates = y.length;
      }
      cache.picks = picks; cache.picksAt = now;
    }
    writeJSON('traders-cache.json', cache);
    // 3) Açık pozisyonlar (15 dk'da bir) — kullanıcı başına tek çağrı, paritelerde ortak
    const byUser = new Map<string, { y: SearchItem; pairs: string[] }>();
    for (const [p, list] of Object.entries(cache.picks ?? {})) for (const x of list) { const e = byUser.get(x.u) ?? { y: x.y, pairs: [] }; e.pairs.push(p); byUser.set(x.u, e); }
    const idToPair = new Map(Object.entries(cache.ids ?? {}).map(([p, id]) => [id, p]));
    for (const [u, e] of [...byUser].slice(0, 45)) {
      let pf: { positions?: { instrumentId: number; isBuy: boolean; openRate: number; openTimestamp: string; investmentPct: number }[] };
      try { pf = await api.get(`/api/v1/user-info/people/${encodeURIComponent(u)}/portfolio/live`); } catch { continue; } // gizli portföy olabilir
      const agg = new Map<string, { net: number; first: string | null; rateW: number; w: number }>();
      for (const pos of pf.positions ?? []) {
        const p = idToPair.get(pos.instrumentId);
        if (!p) continue;
        const a = agg.get(p) ?? { net: 0, first: null, rateW: 0, w: 0 };
        const w = Math.abs(pos.investmentPct || 1);
        a.net += (pos.isBuy ? 1 : -1) * w; a.rateW += pos.openRate * w; a.w += w;
        if (!a.first || pos.openTimestamp < a.first) a.first = pos.openTimestamp;
        agg.set(p, a);
      }
      for (const [p, a] of agg) {
        if (a.net === 0) continue;
        file.pairs[p].traders.push({ username: u, dir: a.net > 0 ? 1 : -1, openedAt: a.first, openRate: a.w ? +(a.rateW / a.w).toFixed(5) : null, gain12m: e.y.gain ?? null, maxDD: e.y.peakToValley ?? null, riskScore: e.y.maxMonthlyRiskScore ?? e.y.riskScore ?? null, trades: e.y.trades ?? null, fetchedAt: now });
      }
    }
    for (const p of PAIRS) { const t = file.pairs[p].traders; file.pairs[p].long = t.filter((x) => x.dir === 1).length; file.pairs[p].short = t.filter((x) => x.dir === -1).length; }
    file.source = `eToro Public API · ${api.calls} istek`;
  } catch (e) { file.status = `hata: ${(e as Error).message}`; }
  writeJSON('traders.json', file);
  return { file, msgs: disagreement(setups, file, notified, now) };
}

/** Uyumsuzluk (EK §8): bizim TAM sinyale karşı trader'ların ≥ %70'i ters yönde (en az 3 trader) */
export function disagreement(setups: Setup[], file: TradersFile, notified: Record<string, number>, now: number): Msg[] {
  const out: Msg[] = [];
  for (const s of setups) {
    if ((s.status !== 'TAM' && s.status !== 'BEKLE') || !s.dir) continue;
    const p = file.pairs[s.symbol];
    const n = (p?.long ?? 0) + (p?.short ?? 0);
    const top = file.okx?.[s.symbol]?.topLongPct ?? null;
    // eToro trader'ları (≥3) yoksa kripto için OKX büyük trader oranı
    const againstPct = n >= 3 ? ((s.dir === 1 ? p.short : p.long) / n) * 100 : top !== null ? (s.dir === 1 ? 100 - top : top) : null;
    const who = n >= 3 ? `seçili trader'ların (${n})` : 'OKX büyük trader pozisyonlarının';
    const key = `${s.id}+TRUYUM`;
    if (againstPct === null || againstPct < 70 || key in notified) continue;
    notified[key] = now;
    out.push({ kind: 'info', strategy: s.strategy, symbol: s.symbol, title: `👥 ${s.strategy} · ${SHORT[s.symbol] ?? s.symbol}: trader'lar ters yönde`, body: `${s.strategy} ${s.dir === 1 ? 'LONG' : 'SHORT'} TAM — ${who} %${Math.round(againstPct)}'i ${s.dir === 1 ? 'SHORT' : 'LONG'}. Sinyal değil, teyit bilgisi.`, url: `./#/trader/${s.symbol}`, tag: key });
  }
  return out;
}

/** Long/short oranı → long % (oran 2 → %66,7) */
export function lsToPct(r?: number | null): number | null { return r !== undefined && r !== null && Number.isFinite(r) && r > 0 ? +((r / (1 + r)) * 100).toFixed(1) : null; }

export function shouldRunTraders(prev: TradersFile | null, now: number): boolean {
  return !prev || now - prev.updatedAt >= 14 * MIN;
}
