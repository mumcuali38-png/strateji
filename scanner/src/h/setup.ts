// KURULUM H — Trend Devam (Pullback): değerlendirme ve hatalı sinyal koruması (§10). Şartname: docs/KURULUM_H.md
import type { Candle, Condition, Dir, EntryMethod, NewsEvent, Overlay, Setup } from '../types.ts';
import type { Config } from '../config.ts';
import { Ctx, finalize, pushTargetOverlays } from '../context.ts';
import { atr as atrSeries, ema } from '../indicators.ts';
import { HOUR, MIN, fmtTR, durationText, nyMinutes, nyDow, utcDateStr, parseHM, inNyLocal, nyLocal } from '../time.ts';
import { mirror } from '../f/wyckoff.ts';
import { cleanBadTicks, trendCheck, pullbacks, character, microTrigger, holyGrail, order, volShock, bos4h, last, type TrendCheck } from './core.ts';

export type HSym = 'XAUUSD' | 'US100' | 'BTCUSD';
export interface HInput { sym: HSym; d1: Candle[]; h4: Candle[]; h1: Candle[]; m15: Candle[]; m5: Candle[]; price: number | null; source: string; qqqRatio?: number }
export interface HMem { active?: Partial<Record<'1' | '-1', boolean>>; cooldownUntil?: number; cooldownWhy?: string; pending?: { sig: string; t: number } }
export interface HParams {
  adxIn: number; adxOut: number; adxNone: number; adxStrong: number; emaHystAtr: number; ret60: number; warmD1: number; warm4h: number;
  maxK: number; rsiMin: number; maxDepth: number; stopAtr1h: number; maxStopAtr4h: number; minRR2: number; triggerValid15m: number;
  trigger: 'micro' | 'holygrail'; hgValid1h: number; hgOffAtr: number; trailAtr: number; newsBlockMin: number; newsBarMin: number;
  volShock: number; badTickAtr: number; jumpPct: Record<string, number>; cooldown1h: number; usSession: [string, string];
  fundingBlockMin: number; maxDataAgeBars: number; confirmMinSec: number; finalCheckR: number;
}

const cond = (id: string, label: string, status: Condition['status'], detail: string, level?: number): Condition => (level === undefined ? { id, label, status, detail } : { id, label, status, detail, level });
const SHORT: Record<string, string> = { XAUUSD: 'XAU', US100: 'US100', BTCUSD: 'BTC' };
const pct = (x: number) => `%${(x * 100).toFixed(1)}`;

/** Piyasa açık mı (veri tazeliği yalnız açıkken beklenir — §10.4/§10.7) */
export function marketOpen(sym: HSym, t: number): boolean {
  if (sym === 'BTCUSD') return true;
  if (sym === 'US100') return inNyLocal(t, '09:30', '16:00');
  const d = nyDow(t), m = nyMinutes(t); // XAU: Pazar 18:00 → Cuma 17:00 (sabit UTC-5), günlük 17–18 arası
  if (d === 6 || (d === 5 && m >= 17 * 60) || (d === 0 && m < 18 * 60)) return false;
  return !(m >= 17 * 60 && m < 18 * 60);
}
/** §10.7 Beklenmeyen 1H boşluğu (hafta sonu / seans dışı / günlük ara hariç) */
export function missingBars(sym: HSym, h1: Candle[], lookback = 250): number {
  if (sym === 'US100') return 0; // QQQ sadece seans içi veri — boşluklar beklenen
  let n = 0;
  for (let i = Math.max(1, h1.length - lookback); i < h1.length; i++) {
    const gap = h1[i].t - h1[i - 1].t;
    if (gap <= HOUR) continue;
    let expected = true;
    for (let t = h1[i - 1].t + HOUR; t < h1[i].t; t += HOUR) if (marketOpen(sym, t + 30 * MIN)) expected = false;
    if (!expected) n++;
  }
  return n;
}
/** §9 Giriş penceresi */
export function entryWindow(sym: HSym, t: number, conf: Config, P: HParams): { open: boolean; text: string } {
  if (sym === 'XAUUSD') {
    const kz = conf.sessions.killzones.filter((k) => k.id === 'LO' || k.id === 'NYO');
    const m = nyMinutes(t), hit = kz.find((k) => m >= parseHM(k.start) && m < parseHM(k.end));
    return { open: !!hit && nyDow(t) >= 1 && nyDow(t) <= 5, text: hit ? `${hit.name} içinde` : 'Giriş penceresi dışında (10:00–13:00 / 15:00–18:00 TR)' };
  }
  if (sym === 'US100') {
    const open = inNyLocal(t, P.usSession[0], P.usSession[1]);
    return { open, text: open ? 'NY seansı içinde (09:45–15:30 NY)' : 'NY seansı dışında (giriş 09:45–15:30 NY, yaz saatli)' };
  }
  // BTC: 7/24; funding ±15 dk ve Cumartesi yeni giriş yok
  const d = new Date(t);
  if (d.getUTCDay() === 6) return { open: false, text: 'Cumartesi — yeni giriş yok' };
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  const f = conf.params.F.fundingUTC.map(parseHM).find((x) => Math.min(Math.abs(m - x), 1440 - Math.abs(m - x)) <= P.fundingBlockMin);
  if (f !== undefined) return { open: false, text: `Funding saati ±${P.fundingBlockMin} dk — giriş yok` };
  return { open: true, text: '7/24 (funding ve Cumartesi hariç)' };
}

function relevantNews(conf: Config, sym: string, news: NewsEvent[]) {
  const cur = conf.symbols[sym]?.currencies ?? ['USD'];
  return news.filter((e) => e.impact === 'High' && conf.params.news.currencies.includes(e.currency) && (e.symbols ? e.symbols.includes(sym) : e.currency === 'USD' || cur.includes(e.currency)));
}

export function evalH(conf: Config, inp: HInput | null, now: number, news: NewsEvent[], memIn: HMem, others: Setup[], sym: HSym = inp?.sym ?? 'XAUUSD'): { setup: Setup; mem: HMem } {
  const P = (conf.params as unknown as { H: HParams }).H;
  const mem: HMem = { ...memIn, active: { ...(memIn.active ?? {}) } };
  const ctx = new Ctx(sym, conf, now, { m5: inp?.m5 ?? [], m1: [], d1: [] }, news);
  const dec = conf.symbols[sym]?.decimals ?? 2;
  const f = (x: number) => (Number.isFinite(x) ? x.toFixed(dec) : '—');
  const base = { strategy: 'H' as const, chartTf: '1h' as const, tfs: ['15m', '1h', '4h', '1d'] as Setup['tfs'], chartKey: `${sym}_H` };
  const none = (id: string, sub: string, c: Condition[], why: string, waiting: string, info: Record<string, unknown> = {}) =>
    finalize(ctx, { ...base, id: `H-${sym}-${id}`, sub, dir: 0, zoneId: id, methods: [], overlays: [], conditions: c, none: { why, waiting, ends: '—' }, info: { h: { status: 'YOK', ...info } } });

  // ---------- 1. Veri (§10.1, §10.4, §10.5, §10.7) ----------
  if (!inp || inp.h1.length < 60 || inp.h4.length < 20) {
    return { setup: none('veri', 'Trend devam · VERİ YOK', [cond('data', 'Veri tamam ve taze', 'fail', `VERİ YOK — ${inp ? `1H ${inp.h1.length} / 4H ${inp.h4.length} mum` : 'kaynak cevap vermedi'}`)], 'Veri yok — tahmin üretilmez', 'Bir sonraki taramada veri'), mem };
  }
  const bt1 = cleanBadTicks(inp.h1, P.badTickAtr), bt15 = cleanBadTicks(inp.m15, P.badTickAtr);
  const h1R = bt1.clean, m15R = bt15.clean;
  const lastH1 = last(h1R)!, last15 = last(m15R);
  const open = marketOpen(sym, now);
  const age1 = now - (lastH1.t + HOUR), age15 = last15 ? now - (last15.t + 15 * MIN) : Infinity;
  if (open && (age1 > P.maxDataAgeBars * HOUR || age15 > P.maxDataAgeBars * 15 * MIN)) {
    return { setup: none('veri', 'Trend devam · VERİ GECİKMESİ', [cond('data', 'Veri tamam ve taze', 'fail', `10.4 VERİ GECİKMESİ — son 1H mum ${fmtTR(lastH1.t)} TR (${durationText(age1)} önce), son 15m ${last15 ? fmtTR(last15.t) : '—'} TR · ${inp.source}`)], 'Veri gecikmesi — sinyal üretilmez', 'Güncel veri', { status: 'VERI_GECIKMESI' }), mem };
  }
  const miss = missingBars(sym, h1R);
  const lastClose = last15?.c ?? lastH1.c;
  const jump = inp.price !== null && lastClose > 0 ? Math.abs(inp.price - lastClose) / lastClose * 100 : 0;
  const jumpLim = P.jumpPct[sym] ?? 0.3;
  const dataCond = miss > 0 ? cond('data', 'Veri tamam ve taze', 'wait', `10.7 veri eksik — son 250 1H içinde ${miss} beklenmeyen boşluk; göstergeler hesaplanmadı`)
    : jump > jumpLim ? cond('data', 'Veri tamam ve taze', 'wait', `10.5 anlık fiyat ${f(inp.price!)} son kapanıştan %${jump.toFixed(2)} uzak (> %${jumpLim}) — sonraki tarama bekleniyor`)
    : cond('data', 'Veri tamam ve taze', 'ok', `${open ? 'Taze' : 'Piyasa kapalı (son veri)'} · son 1H ${fmtTR(lastH1.t)} TR · ${inp.source}${bt1.removed.length + bt15.removed.length ? ` · 10.5: ${bt1.removed.length + bt15.removed.length} kötü tick mumu çıkarıldı` : ''}`);
  if (miss > 0) return { setup: none('veri', 'Trend devam · veri eksik', [dataCond], 'Veri eksik — göstergeler hesaplanmadı', 'Eksik mumların tamamlanması'), mem };

  // ---------- 2–4. Trend (§4) — yön seçimi ----------
  const Pt = { adxIn: P.adxIn, adxOut: P.adxOut, adxNone: P.adxNone, adxStrong: P.adxStrong, emaHystAtr: P.emaHystAtr, ret60: P.ret60, warmD1: P.warmD1, warm4h: P.warm4h };
  const tL = trendCheck(inp.d1, inp.h4, !!mem.active?.['1'], Pt);
  const tS = trendCheck(mirror(inp.d1), mirror(inp.h4), !!mem.active?.['-1'], Pt);
  const pick: Dir = tS.t1.ok && !tL.t1.ok ? -1 : tL.t1.ok ? 1 : (inp.d1.length && last(inp.d1)!.c < (tL.t1.ema50 || Infinity) ? -1 : 1);
  const dir: Dir = pick;
  const T: TrendCheck = dir === 1 ? tL : tS;
  const S = dir; // gerçek fiyat = S × uzay fiyatı
  const dirTxt = dir === 1 ? 'LONG' : 'SHORT';
  const ok3 = (x: boolean | null) => (x === null ? 'wait' : x ? 'ok' : 'fail') as Condition['status'];
  const conds: Condition[] = [dataCond];
  conds.push(cond('t1', 'Günlük trend (T1)', ok3(T.t1.ok), T.t1.ok === null ? `EMA200 ısınması için günlük veri bekleniyor (${inp.d1.length}/${P.warmD1})` : `Kapanış ${f(S * T.t1.close)} · EMA50 ${f(S * T.t1.ema50)} · EMA200 ${f(S * T.t1.ema200)} · 60 gün getiri ${pct(S * T.t1.ret60)}`));
  const mixed = T.t1.ok && (T.t2.bos === -1 || (T.t3.ok === false && !T.t3.none && (dir === 1 ? tS : tL).t3.ok));
  conds.push(cond('t2', '4H yapı (T2)', mixed ? 'fail' : ok3(T.t2.ok), `${mixed ? 'Trend uyumsuz — ' : ''}4H kapanış ${f(S * T.t2.close)} · EMA50 ${f(S * T.t2.ema50)} · son BOS ${T.t2.bos === 1 ? (dir === 1 ? 'yukarı' : 'aşağı') : T.t2.bos === -1 ? (dir === 1 ? 'aşağı' : 'yukarı') : 'yok'}${T.t2.tBOS ? ` (${fmtTR(T.t2.tBOS)} TR)` : ''}`));
  conds.push(cond('t3', '4H güç (T3)', ok3(T.t3.ok), `ADX14 ${Number.isFinite(T.t3.adx) ? T.t3.adx.toFixed(1) : '—'} ${T.t3.rising ? '↑' : '↓'}${T.t3.none ? ' — < 20, trend yok' : ''}${mem.active?.[String(dir) as '1'] ? ' · aktif trend (çıkış eşiği 22)' : ' · giriş eşiği 25 + yükselen'}`));
  const trendOk = T.t1.ok === true && T.t2.ok === true && T.t3.ok === true && !mixed;
  mem.active = { ...mem.active, [String(dir)]: trendOk, [String(-dir)]: false };
  const day = utcDateStr(now);
  const notices: NonNullable<Setup['notices']> = [];
  if (trendOk) notices.push({ key: `H-trend-${sym}-${dir}-${day}`, title: `📈 H · ${SHORT[sym]} ${dir === 1 ? '▲' : '▼'} ${dirTxt} trend`, body: `H: ${SHORT[sym]} ${dirTxt} trend aktif — geri çekilme bekleniyor` });
  const quality0 = T.quality;
  const D = dir === 1 ? { h1: h1R, h4: inp.h4, m15: m15R } : { h1: mirror(h1R), h4: mirror(inp.h4), m15: mirror(m15R) };
  const atr1h = last(atrSeries(D.h1, 14)) ?? NaN, atr4h = last(atrSeries(D.h4, 14)) ?? NaN;
  const e20 = ema(D.h1.map((x) => x.c), 20), e50 = ema(D.h1.map((x) => x.c), 50);
  const finish = (id: string, zoneId: string, extra: Partial<Setup> = {}, info: Record<string, unknown> = {}): { setup: Setup; mem: HMem } => {
    while (conds.length < 11) conds.push(cond(['', '', '', '', 'k', 'zone', 'char', 'trigger', 'rr', 'time', 'guard'][conds.length], ['', '', '', '', 'Geri çekilme sayısı', 'Değer bölgesinde', 'Düzeltme karakteri (P1–P4)', '15m tetik', 'Stop ve RR', 'Saat ve ortam', 'Hatalı sinyal koruması'][conds.length], 'wait', 'Önceki şartlar bekleniyor'));
    const s = finalize(ctx, { ...base, id: `H-${sym}-${id}`, sub: extra.sub ?? 'Trend devam', dir, zoneId, methods: [], overlays: [], conditions: conds, notices, info: { h: { quality: quality0, ...info } }, ...extra });
    return { setup: s, mem };
  };
  if (!trendOk) return finish('trend', `trend-${day}`, { sub: `Trend devam · trend yok` });

  // ---------- 5. Geri çekilme sayısı (§5.1) ----------
  const tBOS = T.t2.tBOS!;
  const pbs = pullbacks(D.h1, tBOS);
  const sigBase = `${tBOS}-${pbs.k}`;
  if (pbs.k > P.maxK || (!pbs.inPB && pbs.k >= P.maxK)) {
    conds.push(cond('k', 'Geri çekilme sayısı', 'fail', `${pbs.k}. geri çekilme${!pbs.inPB ? ' tamamlandı, sıradaki 3.' : ''} — trend yorgun (sadece 1. ve 2. alınır)`));
    return finish(`${tBOS}-yorgun`, `${tBOS}-yorgun`, { sub: 'Trend devam · trend yorgun' });
  }
  if (!pbs.inPB || !pbs.cur) {
    conds.push(cond('k', 'Geri çekilme sayısı', 'wait', pbs.k === 0 ? '1. geri çekilme bekleniyor (1H low EMA20\'ye dokunmalı)' : `${pbs.k + 1}. geri çekilme bekleniyor`));
    return finish(`${tBOS}-itki`, `${tBOS}-itki`, { sub: `Trend devam · ${pbs.k + 1}. geri çekilme bekleniyor` });
  }
  const pb = pbs.cur;
  conds.push(cond('k', 'Geri çekilme sayısı', 'ok', `${pb.k}. geri çekilme · H0 ${f(S * pb.H0)} · L0 ${f(S * pb.L0)} · başlangıç ${fmtTR(pb.startT)} TR`, S * pb.H0));

  // ---------- 6. Değer bölgesi (§5.2) ----------
  const le20 = last(e20)!, le50 = last(e50)!, lc = last(D.h1)!;
  const zoneNow = lc.l <= le20 || (lc.c <= le20 && lc.c >= le50);
  const prev = D.h1[D.h1.length - 2];
  const zoneRecent = zoneNow || (prev && (prev.l <= e20[e20.length - 2])); // bölgeden çıkalı ≤ 4×15m
  const oteLo = pb.H0 - 0.786 * (pb.H0 - pb.L0), oteHi = pb.H0 - 0.618 * (pb.H0 - pb.L0);
  const ote = Math.max(oteLo, Math.min(le50, le20)) <= Math.min(oteHi, Math.max(le50, le20)) || (pb.low >= oteLo && pb.low <= oteHi);
  const quality = quality0 + (ote ? 1 : 0);
  const flags = [...(T.quality ? ['ADX≥30'] : []), ...(ote ? ['OTE'] : [])];
  conds.push(cond('zone', 'Değer bölgesinde', zoneRecent ? 'ok' : 'wait', `${zoneNow ? 'Fiyat değer bölgesinde' : zoneRecent ? 'Bölgeden yeni çıktı (≤ 4×15m)' : 'Bölge dışında — EMA20/EMA50 (1H) bölgesine dönüş bekleniyor'} · EMA20 ${f(S * le20)} · EMA50 ${f(S * le50)}${ote ? ' · OTE çakışması (+1)' : ''}`, S * le20));
  if (zoneRecent) notices.push({ key: `H-zone-${sym}-${sigBase}`, title: `📈 H · ${SHORT[sym]} değer bölgesinde`, body: `H: ${SHORT[sym]} değer bölgesinde (${pb.k}. geri çekilme) — 15m tetik bekleniyor` });

  // ---------- 7. Karakter (§5.3) ----------
  const piv = bos4h(D.h4);
  const ch = character(D.h1, pb, piv.lastPivotLow, P.maxDepth, P.rsiMin);
  const structBroken = !ch.p3 || !ch.p4;
  const chDetail = `P1 aralık ${ch.avgPb.toFixed(dec)} < itki ${ch.avgImp.toFixed(dec)} ${ch.p1 ? '✓' : '✗'} · P2 RSI min ${ch.rsiMin.toFixed(1)} > ${P.rsiMin} ${ch.p2 ? '✓' : '✗'} · P3 derinlik ${pct(ch.depth)} ≤ 78,6% ${ch.p3 ? '✓' : '✗'} · P4 yükselen dip korunuyor ${ch.p4 ? '✓' : '✗'}`;
  const cancelNotice = (why: string, id: string) => notices.push({ key: `H-iptal-${id}`, requires: `H+${sym}+${dir}+${id.replace(`H-${sym}-`, '')}+TAM`, title: `⛔ H · ${SHORT[sym]} sinyal iptal`, body: `H: ${SHORT[sym]} sinyal iptal — ${why}` });
  const setCooldown = (why: string) => { if (!mem.cooldownUntil || mem.cooldownUntil < now) { mem.cooldownUntil = now + P.cooldown1h * HOUR; mem.cooldownWhy = why; } };
  if (structBroken || !ch.p1 || !ch.p2) {
    conds.push(cond('char', 'Düzeltme karakteri (P1–P4)', 'fail', `${structBroken ? 'İPTAL — yapı bozuldu · ' : 'Düzeltme sert, trend riskte · '}${chDetail}`));
    if (structBroken) { cancelNotice('yapı bozuldu (P3/P4)', `H-${sym}-${sigBase}`); setCooldown('yapı bozuldu'); }
    return finish(sigBase, sigBase, { sub: `Trend devam · ${pb.k}. geri çekilme`, signalAt: undefined }, { flags });
  }
  conds.push(cond('char', 'Düzeltme karakteri (P1–P4)', 'ok', chDetail));

  // ---------- 8. Tetik (§6) ----------
  const newsRel = relevantNews(conf, sym, news);
  const isNewsBar = (closeT: number) => newsRel.some((e) => Math.abs(closeT - e.t) <= P.newsBarMin * MIN);
  const trg = P.trigger === 'holygrail' ? holyGrail(D.h1, pb, atr1h, P.hgOffAtr, P.hgValid1h) : microTrigger(D.m15, pb, isNewsBar, P.triggerValid15m);
  const trgName = P.trigger === 'holygrail' ? 'Holy Grail (1H)' : '15m mikro kırılım';
  if (trg.state === 'none' || trg.lh === null) {
    conds.push(cond('trigger', '15m tetik', 'wait', `${trgName} bekleniyor${trg.lh !== null ? ` — ${f(S * trg.lh)} ${dir === 1 ? 'üstü' : 'altı'} kapanış` : ' — geri çekilme içinde 15m pivot tepe oluşmalı'}`));
    return finish(sigBase, sigBase, { sub: `Trend devam · ${pb.k}. geri çekilme · tetik bekleniyor` }, { flags, quality });
  }
  if (trg.state === 'expired' || trg.state === 'missed') {
    const why = trg.state === 'expired' ? 'retest gelmedi (4 adet 15m mum)' : 'zirve (H0) geçildi — kaçırıldı';
    conds.push(cond('trigger', '15m tetik', 'fail', `${trgName} ${fmtTR(trg.barT!)} TR · ${why}`));
    cancelNotice(why, `H-${sym}-${sigBase}`); setCooldown(why);
    return finish(sigBase, sigBase, { sub: `Trend devam · ${pb.k}. geri çekilme` }, { flags, quality });
  }
  const entry = trg.lh;
  const filled = trg.state === 'filled';
  conds.push(cond('trigger', '15m tetik', 'ok', `${trgName} ${fmtTR(trg.barT!)} TR · limit ${f(S * entry)} · ${filled ? `DOLDU ${fmtTR(trg.fillT!)} TR` : `geçerli ${fmtTR(trg.validUntil!)} TR'ye kadar`}`, S * entry));

  // ---------- 9. Stop / RR (§7) ----------
  const o = order(entry, pb, atr1h, atr4h, { stopAtr1h: P.stopAtr1h, maxStopAtr4h: P.maxStopAtr4h, minRR2: P.minRR2 });
  const rrTxt = `Stop ${f(S * o.stop)} (${(o.R / atr4h).toFixed(2)}×ATR4H) · T1 ${f(S * o.t1)}${o.rrH0 < 1 ? ' (H0 RR<1 → giriş+1R)' : ''} · T2 ${f(S * o.t2)} · RR(T2) ${o.rr2.toFixed(2)}`;
  if (!o.maxStopOk || !o.rrOk) {
    conds.push(cond('rr', 'Stop ve RR', 'fail', `${!o.maxStopOk ? 'Stop çok geniş (> 1,5×ATR4H) · ' : ''}${!o.rrOk ? `RR(T2) < ${P.minRR2} · ` : ''}${rrTxt}`));
    return finish(sigBase, sigBase, { sub: `Trend devam · ${pb.k}. geri çekilme` }, { flags, quality });
  }
  conds.push(cond('rr', 'Stop ve RR', 'ok', rrTxt, S * o.stop));

  // ---------- 10. Saat ve ortam (§9, §10.8) ----------
  const win = entryWindow(sym, now, conf, P);
  const blocks: string[] = [];
  if (!win.open) blocks.push(win.text);
  const nextNews = newsRel.filter((e) => e.t > now).sort((a, b) => a.t - b.t)[0];
  if (nextNews && nextNews.t - now <= P.newsBlockMin * MIN) blocks.push(`Haber ${nextNews.currency} ${nextNews.title} ${fmtTR(nextNews.t)} TR (≤ ${P.newsBlockMin} dk)`);
  const vs = volShock(D.h1, P.volShock);
  if (vs.shock) blocks.push(`Volatilite şoku (ATR1H ${vs.atr.toFixed(dec)} > 2×ort. ${vs.avg.toFixed(dec)})`);
  const gap = gapBlock(sym, h1R, now, atr1h);
  if (gap) blocks.push(gap);
  conds.push(cond('time', 'Saat ve ortam', blocks.length ? 'wait' : 'ok', blocks.length ? `BLOK: ${blocks.join(' · ')}` : win.text));

  // ---------- 11. Hatalı sinyal koruması (§10) ----------
  const sigId = `H-${sym}-${sigBase}`;
  const R = o.R, priceS = inp.price !== null ? S * inp.price : lastClose * S;
  const pS = dir === 1 ? (inp.price ?? lastClose) : -(inp.price ?? lastClose); // uzay fiyatı
  void priceS;
  const guard: string[] = [];
  let guardStatus: Condition['status'] = 'ok';
  let escaped = false, confirming = false;
  if (mem.cooldownUntil && now < mem.cooldownUntil) { guard.push(`10.11 soğuma — ${mem.cooldownWhy ?? 'iptal'} sonrası ${fmtTR(mem.cooldownUntil)} TR'ye kadar yeni H yok`); guardStatus = 'fail'; }
  const conflict = others.filter((x) => x.symbol === sym && x.strategy !== 'H' && (x.status === 'TAM' || x.status === 'BEKLE') && x.dir === -dir);
  const same = others.filter((x) => x.symbol === sym && x.strategy !== 'H' && (x.status === 'TAM' || x.status === 'BEKLE') && x.dir === dir);
  if (guardStatus === 'ok') {
    // 10.10 Son kontrol: fiyat stopa ≤ 0,25R yakın veya T1'i geçmiş → KAÇTI
    if (pS - o.stop <= P.finalCheckR * R || pS >= o.t1) { escaped = true; guard.push(`10.10 — sinyal kaçtı (fiyat ${f(inp.price ?? lastClose)}${pS >= o.t1 ? ' T1\'i geçti' : ' stopa ≤ 0,25R'})`); guardStatus = 'fail'; }
    // 10.3 Çift tarama teyidi
    else if (!blocks.length) {
      if (mem.pending?.sig === sigId && now - mem.pending.t >= P.confirmMinSec * 1000) guard.push('10.3 teyit 2/2 ✓');
      else { confirming = true; if (mem.pending?.sig !== sigId) mem.pending = { sig: sigId, t: now }; guard.push('10.3 — teyit 1/2 (sonraki taramada yeniden kontrol)'); }
    }
  }
  if (escaped) { cancelNotice('10.10 sinyal kaçtı', sigId); setCooldown('sinyal kaçtı'); mem.pending = undefined; }
  if (conflict.length) guard.push(`10.12 ÇAKIŞMA — ${conflict.map((x) => x.strategy).join(', ')} ters yönde TAM: emir kartında birini seç`);
  if (same.length) guard.push(`aynı fikir — ${same.map((x) => x.strategy).join(', ')} aynı yönde: tek işlem`);
  conds.push(cond('guard', 'Hatalı sinyal koruması', guardStatus, guard.join(' · ') || 'Veri taze · kapanmış mumlar · repaint yok'));

  // ---------- Kart ----------
  const m: EntryMethod = {
    id: P.trigger === 'holygrail' ? 'h-hg' : 'h-micro', label: P.trigger === 'holygrail' ? 'Buy stop — Holy Grail' : 'Limit — 15m kırılım retesti', type: P.trigger === 'holygrail' ? 'market' : 'limit',
    entry: S * entry, stopStructural: S * o.stop, stop: S * o.stop, fixedStop: true, tp1: S * o.t1, rr: +o.rr1.toFixed(2), tp2: S * o.t2, rr2: +o.rr2.toFixed(2), trailAtr: atr1h,
    note: `T1'de %50 kapat + stop girişe · kalan trailing (1H kapanışta HH − ${P.trailAtr}×ATR14_1H) · trend sonu: 4H kapanış EMA50 ${dir === 1 ? 'altı' : 'üstü'} veya ters 4H BOS · T2 sadece RR şartı içindir`,
  };
  const ov: Overlay[] = [
    { kind: 'line', style: 'level', label: 'H0', price: S * pb.H0 }, { kind: 'line', style: 'level', label: 'L0', price: S * pb.L0 },
    { kind: 'zone', style: 'range', label: 'Değer bölgesi', top: Math.max(S * le20, S * le50), bottom: Math.min(S * le20, S * le50), from: pb.startT, tf: '1h' },
    { kind: 'zone', style: 'fvg', label: 'OTE', top: Math.max(S * oteLo, S * oteHi), bottom: Math.min(S * oteLo, S * oteHi), from: pb.H0t, tf: '1h' },
  ];
  pushTargetOverlays(ov, m, trg.barT ?? undefined);
  const qTxt = quality >= 2 ? 'güçlü' : quality === 1 ? 'iyi' : 'normal';
  const res = finish(sigBase, sigBase, {
    sub: `Trend devam · ${pb.k}. geri çekilme · ${qTxt}`, methods: [m], defaultMethod: m.id, overlays: ov, signalAt: filled ? trg.fillT! : trg.barT!,
    stars: quality, tags: [...flags, ...(conflict.length ? ['ÇAKIŞMA'] : [])], warnings: conflict.length ? [`ÇAKIŞMA: ${conflict.map((x) => `${x.strategy} ${x.dir === 1 ? 'LONG' : 'SHORT'}`).join(', ')} ters yönde TAM — emir kartında ikisinden birini seç`] : [],
    invalidation: `Derinlik > %78,6 veya yükselen 4H dibin altında 1H kapanış · retest ${fmtTR(trg.validUntil ?? now)} TR'ye kadar gelmezse iptal · fiyat stopa ≤ 0,25R ya da T1 geçilirse KAÇTI`,
  }, { flags, quality, qualityText: qTxt, filled, validUntil: filled ? undefined : trg.validUntil, trigger: { type: P.trigger === 'holygrail' ? 'HOLY_GRAIL' : 'MICRO_BOS', lh: S * entry, bar: trg.barT, validUntil: trg.validUntil },
    trend: { dir, adx: T.t3.adx, rising: T.t3.rising }, pullback: { k: pb.k, H0: S * pb.H0, L0: S * pb.L0, low: S * pb.low, depth: ch.depth, ote, rsiMin: ch.rsiMin },
    order: { entry: S * entry, stop: S * o.stop, t1: S * o.t1, t2: S * o.t2, rr1: o.rr1, rr2: o.rr2 }, atr1h, protection: { confirming, escaped, blocks, conflict: conflict.map((x) => x.strategy) },
    us100: sym === 'US100' && inp.qqqRatio ? { qqq: inp.price, ratio: inp.qqqRatio, us100: (inp.price ?? lastClose) * inp.qqqRatio } : undefined });
  const s = res.setup;
  // TAM → TAM–BEKLE (10. blok veya 10.3 teyit). Teyit 1/2 bildirim göndermez.
  if ((s.status === 'TAM' || s.status === 'EKSIK') && (blocks.length > 0 || confirming) && s.conditions.every((c) => c.status === 'ok' || c.id === 'time')) {
    const why = [...blocks, ...(confirming ? ['10.3 teyit 1/2'] : [])].join(' · ');
    s.status = 'BEKLE'; s.remaining = 0; s.missing = `BLOK: ${why}`; delete s.none;
    s.key = `${s.strategy}+${s.symbol}+${s.dir}+${s.zoneId}+BEKLE${confirming && !blocks.length ? '-teyit' : ''}`;
    if (confirming && !blocks.length) s.info = { ...(s.info ?? {}), noNotify: true };
  }
  if (s.status === 'TAM') mem.pending = undefined;
  return res;
}

/** §10.8 Açılış boşluğu: US100 ilk 30 dk (QQQ açılış gap'i > 1×ATR1H); XAU hafta açılışında ilk 1H mum kapanana kadar */
export function gapBlock(sym: HSym, h1: Candle[], now: number, atr1h: number): string | null {
  if (sym === 'US100') {
    const { min } = nyLocal(now);
    if (min < parseHM('09:30') || min >= parseHM('10:00')) return null;
    const today = h1.filter((x) => now - x.t < 12 * HOUR), before = h1.filter((x) => now - x.t >= 12 * HOUR);
    const first = today[0], prevC = last(before)?.c;
    if (first && prevC !== undefined && Math.abs(first.o - prevC) > atr1h) return `10.8 açılış boşluğu ${Math.abs(first.o - prevC).toFixed(2)} > 1×ATR1H — ilk 30 dk H yok`;
    return null;
  }
  if (sym === 'XAUUSD' && nyDow(now) === 0 && nyMinutes(now) >= 18 * 60 && nyMinutes(now) < 19 * 60) {
    const wk = h1.filter((x) => nyDow(x.t) === 0 && nyMinutes(x.t) >= 18 * 60), prev = h1.filter((x) => now - x.t > 24 * HOUR);
    const first = wk[0], prevC = last(prev)?.c;
    if (first && prevC !== undefined && Math.abs(first.o - prevC) > atr1h) return '10.8 hafta açılışı boşluğu > 1×ATR1H — ilk 1H mum kapanana kadar H yok';
  }
  return null;
}
