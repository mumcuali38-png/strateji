import type { Condition, Dir, Overlay, Setup, TF } from '../types.ts';
import { Ctx, finalize, method, pushTargetOverlays, rankSetups } from '../context.ts';
import { rsi } from '../indicators.ts';
import { rsiDivergence, type Zone, type Liq } from '../structure.ts';
import { TF_MS, TF_LABEL, fmtTR } from '../time.ts';
import { htfFilter } from './common.ts';

export const CONFIRM_TF: Partial<Record<TF, TF>> = { '1w': '4h', '1d': '1h', '4h': '15m', '1h': '5m' };
const LOWER_TF: Partial<Record<TF, TF>> = { '1d': '4h', '4h': '1h', '1h': '15m' };
const KIND_TXT: Record<string, string> = { OB: 'OB', FVG: 'FVG', MB: 'Mitigation block', BRK: 'Breaker', IFVG: 'IFVG' };

/** KURULUM B — HTF bölge + likidite + LTF onay (MASTERPROMPT §4–7) */
export function evalB(ctx: Ctx): Setup[] {
  const p = ctx.p.B;
  const flt = htfFilter(ctx);
  const price = ctx.price;
  const out: Setup[] = [];
  if (!flt.allowed.length) {
    const d: Dir = flt.emaDir || 1;
    return [finalize(ctx, {
      id: `B-${ctx.sym}-filter`, strategy: 'B', sub: 'HTF bölge · LTF onay', dir: 0, zoneId: 'filter', methods: [], overlays: [], chartTf: '1h', tfs: ['5m', '15m', '1h', '4h'],
      conditions: [flt.trendCond(d), flt.emaCond(d)],
      invalidation: '4H trend ve EMA50 aynı yönü gösterince bölgeler aranır',
    })];
  }
  for (const tf of p.zoneTfs) {
    const an = ctx.an(tf);
    const ctf = CONFIRM_TF[tf]!;
    const atrZ = an.atr;
    if (!Number.isFinite(atrZ)) continue;
    const ctfMs = TF_MS[ctf];
    const zones = an.zones
      .filter((z) => (z.kind === 'OB' || z.kind === 'MB' || (z.kind === 'FVG' && z.inLeg)) && z.brokenIdx === undefined && flt.allowed.includes(z.dir))
      .filter((z) => (z.dir === 1 ? price >= z.bottom : price <= z.top))
      .filter((z) => z.touchedAt === undefined ? Math.abs(price - (z.dir === 1 ? z.top : z.bottom)) <= p.maxZoneDistAtr * atrZ : ctx.now - z.touchedAt <= (p.confirmMaxBars + p.signalValidityBars) * ctfMs)
      .sort((a, b) => Math.abs(price - (a.dir === 1 ? a.top : a.bottom)) - Math.abs(price - (b.dir === 1 ? b.top : b.bottom)))
      .slice(0, p.zonesPerTf);
    for (const z of zones) out.push(evalZone(ctx, z, tf, ctf, atrZ, flt));
  }
  if (!out.length) {
    const d = flt.allowed[0];
    out.push(finalize(ctx, {
      id: `B-${ctx.sym}-nozone`, strategy: 'B', sub: 'HTF bölge · LTF onay', dir: d, zoneId: 'nozone', methods: [], overlays: [], chartTf: '1h', tfs: ['5m', '15m', '1h', '4h'],
      conditions: [flt.trendCond(d), flt.emaCond(d), { id: 'zone', label: 'HTF bölge (OB/FVG)', status: 'fail', detail: `Fiyata ${p.maxZoneDistAtr}×ATR içinde mitige edilmemiş ${d === 1 ? 'bullish' : 'bearish'} 4H/1H OB/FVG yok` }],
      none: { why: 'Uygun HTF bölge yok', waiting: `Trend yönünde yeni ${d === 1 ? 'bullish' : 'bearish'} OB/FVG oluşması veya fiyatın mevcut bölgeye yaklaşması`, ends: '4H trend veya EMA50 yön değiştirirse' },
    }));
  }
  return out.sort(rankSetups).slice(0, 4);
}

function evalZone(ctx: Ctx, z: Zone, tf: TF, ctf: TF, atrZ: number, flt: ReturnType<typeof htfFilter>): Setup {
  const p = ctx.p.B;
  const dir = z.dir;
  const an = ctx.an(tf);
  const can = ctx.an(ctf);
  const edge = dir === 1 ? z.top : z.bottom;
  const conds: Condition[] = [flt.trendCond(dir), flt.emaCond(dir)];
  const zoneName = `${TF_LABEL[tf]} ${KIND_TXT[z.kind]} ${ctx.fmt(z.bottom)}–${ctx.fmt(z.top)}`;
  conds.push({ id: 'zone', label: 'HTF bölge (OB/FVG)', status: 'ok', detail: `${zoneName}${z.touchedAt ? ' · temas var' : ' · mitige edilmemiş'}`, level: edge });

  // Yakın likidite (bölgenin önünde, 0.2–1.5 ATR)
  const lower = LOWER_TF[tf];
  const pool: Liq[] = [...an.liquidity, ...(lower ? ctx.an(lower).liquidity : [])]
    .filter((l) => l.side === (dir === 1 ? 'sell' : 'buy'))
    .filter((l) => { const d = dir === 1 ? l.price - z.top : z.bottom - l.price; return d >= p.liqMinAtr * atrZ && d <= p.liqMaxAtr * atrZ; })
    .filter((l) => l.t > z.t && (l.takenAt === undefined || l.takenAt >= z.t));
  pool.sort((a, b) => Math.abs(a.price - edge) - Math.abs(b.price - edge));
  const liq = pool[0];
  conds.push(liq
    ? { id: 'liq', label: 'Yakın likidite', status: 'ok', detail: `${liq.kind} (${TF_LABEL[liq.tf]}) ${ctx.fmt(liq.price)} · bölgeye ${(Math.abs(liq.price - edge) / atrZ).toFixed(2)}×ATR`, level: liq.price }
    : { id: 'liq', label: 'Yakın likidite', status: 'fail', detail: `Bölge önünde ${p.liqMinAtr}–${p.liqMaxAtr}×ATR mesafede likidite yok` });
  const liqTaken = liq?.takenAt;
  conds.push(!liq ? { id: 'liqTaken', label: 'Likidite alındı mı', status: 'wait', detail: '—' }
    : liqTaken ? { id: 'liqTaken', label: 'Likidite alındı mı', status: 'ok', detail: `${fmtTR(liqTaken)} TR'de ${liq.takenBy === 'sweep' ? 'iğneyle süpürüldü' : 'alındı'}`, level: liq.price }
      : { id: 'liqTaken', label: 'Likidite alındı mı', status: 'wait', detail: `${ctx.fmt(liq.price)} henüz alınmadı`, level: liq.price });

  // LTF onay
  const ref = z.touchedAt ?? liqTaken;
  const ctfMs = TF_MS[ctf];
  let confirm = ref === undefined ? undefined : can.breaks.find((b) => b.dir === dir && b.type === 'CHoCH' && b.t >= ref - ctfMs && b.t <= ref + p.confirmMaxBars * ctfMs
    && (dir === 1 ? b.legExtreme <= z.top + p.confirmMaxDistAtr * atrZ : b.legExtreme >= z.bottom - p.confirmMaxDistAtr * atrZ)
    && Math.abs(b.level - b.legExtreme) <= p.mitigationMaxHeightAtr * atrZ);
  // Bölgeye temas: temas veya onayın likiditede oluşması
  const touchOk = z.touchedAt !== undefined || (confirm !== undefined && liqTaken !== undefined);
  conds.push(touchOk
    ? { id: 'touch', label: 'Bölgeye temas', status: 'ok', detail: z.touchedAt ? `${fmtTR(z.touchedAt)} TR'de temas` : 'Onay likiditede oluştu', level: edge }
    : { id: 'touch', label: 'Bölgeye temas', status: 'wait', detail: `Bölge kenarı ${ctx.fmt(edge)} · mesafe ${ctx.fmt(Math.abs(ctx.price - edge))} (${(Math.abs(ctx.price - edge) / atrZ).toFixed(2)}×ATR)`, level: edge });
  if (confirm && z.touchedAt === undefined && !liqTaken) confirm = undefined;

  const overlays: Overlay[] = [{ kind: 'zone', style: z.kind === 'FVG' ? 'fvg' : z.kind === 'MB' ? 'mb' : 'ob', label: zoneName, top: z.top, bottom: z.bottom, from: z.t, tf, cond: 'zone' }];
  if (liq) overlays.push({ kind: 'line', style: 'liq', label: `$$ ${liq.kind}`, price: liq.price, from: liq.t, cond: 'liq' });

  let methods: ReturnType<typeof method>[] = [];
  let signalAt: number | undefined;
  let defaultMethod: string | undefined;
  const lastSwing = can.swings.filter((s) => s.type === (dir === 1 ? 'H' : 'L') && (ref === undefined || s.t <= ctx.now)).slice(-1)[0];
  if (confirm) {
    signalAt = confirm.t;
    conds.push({ id: 'confirm', label: `LTF onay (${TF_LABEL[ctf]})`, status: 'ok', detail: `${TF_LABEL[ctf]} ${confirm.mss ? 'MSS' : 'CHoCH'} ${ctx.fmt(confirm.level)} ${dir === 1 ? 'üstü' : 'altı'} kapanış · ${fmtTR(confirm.t)} TR`, level: confirm.level });
    const entryClose = can.c[confirm.i].c;
    const structural = confirm.legExtreme;
    const tg = ctx.targets(dir, confirm.level);
    const htfTg = ctx.targets(dir, confirm.level, ['4h', '1d']);
    const tp1 = tg[0]?.price;
    const tp2 = htfTg.find((l) => tp1 === undefined || (dir === 1 ? l.price > tp1 : l.price < tp1))?.price ?? tg[1]?.price;
    if (tp1 !== undefined) {
      methods.push(method(ctx, 'breaker', 'Breaker retest (kırılan swing)', 'limit', confirm.level, structural, dir, tp1, tp2));
      methods.push(method(ctx, 'market', 'Kapanışta piyasa emri', 'market', entryClose, structural, dir, tp1, tp2));
      const fvg = can.zones.find((q) => q.kind === 'FVG' && q.dir === dir && q.i >= confirm!.legStart && q.i <= confirm!.i + 1 && q.brokenIdx === undefined);
      if (fvg) methods.push(method(ctx, 'fvg', `${TF_LABEL[ctf]} FVG geri çekilme`, 'limit', dir === 1 ? fvg.top : fvg.bottom, structural, dir, tp1, tp2));
      const ob = can.zones.find((q) => q.kind === 'OB' && q.breakIdx === confirm!.i);
      if (ob) {
        methods.push(method(ctx, 'ltfob', `${TF_LABEL[ctf]} order block`, 'limit', dir === 1 ? ob.top : ob.bottom, structural, dir, tp1, tp2, 'Dolma ihtimali düşük (10\'da 2-3)'));
        methods.push(method(ctx, 'ob50', 'OB %50 (EQ)', 'limit', (ob.top + ob.bottom) / 2, structural, dir, tp1, tp2, 'Çok düşük dolma — küçük pozisyon'));
      }
      methods = methods.filter((m) => (dir === 1 ? m.entry > m.stop : m.entry < m.stop));
      const pref = ['breaker', 'fvg', 'ltfob'];
      defaultMethod = pref.map((id) => methods.find((m) => m.id === id && m.rr >= ctx.p.risk.minRR)).find(Boolean)?.id ?? methods[0]?.id;
      const dm = methods.find((m) => m.id === defaultMethod);
      conds.push(ctx.killzoneCond('B'));
      conds.push(dm ? { id: 'rr', label: 'RR ≥ 2', status: dm.rr >= ctx.p.risk.minRR ? 'ok' : 'fail', detail: `${dm.label}: RR ${dm.rr.toFixed(2)} · hedef ${tg[0].kind} ${ctx.fmt(tp1)}`, level: tp1 } : { id: 'rr', label: 'RR ≥ 2', status: 'fail', detail: 'Geçerli giriş yok' });
      // Sinyal sonrası takip
      const after = can.c.slice(confirm.i + 1);
      if (dm) {
        if (after.some((x) => (dir === 1 ? x.l <= dm.stop : x.h >= dm.stop))) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: 'Stop seviyesi delindi — senaryo bitti' });
        else if (after.some((x) => (dir === 1 ? x.h >= dm.tp1 : x.l <= dm.tp1))) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: 'Hedef görüldü — senaryo tamamlandı' });
        else if (after.length > p.signalValidityBars) conds.push({ id: 'valid', label: 'Geçerlilik', status: 'fail', detail: `Onay ${fmtTR(confirm.t)} TR'de oluştu, ${p.signalValidityBars} mumdan eski` });
      }
    } else {
      conds.push(ctx.killzoneCond('B'));
      conds.push({ id: 'rr', label: 'RR ≥ 2', status: 'wait', detail: 'İşlem yönünde alınmamış likidite bulunamadı' });
    }
  } else {
    const expired = ref !== undefined && ctx.now - ref > p.confirmMaxBars * ctfMs;
    const trig = lastSwing?.price;
    conds.push(expired
      ? { id: 'confirm', label: `LTF onay (${TF_LABEL[ctf]})`, status: 'fail', detail: `Temastan sonra ${p.confirmMaxBars} ${TF_LABEL[ctf]} mum içinde onay gelmedi` }
      : { id: 'confirm', label: `LTF onay (${TF_LABEL[ctf]})`, status: 'wait', detail: `${TF_LABEL[ctf]} CHoCH kapanışı bekleniyor${trig !== undefined ? ` (${ctx.fmt(trig)} ${dir === 1 ? 'üstü' : 'altı'})` : ''}`, level: trig });
    conds.push(ctx.killzoneCond('B'));
    // Önizleme: giriş = beklenen kırılım seviyesi, stop = bölgenin uzak kenarı
    const pe = trig ?? edge;
    const ps = dir === 1 ? Math.min(z.bottom, ctx.price) : Math.max(z.top, ctx.price);
    const tg = ctx.targets(dir, pe);
    if (tg[0] && (dir === 1 ? pe > ps : pe < ps)) {
      methods.push(method(ctx, 'breaker', 'Breaker retest (önizleme)', 'limit', pe, ps, dir, tg[0].price, tg[1]?.price, 'Önizleme — onay sonrası yeniden hesaplanır'));
      conds.push({ id: 'rr', label: 'RR ≥ 2', status: 'wait', detail: `Önizleme RR ${methods[0].rr.toFixed(2)} · hedef ${ctx.fmt(tg[0].price)}` });
    } else conds.push({ id: 'rr', label: 'RR ≥ 2', status: 'wait', detail: 'Onay sonrası hesaplanır' });
    defaultMethod = methods[0]?.id;
  }
  conds.push(ctx.newsCond());

  // Güçlendiriciler (★)
  let stars = 0;
  const why: string[] = [];
  if (z.sweptLiq) { stars++; why.push('swing likidite aldı'); }
  if (z.causedBos || z.inLeg) { stars++; why.push('BOS bacağında'); }
  const pre = an.c.slice(Math.max(0, z.i - 20), z.i);
  if (pre.length >= 10) {
    const hh = Math.max(...pre.map((x) => x.h)), ll = Math.min(...pre.map((x) => x.l));
    if (hh - ll < atrZ * ctx.p.consolidation.rangeAtrMult) { stars++; why.push('range çıkışı'); }
  }
  if (rsiDivergence(an.c, an.swings, rsi(an.c.map((x) => x.c), 14), dir)) { stars++; why.push('RSI uyumsuzluğu'); }

  // Karşı bölge uyarısı
  const warnings: string[] = [];
  const dm = methods.find((m) => m.id === defaultMethod);
  if (dm) {
    for (const otf of ['4h', '1h'] as TF[]) {
      const opp = ctx.an(otf).zones.find((q) => q.dir === -dir && q.brokenIdx === undefined && (q.kind === 'OB' || q.kind === 'FVG') && (dir === 1 ? q.bottom > dm.entry && q.bottom < dm.tp1 : q.top < dm.entry && q.top > dm.tp1));
      if (opp) { warnings.push(`Hedef yolunda karşı ${TF_LABEL[otf]} ${opp.kind} ${ctx.fmt(opp.bottom)}–${ctx.fmt(opp.top)} — kâr orada erken alınabilir`); break; }
    }
    warnings.push('Ek pozisyon: kârdayken yeni BOS olursa o bacaktaki ilk mitige edilmemiş FVG\'ye limit; stop son swing\'in ötesine');
  }
  pushTargetOverlays(overlays, dm);
  const zoneId = z.id;
  return finalize(ctx, {
    id: `B-${ctx.sym}-${zoneId}`, strategy: 'B', sub: `${TF_LABEL[tf]} ${KIND_TXT[z.kind]} · ${TF_LABEL[ctf]} onay`, dir, conditions: conds, methods, defaultMethod,
    invalidation: `Bölge ${ctx.fmt(dir === 1 ? z.bottom : z.top)} kapanışla delinirse veya stop ${dm ? ctx.fmt(dm.stop) : '—'} görülürse`,
    extra: ctx.extra(dir), stars, warnings, tags: why, overlays, chartTf: ctf, tfs: [ctf, tf, '4h'], signalAt, zoneId,
  });
}
