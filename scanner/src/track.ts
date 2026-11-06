/**
 * İşlem takibi (EK §3.6–3.8, §3.10–3.11): her TAM sinyal için kayıtlı mumlardan
 * dolum → TP1 (%50 kapat + stop girişe) → TP2 / BE, ya da SL. Ek kredi yok.
 * Sonuç hem kullanıcının girdiği işlemlerin otomatik günlüğüne, hem de girilmeyen sinyallerin
 * "sanal sonucuna" (kaçan R) kaynak olur. Bildirimler: TP1 / TP2 / SL / BE / haber kuralı.
 */
import type { Config } from './config.ts';
import type { Candle, NewsEvent, StrategyId } from './types.ts';
import type { HistEvent } from './history.ts';
import { MIN, fmtTR, durationText } from './time.ts';
import { SHORT, type Msg } from './push.ts';

export type TrackType = 'FILL' | 'TP1' | 'TP2' | 'SL' | 'BE' | 'TRAIL';
export interface Track {
  status: 'BEKLIYOR' | 'ACIK' | 'KAPANDI' | 'DOLMADI';
  events: { type: TrackType; t: number; price: number }[];
  resultR?: number; maeR: number; mfeR: number; lastPrice?: number; liveR?: number; updatedAt: number;
  /** H: güncel trailing stop (sadece ekranda) */
  trail?: number;
}

/** Varsayılan yönetim (kurulumun kendi kuralı yoksa): TP1'de %50 + stop girişe; aynı mumda stop ve hedef → stop (temkinli) */
export function trackEvent(h: HistEvent, candles: Candle[], now: number): Track | undefined {
  const m = h.method;
  if (!m || !h.dir) return undefined;
  const risk = Math.abs(m.entry - m.stop);
  if (!(risk > 0)) return undefined;
  const d = h.dir;
  const start = (h.signalAt && m.type === 'market' ? h.signalAt : h.t) - 60_000;
  const after = candles.filter((c) => c.t >= start);
  const ev: Track['events'] = [];
  const rr1 = Math.abs(m.tp1 - m.entry) / risk, rr2 = m.tp2 !== undefined ? Math.abs(m.tp2 - m.entry) / risk : undefined;
  let filled = m.type === 'market';
  if (filled) ev.push({ type: 'FILL', t: h.signalAt ?? h.t, price: m.entry });
  const isH = h.strategy === 'H' && !!m.trailAtr;
  let phase = 0, mfe = 0, mae = 0, hh = -Infinity, trail = m.entry;
  const done = (type: TrackType, t: number, price: number, r: number): Track => ({ status: 'KAPANDI', events: [...ev, { type, t, price }], resultR: +r.toFixed(2), maeR: +mae.toFixed(2), mfeR: +mfe.toFixed(2), updatedAt: now });
  for (const c of after) {
    if (!filled) {
      if (h.lastEntry && c.t >= h.lastEntry) return { status: 'DOLMADI', events: ev, maeR: 0, mfeR: 0, updatedAt: now };
      if (d === 1 ? c.l <= m.entry : c.h >= m.entry) { filled = true; ev.push({ type: 'FILL', t: c.t, price: m.entry }); }
      else continue;
    }
    const fav = (d === 1 ? c.h - m.entry : m.entry - c.l) / risk, adv = (d === 1 ? m.entry - c.l : c.h - m.entry) / risk;
    mfe = Math.max(mfe, fav); mae = Math.max(mae, adv);
    const sl = d === 1 ? c.l <= m.stop : c.h >= m.stop;
    const hit = (p: number) => (d === 1 ? c.h >= p : c.l <= p);
    if (isH && phase === 1) { // H: kalan %50 trailing — stop = max(giriş, HH − 3×ATR14_1H); T2 kapanış sebebi değil
      const stopNow = trail;
      if (d === 1 ? c.l <= stopNow : c.h >= stopNow) return done(stopNow === m.entry ? 'BE' : 'TRAIL', c.t, stopNow, 0.5 * rr1 + 0.5 * (((stopNow - m.entry) * d) / risk));
      hh = Math.max(hh, d === 1 ? c.h : -c.l);
      const cand = d === 1 ? hh - 3 * m.trailAtr! : -(hh) + 3 * m.trailAtr!;
      trail = d === 1 ? Math.max(trail, cand) : Math.min(trail, cand);
      continue;
    }
    if (phase === 0) {
      if (sl) return done('SL', c.t, m.stop, -1);
      if (hit(m.tp1)) {
        if (isH) { ev.push({ type: 'TP1', t: c.t, price: m.tp1 }); phase = 1; hh = d === 1 ? c.h : -c.l; continue; }
        if (rr2 === undefined) return done('TP1', c.t, m.tp1, rr1);
        ev.push({ type: 'TP1', t: c.t, price: m.tp1 }); phase = 1;
        if (hit(m.tp2!)) return done('TP2', c.t, m.tp2!, 0.5 * rr1 + 0.5 * rr2);
      }
    } else {
      const be = d === 1 ? c.l <= m.entry : c.h >= m.entry;
      if (be) return done('BE', c.t, m.entry, 0.5 * rr1);
      if (hit(m.tp2!)) return done('TP2', c.t, m.tp2!, 0.5 * rr1 + 0.5 * rr2!);
    }
  }
  const last = after[after.length - 1]?.c;
  const liveR = filled && last !== undefined ? +(((last - m.entry) * d) / risk).toFixed(2) : undefined;
  return { status: filled ? 'ACIK' : 'BEKLIYOR', events: ev, maeR: +mae.toFixed(2), mfeR: +mfe.toFixed(2), lastPrice: last, liveR, updatedAt: now, ...(isH && phase === 1 ? { trail } : {}) };
}

/** Kurulumun açık işlemde haber kuralı (G kendi bildirimini atar) */
const NEWS_RULE: Partial<Record<StrategyId, string>> = {
  F: 'T1 alınmadıysa pozisyonu küçült veya stop girişe',
};
const DEFAULT_NEWS_RULE = 'TP1 alınmadıysa çık ya da stop girişe çek';
/** F ve G'nin T1 / çıkış bildirimleri kendi modüllerinde (çift bildirim yok) */
const OWN: Partial<Record<StrategyId, TrackType[]>> = { F: ['TP1'], G: ['TP1'] };

/**
 * Takip olaylarından bildirimler. Sadece TAM bildirimi gönderilmiş sinyaller; olay en fazla 20 dk önce
 * olmuş olmalı (ilk kurulumda geçmiş olaylar yağmuru olmaz). Anahtar: id+TRK+tip.
 */
export function trackMessages(conf: Config, hist: HistEvent[], notified: Record<string, number>, news: NewsEvent[], now: number): Msg[] {
  const out: Msg[] = [];
  for (const h of hist) {
    if (h.kind !== 'TAM' || !h.track || !(h.key in notified)) continue;
    const S = `${h.strategy} · ${SHORT[h.symbol] ?? h.symbol} ${h.dir === 1 ? '▲ LONG' : '▼ SHORT'}`;
    const url = `./#/islemler/${encodeURIComponent(h.id)}`;
    const base = { strategy: h.strategy, symbol: h.symbol, url, signal: h.id };
    for (const e of h.track.events) {
      const key = `${h.id}+TRK+${e.type}`;
      if (key in notified || now - e.t > 20 * MIN || e.type === 'FILL' || OWN[h.strategy]?.includes(e.type)) continue;
      notified[key] = now;
      const text: Record<Exclude<TrackType, 'FILL'>, [string, string]> = {
        TP1: [`🎯 ${S}: TP1`, h.strategy === 'H' ? 'H: T1 — %50 kapat, stop girişe; kalan trailing' : `${h.strategy}: TP1 — %50 kapat, SL'yi girişe çek`],
        TRAIL: [`🎯 ${S}: trailing stop`, `${h.strategy}: trailing stop — kalan %50 kapandı (+${h.track.resultR?.toFixed(2)}R)`],
        TP2: [`🎯 ${S}: TP2`, `${h.strategy}: TP2 — kalanı kapat (+${h.track.resultR?.toFixed(2)}R)`],
        SL: [`🛑 ${S}: Stop`, `${h.strategy}: Stop — işlemi kapat, günlük kaydı tamamla (−1R)`],
        BE: [`➖ ${S}: Girişe döndü`, `${h.strategy}: TP1 sonrası stop girişte — kalan %50 BE (+${h.track.resultR?.toFixed(2)}R)`],
      };
      const [title, body] = text[e.type as Exclude<TrackType, 'FILL'>];
      out.push({ ...base, kind: 'trade', title, body, tag: key });
    }
    // Haber kuralı: açık işlemde ilgili kırmızı habere ≤ 15 dk (G kendi kuralını gönderir)
    if (h.track.status === 'ACIK' && h.strategy !== 'G') {
      const cur = conf.symbols[h.symbol]?.currencies ?? [];
      for (const n of news) {
        if (n.impact !== 'High' || !conf.params.news.currencies.includes(n.currency)) continue;
        if (!(n.symbols ? n.symbols.includes(h.symbol) : n.currency === 'USD' || cur.includes(n.currency))) continue;
        const dt = n.t - now, key = `${h.id}+NEWS+${n.id}`;
        if (dt <= 0 || dt > 15 * MIN || key in notified) continue;
        notified[key] = now;
        out.push({ ...base, kind: 'trade', title: `⚠️ ${S}: haber ${durationText(dt)} sonra`, body: `${n.currency} ${n.title} ${fmtTR(n.t)} TR — ${NEWS_RULE[h.strategy] ?? DEFAULT_NEWS_RULE}`, tag: key });
      }
    }
  }
  return out;
}

/** Açık (dolmuş, kapanmamış) sinyal kimlikleri — iptal bildirimi bunlar için "ÇIKIŞ" olur */
export function openSignalIds(hist: HistEvent[]): Set<string> {
  return new Set(hist.filter((h) => h.track?.status === 'ACIK').map((h) => h.id));
}
