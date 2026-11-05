import type { Candle, Condition, Dir, EntryMethod, Extra, NewsEvent, Overlay, Setup, Status, StrategyId, SymbolCfg, TF } from './types.ts';
import type { Config } from './config.ts';
import { aggregateClosed, splitClosed } from './candles.ts';
import { analyze, type Analysis, type Liq } from './structure.ts';
import { ema, lastAtr, macd, rsi, squeeze, vwap } from './indicators.ts';
import { DAY, HOUR, MIN, TF_MS, fmtTR, fmtTRNY, durationText, inNyRange, nyDayStart, parseHM, nyMinutes } from './time.ts';

const ANALYZE_BARS: Record<TF, number> = { '1m': 400, '3m': 300, '5m': 700, '15m': 500, '1h': 500, '4h': 300, '1d': 250, '1w': 120 };

export interface NewsRisk { active: boolean; event?: NewsEvent; next?: NewsEvent; text: string }

export class Ctx {
  readonly sym: string;
  readonly cfg: SymbolCfg;
  readonly conf: Config;
  readonly now: number;
  readonly base5: Candle[];
  readonly base1: Candle[];
  readonly daily: Candle[];
  readonly news: NewsEvent[];
  private cache = new Map<string, unknown>();

  constructor(sym: string, conf: Config, now: number, data: { m5: Candle[]; m1: Candle[]; d1: Candle[] }, news: NewsEvent[]) {
    this.sym = sym; this.conf = conf; this.cfg = conf.symbols[sym]; this.now = now;
    this.base5 = data.m5.filter((c) => c.t <= now);
    this.base1 = data.m1.filter((c) => c.t <= now);
    this.daily = data.d1.filter((c) => c.t <= now);
    this.news = news;
  }
  get p() { return this.conf.params; }
  get dec() { return this.cfg.decimals; }
  fmt(x: number | undefined): string { return x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(this.dec); }

  private memo<T>(k: string, f: () => T): T {
    if (!this.cache.has(k)) this.cache.set(k, f());
    return this.cache.get(k) as T;
  }

  /** Kapanmış mumlar ve canlı mum. 1m/3m sadece 1m verisi varsa. */
  series(tf: TF): { closed: Candle[]; live?: Candle } {
    return this.memo(`s-${tf}`, () => {
      if (tf === '1m') return splitClosed(this.base1, '1m', this.now);
      if (tf === '3m') return aggregateClosed(this.base1, '1m', '3m', this.now);
      if (tf === '5m') {
        const s = splitClosed(this.base5, '5m', this.now);
        return s;
      }
      if (tf === '1d') {
        // 1D: 5m'den (NY gün sınırı). 5m geçmişinin ilk (yarım) gününden öncesi için API günlük mumu kullanılır.
        const intra = aggregateClosed(this.base5, '5m', '1d', this.now);
        const first = intra.closed[0]?.t ?? intra.live?.t;
        const full = first === undefined ? [] : intra.closed.filter((d) => d.t >= first + DAY);
        const cut = full[0]?.t ?? intra.live?.t ?? Infinity;
        const older = this.daily.map((d) => ({ ...d, t: nyDayStart(d.t + 12 * HOUR) })).filter((d) => d.t < cut);
        return { closed: [...older, ...full], live: intra.live };
      }
      return aggregateClosed(this.base5, '5m', tf, this.now);
    });
  }
  closed(tf: TF): Candle[] { return this.series(tf).closed; }
  get price(): number {
    const l1 = this.base1[this.base1.length - 1], l5 = this.base5[this.base5.length - 1];
    const last = l1 && (!l5 || l1.t >= l5.t) ? l1 : l5;
    return last ? last.c : NaN;
  }
  get lastBarTime(): number {
    const l1 = this.base1[this.base1.length - 1], l5 = this.base5[this.base5.length - 1];
    return Math.max(l1?.t ?? 0, l5?.t ?? 0);
  }

  an(tf: TF): Analysis {
    return this.memo(`a-${tf}`, () => {
      const p = this.p;
      const c = this.closed(tf).slice(-ANALYZE_BARS[tf]);
      return analyze(c, tf, {
        n: p.swing[tf] ?? 2, dispMult: p.displacementMult, dispLookback: p.displacementLookback, atrPeriod: p.atrPeriod,
        equalTolAtr: p.equalTolAtr, fvgMinAtr: p.fvgMinAtr, consBars: p.consolidation.bars, consMaxBos: p.consolidation.maxBos,
        consRangeAtr: p.consolidation.rangeAtrMult, minBos: p.trend.minBos, strongBos: p.trend.strongBos,
      });
    });
  }
  atr(tf: TF): number { return this.memo(`atr-${tf}`, () => lastAtr(this.closed(tf), this.p.atrPeriod)); }
  ema4h(): number { return this.memo('ema4h', () => { const e = ema(this.closed('4h').map((c) => c.c), this.p.emaTrend); return e[e.length - 1]; }); }
  ema4hSeries(): [number, number][] {
    const c = this.closed('4h'); const e = ema(c.map((x) => x.c), this.p.emaTrend);
    return c.map((x, i) => [x.t, e[i]] as [number, number]).filter((x) => Number.isFinite(x[1]));
  }

  /** Stop'a eklenecek spread + tampon (fiyat cinsinden) */
  stopPad(price: number): number {
    const conv = (v: number, t?: string) => (t === 'pct' ? (price * v) / 100 : t === 'us100pts' ? v / this.p.us100PerQqq : v);
    return conv(this.cfg.buffer, this.cfg.bufferType) + conv(this.cfg.spread, this.cfg.spreadType ?? this.cfg.bufferType);
  }
  stopWithPad(structural: number, dir: Dir): number { return structural - dir * this.stopPad(structural); }

  // --- Seans / killzone ---
  killzoneAt(t: number, strategy: StrategyId): { id: string; name: string } | null {
    const ids = this.conf.sessions.strategyKillzones[strategy] ?? [];
    for (const k of this.conf.sessions.killzones) if (ids.includes(k.id) && inNyRange(t, k.start, k.end)) return k;
    return null;
  }
  nextKillzone(strategy: StrategyId): { name: string; at: number } | null {
    const ids = this.conf.sessions.strategyKillzones[strategy] ?? [];
    let best: { name: string; at: number } | null = null;
    for (let d = 0; d < 4; d++) {
      for (const k of this.conf.sessions.killzones) {
        if (!ids.includes(k.id)) continue;
        const at = nyDayStart(this.now) + d * DAY + parseHM(k.start) * MIN;
        if (at > this.now && (!best || at < best.at)) best = { name: k.name, at };
      }
      if (best) break;
    }
    return best;
  }
  killzoneCond(strategy: StrategyId, id = 'kz'): Condition {
    const kz = this.killzoneAt(this.now, strategy);
    if (kz) {
      const k = this.conf.sessions.killzones.find((x) => x.id === kz.id)!;
      const end = nyDayStart(this.now) + parseHM(k.end) * MIN;
      return { id, label: 'Killzone', status: 'ok', detail: `${kz.name} içinde (bitişe ${durationText(end - this.now)})` };
    }
    const nx = this.nextKillzone(strategy);
    return { id, label: 'Killzone', status: 'fail', detail: `Killzone dışı (${nyMinutes(this.now) < 120 ? 'Asya' : 'öğle arası / seans dışı'})${nx ? ` · sıradaki ${nx.name} ${fmtTR(nx.at)} TR (${durationText(nx.at - this.now)})` : ''}` };
  }

  // --- Haber ---
  newsRisk(): NewsRisk {
    return this.memo('news', () => {
      const p = this.p.news;
      const rel = this.news.filter((e) => e.impact === 'High' && (e.symbols ? e.symbols.includes(this.sym) : (e.currency === 'USD' || this.cfg.currencies.includes(e.currency)) && p.currencies.includes(e.currency)));
      const active = rel.find((e) => this.now >= e.t - p.beforeMin * MIN && this.now <= e.t + p.afterMin * MIN);
      const next = rel.filter((e) => e.t > this.now).sort((a, b) => a.t - b.t)[0];
      const text = active
        ? `HABER RİSKİ: ${active.currency} ${active.title} ${fmtTR(active.t)} TR (${active.t > this.now ? durationText(active.t - this.now) + ' sonra' : durationText(this.now - active.t) + ' önce'})`
        : next ? `Sıradaki: ${next.currency} ${next.title} ${fmtTR(next.t)} TR (${durationText(next.t - this.now)})` : 'Yakın kırmızı haber yok';
      return { active: !!active, event: active, next, text };
    });
  }
  newsCond(): Condition {
    const r = this.newsRisk();
    return { id: 'news', label: 'Haber riski yok', status: r.active ? 'fail' : 'ok', detail: r.text };
  }

  // --- Seviyeler ---
  /** Önceki gün / hafta high-low ve son 4H mum high-low (likidite) */
  htfLevels(): Liq[] {
    return this.memo('htfLevels', () => {
      const out: Liq[] = [];
      const d = this.closed('1d');
      const today = nyDayStart(this.now);
      const prevDays = d.filter((x) => x.t < today);
      const dayCandles = this.closed('5m').filter((x) => x.t >= today);
      const dayHigh = Math.max(...dayCandles.map((x) => x.h)), dayLow = Math.min(...dayCandles.map((x) => x.l));
      const pd = prevDays[prevDays.length - 1];
      if (pd) {
        out.push({ price: pd.h, side: 'buy', kind: 'önceki gün high', t: pd.t, tf: '1d', ...(dayHigh > pd.h ? { takenAt: this.now, takenBy: 'sweep' as const } : {}) });
        out.push({ price: pd.l, side: 'sell', kind: 'önceki gün low', t: pd.t, tf: '1d', ...(dayLow < pd.l ? { takenAt: this.now, takenBy: 'sweep' as const } : {}) });
      }
      const w = this.closed('1w');
      const pw = w[w.length - 1];
      if (pw) {
        const after = this.closed('5m').filter((x) => x.t >= pw.t + 7 * DAY);
        const hh = Math.max(...after.map((x) => x.h)), ll = Math.min(...after.map((x) => x.l));
        out.push({ price: pw.h, side: 'buy', kind: 'önceki hafta high', t: pw.t, tf: '1w', ...(hh > pw.h ? { takenAt: this.now } : {}) });
        out.push({ price: pw.l, side: 'sell', kind: 'önceki hafta low', t: pw.t, tf: '1w', ...(ll < pw.l ? { takenAt: this.now } : {}) });
      }
      const h4 = this.closed('4h');
      const l4 = h4[h4.length - 1];
      if (l4) {
        const after = this.closed('5m').filter((x) => x.t >= l4.t + 4 * HOUR);
        const hh = Math.max(...after.map((x) => x.h)), ll = Math.min(...after.map((x) => x.l));
        out.push({ price: l4.h, side: 'buy', kind: '4H mum high', t: l4.t, tf: '4h', ...(hh > l4.h ? { takenAt: this.now } : {}) });
        out.push({ price: l4.l, side: 'sell', kind: '4H mum low', t: l4.t, tf: '4h', ...(ll < l4.l ? { takenAt: this.now } : {}) });
      }
      return out;
    });
  }

  /** İşlem yönündeki alınmamış likidite seviyeleri (yakından uzağa) */
  targets(dir: Dir, from: number, tfs: TF[] = ['15m', '1h', '4h'], extra: Liq[] = []): Liq[] {
    const minDist = this.p.targetMinAtr15m * (this.atr('15m') || 0);
    const all: Liq[] = [...extra, ...this.htfLevels()];
    for (const tf of tfs) all.push(...this.an(tf).liquidity);
    const side = dir === 1 ? 'buy' : 'sell';
    const res = all
      .filter((l) => l.side === side && l.takenAt === undefined && (dir === 1 ? l.price > from + minDist : l.price < from - minDist))
      .sort((a, b) => Math.abs(a.price - from) - Math.abs(b.price - from));
    const uniq: Liq[] = [];
    for (const l of res) if (!uniq.some((u) => Math.abs(u.price - l.price) < minDist * 0.5)) uniq.push(l);
    return uniq;
  }

  /** Ek teyit (A/B/D/E) — sadece bilgi, kurulumu değiştirmez */
  extra(dir: Dir | 0): Extra | undefined {
    if (!dir) return undefined;
    const c = this.closed('5m').slice(-400);
    if (c.length < 60) return { summary: 'Yok', items: [{ name: 'Veri', sign: 0, detail: 'Yetersiz 5m verisi' }] };
    const e = this.p.extra;
    const close = c.map((x) => x.c);
    const last = c.length - 1;
    const items: Extra['items'] = [];
    const r = rsi(close, e.rsiPeriod);
    const recent = r.slice(-12).filter(Number.isFinite);
    const rMin = Math.min(...recent), rMax = Math.max(...recent);
    const rsiSign = dir === 1 ? (rMin <= e.rsiLow ? 1 : rMax >= e.rsiHigh ? -1 : 0) : (rMax >= e.rsiHigh ? 1 : rMin <= e.rsiLow ? -1 : 0);
    items.push({ name: `RSI ${e.rsiPeriod}`, sign: rsiSign as 1 | 0 | -1, detail: `RSI ${r[last].toFixed(1)} (son 12 mum ${rMin.toFixed(0)}–${rMax.toFixed(0)})` });
    const vw = vwap(c)[last];
    items.push({ name: 'VWAP', sign: (close[last] > vw ? dir : -dir) as 1 | -1, detail: `Fiyat VWAP ${this.fmt(vw)} ${close[last] > vw ? 'üstünde' : 'altında'}` });
    const e200 = ema(close, e.emaLong)[last];
    if (Number.isFinite(e200)) items.push({ name: 'EMA 200 (5m)', sign: (close[last] > e200 ? dir : -dir) as 1 | -1, detail: `EMA200 ${this.fmt(e200)} ${close[last] > e200 ? 'üstünde' : 'altında'}` });
    const m = macd(close, e.macd[0], e.macd[1], e.macd[2]).hist;
    const rising = m[last] > m[last - 1];
    items.push({ name: 'MACD', sign: (rising ? dir : -dir) as 1 | -1, detail: `Histogram ${rising ? 'yükseliyor' : 'düşüyor'} (${m[last] >= 0 ? '+' : ''}${m[last].toPrecision(3)})` });
    const sq = squeeze(c.slice(-120), e.bb[0], e.bb[1], e.kc[0], e.kc[1]);
    const n = sq.val.length - 1;
    const v = sq.val[n], vp = sq.val[n - 1];
    const momDir = v > 0 && v > vp ? 1 : v < 0 && v < vp ? -1 : 0;
    const released = !sq.sqzOn[n] && sq.sqzOn.slice(n - 6, n).some(Boolean);
    items.push({ name: 'Squeeze', sign: (momDir === 0 ? 0 : momDir === dir ? 1 : -1) as 1 | 0 | -1, detail: `${sq.sqzOn[n] ? 'Sıkışma (siyah nokta)' : released ? 'Sıkışma çözüldü' : 'Sıkışma yok'} · momentum ${v > 0 ? 'pozitif' : 'negatif'} ${Math.abs(v) > Math.abs(vp) ? 'artıyor' : 'azalıyor'}` });
    const plus = items.filter((i) => i.sign === 1).length, minus = items.filter((i) => i.sign === -1).length;
    return { summary: plus >= 3 && plus > minus ? 'Var' : minus >= 3 && minus > plus ? 'Ters' : 'Yok', items };
  }

  setupTimeText(t: number): string { return fmtTRNY(t); }
}

export function statusOf(conds: Condition[]): { status: Status; remaining: number } {
  if (conds.some((c) => c.status === 'fail')) return { status: 'YOK', remaining: conds.filter((c) => c.status !== 'ok').length };
  const rem = conds.filter((c) => c.status === 'wait').length;
  return rem === 0 ? { status: 'TAM', remaining: 0 } : { status: 'EKSIK', remaining: rem };
}

export function rr(entry: number, stop: number, tp: number): number {
  const risk = Math.abs(entry - stop);
  return risk > 0 ? Math.abs(tp - entry) / risk : 0;
}

export function method(ctx: Ctx, id: string, label: string, type: 'market' | 'limit', entry: number, stopStructural: number, dir: Dir, tp1: number, tp2?: number, note?: string, tag?: string): EntryMethod {
  const stop = ctx.stopWithPad(stopStructural, dir);
  const m: EntryMethod = { id, label, type, entry, stopStructural, stop, tp1, rr: +rr(entry, stop, tp1).toFixed(2) };
  if (tp2 !== undefined) { m.tp2 = tp2; m.rr2 = +rr(entry, stop, tp2).toFixed(2); }
  if (note) m.note = note;
  if (tag) m.tag = tag;
  return m;
}

/**
 * Ortak bayat sinyal kontrolü (tüm stratejiler): sinyal oluştuktan sonra
 * stop veya TP1 görüldüyse, sinyal maxSignalAgeHours'tan eskiyse ya da fiyat girişten
 * maxEntryDistR'den fazla uzaklaştıysa setup biter — geçmiş sinyal kovalanmaz.
 */
export function staleGuard(ctx: Ctx, s: { signalAt?: number; dir: Dir | 0; methods: EntryMethod[]; defaultMethod?: string; conditions: Condition[] }): void {
  if (!s.signalAt || !s.dir || s.conditions.some((c) => c.status === 'fail')) return;
  const g = ctx.p.general;
  if (ctx.now - s.signalAt > g.maxSignalAgeHours * HOUR) { s.conditions.push({ id: 'stale', label: 'Sinyal güncel mi', status: 'fail', detail: `Sinyal ${fmtTR(s.signalAt)} TR'de oluştu (${durationText(ctx.now - s.signalAt)} önce) — eski` }); return; }
  const m = s.methods.find((x) => x.id === s.defaultMethod) ?? s.methods[0];
  if (!m) return;
  const dir = s.dir;
  // Sinyal/dolum mumunun kendisi hariç: o mumun içindeki sıra bilinmez (limit dolumundan önceki fiyat sayılmaz)
  const after = [...ctx.closed('5m'), ...ctx.closed('1m')].filter((c) => c.t > s.signalAt!);
  const risk = Math.abs(m.entry - m.stop);
  const fail = (detail: string): void => { s.conditions.push({ id: 'stale', label: 'Sinyal güncel mi', status: 'fail', detail }); };
  if (after.some((c) => (dir === 1 ? c.l <= m.stop : c.h >= m.stop))) return fail(`Sinyalden (${fmtTR(s.signalAt)} TR) sonra stop ${ctx.fmt(m.stop)} görüldü — senaryo bitti`);
  if (after.some((c) => (dir === 1 ? c.h >= m.tp1 : c.l <= m.tp1))) return fail(`Sinyalden (${fmtTR(s.signalAt)} TR) sonra TP1 ${ctx.fmt(m.tp1)} görüldü — fırsat geçti, kovalanmaz`);
  if (ctx.now - s.signalAt > g.maxSignalAgeHours * HOUR) return fail(`Sinyal ${fmtTR(s.signalAt)} TR'de oluştu (${durationText(ctx.now - s.signalAt)} önce) — eski`);
  if (risk > 0 && Math.abs(ctx.price - m.entry) / risk > g.maxEntryDistR) return fail(`Fiyat ${ctx.fmt(ctx.price)} girişten ${(Math.abs(ctx.price - m.entry) / risk).toFixed(1)}R uzak — kovalanmaz`);
}

export function finalize(ctx: Ctx, s: Omit<Setup, 'status' | 'remaining' | 'evaluatedAt' | 'key' | 'symbol'> & { symbol?: string }): Setup {
  staleGuard(ctx, s);
  const { status, remaining } = statusOf(s.conditions);
  const missing = s.conditions.filter((c) => c.status === 'wait').map((c) => `${c.label}: ${c.detail}`).join(' · ');
  const setup: Setup = { ...s, symbol: ctx.sym, status, remaining, evaluatedAt: ctx.now, key: '' } as Setup;
  if (status === 'EKSIK') setup.missing = missing;
  if (status !== 'YOK') delete setup.none;
  else if (!setup.none) {
    const fails = s.conditions.filter((c) => c.status === 'fail');
    setup.none = { why: fails.map((f) => `${f.label}: ${f.detail}`).join(' · ') || 'Şartlar sağlanmadı', waiting: missing || 'Yeni yapı bekleniyor', ends: setup.invalidation || 'Yeni yapı oluşunca yeniden değerlendirilir' };
  }
  setup.key = `${setup.strategy}+${setup.symbol}+${setup.dir}+${setup.zoneId}+${status}`;
  return setup;
}

/** Sıralama: TAM → EKSİK (az şart kalan önce) → YOK */
export function rankSetups(a: Setup, b: Setup): number {
  const w = (s: Setup) => ({ TAM: 0, BEKLE: 1, EKSIK: 2, YOK: 3 })[s.status];
  if (w(a) !== w(b)) return w(a) - w(b);
  if (a.remaining !== b.remaining) return a.remaining - b.remaining;
  return (b.stars ?? 0) - (a.stars ?? 0);
}

export function pushTargetOverlays(ov: Overlay[], m: EntryMethod | undefined, from?: number) {
  if (!m) return;
  ov.push({ kind: 'line', style: 'entry', label: 'Giriş', price: m.entry, from });
  ov.push({ kind: 'line', style: 'stop', label: 'Stop', price: m.stop, from });
  ov.push({ kind: 'line', style: 'tp', label: 'TP1', price: m.tp1, from });
  if (m.tp2 !== undefined) ov.push({ kind: 'line', style: 'tp', label: 'TP2', price: m.tp2, from });
}

export const TFMS = TF_MS;
