import type { Candle, Condition, Dir, Overlay, Setup, StrategyId } from './types.ts';
import { DAY } from './time.ts';

export interface HistEvent {
  id: string; key: string; t: number; strategy: StrategyId; symbol: string; dir: Dir; kind: 'TAM' | 'HAZIR';
  sub: string; signalAt?: number;
  method?: { id: string; label: string; type: 'market' | 'limit'; entry: number; stop: number; tp1: number; tp2?: number; rr: number };
  conditions: Pick<Condition, 'label' | 'status' | 'detail'>[];
  overlays: Overlay[];
  result?: { outcome: 'TP' | 'SL' | 'ACIK' | 'ZAMAN_ASIMI' | 'DOLMADI'; filledAt?: number; closedAt?: number; mfeR: number; maeR: number; r?: number };
}

export function toEvent(s: Setup, kind: 'TAM' | 'HAZIR', now: number): HistEvent | null {
  if (!s.dir) return null;
  const m = s.methods.find((x) => x.id === s.defaultMethod) ?? s.methods[0];
  return {
    id: s.id, key: s.key, t: now, strategy: s.strategy, symbol: s.symbol, dir: s.dir, kind, sub: s.sub, signalAt: s.signalAt,
    method: m ? { id: m.id, label: m.label, type: m.type, entry: m.entry, stop: m.stop, tp1: m.tp1, tp2: m.tp2, rr: m.rr } : undefined,
    conditions: s.conditions.map((c) => ({ label: c.label, status: c.status, detail: c.detail })),
    overlays: s.overlays.slice(0, 12),
  };
}

/** Kayıtlı mumlardan sonuç: önce TP mi SL mi, MFE/MAE (R). Ek kredi yok. */
export function evaluate(ev: HistEvent, candles: Candle[], maxBars: number): HistEvent['result'] {
  const m = ev.method;
  if (!m) return undefined;
  const risk = Math.abs(m.entry - m.stop);
  if (!(risk > 0)) return undefined;
  const d = ev.dir;
  const after = candles.filter((c) => c.t >= ev.t - 60_000);
  let filledAt: number | undefined = m.type === 'market' ? ev.t : undefined;
  let mfe = 0, mae = 0, n = 0;
  for (const c of after) {
    if (filledAt === undefined) {
      if (d === 1 ? c.l <= m.entry : c.h >= m.entry) filledAt = c.t;
      else { if (++n > maxBars) return { outcome: 'DOLMADI', mfeR: 0, maeR: 0 }; continue; }
    }
    n++;
    const fav = d === 1 ? c.h - m.entry : m.entry - c.l;
    const adv = d === 1 ? m.entry - c.l : c.h - m.entry;
    mfe = Math.max(mfe, fav / risk); mae = Math.max(mae, adv / risk);
    const sl = d === 1 ? c.l <= m.stop : c.h >= m.stop;
    const tp = d === 1 ? c.h >= m.tp1 : c.l <= m.tp1;
    if (sl) return { outcome: 'SL', filledAt, closedAt: c.t, mfeR: +mfe.toFixed(2), maeR: +mae.toFixed(2), r: -1 };
    if (tp) return { outcome: 'TP', filledAt, closedAt: c.t, mfeR: +mfe.toFixed(2), maeR: +mae.toFixed(2), r: +(Math.abs(m.tp1 - m.entry) / risk).toFixed(2) };
    if (n > maxBars) return { outcome: 'ZAMAN_ASIMI', filledAt, closedAt: c.t, mfeR: +mfe.toFixed(2), maeR: +mae.toFixed(2) };
  }
  return { outcome: filledAt === undefined ? 'ACIK' : 'ACIK', filledAt, mfeR: +mfe.toFixed(2), maeR: +mae.toFixed(2) };
}

export function updateHistory(hist: HistEvent[], setups: Setup[], now: number, days: number, candlesOf: (sym: string, strategy?: string) => Candle[], maxBars: number): { hist: HistEvent[]; added: HistEvent[] } {
  const keys = new Set(hist.map((h) => h.key));
  const added: HistEvent[] = [];
  for (const s of setups) {
    const kind = s.status === 'TAM' ? 'TAM' : s.status === 'EKSIK' && s.remaining === 1 ? 'HAZIR' : null;
    if (!kind || keys.has(s.key)) continue;
    const ev = toEvent(s, kind, now);
    if (ev) { hist.push(ev); added.push(ev); keys.add(s.key); }
  }
  const kept = hist.filter((h) => now - h.t <= days * DAY);
  for (const h of kept) {
    if (h.result && h.result.outcome !== 'ACIK') continue;
    h.result = evaluate(h, candlesOf(h.symbol, h.strategy), maxBars);
  }
  return { hist: kept.sort((a, b) => b.t - a.t), added };
}
