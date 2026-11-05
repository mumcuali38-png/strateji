import type { Candle, Condition, Dir, Overlay, Setup, TF } from '../types.ts';
import { Ctx, finalize, method, pushTargetOverlays, rankSetups } from '../context.ts';
import { DIR_TXT } from '../structure.ts';
import { DAY, HOUR, TF_LABEL, TF_MS, fmtTR, nyDayStart } from '../time.ts';

const BREAK_TF: Partial<Record<TF, TF[]>> = { '4h': ['4h', '1h'], '1h': ['1h', '15m'] };
const HIGHER: Partial<Record<TF, TF[]>> = { '4h': ['1d', '4h'], '1h': ['4h', '1d', '1h'] };

/**
 * RB bölgesi: süpürme mumu + iğne bölgesinde kalan en fazla (maxCandles-1) mum.
 * Bearish: en yüksek gövde (open/close) ile iğne tepesi arası; bullish tersi.
 */
export function rbZone(c: Candle[], i: number, dir: Dir, maxCandles: number, level: number) {
  let j = i;
  const bodyEdge = (k: number) => (dir === -1 ? Math.max(c[k].o, c[k].c) : Math.min(c[k].o, c[k].c));
  while (j + 1 < c.length && j - i + 1 < maxCandles && (dir === -1 ? c[j + 1].h > bodyEdge(i) && c[j + 1].c <= level : c[j + 1].l < bodyEdge(i) && c[j + 1].c >= level)) j++;
  const grp = c.slice(i, j + 1);
  const wick = dir === -1 ? Math.max(...grp.map((x) => x.h)) : Math.min(...grp.map((x) => x.l));
  const bodyLvl = dir === -1 ? Math.max(...grp.map((x) => Math.max(x.o, x.c))) : Math.min(...grp.map((x) => Math.min(x.o, x.c)));
  return { j, wick, bodyLvl, top: dir === -1 ? wick : bodyLvl, bottom: dir === -1 ? bodyLvl : wick };
}

/** KURULUM E — Rejection Block (MASTERPROMPT §11) */
export function evalE(ctx: Ctx): Setup[] {
  const p = ctx.p.E;
  const dAn = ctx.an('1d');
  const lastD = dAn.breaks[dAn.breaks.length - 1];
  const bias: Dir | 0 = lastD ? lastD.dir : 0;
  const pdh = ctx.htfLevels().find((l) => l.kind === 'önceki gün high'), pdl = ctx.htfLevels().find((l) => l.kind === 'önceki gün low');
  const taken = [pdh?.takenAt ? 'PDH alındı' : '', pdl?.takenAt ? 'PDL alındı' : ''].filter(Boolean).join(', ') || 'PDH/PDL alınmadı';
  const biasCond: Condition = bias
    ? { id: 'bias', label: 'Günlük bias', status: 'ok', detail: `Son daily ${lastD!.type} ${DIR_TXT(bias)} · ${taken}` }
    : { id: 'bias', label: 'Günlük bias', status: 'fail', detail: 'Daily yapı net değil' };
  if (!bias) {
    return [finalize(ctx, { id: `E-${ctx.sym}-bias`, strategy: 'E', sub: 'Rejection Block', dir: 0, zoneId: 'bias', methods: [], overlays: [], chartTf: '1h', tfs: ['5m', '15m', '1h', '4h'], conditions: [biasCond] })];
  }
  const out: Setup[] = [];
  const dir = bias;
  for (const tf of p.tfs) {
    const an = ctx.an(tf);
    const c = an.c, atr = an.atr;
    if (!Number.isFinite(atr)) continue;
    const startI = Math.max(0, c.length - p.lookbackBars);
    // HTF PD array'ler ve anahtar açılışlar
    const pdZones = (HIGHER[tf] ?? []).flatMap((htf) => ctx.an(htf).zones.filter((z) => z.dir === dir && (z.kind === 'OB' || z.kind === 'FVG' || z.kind === 'BRK')).map((z) => ({ ...z, label: `${TF_LABEL[htf]} ${z.kind}` })));
    const d1 = ctx.closed('1d');
    const lastDay = d1[d1.length - 1];
    const keyOpens: { price: number; label: string }[] = [];
    if (lastDay) keyOpens.push({ price: ctx.closed('5m').find((x) => x.t >= nyDayStart(ctx.now))?.o ?? lastDay.c, label: 'NY 00:00 açılışı' });
    const wk = ctx.closed('1w'); if (wk.length) keyOpens.push({ price: (ctx.series('1w').live ?? wk[wk.length - 1]).o, label: 'Hafta açılışı' });
    const dsw = dAn.swings.slice(-6);
    const sh = dsw.filter((s) => s.type === 'H').slice(-1)[0], sl = dsw.filter((s) => s.type === 'L').slice(-1)[0];
    let fib: [number, number] | null = null;
    if (sh && sl) {
      const [f1, f2] = p.fib;
      // bearish: premium (düşükten yükseğe 78.6–88.6), bullish: discount
      fib = dir === -1 ? [sl.price + (sh.price - sl.price) * f1, sl.price + (sh.price - sl.price) * f2] : [sh.price - (sh.price - sl.price) * f2, sh.price - (sh.price - sl.price) * f1];
    }
    const sweeps = an.liquidity.filter((l) => l.side === (dir === -1 ? 'buy' : 'sell') && l.takenBy === 'sweep' && l.takenIdx !== undefined && l.takenIdx >= startI);
    const seen = new Set<number>();
    for (const L of sweeps) {
      const i = L.takenIdx!;
      if (seen.has(i)) continue;
      seen.add(i);
      const { j, wick, bodyLvl, top, bottom } = rbZone(c, i, dir, p.maxCandles, L.price);
      const rbC = c[j];
      const colorOk = dir === -1 ? rbC.c < rbC.o : rbC.c > rbC.o;
      // (a) PD array teması
      const pdHit = pdZones.find((z) => z.t < c[i].t && z.bottom <= top && z.top >= bottom);
      const keyHit = keyOpens.find((k) => k.price >= bottom && k.price <= top);
      const fibHit = fib && fib[0] <= top && fib[1] >= bottom ? `Fib ${p.fib.join('–')}` : '';
      const a = pdHit ? pdHit.label : keyHit ? keyHit.label : fibHit;
      const conds: Condition[] = [biasCond];
      conds.push(a
        ? { id: 'form', label: 'RB oluşumu (PD array + süpürme)', status: 'ok', detail: `${a} temas + ${L.kind} ${ctx.fmt(L.price)} iğneyle süpürüldü (${fmtTR(c[i].t)} TR)`, level: L.price }
        : { id: 'form', label: 'RB oluşumu (PD array + süpürme)', status: 'fail', detail: `${L.kind} süpürüldü ama bias yönlü PD array teması yok` });
      // Lifecycle: tükenme (iğne ötesinde gövde kapanışı), kırılım, geri dönüş
      const afterIdx = j + 1;
      let exhausted = -1;
      for (let k = afterIdx; k < c.length; k++) if (dir === -1 ? c[k].c > top : c[k].c < bottom) { exhausted = k; break; }
      const cisd = (() => {
        // RB öncesi aynı yönlü mum serisinin açılışı (CISD)
        let k = i; const want = (x: typeof c[number]) => (dir === -1 ? x.c > x.o : x.c < x.o);
        while (k - 1 >= 0 && want(c[k - 1])) k--;
        return k < i ? c[k].o : (dir === -1 ? c[i].l : c[i].h);
      })();
      let brk: { tf: TF; t: number; level: number; kind: string } | undefined;
      for (const btf of BREAK_TF[tf] ?? [tf]) {
        const ban = ctx.an(btf);
        const b = ban.breaks.find((x) => x.dir === dir && x.t > rbC.t && (exhausted < 0 || x.t < c[exhausted].t));
        const cis = ban.c.find((x) => x.t > rbC.t + TF_MS[tf] - TF_MS[btf] && (dir === -1 ? x.c < cisd : x.c > cisd));
        const cand = [b && { tf: btf, t: b.t, level: b.level, kind: b.mss ? 'MSS' : b.type }, cis && { tf: btf, t: cis.t, level: cisd, kind: 'CISD' }].filter(Boolean) as { tf: TF; t: number; level: number; kind: string }[];
        cand.sort((x, y) => x.t - y.t);
        if (cand[0] && (!brk || cand[0].t < brk.t)) brk = cand[0];
      }
      conds.push(!colorOk
        ? { id: 'confirm', label: 'Teyit (renk + kırılım)', status: 'fail', detail: `RB mumu ${dir === -1 ? 'kırmızı' : 'yeşil'} kapanmadı` }
        : brk ? { id: 'confirm', label: 'Teyit (renk + kırılım)', status: 'ok', detail: `${dir === -1 ? 'Kırmızı' : 'Yeşil'} kapanış · ${TF_LABEL[brk.tf]} ${brk.kind} ${ctx.fmt(brk.level)} (${fmtTR(brk.t)} TR)`, level: brk.level }
          : { id: 'confirm', label: 'Teyit (renk + kırılım)', status: exhausted >= 0 ? 'fail' : 'wait', detail: `Renk uygun · alt TF MSS/CISD bekleniyor (${ctx.fmt(cisd)} ${dir === -1 ? 'altı' : 'üstü'} kapanış)`, level: cisd });
      // 5. Bekle: gövde seviyesine geri dönüş
      let ret: number | undefined, used = false;
      if (brk) {
        const post = ctx.closed(brk.tf).filter((x) => x.t > brk!.t);
        let left = false;
        for (const x of post) {
          const touch = dir === -1 ? x.h >= bottom : x.l <= top;
          if (touch && ret === undefined) ret = x.t;
          else if (ret !== undefined && !touch && Math.abs(x.c - bodyLvl) > atr) left = true;
          else if (ret !== undefined && left && touch) { used = true; break; }
        }
      }
      conds.push(!brk ? { id: 'return', label: 'Gövde seviyesine dönüş', status: 'wait', detail: 'Önce kırılım' }
        : used ? { id: 'return', label: 'Gövde seviyesine dönüş', status: 'fail', detail: 'RB daha önce test edilip tepki verdi (kullanılmış)' }
          : ret ? { id: 'return', label: 'Gövde seviyesine dönüş', status: 'ok', detail: `${fmtTR(ret)} TR'de gövde seviyesi ${ctx.fmt(bodyLvl)} görüldü`, level: bodyLvl }
            : { id: 'return', label: 'Gövde seviyesine dönüş', status: 'wait', detail: `Limit ${ctx.fmt(bodyLvl)} — dönüş bekleniyor (kovalanmaz) · mesafe ${ctx.fmt(Math.abs(ctx.price - bodyLvl))}`, level: bodyLvl });
      // Giriş yöntemleri
      const tg = ctx.targets(dir, bodyLvl, ['1h', '4h']);
      const methods: ReturnType<typeof method>[] = [];
      const inside = bodyLvl + (dir === -1 ? 1 : -1) * p.limitInsidePct * Math.abs(wick - bodyLvl);
      if (tg[0]) {
        methods.push(method(ctx, 'body', 'Gövde kenarı limiti (standart)', 'limit', bodyLvl, wick, dir, tg[0].price, tg[1]?.price));
        methods.push(method(ctx, 'inside', `RB içi %${Math.round(p.limitInsidePct * 100)} limit (inceltme)`, 'limit', inside, wick, dir, tg[0].price, tg[1]?.price, 'RB içinde RB: 15m→5m→3m→1m küçük RB aranır'));
        if (a && ctx.killzoneAt(rbC.t, 'E')) methods.push(method(ctx, 'aggr', 'Agresif: RB ters kapanışında', 'market', rbC.c, wick, dir, tg[0].price, tg[1]?.price, 'Sadece 2a+2b birlikte, killzone içinde', 'AGRESİF'));
      }
      conds.push(tg[0] ? { id: 'stop', label: 'Stop', status: 'ok', detail: `İğne ucu ${ctx.fmt(wick)} ötesi + tampon (${ctx.fmt(methods[0].stop)})`, level: wick } : { id: 'stop', label: 'Stop', status: 'ok', detail: `İğne ucu ${ctx.fmt(wick)} ötesi` });
      conds.push(tg[0] ? { id: 'rr', label: 'Hedef / RR ≥ 2', status: methods[0].rr >= ctx.p.risk.minRR ? 'ok' : 'fail', detail: `Draw on liquidity: ${tg[0].kind} ${ctx.fmt(tg[0].price)} · RR ${methods[0].rr.toFixed(2)}`, level: tg[0].price }
        : { id: 'rr', label: 'Hedef / RR ≥ 2', status: 'wait', detail: 'Hedef likiditesi bulunamadı' });
      conds.push(ctx.killzoneCond('E'));
      conds.push(exhausted >= 0 ? { id: 'valid', label: 'Bölge geçerli', status: 'fail', detail: `İğne ucunun ötesinde gövde kapanışı (${fmtTR(c[exhausted].t)} TR) — bölge tükendi` } : { id: 'valid', label: 'Bölge geçerli', status: 'ok', detail: 'Taze' });
      if (ret && methods[0]) {
        const post = ctx.closed('5m').filter((x) => x.t >= ret!);
        if (post.some((x) => (dir === 1 ? x.h >= methods[0].tp1 : x.l <= methods[0].tp1))) conds.push({ id: 'done', label: 'Senaryo', status: 'fail', detail: 'Hedef görüldü — tamamlandı' });
        else if (ctx.now - ret > 6 * HOUR) conds.push({ id: 'done', label: 'Senaryo', status: 'fail', detail: 'Giriş 6 saatten eski' });
      }
      if (ctx.now - c[i].t > 5 * DAY) continue;
      conds.push(ctx.newsCond());
      const overlays: Overlay[] = [{ kind: 'zone', style: 'rb', label: `${TF_LABEL[tf]} RB`, top, bottom, from: c[i].t, tf, cond: 'form' }, { kind: 'line', style: 'liq', label: `$$ ${L.kind}`, price: L.price, from: L.t }];
      pushTargetOverlays(overlays, methods[0]);
      const zoneId = `${tf}-RB-${c[i].t}`;
      out.push(finalize(ctx, {
        id: `E-${ctx.sym}-${zoneId}`, strategy: 'E', sub: `${TF_LABEL[tf]} RB · ${brk ? TF_LABEL[brk.tf] : 'alt TF'} kırılım`, dir, conditions: conds, methods, defaultMethod: methods[0]?.id,
        invalidation: `İğne ucu ${ctx.fmt(wick)} ötesinde gövde kapanışı`, extra: ctx.extra(dir), overlays, chartTf: tf === '4h' ? '1h' : '15m', tfs: ['5m', '15m', '1h', '4h'],
        signalAt: ret, zoneId, tags: tf === '4h' ? ['4H RB (1H\'ten güçlü)'] : [],
        info: { distance: Math.abs(ctx.price - bodyLvl), body: bodyLvl, wick, biasOk: true },
      }));
    }
  }
  if (!out.length) {
    out.push(finalize(ctx, { id: `E-${ctx.sym}-none`, strategy: 'E', sub: 'Rejection Block', dir, zoneId: 'none', methods: [], overlays: [], chartTf: '1h', tfs: ['15m', '1h', '4h'],
      conditions: [biasCond, { id: 'form', label: 'RB oluşumu (PD array + süpürme)', status: 'fail', detail: `Son ${p.lookbackBars} mumda bias yönlü (${dir === 1 ? 'bullish' : 'bearish'}) süpürme yok` }],
      none: { why: 'Aktif (taze) RB yok', waiting: `${dir === 1 ? 'Sell-side' : 'Buy-side'} likiditenin PD array içinde iğneyle süpürülmesi`, ends: 'Bias değişirse' } }));
  }
  return out.sort(rankSetups).slice(0, 5);
}
