// ⭐ kurulum değerlendirmeleri: trend ailesi (M2, T4-S, TD) — veri → sinyal → sanal pozisyon → satır (star.json) + bildirim + grafik.
import type { StarId } from '../types.ts';
import { pack } from '../candles.ts';
import { HOUR, DAY, NY_OFFSET } from '../time.ts';
import type { StarConfig } from './config.ts';
import { barEnd } from './sessions.ts';
import { donchian } from './ind.ts';
import { priceJump, signalId, type Pending } from './guard.ts';
import { evalTrend, trackPos, type Bar, type StarPos, type TrendParams, type TrendRow } from './trend.ts';
import type { StarSeries } from './run.ts';

/** Etkin trend kurulumları (adım adım eklenir) */
export const TREND_IDS: StarId[] = ['M2', 'T4S', 'TD'];

export function trendParams(sc: StarConfig, id: StarId): TrendParams {
  const s = sc.setups[id], p = s.p;
  return {
    id, name: s.name, tf: s.tf, entryN: p.entryN, exitN: p.exitN, stopAtr: p.stopAtr, kactiAtr: p.kactiAtr,
    t1R: p.t1R, t1Fraction: p.t1Fraction, kactiT1Frac: p.kactiT1Frac, warmBars: p.warmBars ?? p.warmDays ?? 260,
    exitAt: 'nextOpen',
    ...(id === 'TD' ? { openGapAtr: p.kactiAtr } : {}),
  };
}
export const TF_MS = { '1h': HOUR, '4h': 4 * HOUR, '1d': DAY } as const;

/** Kurulumun zaman dilimindeki kapanmış + geçerli mumlar */
export function tfBars(s: StarSeries, tf: '1h' | '4h' | '1d', etf: [string, string]): Bar[] {
  if (tf === '1h') return s.h1.map((b) => ({ ...b, end: barEnd(s.ins.cls, b.t, etf) }));
  return (tf === '4h' ? s.h4 : s.days).map((g) => ({ t: g.t, o: g.o, h: g.h, l: g.l, c: g.c, end: g.end }));
}

export interface StarMsg { key: string; title: string; body: string; url: string; loud: boolean; setup: StarId; symbol: string }
export interface SigLog { id: string; setup: StarId; sym: string; t: number; status: 'TAM' | 'KACTI' | 'IPTAL'; note?: string }

const SH: Record<string, string> = { XAUUSD: 'XAU', USDJPY: 'USDJPY', AUDUSD: 'AUDUSD', US100: 'US100', US500: 'US500', US30: 'US30', XAGUSD: 'XAG', WTI: 'WTI', BTCUSD: 'BTC', ETHUSD: 'ETH' };
const dirW = (d: number) => (d === 1 ? '▲ LONG' : '▼ SHORT');

/** Bildirim metinleri (şartname §7 "Bildirimler") */
export function trendMessages(p: TrendParams, pos: StarPos, row: TrendRow | null, dec: number, now: number): StarMsg[] {
  const out: StarMsg[] = [];
  const S = SH[pos.sym] ?? pos.sym, url = `./#/star/${p.id}/${pos.sym}`, fx = (x: number | null) => (x === null ? '—' : x.toFixed(dec));
  const exitW = p.id === 'M2' ? `1H kapanış ${pos.dir === 1 ? 'DA5' : 'DU5'} ötesi` : p.id === 'T4S' ? `4H kapanış ${pos.dir === 1 ? 'DA10' : 'DU10'} ötesi` : `günlük kapanış ${pos.dir === 1 ? 'DA20' : 'DU20'} ötesi`;
  if (row?.newPos) {
    const body = p.id === 'M2'
      ? `${p.name}: ${S} ${dirW(pos.dir)} TAM — giriş ~${fx(pos.ref)}, stop ${fx(pos.stop)} (2 ATR), çıkış: ${exitW}`
      : p.id === 'T4S' ? `${p.name}: ${S} ${dirW(pos.dir)} TAM — giriş ~${fx(pos.ref)}, stop ${fx(pos.stop)}, T1 ${fx(pos.t1)} (%50)`
        : `${p.name}: ${S} ${dirW(pos.dir)} TAM — giriş ~${fx(pos.ref)} (ertesi açılış), stop ${fx(pos.stop)}, T1 ${fx(pos.t1)} (%50)`;
    out.push({ key: `${pos.id}+TAM`, title: `🔵 ${p.name} · ${S} ${dirW(pos.dir)} TAM`, body, url, loud: true, setup: p.id, symbol: pos.sym });
  }
  const fresh = (t: number) => now - t <= 6 * HOUR;
  for (const e of pos.events) {
    if (!fresh(e.t)) continue;
    if (e.k === 'T1') out.push({ key: `${pos.id}+T1`, title: `💰 ${p.name} · ${S} T1`, body: `${p.name}: T1 — %50 kapat, stop girişe (${fx(pos.entry)})`, url, loud: true, setup: p.id, symbol: pos.sym });
    if (e.k === 'STOP' || e.k === 'BE_STOP') out.push({ key: `${pos.id}+STOP`, title: `⛔ ${p.name} · ${S} STOP`, body: `${p.name}: ${S} ${e.k === 'BE_STOP' ? 'giriş seviyesinde stop' : 'stop'} — R ${(e.r ?? 0).toFixed(2)}`, url, loud: true, setup: p.id, symbol: pos.sym });
    if (e.k === 'CIKIS' && p.exitAt === 'close') out.push({ key: `${pos.id}+CIKIS`, title: `⛔ ${p.name} · ${S} ÇIKIŞ`, body: `${p.name}: ${S} çıkış — ${pos.reason}, R ${(e.r ?? 0).toFixed(2)}`, url, loud: true, setup: p.id, symbol: pos.sym });
  }
  for (const e of pos.events) if (e.k === 'KACTI' && fresh(e.t)) out.push({ key: `${pos.id}+KACTI`, title: `⛔ ${p.name} · ${S} KAÇTI`, body: `${p.name}: ${S} ${pos.reason} — emir verme, sinyal iptal`, url, loud: true, setup: p.id, symbol: pos.sym });
  // TD.3: pozisyon açıkken her Cuma "hafta sonu taşınıyor" bilgisi (engel değil)
  if (p.id === 'TD' && pos.open && pos.entryT !== null && new Date(now + NY_OFFSET).getUTCDay() === 5) {
    out.push({ key: `${pos.id}+CUMA+${stratDate(now)}`, title: `ℹ️ ${p.name} · ${S} hafta sonu`, body: `${p.name}: ${S} pozisyonu hafta sonu taşınıyor (bilgi — engel değil). Oran tazeliğini kontrol et.`, url, loud: false, setup: p.id, symbol: pos.sym });
  }
  if (pos.exitPending !== null && fresh(pos.exitPending)) {
    const r = pos.rNow;
    out.push({ key: `${pos.id}+CIKIS`, title: `⛔ ${p.name} · ${S} ÇIKIŞ`, body: `${p.name}: ${S} çıkış — ${p.id === 'M2' ? '1H' : p.id === 'T4S' ? '4H' : 'günlük'} kapanış Donchian ${p.exitN} kırıldı${r !== null ? `, R ${r.toFixed(2)}` : ''} — kalanı piyasa emriyle kapat`, url, loud: true, setup: p.id, symbol: pos.sym });
  }
  return out;
}

/** Strateji günü (UTC-5) — takvim anahtarı */
export const stratDate = (t: number) => new Date(t + NY_OFFSET).toISOString().slice(0, 10);

export interface TrendDeps {
  sc: StarConfig; now: number; series: Record<string, StarSeries>; positions: StarPos[]; pending: Record<string, Pending>; signals: SigLog[];
  /** Anlık fiyat: 'final' = son kontrol (teyit 2/2), 'pos' = açık pozisyon takibi */
  livePrice: (sym: string, why: 'final' | 'pos') => Promise<{ price: number | null; src: string; live: boolean }>;
  urgent: Set<string>; newsLabel: { title: string; t: number; minutes?: number } | null;
}

/** Bir trend kurulumunu tüm enstrümanlarında çalıştır */
export async function runTrend(id: StarId, d: TrendDeps): Promise<{ rows: Record<string, unknown>; msgs: StarMsg[]; charts: Record<string, unknown> }> {
  const { sc, now } = d;
  const p = trendParams(sc, id);
  const etf = sc.common.etfSessionNY;
  const rows: Record<string, unknown> = {}, msgs: StarMsg[] = [], charts: Record<string, unknown> = {};
  const done = new Set(d.signals.map((x) => x.id));
  for (const sym of sc.setups[id].symbols) {
    const s = d.series[sym];
    if (!s) continue;
    const pp: TrendParams = { ...p, exitAt: id === 'TD' && s.ins.cls !== 'etf' ? 'close' : 'nextOpen' };
    const bars = tfBars(s, p.tf, etf);
    const dec = s.ins.decimals;
    // Açık pozisyon takibi
    const pi = d.positions.findIndex((x) => x.setup === id && x.sym === sym && x.open);
    let open: StarPos | null = pi >= 0 ? d.positions[pi] : null;
    if (open) {
      const lp = await d.livePrice(sym, 'pos');
      let tracked = trackPos(open, s.ins.cls, s.h1, bars, pp, now, lp.price, etf);
      if (tracked.open && lp.live && lp.price !== null && tracked.entry !== null && (tracked.dir === 1 ? lp.price <= tracked.stop : lp.price >= tracked.stop) && !open.liveStopT) {
        tracked = trackPos({ ...open, liveStopT: now }, s.ins.cls, s.h1, bars, pp, now, lp.price, etf);
      }
      d.positions[pi] = tracked;
      if (tracked.events.some((e) => e.k === 'KACTI')) { const sl = d.signals.find((x) => x.id === tracked.id); if (sl && sl.status === 'TAM') { sl.status = 'KACTI'; sl.note = tracked.reason ?? undefined; } }
      msgs.push(...trendMessages(pp, tracked, null, dec, now));
      open = tracked.open ? tracked : null;
    }
    const lastClosedT = d.positions.filter((x) => x.setup === id && x.sym === sym && !x.open).reduce((a, x) => Math.max(a, x.signalEnd), -Infinity);
    // Son kontrol fiyatı sadece teyit taramasında (kredi)
    const g = bars[bars.length - 1];
    const sid = g ? signalId(id === 'T4S' ? 'T4-S' : id, sym, g.t) : '';
    const pend = d.pending[sid];
    const needFinal = !!pend && pend.seq === 1 && now - pend.t >= 2 * 60_000 && !open;
    const lp = needFinal ? await d.livePrice(sym, 'final') : { price: s.price, src: s.priceSource, live: s.ins.source === 'binance' };
    const jump = lp.live ? priceJump(s.ins.cls, lp.price, s.h1[s.h1.length - 1]?.c, sc.common) : false;
    const row = evalTrend({
      p: pp, sym, bars, regime: s.regime, fresh: s.fresh, missing: s.missing.length, now, scanT: now, price: lp.price, jump,
      pending: d.pending, done, openPos: open, lastClosedT: Number.isFinite(lastClosedT) ? lastClosedT : null, dec, maxAgeMs: TF_MS[p.tf],
    });
    if (row.status === 'TAM_BEKLE' && row.scanSeq === 1) d.urgent.add(sym);
    if (row.finalCheck === 'KACTI' && row.signalId && !done.has(row.signalId)) { d.signals.push({ id: row.signalId, setup: id, sym, t: now, status: 'KACTI', note: row.conditions.find((c) => c.id === 'koruma')?.detail }); done.add(row.signalId); }
    if (row.newPos) {
      const np = trackPos(row.newPos, s.ins.cls, s.h1, bars, pp, now, lp.price, etf);
      d.positions.push(np);
      d.signals.push({ id: row.newPos.id, setup: id, sym, t: now, status: 'TAM' });
      msgs.push(...trendMessages(pp, np, row, dec, now));
      open = np;
    }
    const pos = open ?? null;
    const last = d.positions.filter((x) => x.setup === id && x.sym === sym && !x.open).sort((a, b) => (b.closedT ?? 0) - (a.closedT ?? 0))[0] ?? null;
    const tfKey = p.tf === '1h' ? 'atr14_1h' : p.tf === '4h' ? 'atr14_4h' : 'atr14_d';
    const donKey = p.tf === '1h' ? 'donchian' : p.tf === '4h' ? 'donchian_4h' : 'donchian_d';
    const L = row.levels;
    const nE = p.entryN, nX = p.exitN;
    rows[sym] = {
      status: row.status, dir: row.dir, note: row.note, conditions: row.conditions, signalId: row.signalId,
      levels: L, order: row.order, news: d.newsLabel,
      position: pos ? { ...pos, exitLevel: pos.dir === 1 ? L.exitDn : L.exitUp } : null,
      lastClosed: last, regime: s.regime,
      // Şartnamedeki çıktı şeması (§8)
      json: {
        setup: id === 'T4S' ? 'T4-S' : id, star: true, symbol: sym, evaluated_at_utc: new Date(now).toISOString().replace(/\.\d+Z$/, 'Z'), scan_seq: row.scanSeq,
        status: row.status, direction: row.dir === 1 ? 'LONG' : row.dir === -1 ? 'SHORT' : null,
        regime: s.regime ? { value: s.regime.value, close: s.regime.close, ema50: s.regime.ema50, ema200: s.regime.ema200, ret60: s.regime.ret60 } : null,
        [donKey]: { [`du${nE}`]: L.up, [`da${nE}`]: L.dn, [`du${nX}`]: L.exitUp, [`da${nX}`]: L.exitDn },
        [tfKey]: L.atr,
        order: row.order ? { ...row.order, risk_pct: sc.common.riskPct, lots: null } : null,
        position: pos ? { open: true, entry: pos.entry ?? pos.ref, stop: pos.stop, r_now: pos.rNow, ...(p.t1R ? { t1_done: pos.t1Done, stop_at_be: pos.stopAtBe } : {}), ...(id === 'TD' ? { days_open: pos.entryT ? Math.floor((now - pos.entryT) / DAY) : 0 } : {}) } : { open: false, entry: null, stop: null, r_now: null },
        protection: { double_scan_ok: row.scanSeq === 2, fresh: s.fresh, final_check: row.finalCheck, blocked_by: row.blockedBy },
      },
    };
    // Mini grafik: TF mumları + Donchian kanalları
    const show = bars.slice(-300);
    const de = donchian(bars, nE), dx = donchian(bars, nX);
    const off = bars.length - show.length;
    const ln = (arr: number[]) => show.map((b, i) => [b.t, arr[off + i]]).filter((x) => Number.isFinite(x[1]));
    charts[`${id}_${sym}`] = {
      t: now, symbol: `${id}_${sym}`, decimals: dec, source: s.source,
      tfs: { [p.tf]: pack(show).map((r) => r.slice(0, 5)) },
      lines: [
        { name: `DU${nE}`, tf: p.tf, color: '--info', pts: ln(de.up) }, { name: `DA${nE}`, tf: p.tf, color: '--info', pts: ln(de.dn) },
        { name: `DU${nX}`, tf: p.tf, color: '--eksik', pts: ln(dx.up) }, { name: `DA${nX}`, tf: p.tf, color: '--eksik', pts: ln(dx.dn) },
      ],
    };
  }
  return { rows, msgs, charts };
}

/** Portföy özeti (§6, §9): haftalık R, açık risk, takvim */
export function portfolio(positions: StarPos[], weekStartT: number, riskPct: number, now: number) {
  const closed = positions.filter((x) => !x.open && x.closedT !== null && x.r !== null);
  const open = positions.filter((x) => x.open);
  const calendar: Record<string, number> = {};
  for (const x of closed) { const k = stratDate(x.closedT!); calendar[k] = +((calendar[k] ?? 0) + x.r!).toFixed(2); }
  const weekR = closed.filter((x) => x.closedT! >= weekStartT).reduce((a, x) => a + x.r!, 0);
  const riskOn = open.filter((x) => !x.stopAtBe);
  return {
    weekR: +weekR.toFixed(2), openRiskPct: +(riskOn.length * riskPct).toFixed(2), riskPerTrade: riskPct,
    open: open.map((x) => ({ id: x.id, setup: x.setup, sym: x.sym, dir: x.dir, rNow: x.rNow, riskOn: !x.stopAtBe, entry: x.entry ?? x.ref, stop: x.stop, t1: x.t1, t1Done: x.t1Done, t: x.notifiedAt })),
    closed: closed.filter((x) => now - x.closedT! <= 90 * DAY).map((x) => ({ id: x.id, setup: x.setup, sym: x.sym, dir: x.dir, r: +x.r!.toFixed(2), t: x.closedT, reason: x.reason, entry: x.entry, exit: x.exit })),
    calendar,
  };
}
