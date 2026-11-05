import type { Candle, Condition, Dir, Overlay, Setup, TF } from '../types.ts';
import { Ctx, finalize, method, pushTargetOverlays, rankSetups } from '../context.ts';
import { body, lowerWick, upperWick } from '../candles.ts';
import type { Analysis, Liq } from '../structure.ts';
import { MIN, TF_LABEL, TF_MS, durationText, fmtTR, nyDayStart, parseHM } from '../time.ts';

export function roundStep(price: number): number { return Math.pow(10, Math.floor(Math.log10(Math.abs(price))) - 2); }
function roundLevels(price: number, dir: Dir, n = 3): Liq[] {
  const st = roundStep(price);
  const out: Liq[] = [];
  let lv = dir === 1 ? Math.ceil(price / st) * st : Math.floor(price / st) * st;
  for (let k = 0; k < n; k++, lv += dir * st) out.push({ price: +lv.toFixed(8), side: dir === 1 ? 'buy' : 'sell', kind: 'tam sayı', t: 0, tf: '1h' });
  return out;
}

export function evalD(ctx: Ctx): Setup[] {
  const out: Setup[] = [d1(ctx)];
  for (const tf of ctx.p.D.d2.tfs) out.push(...d2(ctx, tf));
  return out.sort(rankSetups);
}

/** D1 — Açılış range'i (ORB) */
function d1(ctx: Ctx): Setup {
  const s = ctx.conf.sessions.D1, p = ctx.p.D.d1;
  const today = nyDayStart(ctx.now);
  const rs = today + parseHM(s.rangeStart) * MIN, re = today + parseHM(s.rangeEnd) * MIN, ee = today + parseHM(s.entryEnd) * MIN;
  const conds: Condition[] = [];
  const overlays: Overlay[] = [];
  const base = ctx.base1.length ? ctx.closed('1m') : [];
  const rangeBars = base.filter((x) => x.t >= rs && x.t < re);
  const fallback5 = ctx.closed('5m').find((x) => x.t === rs);
  let rh = NaN, rl = NaN;
  if (rangeBars.length >= 5) { rh = Math.max(...rangeBars.map((x) => x.h)); rl = Math.min(...rangeBars.map((x) => x.l)); }
  else if (fallback5) { rh = fallback5.h; rl = fallback5.l; }
  const id = `D1-${ctx.sym}-${today}`;
  const mk = (dir: Dir | 0, methods: ReturnType<typeof method>[] = [], signalAt?: number, none?: Setup['none']) => {
    pushTargetOverlays(overlays, methods[0]);
    return finalize(ctx, { id, strategy: 'D', sub: 'D1 · açılış range (ORB) · 1m', dir, conditions: conds, methods, defaultMethod: methods[0]?.id, invalidation: 'Retestte 1m kapanış range içine girerse o taraf iptal', overlays, chartTf: '1m', tfs: ['1m', '5m', '15m'], signalAt, zoneId: String(today), extra: ctx.extra(dir), none });
  };
  if (ctx.now < re || !Number.isFinite(rh)) {
    conds.push({ id: 'range', label: 'Range (09:30–09:35 NY)', status: ctx.now < re ? 'fail' : 'wait', detail: ctx.now < re ? `Range 17:30–17:35 TR'de oluşur (${durationText(re - ctx.now)})` : 'Range mumu verisi bekleniyor' });
    return mk(0, [], undefined, ctx.now < re ? { why: 'Henüz açılış range\'i yok', waiting: `NY açılış mumu 17:30 TR (${durationText(rs - ctx.now)})`, ends: '19:00 TR' } : undefined);
  }
  overlays.push({ kind: 'zone', style: 'range', label: 'ORB', top: rh, bottom: rl, from: rs, to: ee, tf: '1m', cond: 'range' });
  conds.push({ id: 'range', label: 'Range (09:30–09:35 NY)', status: 'ok', detail: `High ${ctx.fmt(rh)} · Low ${ctx.fmt(rl)}`, level: rh });
  const atr1 = ctx.atr('1m');
  const tol = p.retestTolAtr1m * (Number.isFinite(atr1) ? atr1 : (rh - rl) * 0.1);
  const bars = base.filter((x) => x.t >= re && x.t < ee);
  type St = { broken?: number; touch?: number; entry?: number; cancelled?: number };
  const st: Record<'1' | '-1', St> = { '1': {}, '-1': {} };
  let chosen: Dir | 0 = 0;
  for (let i = 0; i < bars.length && !chosen; i++) {
    const x = bars[i];
    for (const d of [1, -1] as Dir[]) {
      const S = st[String(d) as '1' | '-1'];
      if (S.cancelled !== undefined || chosen) continue;
      const lvl = d === 1 ? rh : rl;
      const outside = d === 1 ? x.c > lvl : x.c < lvl;
      if (S.broken === undefined) {
        const r = x.h - x.l;
        if (outside && r > 0 && body(x) / r >= p.momentumBodyPct && (d === 1 ? x.c > x.o : x.c < x.o)) S.broken = i;
        continue;
      }
      if (i === S.broken) continue;
      const backInside = d === 1 ? x.c < lvl : x.c > lvl;
      if (backInside) { S.cancelled = i; continue; }
      const touches = d === 1 ? x.l <= lvl + tol : x.h >= lvl - tol;
      if (touches && S.touch === undefined) S.touch = i;
      const wick = d === 1 ? lowerWick(x) : upperWick(x);
      const noOpp = d === 1 ? x.c >= x.o || wick >= 2 * body(x) : x.c <= x.o || wick >= 2 * body(x);
      if (touches && outside && wick >= p.rejectWickBody * body(x) && noOpp) { S.entry = i; chosen = d; }
    }
  }
  const up = st['1'], dn = st['-1'];
  const chop = up.cancelled !== undefined && dn.cancelled !== undefined;
  const dir: Dir | 0 = chosen || (up.broken !== undefined && up.cancelled === undefined ? 1 : dn.broken !== undefined && dn.cancelled === undefined ? -1 : 0);
  const S = dir ? st[String(dir) as '1' | '-1'] : undefined;
  const lvl = dir === 1 ? rh : rl;
  conds.push(chop ? { id: 'break', label: 'Kırılım (1m momentum kapanış)', status: 'fail', detail: 'İki taraf da fake-out verdi — gün chop, D1 bitti' }
    : S?.broken !== undefined ? { id: 'break', label: 'Kırılım (1m momentum kapanış)', status: 'ok', detail: `${fmtTR(bars[S.broken].t)} TR · ${dir === 1 ? 'high üstü' : 'low altı'} kapanış ${ctx.fmt(bars[S.broken].c)}`, level: lvl }
      : { id: 'break', label: 'Kırılım (1m momentum kapanış)', status: ctx.now >= ee ? 'fail' : 'wait', detail: `${ctx.fmt(rh)} üstü veya ${ctx.fmt(rl)} altı momentum kapanışı bekleniyor${up.cancelled !== undefined ? ' (üst taraf iptal)' : dn.cancelled !== undefined ? ' (alt taraf iptal)' : ''}` });
  conds.push(S?.entry !== undefined ? { id: 'retest', label: 'Retest + 1m red', status: 'ok', detail: `${fmtTR(bars[S.entry].t)} TR red mumu · kapanış ${ctx.fmt(bars[S.entry].c)}`, level: lvl }
    : { id: 'retest', label: 'Retest + 1m red', status: S?.broken !== undefined && ctx.now < ee ? 'wait' : ctx.now >= ee || chop ? 'fail' : 'wait', detail: S?.broken !== undefined ? `Seviyeye (${ctx.fmt(lvl)}) dönüş ve iğneli red mumu bekleniyor` : 'Kırılım sonrası' });
  conds.push(ctx.now < ee || S?.entry !== undefined ? { id: 'window', label: 'Pencere 17:35–19:00 TR', status: 'ok', detail: ctx.now < ee ? `Kapanışa ${durationText(ee - ctx.now)}` : 'Giriş pencere içinde oluştu' } : { id: 'window', label: 'Pencere 17:35–19:00 TR', status: 'fail', detail: 'Pencere kapandı (11:00 NY)' });
  const methods: ReturnType<typeof method>[] = [];
  let signalAt: number | undefined;
  if (dir) {
    const from = S?.touch ?? S?.broken ?? 0;
    const to = S?.entry ?? bars.length - 1;
    const seg = bars.slice(from, to + 1);
    const structural = dir === 1 ? Math.min(...seg.map((x) => x.l)) : Math.max(...seg.map((x) => x.h));
    const entry = S?.entry !== undefined ? bars[S.entry].c : lvl;
    const dayBars = ctx.closed('5m').filter((x) => x.t >= today && x.t < rs);
    const extra: Liq[] = [...roundLevels(entry, dir)];
    if (dayBars.length) extra.push({ price: dir === 1 ? Math.max(...dayBars.map((x) => x.h)) : Math.min(...dayBars.map((x) => x.l)), side: dir === 1 ? 'buy' : 'sell', kind: `günün ${dir === 1 ? 'high' : 'low'}'u`, t: today, tf: '1d' });
    const tg = ctx.targets(dir, entry, ['5m', '15m'], extra);
    if (tg[0]) {
      methods.push(method(ctx, 'reject', 'Red mumu kapanışı', 'market', entry, structural, dir, tg[0].price, tg[1]?.price, S?.entry === undefined ? 'Önizleme' : undefined));
      conds.push({ id: 'stop', label: 'Stop', status: S?.entry !== undefined ? 'ok' : 'wait', detail: `Retest/red ucu ${ctx.fmt(structural)} + tampon`, level: structural });
      conds.push({ id: 'rr', label: 'Hedef / RR ≥ 2', status: methods[0].rr >= ctx.p.risk.minRR ? 'ok' : S?.entry !== undefined ? 'fail' : 'wait', detail: `${tg[0].kind} ${ctx.fmt(tg[0].price)} · RR ${methods[0].rr.toFixed(2)}${S?.entry === undefined ? ' (önizleme)' : ''}`, level: tg[0].price });
    } else {
      conds.push({ id: 'stop', label: 'Stop', status: 'wait', detail: `Retest/red ucu ${ctx.fmt(structural)}` });
      conds.push({ id: 'rr', label: 'Hedef / RR ≥ 2', status: 'wait', detail: 'Hedef seviyesi bulunamadı' });
    }
    if (S?.entry !== undefined && methods[0]) {
      signalAt = bars[S.entry].t;
      const after = base.filter((x) => x.t > signalAt!);
      if (after.some((x) => (dir === 1 ? x.l <= methods[0].stop : x.h >= methods[0].stop))) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: 'Stop delindi — D1 bugün bitti' });
      else if (after.some((x) => (dir === 1 ? x.h >= methods[0].tp1 : x.l <= methods[0].tp1))) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: 'Hedef görüldü — D1 bugün bitti' });
      else if (after.length > 10) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: `Giriş ${fmtTR(signalAt)} TR'de oluştu (parite başına günde 1 D1)` });
    }
  } else {
    conds.push({ id: 'stop', label: 'Stop', status: 'wait', detail: 'Retest oluşunca' });
    conds.push({ id: 'rr', label: 'Hedef / RR ≥ 2', status: 'wait', detail: 'Giriş oluşunca' });
  }
  conds.push(ctx.newsCond());
  return mk(dir, methods, signalAt);
}

interface Range { s: number; e: number; top: number; bottom: number; topZone: number; botZone: number; post: number }

export function findRange(an: Analysis, minBars: number, maxBars: number, minTests: number, edgeAtr: number): Range | null {
  const c = an.c, n = c.length;
  const atr = an.atr;
  if (!Number.isFinite(atr) || n < minBars + 2) return null;
  for (let post = 0; post <= 6; post++) {
    const e = n - 1 - post;
    if (post > 0 && !(c[e + 1].h > Math.max(...c.slice(Math.max(0, e - minBars), e + 1).map((x) => x.h)) || c[e + 1].l < Math.min(...c.slice(Math.max(0, e - minBars), e + 1).map((x) => x.l)))) continue;
    for (let L = Math.min(maxBars, e + 1); L >= minBars; L--) {
      const s = e - L + 1;
      const seg = c.slice(s, e + 1);
      const top = Math.max(...seg.map((x) => x.h)), bottom = Math.min(...seg.map((x) => x.l));
      const tc = seg.find((x) => x.h === top)!, bc = seg.find((x) => x.l === bottom)!;
      const topZone = Math.min(top - edgeAtr * atr, Math.max(tc.o, tc.c));
      const botZone = Math.max(bottom + edgeAtr * atr, Math.min(bc.o, bc.c));
      const sw = an.swings.filter((x) => x.i >= s && x.i <= e);
      const distinct = (arr: number[]) => { let k = 0, last = -99; for (const i of arr) { if (i - last >= 3) { k++; last = i; } } return k; };
      const tests = distinct(sw.filter((x) => x.type === 'H' && x.price >= topZone).map((x) => x.i));
      const btests = distinct(sw.filter((x) => x.type === 'L' && x.price <= botZone).map((x) => x.i));
      if (tests >= minTests && btests >= minTests) return { s, e, top, bottom, topZone, botZone, post };
    }
  }
  return null;
}

/** D2 — Konsolidasyon range'i */
function d2(ctx: Ctx, tf: TF): Setup[] {
  const p = ctx.p.D.d2;
  const an = ctx.an(tf);
  const ltf: TF = tf === '1h' ? '5m' : '15m';
  const r = findRange(an, p.minBars, p.maxBars, p.minTests, p.edgeZoneAtr);
  const atr = an.atr;
  const baseId = `D2-${ctx.sym}-${tf}`;
  if (!r) {
    return [finalize(ctx, { id: baseId, strategy: 'D', sub: `D2 · ${TF_LABEL[tf]} konsolidasyon range`, dir: 0, zoneId: `${tf}-none`, methods: [], overlays: [], chartTf: tf, tfs: [ltf, tf],
      conditions: [{ id: 'range', label: 'Range geçerliliği', status: 'fail', detail: `${TF_LABEL[tf]}'te her iki uçta ≥${p.minTests} test olan range yok` }],
      none: { why: `${TF_LABEL[tf]} geçerli range yok`, waiting: 'Her iki uçta en az 2 red', ends: '—' } })];
  }
  const c = an.c;
  const eq = (r.top + r.bottom) / 2, h = r.top - r.bottom;
  const narrow = h < p.narrowAtrMult * atr;
  const prior = an.breaks.filter((b) => b.i < r.s).slice(-2);
  const priorDir: Dir | 0 = prior.length === 2 && prior[0].dir === prior[1].dir ? prior[1].dir : prior.length ? prior[prior.length - 1].dir : 0;
  const ovBase: Overlay[] = [
    { kind: 'zone', style: 'range', label: `${TF_LABEL[tf]} range`, top: r.top, bottom: r.bottom, from: c[r.s].t, tf, cond: 'range' },
    { kind: 'zone', style: 'rb', label: 'Üst uç', top: r.top, bottom: r.topZone, from: c[r.s].t, tf },
    { kind: 'zone', style: 'rb', label: 'Alt uç', top: r.botZone, bottom: r.bottom, from: c[r.s].t, tf },
    { kind: 'line', style: 'eq', label: 'EQ 0.5', price: eq, from: c[r.s].t },
  ];
  const rangeCond: Condition = { id: 'range', label: 'Range geçerliliği', status: 'ok', detail: `${TF_LABEL[tf]} ${ctx.fmt(r.bottom)}–${ctx.fmt(r.top)} · ${r.e - r.s + 1} mum · yükseklik ${(h / atr).toFixed(1)}×ATR${narrow ? ' (dar)' : ''}` };
  const prefCond = (d: Dir): Condition => priorDir === 0 || priorDir === d
    ? { id: 'pref', label: 'Yön tercihi', status: 'ok', detail: priorDir === 0 ? 'Önceki trend yok — iki uç da kullanılabilir' : `Önceki trend ${priorDir === 1 ? 'yükseliş → alttan long' : 'düşüş → üstten short'}` }
    : { id: 'pref', label: 'Yön tercihi', status: 'fail', detail: `Önceki trend ${priorDir === 1 ? 'yükseliş — sadece alttan long' : 'düşüş — sadece üstten short'}` };
  const out: Setup[] = [];
  const after = c.slice(r.e + 1);

  // Kırılım modeli (her range'de)
  {
    const conds: Condition[] = [rangeCond];
    let bi = -1, d: Dir | 0 = 0;
    for (let i = 0; i < after.length; i++) {
      const x = after[i]; const rg = x.h - x.l;
      const mom = rg > 0 && body(x) / rg >= ctx.p.strongBodyRatio;
      if (mom && x.c > r.top && x.c > x.o) { bi = i; d = 1; break; }
      if (mom && x.c < r.bottom && x.c < x.o) { bi = i; d = -1; break; }
    }
    const dd: Dir = (d || priorDir || 1) as Dir;
    conds.push(priorDir === 0 || priorDir === dd ? { id: 'pref', label: 'Yön tercihi', status: 'ok', detail: priorDir ? `Önceki trend yönünde kırılım (öncelikli)` : 'Önceki trend yok' } : { id: 'pref', label: 'Yön tercihi', status: 'ok', detail: 'Önceki trende ters kırılım (düşük öncelik)' });
    conds.push(bi >= 0 ? { id: 'mom', label: 'Dışarıda momentum kapanışı', status: 'ok', detail: `${fmtTR(after[bi].t)} TR · ${ctx.fmt(after[bi].c)}`, level: d === 1 ? r.top : r.bottom }
      : { id: 'mom', label: 'Dışarıda momentum kapanışı', status: 'wait', detail: `${ctx.fmt(r.top)} üstü / ${ctx.fmt(r.bottom)} altı güçlü kapanış bekleniyor (tek kapanış yetmez)` });
    let pb = -1, conf = -1;
    if (bi >= 0) {
      let ext = after[bi][d === 1 ? 'h' : 'l'];
      for (let i = bi + 1; i < after.length; i++) {
        const x = after[i];
        if (pb < 0) { if (d === 1 ? x.c < x.o : x.c > x.o) pb = i; else ext = d === 1 ? Math.max(ext, x.h) : Math.min(ext, x.l); continue; }
        if (d === 1 ? x.c > ext : x.c < ext) { conf = i; break; }
      }
      conds.push(pb >= 0 ? { id: 'pullback', label: 'Geri çekilme + yeni kapanış', status: conf >= 0 ? 'ok' : 'wait', detail: conf >= 0 ? `Geri çekilme swing'i ötesinde kapanış ${fmtTR(after[conf].t)} TR` : `Geri çekilme var · ${ctx.fmt(ext)} ${d === 1 ? 'üstü' : 'altı'} kapanış bekleniyor`, level: ext }
        : { id: 'pullback', label: 'Geri çekilme + yeni kapanış', status: 'wait', detail: 'Geri çekilme bekleniyor' });
    } else conds.push({ id: 'pullback', label: 'Geri çekilme + yeni kapanış', status: 'wait', detail: 'Kırılım sonrası' });
    const methods: ReturnType<typeof method>[] = [];
    if (bi >= 0 && d) {
      const flip = d === 1 ? r.top : r.bottom;
      const seg = after.slice(bi, (conf >= 0 ? conf : after.length - 1) + 1);
      const structural = pb >= 0 ? (d === 1 ? Math.min(...after.slice(pb, (conf >= 0 ? conf : after.length - 1) + 1).map((x) => x.l)) : Math.max(...after.slice(pb, (conf >= 0 ? conf : after.length - 1) + 1).map((x) => x.h))) : (d === 1 ? Math.min(...seg.map((x) => x.l)) : Math.max(...seg.map((x) => x.h)));
      const stopRef = dir1(d) === 1 ? Math.min(structural, flip - 0.1 * atr) : Math.max(structural, flip + 0.1 * atr);
      const proj = flip + d * h;
      const tg = ctx.targets(d, flip, ['1h', '4h']);
      const tp2 = tg.find((l) => (d === 1 ? l.price > proj : l.price < proj))?.price;
      methods.push(method(ctx, 'flip', 'Flip seviyesi retest', 'limit', flip, stopRef, d, proj, tp2, 'Hedef: range yüksekliği projeksiyonu'));
      const rrOk = methods[0].rr >= ctx.p.risk.minRR;
      const retested = conf >= 0 && after.slice(conf + 1).some((x) => (d === 1 ? x.l <= flip : x.h >= flip));
      conds.push(conf >= 0 ? { id: 'retest', label: 'Flip retest', status: retested ? 'ok' : 'wait', detail: retested ? `Flip ${ctx.fmt(flip)} test edildi` : `Limit ${ctx.fmt(flip)} — retest bekleniyor`, level: flip } : { id: 'retest', label: 'Flip retest', status: 'wait', detail: 'Önce kırılım teyidi' });
      conds.push({ id: 'rr', label: 'RR ≥ 2', status: rrOk ? 'ok' : conf >= 0 ? 'fail' : 'wait', detail: `Projeksiyon ${ctx.fmt(proj)} · RR ${methods[0].rr.toFixed(2)}`, level: proj });
      if (conf >= 0) {
        const aft = after.slice(conf + 1);
        const m = methods[0];
        if (aft.some((x) => (d === 1 ? x.l <= m.stop : x.h >= m.stop))) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: 'Stop delindi' });
        else if (aft.some((x) => (d === 1 ? x.h >= m.tp1 : x.l <= m.tp1))) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: 'Projeksiyon hedefi görüldü — senaryo tamamlandı' });
        else if (aft.length > p.breakoutValidityBars) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: `Kırılım teyidi ${fmtTR(after[conf].t)} TR'de oluştu, ${p.breakoutValidityBars} ${TF_LABEL[tf]} mumdan eski` });
      }
    } else { conds.push({ id: 'retest', label: 'Flip retest', status: 'wait', detail: '—' }); conds.push({ id: 'rr', label: 'RR ≥ 2', status: 'wait', detail: '—' }); }
    conds.push(ctx.newsCond());
    const ov = [...ovBase]; pushTargetOverlays(ov, methods[0]);
    out.push(finalize(ctx, { id: `${baseId}-brk`, strategy: 'D', sub: `D2 · ${TF_LABEL[tf]} range kırılımı`, dir: d, conditions: conds, methods, defaultMethod: methods[0]?.id, signalAt: conf >= 0 ? after[conf].t : undefined, invalidation: 'Flip seviyesi kapanışla geri alınırsa', overlays: ov, chartTf: tf, tfs: [ltf, tf], zoneId: bi >= 0 ? `${tf}-brk${after[bi].t}` : `${tf}-brk-wait${c[r.s].t}`, extra: ctx.extra(d) }));
  }

  // Dönüş modeli (geniş range)
  for (const d of [1, -1] as Dir[]) {
    const conds: Condition[] = [rangeCond, prefCond(d)];
    conds.push(narrow ? { id: 'wide', label: 'Geniş range', status: 'fail', detail: `Yükseklik ${(h / atr).toFixed(2)}×ATR < ${p.narrowAtrMult} — dönüş yok, sadece kırılım` } : { id: 'wide', label: 'Geniş range', status: 'ok', detail: `Yükseklik ${(h / atr).toFixed(2)}×ATR` });
    // Uçta süpürme: önceki uç dip/tepesinin iğneyle geçilip gövdeyle içeri dönmesi
    let sw = -1;
    for (let i = c.length - 1; i > r.s + 3; i--) {
      const prevExt = d === 1 ? Math.min(...c.slice(r.s, i).map((x) => x.l)) : Math.max(...c.slice(r.s, i).map((x) => x.h));
      const x = c[i];
      if (d === 1 ? x.l < prevExt && x.c > prevExt && x.l <= r.botZone : x.h > prevExt && x.c < prevExt && x.h >= r.topZone) { sw = i; break; }
      if (c.length - 1 - i > 8) break;
    }
    const edgeZ = d === 1 ? r.botZone : r.topZone;
    const inEdge = d === 1 ? ctx.price <= edgeZ + 0.5 * atr : ctx.price >= edgeZ - 0.5 * atr;
    conds.push(sw >= 0 ? { id: 'sweep', label: 'Uçta likidite süpürmesi', status: 'ok', detail: `${fmtTR(c[sw].t)} TR · iğne ${ctx.fmt(d === 1 ? c[sw].l : c[sw].h)}`, level: d === 1 ? c[sw].l : c[sw].h }
      : { id: 'sweep', label: 'Uçta likidite süpürmesi', status: 'wait', detail: `${d === 1 ? 'Alt' : 'Üst'} uç ${ctx.fmt(d === 1 ? r.bottom : r.top)} · fiyat ${inEdge ? 'uçta' : 'uçtan uzak'} (${ctx.fmt(ctx.price)})`, level: d === 1 ? r.bottom : r.top });
    const methods: ReturnType<typeof method>[] = [];
    const lan = ctx.an(ltf);
    const br = sw >= 0 ? lan.breaks.find((b) => b.dir === d && b.type === 'CHoCH' && b.t >= c[sw].t && b.t <= c[sw].t + TF_MS[tf] + p.confirmMaxBars * TF_MS[ltf]) : undefined;
    conds.push(br ? { id: 'ltf', label: `LTF onay (${TF_LABEL[ltf]})`, status: 'ok', detail: `${TF_LABEL[ltf]} CHoCH ${ctx.fmt(br.level)} kapanış · ${fmtTR(br.t)} TR`, level: br.level }
      : { id: 'ltf', label: `LTF onay (${TF_LABEL[ltf]})`, status: sw >= 0 && ctx.now > c[sw].t + TF_MS[tf] + p.confirmMaxBars * TF_MS[ltf] ? 'fail' : 'wait', detail: `${TF_LABEL[ltf]} CHoCH/breaker/IFVG kapanışı bekleniyor` });
    if (sw >= 0) {
      const structural = d === 1 ? c[sw].l : c[sw].h;
      const entry = br ? br.level : (d === 1 ? edgeZ : edgeZ);
      const tp1 = eq, tp2 = d === 1 ? r.top : r.bottom;
      if (d === 1 ? entry > structural : entry < structural) {
        const m = method(ctx, 'retest', 'Kırılan swing retest limiti', 'limit', entry, structural, d, tp1, tp2, br ? undefined : 'Önizleme');
        methods.push(m);
        conds.push({ id: 'rr', label: 'RR ≥ 2 (TP2)', status: (m.rr2 ?? 0) >= ctx.p.risk.minRR ? 'ok' : br ? 'fail' : 'wait', detail: `TP1 EQ ${ctx.fmt(tp1)} · TP2 karşı uç ${ctx.fmt(tp2)} · RR2 ${(m.rr2 ?? 0).toFixed(2)}`, level: tp2 });
        if (br) {
          const aft = lan.c.filter((x) => x.t > br.t);
          if (aft.some((x) => (d === 1 ? x.l <= m.stop : x.h >= m.stop))) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: 'Stop delindi' });
          else if (aft.some((x) => (d === 1 ? x.h >= m.tp2! : x.l <= m.tp2!))) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: 'Karşı uca ulaşıldı — senaryo tamamlandı' });
          else if (aft.some((x) => (d === 1 ? x.h >= m.tp1 : x.l <= m.tp1))) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: `TP1 (EQ ${ctx.fmt(m.tp1)}) görüldü — giriş fırsatı geçti, kovalanmaz` });
          else if (aft.length > p.signalValidityBars) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: `Onay ${fmtTR(br.t)} TR'de oluştu, ${p.signalValidityBars} ${TF_LABEL[ltf]} mumdan eski` });
        }
      } else conds.push({ id: 'rr', label: 'RR ≥ 2 (TP2)', status: 'wait', detail: '—' });
    } else conds.push({ id: 'rr', label: 'RR ≥ 2 (TP2)', status: 'wait', detail: 'TP1 EQ, TP2 karşı uç' });
    conds.push(ctx.newsCond());
    const ov = [...ovBase]; pushTargetOverlays(ov, methods[0]);
    out.push(finalize(ctx, { id: `${baseId}-rev${d}`, strategy: 'D', sub: `D2 · ${TF_LABEL[tf]} range dönüşü (${d === 1 ? 'alt uç' : 'üst uç'})`, dir: d, conditions: conds, methods, defaultMethod: methods[0]?.id, invalidation: 'Süpürme iğnesinin ötesinde kapanış', overlays: ov, chartTf: ltf, tfs: [ltf, tf], signalAt: br?.t, zoneId: sw >= 0 ? `${tf}-sw${c[sw].t}-rev${d}` : `${tf}-rev${d}-wait`, extra: ctx.extra(d), warnings: ['Range içindeki FVG\'ler giriş için kullanılmaz', 'Range ucunda RSI uyumsuzluğu ek güçtür'] }));
  }
  return out;
}
const dir1 = (d: Dir) => d;
export type _D = Candle;
