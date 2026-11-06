// ⭐ trend kırılımı motoru — M2 (1H Donchian 10/5), T4-S (4H 20/10 + yarı kâr), TD (günlük 55/20 + yarı kâr) ortak.
// Giriş: rejim yönünde TF kapanışı Donchian(entryN) dışında; stop = giriş ∓ stopAtr × ATR14(TF, sinyal mumu);
// isteğe bağlı T1 = giriş ± t1R × R'de pozisyonun t1Fraction'ı kapanır ve stop girişe çekilir; çıkış TF kapanışı Donchian(exitN) ters ötesi.
// Pozisyon testteki gibi sanal izlenir (giriş = sinyalden sonraki ilk 1H açılışı); her taramada kapanmış mumlardan yeniden hesaplanır (repaint yok).
import type { Candle, StarId } from '../types.ts';
import type { StarCls } from './config.ts';
import { barEnd } from './sessions.ts';
import { donchian, atr as atrSeries, type Regime } from './ind.ts';
import { doubleScan, kacti, signalId, type Pending } from './guard.ts';

export interface Bar extends Candle { end: number }
export interface TrendParams {
  id: StarId; name: string; tf: '1h' | '4h' | '1d';
  entryN: number; exitN: number; stopAtr: number; kactiAtr: number;
  t1R?: number; t1Fraction?: number; kactiT1Frac?: number;
  warmBars: number;
  /** Donchian çıkışı: 'nextOpen' = sonraki 1H açılışı (testte), 'close' = kapanış fiyatı (TD 24 saat: "teyitten sonra hemen") */
  exitAt: 'nextOpen' | 'close';
}
export type PosEvent = { k: 'GIRIS' | 'T1' | 'STOP' | 'CIKIS' | 'BE_STOP'; t: number; price: number; r?: number };
export interface StarPos {
  id: string; setup: StarId; sym: string; dir: 1 | -1;
  signalT: number; signalEnd: number; signalClose: number; atr: number; ref: number; notifiedAt: number;
  entry: number | null; entryT: number | null; stop: number; stop0: number; R: number;
  t1: number | null; t1Done: boolean; stopAtBe: boolean;
  open: boolean; closedT: number | null; exit: number | null; reason: string | null; r: number | null; rNow: number | null;
  exitPending: number | null; events: PosEvent[]; liveStopT?: number | null;
}
export type TrendStatus = 'TAM' | 'TAM_BEKLE' | 'EKSIK' | 'YOK' | 'VERI_GECIKMESI';
export interface Cond { id: string; label: string; status: 'ok' | 'fail' | 'wait'; detail: string }
export interface TrendRow {
  setup: StarId; symbol: string; status: TrendStatus; dir: 1 | -1 | null; conditions: Cond[];
  signalId: string | null; scanSeq: 0 | 1 | 2; finalCheck: 'OK' | 'KACTI' | null; blockedBy: string | null; note: string;
  levels: { up: number; dn: number; exitUp: number; exitDn: number; atr: number; price: number | null; distAtr: number | null; level: number | null };
  order: { type: 'MARKET' | 'MARKET_NEXT_OPEN'; ref_price: number; stop: number; t1: number | null; t1_fraction: number | null } | null;
  newPos: StarPos | null;
}

const fin = Number.isFinite;
const f = (x: number, d: number) => (fin(x) ? x.toFixed(d) : '—');

/** Pozisyonu kapanmış mumlardan yeniden hesapla (giriş, stop/T1 dokunuşu, TF kapanışı çıkışı). Aynı mumda stop ve T1 → stop önceliği. */
export function trackPos(pos: StarPos, cls: StarCls, h1: Candle[], bars: Bar[], p: TrendParams, now: number, price: number | null, etf?: [string, string]): StarPos {
  const P: StarPos = { ...pos, entry: null, entryT: null, t1Done: false, stopAtBe: false, open: true, closedT: null, exit: null, reason: null, r: null, rNow: null, exitPending: null, events: [] };
  const first = h1.find((b) => b.t >= pos.signalEnd);
  if (!first) { P.stop = pos.ref - pos.dir * p.stopAtr * pos.atr; P.R = p.stopAtr * pos.atr; P.t1 = p.t1R ? pos.ref + pos.dir * p.t1R * P.R : null; return P; }
  const d = pos.dir, entry = first.o, R = p.stopAtr * pos.atr;
  P.entry = entry; P.entryT = first.t; P.R = R; P.stop0 = entry - d * R; P.stop = P.stop0;
  P.t1 = p.t1R ? entry + d * p.t1R * R : null;
  P.events.push({ k: 'GIRIS', t: first.t, price: entry });
  const frac = p.t1Fraction ?? 0;
  const result = (exit: number) => (P.t1Done ? frac * (p.t1R ?? 0) + (1 - frac) * (d * (exit - entry)) / R : (d * (exit - entry)) / R);
  const close = (t: number, px: number, reason: string, k: PosEvent['k']) => { P.open = false; P.closedT = t; P.exit = px; P.reason = reason; P.r = result(px); P.events.push({ k, t, price: px, r: P.r }); };
  const ex = donchian(bars, p.exitN);
  const endIdx = new Map(bars.map((b, i) => [b.end, i]));
  for (const b of h1) {
    if (b.t < first.t) continue;
    if (P.exitPending !== null) { close(b.t, b.o, `${p.tf.toUpperCase()} kapanış Donchian ${p.exitN} kırıldı`, 'CIKIS'); break; }
    const hitStop = d === 1 ? b.l <= P.stop : b.h >= P.stop;
    const hitT1 = P.t1 !== null && !P.t1Done && (d === 1 ? b.h >= P.t1 : b.l <= P.t1);
    if (hitStop) {
      const gap = d === 1 ? b.o < P.stop : b.o > P.stop;
      close(b.t, gap ? b.o : P.stop, P.stopAtBe ? 'stop (giriş seviyesi)' : hitT1 ? 'stop (aynı mum — stop önceliği)' : 'stop', P.stopAtBe ? 'BE_STOP' : 'STOP');
      break;
    }
    if (hitT1) { P.t1Done = true; P.stopAtBe = true; P.stop = entry; P.events.push({ k: 'T1', t: b.t, price: P.t1! }); }
    const end = barEnd(cls, b.t, etf);
    const gi = endIdx.get(end);
    if (gi !== undefined && fin(ex.dn[gi])) {
      const g = bars[gi];
      const out = d === 1 ? g.c < ex.dn[gi] : g.c > ex.up[gi];
      if (out) {
        if (p.exitAt === 'close') { close(g.end, g.c, `${p.tf === '1d' ? 'günlük' : p.tf.toUpperCase()} kapanış Donchian ${p.exitN} kırıldı`, 'CIKIS'); break; }
        P.exitPending = g.end;
      }
    }
  }
  if (P.open && price !== null && pos.liveStopT && P.events.length) {
    // Anlık fiyat stopu geçmişti (sunucuda bekleyen stop) — 1H mumu henüz gelmediyse
    close(pos.liveStopT, P.stop, P.stopAtBe ? 'stop (giriş seviyesi)' : 'stop', P.stopAtBe ? 'BE_STOP' : 'STOP');
  }
  if (P.open && price !== null) P.rNow = result(price);
  return P;
}

/**
 * Tek enstrüman, tek kurulum: sinyal değerlendirmesi (§7 koruma dahil). Açık pozisyon yoksa çağrılır.
 * `price` = son kontrol için anlık fiyat (yoksa null → son kapanış). `pending` çift tarama hafızası.
 */
export function evalTrend(o: {
  p: TrendParams; sym: string; bars: Bar[]; regime: Regime | null; fresh: boolean; missing: number; now: number; scanT: number;
  price: number | null; jump: boolean; pending: Record<string, Pending>; done: Set<string>; openPos: StarPos | null; lastClosedT: number | null; dec: number; maxAgeMs: number;
}): TrendRow {
  const { p, sym, bars, regime, now, dec } = o;
  const i = bars.length - 1;
  const g = bars[i];
  const up = donchian(bars, p.entryN), ex = donchian(bars, p.exitN);
  const a = atrSeries(bars, 14);
  const lv = { up: up.up[i] ?? NaN, dn: up.dn[i] ?? NaN, exitUp: ex.up[i] ?? NaN, exitDn: ex.dn[i] ?? NaN, atr: a[i] ?? NaN, price: o.price ?? g?.c ?? null, distAtr: null as number | null, level: null as number | null };
  const conds: Cond[] = [];
  const row = (status: TrendStatus, dir: 1 | -1 | null, note: string, extra: Partial<TrendRow> = {}): TrendRow => ({ setup: p.id, symbol: sym, status, dir, conditions: conds, signalId: null, scanSeq: 0, finalCheck: null, blockedBy: null, note, levels: lv, order: null, newPos: null, ...extra });
  const tfName = p.tf === '1d' ? 'Günlük' : p.tf.toUpperCase();
  // 1 Veri
  const warm = bars.length >= p.warmBars && regime?.value !== null && regime !== null;
  if (!g) { conds.push({ id: 'veri', label: 'Veri tamam ve taze', status: 'wait', detail: '⏳ veri yok' }); return row('YOK', null, 'veri yok'); }
  if (!o.fresh) { conds.push({ id: 'veri', label: 'Veri tamam ve taze', status: 'fail', detail: 'VERİ GECİKMESİ — son kapanış beklenenden 2 saatten eski' }); return row('VERI_GECIKMESI', null, 'VERİ GECİKMESİ'); }
  if (!warm || o.missing > 0) {
    conds.push({ id: 'veri', label: 'Veri tamam ve taze', status: 'wait', detail: o.missing ? `⏳ veri eksik (${o.missing} beklenmeyen boşluk)` : `⏳ ısınma: ${bars.length}/${p.warmBars} ${tfName} mum, rejim ${regime?.days ?? 0}/210 gün` });
    return row('YOK', null, 'veri eksik');
  }
  conds.push({ id: 'veri', label: 'Veri tamam ve taze', status: 'ok', detail: `${bars.length} ${tfName} mum · son kapanış ${new Date(g.end).toISOString().slice(11, 16)} UTC` });
  // 2 Rejim
  const dir = regime!.value as 1 | -1 | 0;
  conds.push({ id: 'rejim', label: 'Rejim ±1', status: dir ? 'ok' : 'fail', detail: `C ${f(regime!.close, dec)} · EMA50 ${f(regime!.ema50, dec)} · EMA200 ${f(regime!.ema200, dec)} · 60g ${(regime!.ret60 * 100).toFixed(1)}% → ${dir === 1 ? '+1 (sadece LONG)' : dir === -1 ? '−1 (sadece SHORT)' : '0 (işlem yok)'}` });
  if (!dir) return row('YOK', null, 'rejim 0 — işlem yok');
  // 3 Kırılım
  const level = dir === 1 ? lv.up : lv.dn;
  lv.level = level;
  lv.distAtr = lv.price !== null && fin(lv.atr) && lv.atr > 0 ? (dir * (level - lv.price)) / lv.atr : null;
  const brk = dir === 1 ? g.c > level : g.c < level;
  const age = now - g.end;
  const kname = `Donchian ${p.entryN}`;
  // 4 Açık pozisyon
  if (o.openPos) {
    conds.push({ id: 'kirilim', label: `${tfName} kapanış ${kname} dışında`, status: brk ? 'ok' : 'wait', detail: `${dir === 1 ? 'DU' : 'DA'}${p.entryN} = ${f(level, dec)} · kapanış ${f(g.c, dec)}` });
    conds.push({ id: 'pozisyon', label: `Açık ${p.name} yok`, status: 'fail', detail: `Açık ${p.name} pozisyonu var (${o.openPos.dir === 1 ? '▲ LONG' : '▼ SHORT'}) — kapanmadan yeni sinyal yok` });
    return row('YOK', null, 'açık pozisyon');
  }
  const sid = signalId(p.id === 'T4S' ? 'T4-S' : p.id, sym, g.t);
  const already = o.done.has(sid) || (o.lastClosedT !== null && g.end <= o.lastClosedT);
  if (!brk || already || age > o.maxAgeMs) {
    conds.push({ id: 'kirilim', label: `${tfName} kapanış ${kname} dışında`, status: 'wait', detail: brk && already ? `Bu mumun sinyali işlendi (${sid}) — sonraki kapanış bekleniyor` : brk ? 'Sinyal mumu eski — sonraki kapanış bekleniyor' : `kırılım seviyesi ${dir === 1 ? 'DU' : 'DA'}${p.entryN} = ${f(level, dec)}, fiyata uzaklık: ${lv.distAtr !== null ? lv.distAtr.toFixed(2) : '—'} ATR` });
    conds.push({ id: 'pozisyon', label: `Açık ${p.name} yok`, status: 'ok', detail: 'yok' });
    conds.push({ id: 'koruma', label: 'Hatalı sinyal koruması', status: 'wait', detail: 'kırılım bekleniyor' });
    return row('EKSIK', dir, `kırılım bekleniyor (${dir === 1 ? 'DU' : 'DA'}${p.entryN} = ${f(level, dec)})`);
  }
  conds.push({ id: 'kirilim', label: `${tfName} kapanış ${kname} dışında`, status: 'ok', detail: `kapanış ${f(g.c, dec)} ${dir === 1 ? '>' : '<'} ${dir === 1 ? 'DU' : 'DA'}${p.entryN} ${f(level, dec)}` });
  conds.push({ id: 'pozisyon', label: `Açık ${p.name} yok`, status: 'ok', detail: 'yok' });
  // 5 Koruma: çift tarama (veri yeniden çekilerek) + son kontrol
  const ps = doubleScan(o.pending, sid, `${dir}|${g.t}`, o.scanT);
  const ref = lv.price ?? g.c;
  const stop = ref - dir * p.stopAtr * lv.atr;
  const t1 = p.t1R ? ref + dir * p.t1R * p.stopAtr * lv.atr : null;
  const order = { type: (p.tf === '1d' ? 'MARKET_NEXT_OPEN' : 'MARKET') as 'MARKET' | 'MARKET_NEXT_OPEN', ref_price: ref, stop, t1, t1_fraction: p.t1Fraction ?? null };
  if (ps.seq === 1) {
    conds.push({ id: 'koruma', label: 'Hatalı sinyal koruması', status: 'wait', detail: 'teyit 1/2 — sonraki taramada veri yeniden çekilip kontrol edilecek' });
    return row('TAM_BEKLE', dir, 'teyit 1/2', { signalId: sid, scanSeq: 1, order });
  }
  if (o.jump) {
    conds.push({ id: 'koruma', label: 'Hatalı sinyal koruması', status: 'wait', detail: 'teyit 2/2 · anlık fiyat son kapanıştan çok uzak (kötü tick?) — sonraki tarama bekleniyor' });
    return row('TAM_BEKLE', dir, 'kötü tick şüphesi', { signalId: sid, scanSeq: 2, order, blockedBy: 'KOTU_TICK' });
  }
  const t1Gone = p.kactiT1Frac !== undefined && t1 !== null && o.price !== null && dir * (o.price - g.c) > p.kactiT1Frac * Math.abs(t1 - g.c);
  if (kacti(dir, g.c, o.price, p.kactiAtr * lv.atr) || t1Gone) {
    conds.push({ id: 'koruma', label: 'Hatalı sinyal koruması', status: 'fail', detail: `KAÇTI — fiyat ${f(o.price!, dec)} sinyal kapanışından ${(dir * (o.price! - g.c) / lv.atr).toFixed(2)} ATR ilerledi (eşik ${p.kactiAtr} ATR${p.kactiT1Frac ? `, T1'e %${p.kactiT1Frac * 100}` : ''}) — sonraki kapanış beklenir` });
    return row('EKSIK', dir, 'KAÇTI — sonraki kapanış', { signalId: sid, scanSeq: 2, finalCheck: 'KACTI', blockedBy: 'KACTI' });
  }
  conds.push({ id: 'koruma', label: 'Hatalı sinyal koruması', status: 'ok', detail: `teyit 2/2 · son kontrol OK (fiyat ${f(ref, dec)}, eşik ${p.kactiAtr} ATR)` });
  const newPos: StarPos = {
    id: sid, setup: p.id, sym, dir, signalT: g.t, signalEnd: g.end, signalClose: g.c, atr: lv.atr, ref, notifiedAt: now,
    entry: null, entryT: null, stop, stop0: stop, R: p.stopAtr * lv.atr, t1, t1Done: false, stopAtBe: false,
    open: true, closedT: null, exit: null, reason: null, r: null, rNow: null, exitPending: null, events: [],
  };
  return row('TAM', dir, 'TAM', { signalId: sid, scanSeq: 2, finalCheck: 'OK', order, newPos });
}
