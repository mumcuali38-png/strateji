import type { Condition, Dir, Overlay, Setup } from '../types.ts';
import { Ctx, finalize, method, pushTargetOverlays, rankSetups } from '../context.ts';
import { body, splitClosed } from '../candles.ts';
import { makeAvgBody } from '../structure.ts';
import { HOUR, fmtTR, fmtNY } from '../time.ts';
import { htfFilter } from './common.ts';

/** KURULUM A — 4H mum fake-out (MASTERPROMPT §3) */
export function evalA(ctx: Ctx): Setup[] {
  const p = ctx.p.A;
  const h4 = ctx.closed('4h');
  const flt = htfFilter(ctx);
  const c5 = ctx.closed('5m');
  const avgBody = makeAvgBody(c5, ctx.p.displacementLookback);
  const atr1h = ctx.atr('1h');
  const strong = (i: number, d: Dir) => {
    const x = c5[i]; const r = x.h - x.l;
    const dirOk = d === 1 ? x.c > x.o : x.c < x.o;
    return dirOk && body(x) >= ctx.p.displacementMult * avgBody(i) && r > 0 && body(x) / r >= ctx.p.strongBodyRatio;
  };
  const out: Setup[] = [];
  const lines = h4.slice(-2).reverse();
  for (const X of lines) {
    const end = X.t + 4 * HOUR;
    if (ctx.now >= end + p.lineLifeCandles * 4 * HOUR) continue;
    for (const side of ['high', 'low'] as const) {
      const dir: Dir = side === 'high' ? -1 : 1;
      const lvl = side === 'high' ? X.h : X.l;
      const lineName = `4H ${side} ${ctx.fmt(lvl)} (${fmtNY(X.t)} NY mumu)`;
      const start = c5.findIndex((x) => x.t >= end);
      let phase: 'await' | 'out' | 'done' | 'invalid' = 'await';
      let outIdx = -1, inIdx = -1, extreme = lvl, outsideBars = 0, invalidWhy = '', weakNote = '';
      const outside = (x: { c: number }) => (dir === -1 ? x.c > lvl : x.c < lvl);
      if (start >= 0) {
        for (let i = start; i < c5.length && phase !== 'done' && phase !== 'invalid'; i++) {
          const x = c5[i];
          if (phase === 'await') {
            if (outside(x)) {
              const kz = ctx.killzoneAt(x.t, 'A');
              if (!kz) { phase = 'invalid'; invalidWhy = `Dışarı kapanış killzone dışında (${fmtTR(x.t)} TR)`; break; }
              if (strong(i, (-dir) as Dir)) { phase = 'out'; outIdx = i; extreme = dir === -1 ? x.h : x.l; outsideBars = 1; }
              else weakNote = `Zayıf gövdeli dışarı kapanış ${fmtTR(x.t)} TR (sayılmadı)`;
            }
          } else if (phase === 'out') {
            extreme = dir === -1 ? Math.max(extreme, x.h) : Math.min(extreme, x.l);
            if (!outside(x)) {
              if (!strong(i, dir)) { phase = 'invalid'; invalidWhy = `İçeri dönüş zayıf gövdeli (${fmtTR(x.t)} TR) — displacement değil`; }
              else if (!ctx.killzoneAt(x.t, 'A')) { phase = 'invalid'; invalidWhy = `Dönüş killzone dışında (${fmtTR(x.t)} TR)`; }
              else { phase = 'done'; inIdx = i; }
            } else {
              outsideBars++;
              if (outsideBars > p.maxOutsideBars) { phase = 'invalid'; invalidWhy = `Fiyat dışarıda ${outsideBars} mum oyalandı (> ${p.maxOutsideBars})`; }
            }
            if (phase !== 'invalid' && Math.abs(extreme - lvl) > p.maxExcursionAtr1h * atr1h) { phase = 'invalid'; invalidWhy = `Çizgiden çok uzağa gitti (${ctx.fmt(Math.abs(extreme - lvl))} > 1×ATR1H ${ctx.fmt(atr1h)})`; }
          }
        }
      }
      const conds: Condition[] = [];
      conds.push(flt.trendCond(dir));
      conds.push(flt.emaCond(dir));
      conds.push({ id: 'line', label: 'Çizgi', status: phase === 'invalid' ? 'fail' : 'ok', detail: phase === 'invalid' ? `${lineName} geçersiz: ${invalidWhy}` : `${lineName} · ${dir === 1 ? 'long (alt çizgi)' : 'short (üst çizgi)'}`, level: lvl });
      conds.push(ctx.killzoneCond('A'));
      const lastPrice = ctx.price;
      conds.push(phase === 'await'
        ? { id: 'out', label: 'Dışarı kapanış (5m)', status: 'wait', detail: `${side === 'high' ? 'Üstünde' : 'Altında'} güçlü gövdeli 5m kapanış bekleniyor · fiyat ${ctx.fmt(lastPrice)}${weakNote ? ' · ' + weakNote : ''}`, level: lvl }
        : outIdx >= 0
          ? { id: 'out', label: 'Dışarı kapanış (5m)', status: 'ok', detail: `${fmtTR(c5[outIdx].t)} TR · kapanış ${ctx.fmt(c5[outIdx].c)} ${side === 'high' ? 'üstte' : 'altta'}`, level: c5[outIdx].c }
          : { id: 'out', label: 'Dışarı kapanış (5m)', status: 'fail', detail: invalidWhy, level: lvl });
      conds.push(phase === 'done'
        ? { id: 'in', label: 'İçeri kapanış (5m)', status: 'ok', detail: `${fmtTR(c5[inIdx].t)} TR · güçlü kapanış ${ctx.fmt(c5[inIdx].c)} → giriş`, level: c5[inIdx].c }
        : phase === 'invalid' && outIdx >= 0
          ? { id: 'in', label: 'İçeri kapanış (5m)', status: 'fail', detail: invalidWhy }
          : { id: 'in', label: 'İçeri kapanış (5m)', status: 'wait', detail: `Çizgi ${ctx.fmt(lvl)} ${side === 'high' ? 'altına' : 'üstüne'} güçlü 5m kapanış bekleniyor`, level: lvl });

      const overlays: Overlay[] = [{ kind: 'line', style: 'line4h', label: `4H ${side === 'high' ? 'high' : 'low'}`, price: lvl, from: X.t, cond: 'line' }];
      let methods: ReturnType<typeof method>[] = [];
      let signalAt: number | undefined;
      if (phase === 'out' || phase === 'done') {
        const entry = phase === 'done' ? c5[inIdx].c : lvl;
        const tg = ctx.targets(dir, entry);
        const tp1 = tg[0]?.price, tp2 = tg[1]?.price;
        overlays.push({ kind: 'line', style: 'level', label: 'Dış uç', price: extreme, cond: 'stop' });
        conds.push({ id: 'stop', label: 'Stop', status: phase === 'done' ? 'ok' : 'wait', detail: `Dış hareket ucu ${ctx.fmt(extreme)} + spread/tampon${phase === 'out' ? ' (uç değişebilir)' : ''}`, level: extreme });
        if (tp1 !== undefined) {
          const m1 = method(ctx, 'market', 'Kapanışta piyasa emri', 'market', entry, extreme, dir, tp1, tp2, phase === 'out' ? 'Önizleme — içeri kapanış bekleniyor' : undefined);
          methods.push(m1);
          methods.push(method(ctx, 'retest', 'Çizgi retest limiti', 'limit', lvl, extreme, dir, tp1, tp2, 'Geri çekilmede çizgiye limit'));
          const rrOk = m1.rr >= ctx.p.risk.minRR;
          conds.push({ id: 'target', label: 'Hedef / RR ≥ 2', status: rrOk ? 'ok' : phase === 'done' ? 'fail' : 'wait', detail: `${tg[0].kind} (${tg[0].tf.toUpperCase()}) ${ctx.fmt(tp1)} · RR ${m1.rr.toFixed(2)}${phase === 'out' ? ' (önizleme)' : ''}`, level: tp1 });
        } else conds.push({ id: 'target', label: 'Hedef / RR ≥ 2', status: 'wait', detail: 'İşlem yönünde alınmamış likidite bulunamadı' });
      } else {
        conds.push({ id: 'stop', label: 'Stop', status: 'wait', detail: 'Dışarı hareket oluşunca belirlenir' });
        conds.push({ id: 'target', label: 'Hedef / RR ≥ 2', status: 'wait', detail: 'Giriş oluşunca hesaplanır' });
      }
      conds.push(ctx.newsCond());

      if (phase === 'done' && methods[0]) {
        signalAt = c5[inIdx].t;
        const after = c5.slice(inIdx + 1);
        const m = methods[0];
        const stopHit = after.some((x) => (dir === 1 ? x.l <= m.stop : x.h >= m.stop));
        const tpHit = after.some((x) => (dir === 1 ? x.h >= m.tp1 : x.l <= m.tp1));
        if (stopHit) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: 'Stop seviyesi delindi — senaryo bitti' });
        else if (tpHit) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: 'Hedef görüldü — senaryo tamamlandı' });
        else if (after.length > p.signalValidityBars) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: `Sinyal ${fmtTR(signalAt)} TR'de oluştu; çizgi kullanıldı (tek kullanımlık)` });
      }
      if (outIdx >= 0) overlays.push({ kind: 'zone', style: 'liq', label: 'Fake-out', top: Math.max(extreme, lvl), bottom: Math.min(extreme, lvl), from: c5[outIdx].t, to: (inIdx >= 0 ? c5[inIdx] : c5[c5.length - 1]).t, tf: '5m' });
      pushTargetOverlays(overlays, methods[0]);
      const zoneId = `L${X.t}${side[0]}`;
      out.push(finalize(ctx, {
        id: `A-${ctx.sym}-${zoneId}`, strategy: 'A', sub: `4H ${side} fake-out · 5m`, dir, conditions: conds, methods, defaultMethod: methods[0]?.id,
        invalidation: `Stop ${methods[0] ? ctx.fmt(methods[0].stop) : ctx.fmt(extreme)} delinirse veya çizgi ${fmtTR(end + p.lineLifeCandles * 4 * HOUR)} TR'ye kadar alınmazsa`,
        extra: ctx.extra(dir), overlays, chartTf: '5m', tfs: ['5m', '15m', '1h', '4h'], signalAt, zoneId,
      }));
    }
  }
  if (!out.length) {
    const c4 = splitClosed(ctx.closed('4h'), '4h', ctx.now).closed;
    out.push(finalize(ctx, {
      id: `A-${ctx.sym}-none`, strategy: 'A', sub: '4H fake-out', dir: 0, zoneId: 'none', overlays: [], chartTf: '5m', tfs: ['5m', '4h'], methods: [],
      conditions: [{ id: 'line', label: 'Çizgi', status: 'fail', detail: c4.length ? 'Aktif 4H çizgisi yok' : 'Veri yetersiz' }],
      none: { why: 'Aktif 4H çizgisi yok', waiting: 'Bir sonraki 4H mum kapanışı', ends: '—' },
    }));
  }
  return out.sort(rankSetups);
}
