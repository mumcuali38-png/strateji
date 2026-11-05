import type { Candle, Condition, Dir, Overlay, Setup } from '../types.ts';
import { Ctx, finalize, method, pushTargetOverlays, rankSetups } from '../context.ts';
import type { Liq, Zone } from '../structure.ts';
import { DIR_TXT } from '../structure.ts';
import { HOUR, MIN, durationText, fmtTR, nyDayStart, parseHM } from '../time.ts';

/** 4H merdiven: son iki swing tepe ve dip aynı yönde yükseliyor/düşüyor mu */
function stairs(ctx: Ctx): Dir | 0 {
  const sw = ctx.an('4h').swings;
  const H = sw.filter((s) => s.type === 'H').slice(-2), L = sw.filter((s) => s.type === 'L').slice(-2);
  if (H.length < 2 || L.length < 2) return 0;
  if (H[1].price > H[0].price && L[1].price > L[0].price) return 1;
  if (H[1].price < H[0].price && L[1].price < L[0].price) return -1;
  return 0;
}

/** KURULUM C — Nasdaq 10 AM / TNM (MASTERPROMPT §9). Saf ICT: EMA/killzone/ek teyit yok. */
export function evalC(ctx: Ctx, priorSignals: { id: string; t: number }[] = []): Setup[] {
  const sess = ctx.conf.sessions.C;
  const today = nyDayStart(ctx.now);
  const winStart = today + parseHM(sess.start) * MIN;
  const winEnd = today + parseHM(sess.end) * MIN;
  const candleStart = ctx.p.C.tnmCandleMode === 'aligned' ? today + 8 * HOUR : winStart;
  const conds: Condition[] = [];
  const overlays: Overlay[] = [];

  // 1. Bias
  const dAn = ctx.an('1d');
  const lastD = dAn.breaks[dAn.breaks.length - 1];
  const dailyDir: Dir | 0 = lastD ? lastD.dir : 0;
  const st = stairs(ctx);
  const dFvg = dAn.zones.filter((z) => z.kind === 'FVG' && z.brokenIdx === undefined).slice(-1)[0];
  const bias: Dir | 0 = dailyDir && st === dailyDir ? dailyDir : 0;
  conds.push(bias
    ? { id: 'bias', label: 'Bias', status: 'ok', detail: `Daily ${DIR_TXT(dailyDir)} (son ${lastD!.type}) · 4H merdiven teyitli${dFvg ? ` · daily FVG ${dFvg.dir === 1 ? 'bullish' : 'bearish'} ${ctx.fmt(dFvg.bottom)}–${ctx.fmt(dFvg.top)}` : ''}` }
    : { id: 'bias', label: 'Bias', status: 'fail', detail: `Daily ${DIR_TXT(dailyDir)} · 4H merdiven ${DIR_TXT(st)} — uyumlu bias yok` });
  const dir: Dir = (bias || 1) as Dir;

  // 2. PD array'ler
  const pd: { label: string; top: number; bottom: number; dir: Dir }[] = [];
  const addZone = (z: Zone, label: string) => pd.push({ label, top: z.top, bottom: z.bottom, dir: z.dir });
  for (const z of dAn.zones.filter((q) => q.kind === 'FVG' && q.brokenIdx === undefined).slice(-4)) addZone(z, 'Daily FVG');
  for (const z of ctx.an('4h').zones.filter((q) => (q.kind === 'OB' || q.kind === 'BRK') && q.brokenIdx === undefined).slice(-4)) addZone(z, z.kind === 'OB' ? '4H OB' : '4H breaker');
  const mssLevels = ctx.an('4h').breaks.filter((b) => b.mss).slice(-2).map((b) => b.level);
  const c5 = ctx.closed('5m');
  const openAt = (t: number) => c5.find((x) => x.t >= t && x.t < t + 30 * MIN)?.o;
  const open18 = openAt(today - 6 * HOUR), open00 = openAt(today);
  const keyLevels: Liq[] = [];
  if (open18 !== undefined) keyLevels.push({ price: open18, side: open18 > ctx.price ? 'buy' : 'sell', kind: 'NY 18:00 açılışı', t: today - 6 * HOUR, tf: '1h' });
  if (open00 !== undefined) keyLevels.push({ price: open00, side: open00 > ctx.price ? 'buy' : 'sell', kind: 'NY 00:00 açılışı', t: today, tf: '1h' });
  const eqLiq = [...ctx.an('15m').liquidity, ...ctx.an('1h').liquidity].filter((l) => l.kind.startsWith('eşit') && l.takenAt === undefined);
  conds.push({ id: 'pd', label: 'PD array\'ler', status: pd.length || eqLiq.length || keyLevels.length ? 'ok' : 'wait', detail: `${pd.length} bölge · ${eqLiq.length} eşit tepe/dip · ${mssLevels.length} MSS seviyesi · açılışlar: 18:00 ${ctx.fmt(open18)} / 00:00 ${ctx.fmt(open00)}` });
  for (const z of pd.slice(-4)) overlays.push({ kind: 'zone', style: z.label.includes('FVG') ? 'fvg' : 'ob', label: z.label, top: z.top, bottom: z.bottom });
  for (const k of keyLevels) overlays.push({ kind: 'line', style: 'level', label: k.kind, price: k.price });

  // Günlük limit
  const todaySignals = priorSignals.filter((s) => s.t >= today);
  const c1 = ctx.closed('1m');
  const inWin = ctx.now >= winStart && ctx.now < winEnd;
  const winCond: Condition = ctx.now < winStart
    ? { id: 'window', label: 'Saat 10:00–11:00 NY', status: 'fail', detail: `Pencere 18:00 TR'de açılıyor (${durationText(winStart - ctx.now)})` }
    : ctx.now >= winEnd
      ? { id: 'window', label: 'Saat 10:00–11:00 NY', status: 'fail', detail: '11:00 NY (19:00 TR) sonrası giriş yok' }
      : { id: 'window', label: 'Saat 10:00–11:00 NY', status: 'ok', detail: `Pencere açık (kapanışa ${durationText(winEnd - ctx.now)})` };

  // 3. TNM mumu ve manipülasyon
  const tnm = c1.filter((x) => x.t >= candleStart && x.t < candleStart + 4 * HOUR);
  const winBars = c1.filter((x) => x.t >= winStart && x.t < winEnd);
  let manip: { i: number; t: number; extreme: number; what: string } | undefined;
  let mss: { tf: '1m' | '3m'; t: number; level: number; legExtreme: number; legHigh: number; i: number; displacement: boolean } | undefined;
  let entryM: ReturnType<typeof method> | undefined;
  const methods: ReturnType<typeof method>[] = [];
  let tnmHi = NaN, tnmLo = NaN, ote = NaN;
  if (tnm.length) {
    tnmHi = Math.max(...tnm.map((x) => x.h)); tnmLo = Math.min(...tnm.map((x) => x.l)); ote = (tnmHi + tnmLo) / 2;
    overlays.push({ kind: 'zone', style: 'range', label: 'TNM 4H mumu', top: tnmHi, bottom: tnmLo, from: candleStart, to: candleStart + 4 * HOUR, tf: '1m' });
    overlays.push({ kind: 'line', style: 'eq', label: 'OTE 0.5', price: ote, cond: 'tnm' });
  }
  if (inWin || ctx.now >= winEnd) {
    const oppLiq: Liq[] = [...keyLevels, ...ctx.an('5m').liquidity, ...ctx.an('15m').liquidity, ...ctx.htfLevels()]
      .filter((l) => l.side === (dir === 1 ? 'sell' : 'buy') && (l.takenAt === undefined || l.takenAt >= winStart) && l.t < winStart);
    const oppZones = [...pd, ...ctx.an('15m').zones.filter((z) => z.brokenIdx === undefined && (z.kind === 'FVG' || z.kind === 'OB')).map((z) => ({ label: `15m ${z.kind}`, top: z.top, bottom: z.bottom, dir: z.dir }))].filter((z) => z.dir === dir);
    for (let i = 0; i < winBars.length; i++) {
      const x = winBars[i];
      const lvl = oppLiq.find((l) => (dir === 1 ? x.l < l.price && x.c > l.price : x.h > l.price && x.c < l.price));
      const zone = oppZones.find((z) => (dir === 1 ? x.l <= z.top && x.l >= z.bottom - (z.top - z.bottom) : x.h >= z.bottom && x.h <= z.top + (z.top - z.bottom)));
      if (lvl || zone) { manip = { i, t: x.t, extreme: dir === 1 ? x.l : x.h, what: lvl ? `${lvl.kind} ${ctx.fmt(lvl.price)} süpürüldü` : `${zone!.label} temas` }; break; }
    }
  }
  conds.push(!tnm.length
    ? { id: 'tnm', label: 'TNM + manipülasyon', status: ctx.now < winStart ? 'wait' : 'wait', detail: ctx.now < winStart ? `TNM mumu ${fmtTR(candleStart)} TR'de açılır` : '1m verisi bekleniyor' }
    : manip
      ? { id: 'tnm', label: 'TNM + manipülasyon', status: 'ok', detail: `OTE 0.5 = ${ctx.fmt(ote)} · ${fmtTR(manip.t)} TR: ${manip.what}`, level: manip.extreme }
      : { id: 'tnm', label: 'TNM + manipülasyon', status: ctx.now >= winEnd ? 'fail' : 'wait', detail: `OTE 0.5 = ${ctx.fmt(ote)} · bias'a ters PD array/likiditeye iğne bekleniyor`, level: ote });

  // 4. Onay: 1m/3m MSS (kapanışlı)
  if (manip) {
    let ext = manip.extreme;
    for (const tf of ['1m', '3m'] as const) {
      const an = ctx.an(tf);
      const br = an.breaks.find((b) => b.dir === dir && b.t > manip!.t - (tf === '3m' ? 3 * MIN : 0) && b.t < winEnd && (b.type === 'CHoCH' || b.displacement));
      if (br && (!mss || br.t < mss.t)) {
        const seg = an.c.slice(an.c.findIndex((x) => x.t >= manip!.t - 3 * MIN), br.i + 1);
        ext = dir === 1 ? Math.min(...seg.map((x) => x.l)) : Math.max(...seg.map((x) => x.h));
        const legHigh = dir === 1 ? Math.max(...seg.map((x) => x.h)) : Math.min(...seg.map((x) => x.l));
        mss = { tf, t: br.t, level: br.level, legExtreme: ext, legHigh, i: br.i, displacement: br.displacement };
      }
    }
  }
  conds.push(mss
    ? { id: 'mss', label: 'Onay (1m/3m MSS)', status: 'ok', detail: `${mss.tf} ${mss.displacement ? 'MSS' : 'yapı kırılımı'} ${ctx.fmt(mss.level)} ${dir === 1 ? 'üstü' : 'altı'} kapanış · ${fmtTR(mss.t)} TR`, level: mss.level }
    : { id: 'mss', label: 'Onay (1m/3m MSS)', status: manip && ctx.now < winEnd ? 'wait' : ctx.now >= winEnd ? 'fail' : 'wait', detail: manip ? 'Bias yönünde 1m/3m MSS kapanışı bekleniyor' : 'Önce manipülasyon gerekli' });

  // 5–7. Giriş, stop, hedef
  if (mss) {
    const an = ctx.an(mss.tf);
    const fvg = an.zones.find((z) => z.kind === 'FVG' && z.dir === dir && z.t >= manip!.t - 3 * MIN && z.i <= mss!.i + 2);
    const ob = an.zones.find((z) => z.kind === 'OB' && z.breakIdx === mss!.i);
    const leg = Math.abs(mss.legHigh - mss.legExtreme);
    const [s1, s2] = ctx.p.C.stdv;
    const stdv2 = mss.legHigh + dir * s1 * leg, stdv4 = mss.legHigh + dir * s2 * leg;
    const liqT = ctx.targets(dir, mss.level, ['5m', '15m', '1h']);
    const tp1 = liqT[0]?.price ?? (fvg ? (fvg.top + fvg.bottom) / 2 : stdv2);
    if (fvg) methods.push(method(ctx, 'fvg', `${mss.tf} FVG geri çekilme`, 'limit', dir === 1 ? fvg.top : fvg.bottom, mss.legExtreme, dir, tp1, stdv2, `TP2 STDV -${s1} · STDV -${s2} = ${ctx.fmt(stdv4)}`));
    if (ob) methods.push(method(ctx, 'breaker', `${mss.tf} breaker/OB`, 'limit', dir === 1 ? ob.top : ob.bottom, mss.legExtreme, dir, tp1, stdv2));
    methods.push(method(ctx, 'mss', 'MSS seviyesi retest', 'limit', mss.level, mss.legExtreme, dir, tp1, stdv2));
    const valid = methods.filter((m) => (dir === 1 ? m.entry > m.stop : m.entry < m.stop));
    entryM = valid.find((m) => Math.max(m.rr, m.rr2 ?? 0) >= ctx.p.risk.minRR) ?? valid[0];
    // Limit iptali: OTE 0.5'e dokunmadan yeni tepe/dip
    const after = an.c.slice(mss.i + 1);
    let touchedOte = false, cancelled = false, filled = false;
    for (const x of after) {
      if (dir === 1 ? x.l <= ote : x.h >= ote) touchedOte = true;
      if (entryM && (dir === 1 ? x.l <= entryM.entry : x.h >= entryM.entry)) filled = true;
      if (!touchedOte && !filled && (dir === 1 ? x.h > mss.legHigh : x.l < mss.legHigh)) { cancelled = true; break; }
    }
    conds.push(entryM
      ? cancelled
        ? { id: 'entry', label: 'Giriş (FVG/breaker/RB)', status: 'fail', detail: `Fiyat OTE 0.5'e dokunmadan yeni ${dir === 1 ? 'tepe' : 'dip'} yaptı — emir silindi` }
        : { id: 'entry', label: 'Giriş (FVG/breaker/RB)', status: 'ok', detail: `${entryM.label} limit ${ctx.fmt(entryM.entry)}${filled ? ' · limit seviyesi görüldü' : ' · geri çekilme bekleniyor'}`, level: entryM.entry }
      : { id: 'entry', label: 'Giriş (FVG/breaker/RB)', status: 'wait', detail: 'Geçerli giriş bölgesi yok' });
    conds.push({ id: 'stop', label: 'Stop', status: 'ok', detail: `Yapının ötesi ${ctx.fmt(mss.legExtreme)} + tampon`, level: mss.legExtreme });
    const best = entryM ? Math.max(entryM.rr, entryM.rr2 ?? 0) : 0;
    conds.push({ id: 'rr', label: 'Hedef / RR ≥ 2', status: best >= ctx.p.risk.minRR ? 'ok' : 'fail', detail: entryM ? `TP1 ${ctx.fmt(entryM.tp1)} (RR ${entryM.rr.toFixed(2)}) · TP2 STDV -${s1} ${ctx.fmt(stdv2)} (RR ${(entryM.rr2 ?? 0).toFixed(2)})` : '—', level: entryM?.tp1 });
    if (entryM) {
      const stopHit = after.some((x) => (dir === 1 ? x.l <= entryM!.stop : x.h >= entryM!.stop));
      if (stopHit) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: 'Stop seviyesi delindi — senaryo bitti' });
    }
    overlays.push({ kind: 'line', style: 'level', label: 'STDV -4', price: stdv4 });
  } else {
    conds.push({ id: 'entry', label: 'Giriş (FVG/breaker/RB)', status: 'wait', detail: 'MSS sonrası geri çekilmede FVG/breaker/RB — TNM\'ye kör limit yok' });
    conds.push({ id: 'stop', label: 'Stop', status: 'wait', detail: 'Yapı oluşunca' });
    conds.push({ id: 'rr', label: 'Hedef / RR ≥ 2', status: 'wait', detail: 'TP1 likidite / FVG orta · TP2 STDV -2/-4' });
  }
  conds.push(winCond);
  const own = `C-${ctx.sym}-${today}`;
  const others = todaySignals.filter((s) => s.id !== own);
  conds.push(others.length >= ctx.p.C.maxTradesPerDay
    ? { id: 'limit', label: 'Günde en fazla 1 işlem', status: 'fail', detail: `Bugün ${fmtTR(others[0].t)} TR'de C sinyali oluştu — günün ikinci işlemi yok` }
    : { id: 'limit', label: 'Günde en fazla 1 işlem', status: 'ok', detail: 'Bugün henüz C işlemi yok' });
  conds.push(ctx.newsCond());
  pushTargetOverlays(overlays, entryM);
  const ratio = ctx.p.us100PerQqq;
  return [finalize(ctx, {
    id: own, strategy: 'C', sub: `TNM 10 AM · ${mss ? mss.tf : '1m/3m'} onay`, dir: bias, conditions: conds, methods: entryM ? [entryM, ...methods.filter((m) => m !== entryM)] : methods, defaultMethod: entryM?.id,
    invalidation: 'OTE 0.5\'e dokunmadan yeni tepe/dip, stop, veya 11:00 NY (19:00 TR)',
    none: ctx.now < winStart ? { why: `Pencere dışında — 18:00 TR'de açılıyor (${durationText(winStart - ctx.now)})`, waiting: `Bias ${DIR_TXT(bias)} · izlenecek: ${[...keyLevels.map((k) => `${k.kind} ${ctx.fmt(k.price)}`), ...pd.slice(-2).map((z) => `${z.label} ${ctx.fmt(z.bottom)}–${ctx.fmt(z.top)}`)].join(' · ') || '—'}`, ends: '11:00 NY (19:00 TR)' } : undefined,
    overlays, chartTf: '1m', tfs: ['1m', '3m', '5m', '15m', '4h', '1d'], signalAt: mss?.t, zoneId: String(today), info: { qqqToUs100: ratio, ote, tnmHi, tnmLo },
  })].sort(rankSetups);
}

export type _C = Candle;
