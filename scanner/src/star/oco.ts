// ⭐ OCO kırılım motoru — N7 (NR7 sıkışma) ve IB (iç gün) ortak. Şartname: docs/kurulum_N7_Sikisma_spec.md, kurulum_IB_IcMum_spec.md
// Sinyal seans günü kapanışında; ertesi seans için al-stop = H (stop L), sat-stop = L (stop H), hedef ±1,5R; OCO (biri dolunca diğeri iptal).
// Yönetim: stop −1R (giriş mumu dahil), hedef 1,5R (giriş mumunda sayılmaz), seans sonunda son 1H kapanışından çıkış; kırılım yoksa iptal.
// Açılış boşluğu: giriş = max(açılış, H) — R ve hedef gerçek girişe göre. Aynı 1H mumda iki seviye → testte işlem yok ("test dışı (çift kırılım)").
import type { Candle, StarId } from '../types.ts';
import { HOUR } from '../time.ts';
import type { StarCls, StarCommon } from './config.ts';
import { barEnd, expectedBar, gridStart, keyDay, type Grp } from './sessions.ts';
import { isInside, isNR, roundTick } from './ind.ts';

export interface OcoOrder {
  id: string; setup: StarId; sym: string; dayKey: string; dayT: number; dayEnd: number;
  H: number; L: number; R: number; sessStart: number; sessEnd: number; sessKey: string; notifiedAt: number;
  /** Anlık fiyatla tespit edilen dolum (1H mumu gelmeden; kullanıcı onayı istenir) */
  liveFill?: { dir: 1 | -1; t: number; price: number } | null;
}
export type OcoState = 'BEKLIYOR' | 'DOLDU' | 'KAPANDI' | 'IPTAL' | 'CIFT';
export interface OcoSim {
  state: OcoState; dir: 1 | -1 | null; fillT: number | null; entry: number | null; stop: number | null; R: number | null; target: number | null; gap: boolean;
  exitT: number | null; exit: number | null; reason: string | null; k: 'HEDEF' | 'STOP' | 'SEANS_SONU' | null; r: number | null; rNow: number | null;
}

/** Sinyal gününden sonraki ilk seans (24 saat: 18:00 → 17:00; ETF: borsa günü). Hafta sonu / bayram atlanır. */
export function nextSession(cls: StarCls, dayEnd: number, C: Pick<StarCommon, 'etfSessionNY'>): { key: string; start: number; end: number } | null {
  const etf = C.etfSessionNY, keyOf = keyDay(cls, C);
  for (let t = gridStart(cls, dayEnd); t < dayEnd + 6 * 24 * HOUR; t += HOUR) {
    if (t < dayEnd || !expectedBar(cls, t, etf)) continue;
    const k = keyOf(t);
    if (k && k.start >= dayEnd - HOUR) return k;
  }
  return null;
}

/** Testteki gibi sanal sonuç (her taramada kapanmış 1H mumlarından yeniden hesaplanır — repaint yok) */
export function simulate(o: OcoOrder, cls: StarCls, h1: Candle[], now: number, targetR: number, price: number | null, etf?: [string, string]): OcoSim {
  const S: OcoSim = { state: 'BEKLIYOR', dir: null, fillT: null, entry: null, stop: null, R: null, target: null, gap: false, exitT: null, exit: null, reason: null, k: null, r: null, rNow: null };
  const bars = h1.filter((b) => b.t >= o.sessStart && b.t < o.sessEnd);
  const lastEnd = h1.length ? barEnd(cls, h1[h1.length - 1].t, etf) : -Infinity;
  const done = now >= o.sessEnd && (lastEnd >= o.sessEnd || now >= o.sessEnd + 2 * HOUR);
  const exitAt = (t: number, px: number, reason: string, k: OcoSim['k']) => { S.state = 'KAPANDI'; S.exitT = t; S.exit = px; S.reason = reason; S.k = k; S.r = (S.dir! * (px - S.entry!)) / S.R!; };
  for (const b of bars) {
    if (S.dir === null) {
      const up = b.h >= o.H, dn = b.l <= o.L;
      // Çift kırılım: mum seviyelerin ARASINDA açılıp iki seviyeyi de geçtiyse (sıra bilinmez) → testte işlem yok.
      // Seviyenin ötesinde (boşlukla) açıldıysa o taraf açılışta dolmuştur; aynı mumda karşı uç = stop (−1R, giriş mumu dahil).
      const gapUp = b.o >= o.H, gapDn = b.o <= o.L;
      if (up && dn && !gapUp && !gapDn) { S.state = 'CIFT'; S.reason = 'test dışı (çift kırılım) — aynı 1H mumda iki seviye; testte işlem yoktu'; S.fillT = b.t; return S; }
      if (!up && !dn) continue;
      const d: 1 | -1 = up && dn ? (gapUp ? 1 : -1) : up ? 1 : -1;
      const lvl = d === 1 ? o.H : o.L;
      const entry = d === 1 ? Math.max(b.o, lvl) : Math.min(b.o, lvl);
      S.gap = entry !== lvl;
      S.dir = d; S.fillT = b.t; S.entry = entry; S.stop = d === 1 ? o.L : o.H; S.R = Math.abs(entry - S.stop); S.target = entry + d * targetR * S.R; S.state = 'DOLDU';
      // Giriş mumunda stop geçerli, hedef sayılmaz
      if (d === 1 ? b.l <= S.stop : b.h >= S.stop) { exitAt(b.t, S.stop, 'stop (giriş mumu)', 'STOP'); return S; }
      continue;
    }
    const d = S.dir;
    const hitStop = d === 1 ? b.l <= S.stop! : b.h >= S.stop!;
    const hitTgt = d === 1 ? b.h >= S.target! : b.l <= S.target!;
    if (hitStop) { const gap = d === 1 ? b.o < S.stop! : b.o > S.stop!; exitAt(b.t, gap ? b.o : S.stop!, hitTgt ? 'stop (aynı mum — stop önceliği)' : 'stop', 'STOP'); return S; }
    if (hitTgt) { exitAt(b.t, S.target!, 'hedef 1,5R', 'HEDEF'); return S; }
  }
  if (done) {
    if (S.dir === null) { S.state = 'IPTAL'; S.reason = 'seans boyunca seviye kırılmadı — emirler iptal'; return S; }
    const last = bars[bars.length - 1];
    exitAt(barEnd(cls, last.t, etf), last.c, 'seans sonu kapanış', 'SEANS_SONU');
    return S;
  }
  if (S.dir !== null && price !== null) S.rNow = (S.dir * (price - S.entry!)) / S.R!;
  return S;
}

export type OcoKind = 'NR7' | 'IB';
export interface OcoSignal { ok: boolean | null; why: string; day: Grp | null; prev: Grp | null; nr7: boolean | null; inside: boolean | null; min7: number | null; allValid: boolean }
/**
 * Sinyal tespiti (son kapanmış seans günü). N7: aralık son 7 günün en küçüğüne eşit (eşitlik dahil); 7 günün hepsi geçerli (N7.1).
 * IB: H < dünkü H ve L > dünkü L (fiyat adımına yuvarlanmış, kesin; IB.1) ve NR7 DEĞİL; bugün ve dün geçerli (IB.2), NR7 için 7 gün.
 */
export function detect(kind: OcoKind, daysAll: Grp[], tick: number): OcoSignal {
  const n = daysAll.length, day = daysAll[n - 1] ?? null, prev = daysAll[n - 2] ?? null;
  const last7 = daysAll.slice(-7);
  const allValid = last7.length === 7 && last7.every((d) => d.valid);
  const rng = (d: Grp) => roundTick(roundTick(d.h, tick) - roundTick(d.l, tick), tick);
  const min7 = last7.length ? Math.min(...last7.map(rng)) : null;
  const nr7 = last7.length === 7 ? isNR(last7, 6, 7, tick) : null;
  const inside = n >= 2 ? isInside(daysAll, n - 1, tick) : null;
  const base = { day, prev, nr7, inside, min7, allValid };
  if (!day) return { ok: null, why: 'veri yok', ...base };
  if (kind === 'NR7') {
    if (!allValid) return { ok: null, why: 'son 7 seans gününden biri eksik mumlu (N7.1) — sinyal yok', ...base };
    return { ok: !!nr7, why: nr7 ? `NR7: aralık ${rng(day)} = 7 günün en küçüğü` : `NR7 değil: aralık ${rng(day)} > 7 gün min ${min7}`, ...base };
  }
  if (!day.valid || !prev?.valid) return { ok: null, why: 'dün veya önceki gün eksik mumlu (IB.2) — sinyal yok', ...base };
  if (!allValid) return { ok: null, why: 'NR7 kontrolü için 7 geçerli gün yok — sinyal yok', ...base };
  if (!inside) return { ok: false, why: 'iç gün değil (H < dünkü H ve L > dünkü L şartı — eşitlik iç gün değil)', ...base };
  if (nr7) return { ok: false, why: 'iç gün ama aynı zamanda NR7 — ⭐N7\'nin alanı, IB sinyali yok', ...base };
  return { ok: true, why: 'iç gün (NR7 değil)', ...base };
}

/** Canlı seans adaylığı (EKSİK): N7 → bugünkü aralık şu an son 6 günün minimumundan küçük/eşit; IB → bugün şu ana kadar dünün içinde */
export function candidate(kind: OcoKind, days: Grp[], live: Grp | undefined, tick: number): { cand: boolean; ratio: number | null; text: string } {
  if (!live || !days.length) return { cand: false, ratio: null, text: '—' };
  const r = live.h - live.l;
  if (kind === 'NR7') {
    const prev6 = days.slice(-6);
    const min = Math.min(...prev6.map((d) => d.h - d.l));
    const ratio = min > 0 ? r / min : null;
    return { cand: prev6.length === 6 && r <= min, ratio, text: `bugünkü aralık / 7 gün minimumu: %${ratio !== null ? Math.round(ratio * 100) : '—'}` };
  }
  const y = days[days.length - 1];
  const cand = roundTick(live.h, tick) < roundTick(y.h, tick) && roundTick(live.l, tick) > roundTick(y.l, tick);
  return { cand, ratio: null, text: cand ? 'bugün şu ana kadar dünün içinde (iç gün adayı)' : 'bugün dünün dışına çıktı' };
}
