// KURULUM G — XAUUSD Asya Range Süpürmesi (ICT Judas Swing). Şartname: docs/KURULUM_G.md
// Strateji saati sabit UTC-5 (NY). Short tarafı long kurallarının fiyat-aynasıdır (fiyat × −1).
import type { Candle, Condition, Dir, EntryMethod, NewsEvent, Overlay, Setup } from '../types.ts';
import type { Config } from '../config.ts';
import { Ctx, finalize } from '../context.ts';
import { ema } from '../indicators.ts';
import { mergeCandles } from '../candles.ts';
import { DAY, HOUR, MIN, NY_OFFSET, fmtTR, durationText, nyDayStart } from '../time.ts';
import { mirror, pivots } from '../f/wyckoff.ts';

// ---------- Zaman serileri (strateji saati) ----------
const ny = (t: number) => t + NY_OFFSET;
const fromNy = (t: number) => t - NY_OFFSET;
/** Bucket başlangıcı: NY saatine göre `offsetH` kaymalı `sizeH` saatlik kovalar */
function bucket(t: number, sizeH: number, offsetH: number) { const s = sizeH * HOUR, o = offsetH * HOUR; return fromNy(Math.floor((ny(t) - o) / s) * s + o); }
function agg(h1: Candle[], key: (t: number) => number, minBars: number): Candle[] {
  const m = new Map<number, Candle & { n: number }>();
  for (const x of h1) {
    const k = key(x.t);
    const c = m.get(k);
    if (!c) m.set(k, { ...x, t: k, n: 1 });
    else { c.h = Math.max(c.h, x.h); c.l = Math.min(c.l, x.l); c.c = x.c; c.n++; }
  }
  return [...m.values()].filter((c) => c.n >= minBars && c.h > c.l).sort((a, b) => a.t - b.t).map(({ n: _n, ...c }) => c);
}
/** 4H: sınırlar 02/06/10/14/18/22 (strateji saati); eksik saatli mum atılır */
export const h4G = (h1: Candle[]) => agg(h1, (t) => bucket(t, 4, 2), 4);
/** Günlük: 18:00 → ertesi gün 17:00; yassı/eksik mumlar atılır */
export const dailyG = (h1: Candle[]) => agg(h1, (t) => bucket(t, 24, 18), 10);
/** Haftalık: Pazar 18:00 → Cuma 17:00 */
export const weekStartG = (t: number) => { const s = ny(t) + 6 * HOUR; const days = Math.floor(s / DAY); const dow = (days + 4) % 7; return fromNy((days - ((dow + 6) % 7)) * DAY - 6 * HOUR); };
export const weeklyG = (h1: Candle[]) => agg(h1, weekStartG, 20);

// ---------- Göstergeler ----------
const body = (x: Candle) => Math.abs(x.c - x.o);
function avgBody(c: Candle[], i: number) { let s = 0, n = 0; for (let k = Math.max(0, i - 20); k < i; k++) { s += body(c[k]); n++; } return n ? s / n : 0; }
/** Stop: sweepExt − buffer; $10 yuvarlak sayı ≤ 3 $ yakınsa onun ötesine (long uzayında) */
export function gStop(ext: number, price: number, step = 10, dist = 3, bufPct = 0.0005) {
  const buffer = bufPct * Math.abs(price);
  const R = Math.floor(ext / step) * step;
  return ext - R < dist ? R - buffer : ext - buffer;
}
/** T2: entry üstündeki adaylardan RR ≥ 2 sağlayan ilki (yakından uzağa) */
export function pickT2(entry: number, risk: number, cands: { src: string; price: number }[], minRR = 2) {
  const up = cands.filter((c) => c.price > entry).sort((a, b) => a.price - b.price);
  return up.find((c) => (c.price - entry) / risk >= minRR) ?? null;
}

interface Levels { AH: number; AL: number; AR: number; AEQ: number; MO: number; PDH: number; PDL: number; WH: number; WL: number; WEQ: number; ADR: number; asiaBars: number }

function cond(id: string, label: string, status: Condition['status'], detail: string, level?: number): Condition { return level === undefined ? { id, label, status, detail } : { id, label, status, detail, level }; }

export function evalG(conf: Config, ctx: Ctx, h1Store: Candle[], news: NewsEvent[]): Setup[] {
  const G = conf.params.G, now = ctx.now;
  const mo = nyDayStart(now); // 00:00 strateji saati (işlem günü D)
  const day = new Date(ny(mo)).toISOString().slice(0, 10);
  const T = (h: number, m = 0) => mo + h * HOUR + m * MIN; // strateji saatinden zaman
  const base = { strategy: 'G' as const, chartTf: '15m' as const, tfs: ['5m', '15m', '1h', '4h'] as Setup['tfs'], zoneId: day };
  const id = `G-XAUUSD-${day}`;
  const dowNy = new Date(ny(now)).getUTCDay();
  if (dowNy === 0 || dowNy === 6) {
    return [finalize(ctx, { ...base, id, sub: 'Judas · hafta sonu', dir: 0, methods: [], overlays: [], conditions: [cond('data', 'Veri tamam', 'fail', 'Hafta sonu — altın kapalı, G çalışmaz')], none: { why: 'Hafta sonu', waiting: 'Pazartesi 08:00 TR', ends: '—' } })];
  }
  const c5r = ctx.closed('5m');
  const c15r = ctx.closed('15m');
  const h1r = mergeCandles(h1Store, ctx.closed('1h'));

  // ---------- Seviyeler (gerçek fiyat) ----------
  const levelsOf = (c15: Candle[], h1: Candle[], c5: Candle[]): Levels | null => {
    const asia = c15.filter((x) => x.t >= T(-4) && x.t < mo);
    const moBar = c5.find((x) => x.t === mo) ?? c15.find((x) => x.t === mo);
    if (!moBar) return null;
    const days = dailyG(h1).filter((d) => d.t < T(-6));
    const pd = days[days.length - 1];
    const weeks = weeklyG(h1).filter((w) => w.t < weekStartG(mo));
    const pw = weeks[weeks.length - 1];
    const last20 = days.slice(-20);
    if (!pd || !pw || last20.length < 20 || !asia.length) return null;
    const AH = Math.max(...asia.map((x) => x.h)), AL = Math.min(...asia.map((x) => x.l));
    return { AH, AL, AR: AH - AL, AEQ: (AH + AL) / 2, MO: moBar.o, PDH: pd.h, PDL: pd.l, WH: pw.h, WL: pw.l, WEQ: (pw.h + pw.l) / 2, ADR: last20.reduce((a, d) => a + d.h - d.l, 0) / 20, asiaBars: asia.length };
  };
  const L0 = levelsOf(c15r, h1r, c5r);
  const f = (x: number | undefined) => ctx.fmt(x);

  // ---------- 1) Veri ----------
  const asiaN = c15r.filter((x) => x.t >= T(-4) && x.t < mo).length;
  let gap = 0;
  const sess5 = c5r.filter((x) => x.t >= T(-6));
  for (let i = 1; i < sess5.length; i++) if (sess5[i].t - sess5[i - 1].t >= 20 * MIN && !(sess5[i - 1].t >= T(-7) && sess5[i - 1].t < T(-6))) gap = Math.max(gap, Math.round((sess5[i].t - sess5[i - 1].t) / (5 * MIN)) - 1);
  const h4all = h4G(h1r).filter((x) => x.t + 4 * HOUR <= mo);
  const dataFail = asiaN < G.minAsiaBars ? `Asya'da ${asiaN}/16 adet 15m mum var (en az ${G.minAsiaBars})` : gap >= 3 ? `5m serisinde ardışık ${gap} mum eksik` : !L0 ? 'Seviyeler için 1H geçmişi yetersiz (PDH/haftalık/ADR20)' : '';
  const condData = dataFail ? cond('data', 'Veri tamam', 'fail', `VERİ YOK — ${dataFail}`) : h4all.length < G.emaWarm ? cond('data', 'Veri tamam', 'wait', `4H EMA50 ısınması için ${h4all.length}/${G.emaWarm} adet 4H mum (günlük 1H çekimi bekleniyor)`) : cond('data', 'Veri tamam', 'ok', `Asya ${asiaN}/16 mum · 4H ${h4all.length} mum`);
  if (dataFail || !L0) {
    return [finalize(ctx, { ...base, id, sub: 'Judas · VERİ YOK', dir: 0, methods: [], overlays: [], conditions: [condData], none: { why: 'Veri eksik — tahmin üretilmez', waiting: 'Bir sonraki taramada veri', ends: 'Yarın 08:00 TR' }, info: { g: { status: 'VERI_YOK', mo } } })];
  }

  // ---------- 2) Bias (00:00'da, gün içinde değişmez) ----------
  const e = ema(h4all.map((x) => x.c), 50);
  const nE = h4all.length - 1;
  const close4 = h4all[nE]?.c ?? NaN, ema50 = e[nE], slope = e[nE] - e[nE - 5];
  const sessHigh = Math.max(...c5r.filter((x) => x.t >= T(-6) && x.t < mo).map((x) => x.h)), sessLow = Math.min(...c5r.filter((x) => x.t >= T(-6) && x.t < mo).map((x) => x.l));
  const wk = c5r.filter((x) => x.t >= weekStartG(mo) && x.t < mo);
  const wkHigh = Math.max(...wk.map((x) => x.h)), wkLow = Math.min(...wk.map((x) => x.l));
  const b1: Dir | 0 = !Number.isFinite(slope) ? 0 : close4 > ema50 && slope >= 0 ? 1 : close4 < ema50 && slope <= 0 ? -1 : 0;
  const b2: Dir = L0.MO < L0.WEQ ? 1 : -1;
  const dolL = L0.PDH > L0.MO && sessHigh < L0.PDH ? `PDH ${f(L0.PDH)}` : L0.WH > L0.MO && wkHigh < L0.WH ? `hafta tepesi ${f(L0.WH)}` : '';
  const dolS = L0.PDL < L0.MO && sessLow > L0.PDL ? `PDL ${f(L0.PDL)}` : L0.WL < L0.MO && wkLow > L0.WL ? `hafta dibi ${f(L0.WL)}` : '';
  const dir: Dir | 0 = b1 === 1 && b2 === 1 && dolL ? 1 : b1 === -1 && b2 === -1 && dolS ? -1 : 0;
  const biasTxt = `B1 4H EMA: ${b1 === 1 ? 'LONG' : b1 === -1 ? 'SHORT' : 'yok'} (kapanış ${f(close4)} · EMA50 ${f(ema50)}) · B2 haftalık: ${b2 === 1 ? 'DISCOUNT' : 'PREMIUM'} (MO ${f(L0.MO)} / WEQ ${f(L0.WEQ)}) · B3 DOL: ${dolL ? 'LONG ' + dolL : ''}${dolL && dolS ? ' / ' : ''}${dolS ? 'SHORT ' + dolS : ''}${!dolL && !dolS ? 'yok' : ''}`;
  const condBias = condData.status === 'wait' ? cond('bias', 'Bias (B1+B2+B3)', 'wait', 'EMA ısınması bekleniyor') : dir ? cond('bias', 'Bias (B1+B2+B3)', 'ok', `${dir === 1 ? 'LONG' : 'SHORT'} — ${biasTxt}`) : cond('bias', 'Bias (B1+B2+B3)', 'fail', `Bias uyuşmazlığı — ${biasTxt}`);
  const biasWord = dir === 1 ? 'LONG' : dir === -1 ? 'SHORT' : 'YOK';
  const levelsKey = `G-levels-${day}`;
  const notices: NonNullable<Setup['notices']> = [{ key: levelsKey, title: '🎯 G · Seviyeler hazır', body: `G: Seviyeler hazır — AH ${f(L0.AH)}, AL ${f(L0.AL)}, MO ${f(L0.MO)}, bias ${biasWord}` }];
  const gInfo = (extra: Record<string, unknown> = {}) => ({ g: { day, mo, levels: L0, bias: { value: biasWord, b1, b2, b3: { long: dolL, short: dolS }, ema50_4h: ema50, close_4h: close4 }, ...extra } });
  const ovBase: Overlay[] = [
    { kind: 'zone', style: 'range', label: 'Asya range', top: L0.AH, bottom: L0.AL, from: T(-4), to: mo, tf: '15m', cond: 'range' },
    { kind: 'line', style: 'level', label: 'MO', price: L0.MO, from: mo, cond: 'mo' },
    { kind: 'line', style: 'liq', label: 'PDH', price: L0.PDH }, { kind: 'line', style: 'liq', label: 'PDL', price: L0.PDL },
  ];
  const ended = now >= T(5);
  const noneEnds = 'Bugün için bitti — yarın 08:00 TR yeniden';
  if (!dir || condData.status === 'wait') {
    const ratio0 = L0.AR / L0.ADR;
    return [finalize(ctx, { ...base, id, sub: 'Judas · bias yok', dir: 0, methods: [], overlays: ovBase, notices,
      conditions: [condData, condBias, cond('range', 'Asya range kalitesi', ratio0 >= G.rangeMin && ratio0 <= G.rangeMax ? 'ok' : 'fail', `AR ${f(L0.AR)} = ${(ratio0).toFixed(2)}×ADR20 (${f(L0.ADR)})`)],
      none: { why: condData.status === 'wait' ? 'EMA ısınması için veri bekleniyor' : 'Bias uyuşmazlığı — üç bileşen aynı yönü göstermiyor', waiting: 'Yarın 00:00 NY (08:00 TR) bias yeniden yazılır', ends: noneEnds }, info: gInfo() })];
  }

  // ---------- Yön uzayı (short = ayna) ----------
  const S = dir;
  const P = (x: number) => S * x; // ayna → gerçek
  const fx = (x: number) => f(P(x));
  const c5 = S === 1 ? c5r : mirror(c5r), c15 = S === 1 ? c15r : mirror(c15r);
  const L: Levels = S === 1 ? L0 : { ...L0, AH: -L0.AL, AL: -L0.AH, AEQ: -L0.AEQ, MO: -L0.MO, PDH: -L0.PDL, PDL: -L0.PDH, WH: -L0.WL, WL: -L0.WH, WEQ: -L0.WEQ };
  const W = S === 1 ? { low: 'dibi', high: 'tepesi', below: 'altı', above: 'üstü', side: 'LOW' } : { low: 'tepesi', high: 'dibi', below: 'üstü', above: 'altı', side: 'HIGH' };
  const conds: Condition[] = [condData, condBias];
  const ov: Overlay[] = [...ovBase];
  let methods: EntryMethod[] = [];
  let signalAt: number | undefined;
  const flags: string[] = [];
  const failNote = () => conds.find((c) => c.status === 'fail')?.detail;

  // 3) Range kalitesi
  const ratio = L.AR / L.ADR;
  const moInside = L.MO >= L.AL && L.MO <= L.AH;
  conds.push(!moInside ? cond('range', 'Asya range kalitesi', 'fail', `MO ${fx(L.MO)} Asya range dışında (boşluk) — bugün G değerlendirilmez`)
    : ratio < G.rangeMin ? cond('range', 'Asya range kalitesi', 'fail', `Asya range çok dar: AR ${f(L.AR)} = ${ratio.toFixed(2)}×ADR20 (< ${G.rangeMin})`)
      : ratio > G.rangeMax ? cond('range', 'Asya range kalitesi', 'fail', `Asya range çok geniş: AR ${f(L.AR)} = ${ratio.toFixed(2)}×ADR20 (> ${G.rangeMax})`)
        : cond('range', 'Asya range kalitesi', 'ok', `AR ${f(L.AR)} = ${ratio.toFixed(2)}×ADR20 (${f(L.ADR)})`));

  // 4) Haber
  const usdRed = news.filter((x) => x.impact === 'High' && x.currency === 'USD');
  const inWin = usdRed.find((x) => x.t >= T(2) && x.t < T(5));
  const newsDay = usdRed.find((x) => x.t >= T(5) && x.t <= T(12));
  conds.push(inWin ? cond('news', 'Pencerede kırmızı haber yok', 'fail', `Pencere içinde kırmızı haber: ${inWin.title} ${fmtTR(inWin.t)} TR`)
    : cond('news', 'Pencerede kırmızı haber yok', 'ok', newsDay ? `Pencere temiz · HABER GÜNÜ: ${newsDay.title} ${fmtTR(newsDay.t)} TR (T1 yoksa 15 dk önce kapat)` : 'Pencere temiz'));

  // 5) Erken hareket / erken süpürme
  const early15 = c15.filter((x) => x.t >= mo && x.t < T(2));
  const earlySweep = early15.find((x) => x.l < L.AL);
  const b145 = c15.find((x) => x.t === T(1, 45));
  const early = b145 ? b145.c - L.MO : NaN;
  conds.push(earlySweep ? cond('early', 'Erken hareket / erken süpürme', 'fail', `Süpürme pencere öncesi oldu: Asya ${W.low} ${fmtTR(earlySweep.t)} TR'de delindi`)
    : !b145 ? cond('early', 'Erken hareket / erken süpürme', 'wait', '02:00 NY (10:00 TR) kapanışında ölçülür')
      : early < -G.earlyMax * L.ADR ? cond('early', 'Erken hareket / erken süpürme', 'fail', `Büyük erken hareket ${f(Math.abs(early))} (${(Math.abs(early) / L.ADR).toFixed(2)}×ADR20) bias'a ters — trend günü olabilir`)
        : cond('early', 'Erken hareket / erken süpürme', 'ok', `Erken hareket ${S * early >= 0 ? '+' : '−'}${f(Math.abs(early))} (${(Math.abs(early) / L.ADR).toFixed(2)}×ADR20)`));

  // 6) Süpürme (15m, 02:00–03:45 başlangıçlı)
  const win15 = c15.filter((x) => x.t >= T(2));
  let sweepI = -1, sweepFail = '';
  for (let i = 0; i < win15.length; i++) {
    const x = win15[i];
    const hiB = x.h > L.AH, loB = x.l < L.AL;
    if (!hiB && !loB) continue;
    if (hiB) { sweepFail = `Bias tarafı önce alındı: Asya ${W.high} ${fmtTR(x.t)} TR'de delindi`; break; }
    if (x.t > T(3, 45)) { sweepFail = `Geç süpürme: ilk delinme ${fmtTR(x.t)} TR (12:00 TR sonrası Judas sayılmaz)`; break; }
    sweepI = i; break;
  }
  const sweepBar = sweepI >= 0 ? win15[sweepI] : undefined;
  // sweepExt ve MSS (5m)
  const i5From = sweepBar ? c5.findIndex((x) => x.t >= sweepBar.t) : -1;
  const piv5 = pivots(c5, 2).filter((p) => p.type === 'H');
  let ext = Infinity, extI = -1, mss: { i: number; lh: number; ratio: number } | null = null, mssWeak = '';
  if (i5From >= 0) {
    for (let j = i5From; j < c5.length && c5[j].t < T(5); j++) {
      if (extI >= 0 && j > extI) {
        const lh = [...piv5].reverse().find((p) => p.t < c5[extI].t && p.i + 2 < j)?.price;
        if (lh !== undefined && c5[j].c > lh) {
          const ab = avgBody(c5, j), r = ab > 0 ? body(c5[j]) / ab : 0;
          let fvg = false;
          for (let m = extI + 1; m <= j - 1 && !fvg; m++) if (c5[m + 1] && c5[m - 1] && c5[m + 1].l > c5[m - 1].h) fvg = true;
          if (r >= G.dispBody && fvg && c5[j].c > c5[j].o) { mss = { i: j, lh, ratio: r }; break; }
          mssWeak = `MSS gövdesi ${r.toFixed(2)}×ort.${fvg ? '' : ' · bacakta FVG yok'} — displacement yok, yeni MSS bekleniyor`;
        }
      }
      if (c5[j].l < ext) { ext = c5[j].l; extI = j; }
    }
  }
  if (sweepBar && !Number.isFinite(ext)) ext = sweepBar.l;
  const depth = L.AL - ext;
  if (!sweepFail && sweepBar && depth > L.AR) sweepFail = `Kırılım, süpürme değil: derinlik ${f(depth)} > AR ${f(L.AR)}`;
  const sweepKey = `G-sweep-${day}`;
  conds.push(sweepFail ? cond('sweep', 'Doğru taraf süpürüldü', 'fail', sweepFail)
    : sweepBar ? cond('sweep', 'Doğru taraf süpürüldü', 'ok', `Asya ${W.low} ${fx(L.AL)} ${fmtTR(sweepBar.t)} TR'de süpürüldü · uç ${fx(ext)} (derinlik ${f(depth)})`, P(ext))
      : now >= T(4) ? cond('sweep', 'Doğru taraf süpürüldü', 'fail', '04:00 NY (12:00 TR) kadar süpürme olmadı')
        : cond('sweep', 'Doğru taraf süpürüldü', 'wait', `Asya ${W.low} ${fx(L.AL)} ${W.below} iğne bekleniyor (10:00–12:00 TR)`, P(L.AL)));
  if (sweepBar && !sweepFail) {
    notices.push({ key: sweepKey, title: `🎯 G · Asya ${W.low} süpürüldü`, body: `G: Asya ${W.low} süpürüldü ${fx(ext)} — içeri kapanış bekleniyor` });
    ov.push({ kind: 'line', style: 'level', label: 'Süpürme ucu', price: P(ext), from: sweepBar.t, cond: 'sweep' });
  }

  // 7) 1 saatte içeri kapanış
  let backI = -1;
  if (sweepBar && !sweepFail) for (let k = sweepI; k < Math.min(win15.length, sweepI + G.backInsideBars); k++) if (win15[k].c > L.AL) { backI = k; break; }
  const backBars = sweepI >= 0 ? win15.length - sweepI : 0;
  conds.push(!sweepBar || sweepFail ? cond('back', '1 saatte içeri kapanış', 'wait', 'Süpürme sonrası')
    : backI >= 0 ? cond('back', '1 saatte içeri kapanış', 'ok', `${fmtTR(win15[backI].t)} TR 15m kapanış ${fx(win15[backI].c)} içeride`)
      : backBars >= G.backInsideBars ? cond('back', '1 saatte içeri kapanış', 'fail', '1 saatte (4 adet 15m) içeri kapanış yok — kırılım')
        : cond('back', '1 saatte içeri kapanış', 'wait', `15m'de ${fx(L.AL)} ${W.above} kapanış bekleniyor (${G.backInsideBars - backBars} mum kaldı)`, P(L.AL)));

  // 8) MO kapanışı (+ iptal: içeri kapanıştan sonra MO'dan önce süpürülen tarafta kapanış)
  let moI = -1, moFail = '';
  if (backI >= 0) {
    for (let k = backI; k < win15.length && win15[k].t <= T(4, 45); k++) {
      if (k > backI && win15[k].c < L.AL) { moFail = `Süpürülen tarafta tekrar kapanış (${fmtTR(win15[k].t)} TR) — iptal`; break; }
      if (win15[k].c > L.MO) { moI = k; break; }
    }
  }
  conds.push(backI < 0 ? cond('mo', 'MO kapanışı', 'wait', 'İçeri kapanış sonrası')
    : moFail ? cond('mo', 'MO kapanışı', 'fail', moFail)
      : moI >= 0 ? cond('mo', 'MO kapanışı', 'ok', `${fmtTR(win15[moI].t)} TR 15m kapanış ${fx(win15[moI].c)} MO ${W.above}`, P(L.MO))
        : now >= T(5) ? cond('mo', 'MO kapanışı', 'fail', '05:00 NY (13:00 TR) kadar MO kapanışı yok')
          : cond('mo', 'MO kapanışı', 'wait', `15m'de MO ${fx(L.MO)} ${W.above} kapanış bekleniyor`, P(L.MO)));

  // 9) MSS + displacement
  const lhNow = extI >= 0 ? [...piv5].reverse().find((p) => p.t < c5[extI].t)?.price : undefined;
  conds.push(!sweepBar || sweepFail ? cond('mss', 'MSS + displacement (5m)', 'wait', 'Süpürme sonrası')
    : mss ? cond('mss', 'MSS + displacement (5m)', 'ok', `5m ${fx(mss.lh)} ${W.above} kapanış · gövde ${mss.ratio.toFixed(2)}×ort. · bacakta FVG · ${fmtTR(c5[mss.i].t)} TR`, P(mss.lh))
      : now >= T(5) ? cond('mss', 'MSS + displacement (5m)', 'fail', '05:00 NY (13:00 TR) kadar displacement\'lı MSS yok')
        : cond('mss', 'MSS + displacement (5m)', 'wait', mssWeak || (lhNow !== undefined ? `5m'de ${fx(lhNow)} ${W.above} güçlü kapanış (gövde ≥ ${G.dispBody}×ort. + FVG) bekleniyor` : '5m pivot bekleniyor'), lhNow !== undefined ? P(lhNow) : undefined));
  if (lhNow !== undefined) ov.push({ kind: 'line', style: 'liq', label: 'MSS seviyesi', price: P(mss?.lh ?? lhNow), cond: 'mss' });

  // 10) Giriş bölgesi + RR (limit; dolum 5m ile simüle edilir — deterministik)
  const fillKey = `G-fill-${day}`;
  if (mss && moI >= 0) {
    const moEnd = win15[moI].t + 15 * MIN;
    let k0 = Math.max(mss.i + 1, c5.findIndex((x) => x.t >= moEnd));
    if (k0 < 0) k0 = c5.length;
    const manipFrom = c5.findIndex((x) => x.t >= T(2));
    const limitAt = (k: number): { price: number; type: 'FVG_CE' | 'IFVG' | 'OB'; zone?: [number, number] } | null => {
      const ref = c5[k - 1].c;
      for (let m = k - 2; m >= extI + 1; m--) {
        if (c5[m + 1].l > c5[m - 1].h) { const lo = c5[m - 1].h, hi = c5[m + 1].l, ce = (lo + hi) / 2; if (ce < ref) return { price: ce, type: 'FVG_CE', zone: [lo, hi] }; }
      }
      for (let m = extI - 1; m >= Math.max(1, manipFrom + 1); m--) {
        if (c5[m + 1].h < c5[m - 1].l) { const top = c5[m - 1].l; if (c5.slice(m + 2, k).some((x) => x.c > top) && top < ref) return { price: top, type: 'IFVG', zone: [c5[m + 1].h, top] }; }
      }
      for (let m = mss.i - 1; m >= Math.max(0, extI - 3); m--) if (c5[m].c < c5[m].o) return { price: Math.max(c5[m].o, c5[m].c), type: 'OB', zone: [c5[m].l, Math.max(c5[m].o, c5[m].c)] };
      return null;
    };
    let fillK = -1, cur: ReturnType<typeof limitAt> = null, preFail = '';
    for (let k = k0; k < c5.length; k++) {
      cur = limitAt(k);
      if (c5[k].t >= T(5)) break;
      if (cur && c5[k].l <= cur.price) { fillK = k; break; }
      if (c5[k].c < ext) { preFail = `Dolumdan önce 5m kapanış süpürme ucunun ${W.below} (${fmtTR(c5[k].t)} TR) — iptal`; break; }
      if (c5[k].h >= L.AH) { preFail = `Geri çekilme gelmeden T1 (Asya ${W.high} ${fx(L.AH)}) görüldü — fırsat geçti, kovalanmaz`; break; }
    }
    if (fillK < 0 && !preFail && c5.length > k0 && c5.length >= 1) cur = limitAt(c5.length) ?? cur; // güncel limit (tüm kapanmış mumlarla)
    const lim = cur;
    if (!lim) conds.push(cond('entry', 'Giriş bölgesi + RR', now >= T(5) ? 'fail' : 'wait', 'FVG / iFVG / OB giriş bölgesi bulunamadı'));
    else {
      const entry = lim.price;
      const stop = gStop(ext, entry, G.roundStep, G.roundDist, G.bufferPct);
      const risk = entry - stop;
      const t1 = L.AH;
      const mh = Math.max(...win15.slice(0, sweepI + 1).map((x) => x.h));
      const Lm = mh - ext;
      const t2 = pickT2(entry, risk, [{ src: 'PDH', price: L.PDH }, { src: 'S2', price: ext + 2 * Lm }, { src: 'S4', price: ext + 4 * Lm }], G.minRR2);
      const rr1 = risk > 0 ? (t1 - entry) / risk : 0;
      const zoneTxt = { FVG_CE: 'FVG CE', IFVG: 'iFVG üst kenarı', OB: 'OB gövde üstü' }[lim.type];
      // Kalite
      const mssHigh = c5[mss.i].h;
      if (entry <= ext + 0.5 * (mssHigh - ext)) flags.push('A+');
      const asiaLows = pivots(c5.filter((x) => x.t >= T(-4) && x.t < mo), 2).filter((p) => p.type === 'L' && Math.abs(p.price - L.AL) <= 0.1 * L.AR).length;
      if (asiaLows >= 2 || Math.abs(L.PDL - L.AL) <= 0.1 * L.AR) flags.push('likidite kümesi');
      if (lim.type === 'FVG_CE' && lim.zone) {
        const ob = c5.slice(Math.max(0, extI - 3), mss.i).filter((x) => x.c < x.o).pop();
        if (ob && ob.h >= lim.zone[0] && ob.l <= lim.zone[1]) flags.push('FVG + OB');
      }
      const rrOk = rr1 >= G.minRR1 && !!t2;
      const m: EntryMethod = { id: 'judas', label: `Limit — ${zoneTxt}`, type: 'limit', entry: P(entry), stop: P(stop), stopStructural: P(stop), fixedStop: true, tp1: P(t1), rr: +rr1.toFixed(2), note: `T1 %50 kapat + stop girişe · T2 kalan %50 · son giriş 13:00 TR · zorunlu kapanış 20:00 TR` };
      if (t2) { m.tp2 = P(t2.price); m.rr2 = +((t2.price - entry) / risk).toFixed(2); }
      methods = [m];
      if (lim.zone) ov.push({ kind: 'zone', style: 'fvg', label: `Giriş ${zoneTxt}`, top: Math.max(P(lim.zone[0]), P(lim.zone[1])), bottom: Math.min(P(lim.zone[0]), P(lim.zone[1])), from: c5[Math.max(0, extI)].t, tf: '5m', cond: 'entry' });
      if (preFail) conds.push(cond('entry', 'Giriş bölgesi + RR', 'fail', preFail));
      else if (!rrOk) conds.push(cond('entry', 'Giriş bölgesi + RR', 'fail', `RR yetersiz — T1 ${rr1.toFixed(2)} (≥${G.minRR1}) · T2 adayı ${t2 ? '' : 'yok (PDH/S2/S4 hepsi < 2R)'}`));
      else if (fillK < 0 && now >= T(5)) conds.push(cond('entry', 'Giriş bölgesi + RR', 'fail', '05:00 NY (13:00 TR) kadar geri çekilme gelmedi — limit iptal'));
      else {
        const filled = fillK >= 0;
        if (filled) { signalAt = c5[fillK].t; notices.push({ key: fillKey, title: '🎯 G · Giriş doldu', body: `G: Giriş doldu ${fx(entry)}` }); }
        conds.push(cond('entry', 'Giriş bölgesi + RR', 'ok', `${zoneTxt} limit ${fx(entry)} · stop ${fx(stop)} · T1 ${fx(t1)} (RR ${rr1.toFixed(2)}) · T2 ${t2!.src} ${fx(t2!.price)} (RR ${((t2!.price - entry) / risk).toFixed(2)}) · ${filled ? `DOLDU ${fmtTR(signalAt!)} TR` : 'dolum bekleniyor (son 13:00 TR)'}`, P(entry)));
        if (filled) {
          const after = c5.slice(fillK + 1);
          const t1Hit = after.find((x) => x.h >= t1);
          const stopHit = after.find((x) => x.l <= stop);
          if (t1Hit && (!stopHit || t1Hit.t <= stopHit.t)) notices.push({ key: `G-T1-${day}`, title: '🎯 G · T1', body: 'G: T1 — %50 kapat, stop girişe' });
          const open = !stopHit && !after.some((x) => t2 && x.h >= t2.price);
          if (newsDay && open && now >= newsDay.t - G.newsExitMin * MIN && !(t1Hit && t1Hit.t < newsDay.t - G.newsExitMin * MIN))
            notices.push({ key: `G-newsexit-${day}`, title: '⚠️ G · Haber çıkışı', body: `G: Haber öncesi T1 yok — pozisyonu kapat (${newsDay.title} ${fmtTR(newsDay.t)} TR)` });
          if (open && now >= T(11, 50)) notices.push({ key: `G-forceexit-${day}`, title: '⏰ G · 20:00 TR', body: 'G: 20:00 TR zorunlu kapanış — kalan pozisyonu kapat' });
        }
      }
    }
  } else {
    conds.push(cond('entry', 'Giriş bölgesi + RR', ended && !(mss && moI >= 0) ? 'wait' : 'wait', 'MSS + MO kapanışı sonrası (FVG CE → iFVG → OB)'));
  }
  // Hatalı sinyal koruması (dolum öncesi): ortak kural — fiyat limitten 3R'den fazla uzaksa
  if (!signalAt && methods[0] && !conds.some((c) => c.status === 'fail')) {
    const m = methods[0], risk = Math.abs(m.entry - m.stop);
    if (risk > 0 && Math.abs(ctx.price - m.entry) / risk > conf.params.general.maxEntryDistR) conds.push(cond('stale', 'Sinyal güncel mi', 'fail', `Fiyat ${f(ctx.price)} limitten ${(Math.abs(ctx.price - m.entry) / risk).toFixed(1)}R uzak — kovalanmaz`));
  }
  // Saat sınırı: 05:00 NY sonrası dolmamış/oluşmamış kurulum bitti
  if (ended && !signalAt && !conds.some((c) => c.status === 'fail')) conds.push(cond('time', 'Saat', 'fail', '05:00 NY (13:00 TR) son giriş saati geçti — bugün için bitti'));
  const score = flags.length;
  const quality = score >= 4 ? 'A+' : score >= 2 ? 'güçlü' : 'normal';
  for (const m of methods) { m.tag = quality === 'A+' ? 'A+' : undefined; }
  const reason = failNote();
  if (reason) notices.push({ key: `G-none-${day}`, requires: levelsKey, title: '⛔ G · Bugün kurulum yok', body: `G: Bugün kurulum yok — ${reason}` });
  for (const m of methods) {
    ov.push({ kind: 'line', style: 'entry', label: 'Giriş', price: m.entry }, { kind: 'line', style: 'stop', label: 'Stop', price: m.stop }, { kind: 'line', style: 'tp', label: 'T1', price: m.tp1 });
    if (m.tp2 !== undefined) ov.push({ kind: 'line', style: 'tp', label: 'T2', price: m.tp2 });
  }
  return [finalize(ctx, {
    ...base, id, sub: `Judas · Asya ${W.low} süpürmesi${reason || (ended && !signalAt) ? ' · bugün için bitti' : ''} · ${quality}`, dir: S, conditions: conds, methods, defaultMethod: methods[0]?.id,
    invalidation: `Dolumdan önce süpürme ucunun ötesinde 5m kapanış, 13:00 TR'ye kadar dolmama veya T1'in dolumdan önce görülmesi`,
    overlays: ov, signalAt, stars: score, tags: flags, notices,
    none: reason ? { why: reason, waiting: 'Yarın 00:00 NY (08:00 TR) yeni seviyeler', ends: noneEnds } : undefined,
    warnings: newsDay ? [`Haber günü: ${newsDay.title} ${fmtTR(newsDay.t)} TR — T1 alınmadıysa ${G.newsExitMin} dk önce tüm pozisyon kapatılır`] : [],
    info: gInfo({ filled: !!signalAt, quality, flags, sweep: sweepBar ? { side: W.side, bar: sweepBar.t, ext: P(ext), depth } : null, early: Number.isFinite(early) ? S * early : null, newsDay: newsDay ? { t: newsDay.t, title: newsDay.title } : null, timeline: { asia: T(-4), mo, sweep: T(2), sweepEnd: T(4), lastEntry: T(5), forceExit: T(12) } }),
  })];
}
export const _g = { durationText };
