// Kurulum F — 9 şartlı durum tablosu ve setup kartları (docs/KURULUM_F.md §14–16)
import type { Candle, Condition, Dir, EntryMethod, NewsEvent, Overlay, Setup } from '../types.ts';
import type { Config } from '../config.ts';
import { Ctx, finalize } from '../context.ts';
import { atr as atrSeries } from '../indicators.ts';
import { HOUR, DAY, fmtTR, durationText } from '../time.ts';
import { F_MS, type FData } from './data.ts';
import {
  biasOf, blocksF, chochAfter, cp, demandZones, entryZone, findTR, lastPivotHighBefore, mirrorData, nextFunding, pivots, rv,
  springAt, springFailed, targets, testZone, wyckoffEvents, zoneNear, type FZone, type Spring, type TR,
} from './wyckoff.ts';

const lastFinite = (a: number[]) => { for (let i = a.length - 1; i >= 0; i--) if (Number.isFinite(a[i])) return a[i]; return NaN; };
type Side = { dir: Dir; P: (x: number) => number; f: (x: number) => string; w: Record<string, string> };
const WORDS: Record<string, Record<string, string>> = {
  '1': { spring: 'Spring', sos: 'SOS', lps: 'LPS', zone: 'talep', bandLow: 'alt bant', beyond: 'altına', back: 'içeri', choch: 'pivot tepe üstü', dirTxt: 'LONG', ema: 'üstü', low: 'dip', high: 'tepe' },
  '-1': { spring: 'UTAD', sos: 'SOW', lps: 'LPSY', zone: 'arz', bandLow: 'üst bant', beyond: 'üstüne', back: 'içeri', choch: 'pivot dip altı', dirTxt: 'SHORT', ema: 'altı', low: 'tepe', high: 'dip' },
};

function cond(id: string, label: string, status: Condition['status'], detail: string, level?: number): Condition { return level === undefined ? { id, label, status, detail } : { id, label, status, detail, level }; }

export function evalF(conf: Config, now: number, data: FData | null, news: NewsEvent[], errors: string[] = []): Setup[] {
  const ctx = new Ctx('BTCUSD', conf, now, { m5: data?.m5 ?? [], m1: [], d1: [] }, news);
  const F = conf.params.F;
  const base = { strategy: 'F' as const, chartTf: '1h' as const, tfs: ['5m', '15m', '1h', '4h', '1d'] as Setup['tfs'], chartKey: 'BTCUSD_F' };
  if (!data) {
    return [finalize(ctx, { ...base, id: 'F-BTCUSD-veri', sub: 'Wyckoff · VERİ YOK', dir: 0, zoneId: 'veri', methods: [], overlays: [],
      conditions: [cond('data', 'Veri', 'fail', `VERİ YOK — Binance ve Coinbase cevap vermedi (${errors.join(' · ') || '—'}). Analiz yapılmadı.`)],
      none: { why: 'VERİ YOK — tahmin üretilmez', waiting: 'Bir sonraki taramada veri kaynağı', ends: '—' }, info: { f: { status: 'VERI_YOK' } } })];
  }
  const lastH1 = data.h1[data.h1.length - 1];
  const dataAge = lastH1 ? now - (lastH1.t + HOUR) : Infinity;
  if (dataAge > F.maxDataAgeMin * 60_000 || data.h4.length < 60) {
    return [finalize(ctx, { ...base, id: 'F-BTCUSD-veri', sub: 'Wyckoff · VERİ ESKİ', dir: 0, zoneId: 'veri', methods: [], overlays: [],
      conditions: [cond('data', 'Veri', 'fail', `VERİ ESKİ — son kapanmış 1H mum ${lastH1 ? fmtTR(lastH1.t) + ' TR' : '—'} (${durationText(dataAge)} önce, ${data.source}). Eski mumla sinyal üretilmez.`)],
      none: { why: 'Veri güncel değil', waiting: 'Bir sonraki taramada güncel veri', ends: '—' }, info: { f: { status: 'VERI_YOK', source: data.source } } })];
  }
  const bias = biasOf(data.h4);
  const biasTxt = `4H kapanış ${bias.close.toFixed(1)} · EMA50 ${bias.ema.toFixed(1)} · eğim ${bias.slope >= 0 ? '+' : ''}${bias.slope.toFixed(1)}`;
  if (!bias.value) {
    return [finalize(ctx, { ...base, id: 'F-BTCUSD-bias', sub: 'Wyckoff · yön net değil', dir: 0, zoneId: 'bias', methods: [], overlays: [],
      conditions: [cond('bias', 'Yön filtresi', 'fail', `Yön net değil (NÖTR) — ${biasTxt}`)],
      none: { why: 'Yön net değil: 4H kapanış ve EMA50 eğimi aynı yönü göstermiyor', waiting: 'Kapanış EMA50 üstünde + eğim ≥ 0 (long) veya altında + eğim ≤ 0 (short)', ends: '—' },
      info: { f: { status: 'YOK', bias: { value: null, ema50_4h: bias.ema, close_4h: bias.close }, source: data.source } } })];
  }
  const dir = bias.value;
  const D = dir === 1 ? data : mirrorData(data);
  const side: Side = { dir, P: (x) => dir * x, f: (x) => (dir * x).toFixed(1), w: WORDS[String(dir)] };
  const h1 = D.h1, n = h1.length;
  const A = lastFinite(atrSeries(h1, 14)), A4 = lastFinite(atrSeries(D.h4, 14));
  const ltf = F.ltf === '5m' ? D.m5 : D.m15;
  const condBias = cond('bias', 'Yön filtresi', 'ok', `${side.w.dirTxt} — ${biasTxt} (${side.w.ema})`);

  // --- TR + spring arama (spring anındaki TR ile) ---
  let tr: TR | null = null, sp: Spring | null = null;
  for (let s = n - 1; s >= Math.max(40, n - F.springLookback1h) && !sp; s--) {
    const t = findTR(h1, s, '1h', F);
    if (!t) continue;
    const c = springAt(h1, s, t, A, F);
    if (c && c.end <= n - 1) {
      tr = t; sp = c;
      // Bir önceki mum delip zayıf kapandıysa ikisi birlikte 2 mumlu spring'dir (§7)
      const tPrev = findTR(h1, s - 1, '1h', F);
      const two = tPrev ? springAt(h1, s - 1, tPrev, A, F) : null;
      if (two?.twoBar && two.end === s) { tr = tPrev; sp = two; }
    }
  }
  if (!sp) {
    // 4H TR (ikincil), spring yine 1H mumunda aranır
    const startT = h1[Math.max(0, n - F.springLookback1h)]?.t ?? 0;
    const end4 = D.h4.findIndex((x) => x.t >= startT);
    const t4 = findTR(D.h4, end4 < 0 ? D.h4.length : end4, '4h', F);
    if (t4) for (let s = n - 1; s >= n - F.springLookback1h && !sp; s--) { const c = springAt(h1, s, t4, A, F); if (c) { tr = t4; sp = c; } }
  }
  if (!tr) tr = findTR(h1, n, '1h', F) ?? findTR(D.h4, D.h4.length, '4h', F);

  // --- HTF ilgi bölgesi ---
  const zones: FZone[] = [...demandZones(D.d1, '1d', 2), ...demandZones(D.h4, '4h', 3)];
  const near = tr ? zones.filter((z) => zoneNear(z, tr!.low, F.zoneDistAtr4h * A4)) : [];
  const has1d = near.some((z) => z.tf === '1d'), has4h = near.some((z) => z.tf === '4h');
  const quality = has1d && has4h ? 'çok güçlü' : has1d ? 'güçlü' : has4h ? 'normal' : null;
  const zTxt = (z: FZone) => `${z.tf.toUpperCase()} ${z.type === 'EQUAL_LOWS' ? (dir === 1 ? 'eşit dipler' : 'eşit tepeler') : z.type} ${side.f(dir === 1 ? z.low : z.high)}–${side.f(dir === 1 ? z.high : z.low)}`;
  const condZone = !tr ? cond('zone', 'HTF ilgi bölgesi', 'wait', 'TR oluşunca kontrol edilir')
    : quality ? cond('zone', 'HTF ilgi bölgesi', 'ok', `${near.slice(0, 2).map(zTxt).join(' · ')} — ${quality}`)
      : cond('zone', 'HTF ilgi bölgesi', 'fail', `HTF ${side.w.zone} bölgesi yok (TR ${side.w.low}u ${side.f(tr.low)} yakınında 1D/4H OB/FVG/eşit ${side.w.low} yok)`);

  // --- TR ve faz ---
  const last = h1[n - 1];
  const hgt = tr ? tr.high - tr.low : 0;
  const phaseE = tr ? last.c > tr.high + 0.5 * hgt || last.c < tr.low - 0.5 * hgt : false;
  const condTR = !tr ? cond('tr', 'Geçerli TR', 'fail', `TR yok — 1H'te en az 2 ${side.w.low} + 2 ${side.w.high} temaslı yatay bölge bekleniyor`)
    : phaseE ? cond('tr', 'Geçerli TR', 'fail', `Faz E — fiyat ${side.f(last.c)} TR dışında, yüksekliğin %50'sinden fazla uzaklaştı; yeni giriş yok`)
      : cond('tr', 'Geçerli TR', 'ok', `${tr.tf.toUpperCase()} TR ${Math.min(side.P(tr.low), side.P(tr.high)).toFixed(1)}–${Math.max(side.P(tr.low), side.P(tr.high)).toFixed(1)} · ${tr.bars} mum · temas ${tr.touchesLow}/${tr.touchesHigh}${tr.stale ? ' · ESKİ (72+ mum)' : ''}`, side.P(tr.low));

  const ev = tr ? wyckoffEvents(h1, tr, 0.25 * A) : { sc: undefined, ar: undefined, st: undefined, bonus: 0, notes: [] as string[] };
  const out: Setup[] = [];
  const overlaysBase: Overlay[] = [];
  if (tr) {
    const [lo, hi] = [side.P(tr.low), side.P(tr.high)].sort((a, b) => a - b);
    overlaysBase.push({ kind: 'zone', style: 'range', label: `${tr.tf.toUpperCase()} TR`, top: hi, bottom: lo, from: tr.firstT, cond: 'tr' });
    overlaysBase.push({ kind: 'line', style: 'eq', label: 'TR EQ', price: side.P(tr.eq), from: tr.firstT });
  }
  for (const z of near.slice(0, 2)) { const [lo, hi] = [side.P(z.low), side.P(z.high)].sort((a, b) => a - b); overlaysBase.push({ kind: 'zone', style: 'ob', label: `HTF ${zTxt(z)}`, top: hi, bottom: lo, from: z.t, cond: 'zone' }); }

  // Güç puanı (★)
  let stars = quality === 'çok güçlü' ? 3 : quality === 'güçlü' ? 2 : quality ? 1 : 0;
  const tags: string[] = [];
  if (ev.bonus) { stars++; tags.push('SC+AR+ST'); }
  if (tr) {
    const tol = 0.25 * A;
    const lp = tr.lowPivots;
    if (lp.some((a, i) => lp.some((b, j) => j > i && Math.abs(a.price - b.price) <= tol / 2))) { stars++; tags.push(`eşit ${side.w.low}ler (likidite havuzu)`); }
    const piv = pivots(h1.slice(tr.first, n), 3);
    const legs: number[] = [];
    for (let k = 1; k < piv.length; k++) if (piv[k - 1].type === 'H' && piv[k].type === 'L') legs.push(piv[k - 1].price - piv[k].price);
    if (legs.length >= 3 && legs.at(-1)! < legs.at(-2)! && legs.at(-2)! < legs.at(-3)!) { stars++; tags.push('itki kısalması'); }
    if (tr.stale) { stars = Math.max(0, stars - 1); tags.push('TR eski'); }
  }

  const fBlocks = (sunday?: { t: number; okAfter: () => boolean }) => blocksF(now, h1, news, F, conf.params.news.beforeMin, conf.params.news.afterMin, sunday);
  const filterCond = (b: ReturnType<typeof fBlocks>) => (b.blocks.length ? cond('filters', 'Zaman/ortam filtreleri', 'wait', `BLOK: ${b.text.join(' · ')}`) : cond('filters', 'Zaman/ortam filtreleri', 'ok', b.notes.length ? `Blok yok · ${b.notes.join(' · ')}` : 'Blok yok · en iyi pencere içinde'));
  const sundayOk = (lowRef: number, t: number) => () => {
    const mon = Math.floor(t / DAY) * DAY + DAY; // Pazar UTC → ertesi Pazartesi 00:00
    return pivots(h1, 3).some((p) => p.type === 'L' && p.t >= mon && p.price > lowRef);
  };
  const clock = () => ({ nextFunding: nextFunding(now, F), saturday: new Date(now).getUTCDay() === 6, sunday: new Date(now).getUTCDay() === 0, inBestWindow: !fBlocks().notes.some((x) => x.startsWith('pencere')) });

  const mkMethod = (id: string, label: string, entry: number, stop: number, t: { t1: number; t2: number; t3?: number }, tag?: string): EntryMethod => {
    const risk = entry - stop;
    const r = (x: number) => +(risk > 0 ? (x - entry) / risk : 0).toFixed(2);
    const m: EntryMethod = { id, label, type: 'limit', entry: side.P(entry), stop: side.P(stop), stopStructural: side.P(stop), fixedStop: true, tp1: side.P(t.t1), tp2: side.P(t.t2), rr: r(t.t1), rr2: r(t.t2) };
    if (t.t3 !== undefined) { m.tp3 = side.P(t.t3); m.rr3 = r(t.t3); }
    if (tag) m.tag = tag;
    m.note = 'Yönetim: T1\'de %50 kapat + stop girişe · T2 %30 · T3 kalan %20 · kaldıraç en fazla 3x';
    return m;
  };
  const tradeOverlays = (ov: Overlay[], m?: EntryMethod) => {
    if (!m) return;
    ov.push({ kind: 'line', style: 'entry', label: 'Giriş', price: m.entry });
    ov.push({ kind: 'line', style: 'stop', label: 'Stop', price: m.stop });
    ov.push({ kind: 'line', style: 'tp', label: 'T1', price: m.tp1 });
    if (m.tp2 !== undefined) ov.push({ kind: 'line', style: 'tp', label: 'T2', price: m.tp2 });
    if (m.tp3 !== undefined) ov.push({ kind: 'line', style: 'tp', label: 'T3', price: m.tp3 });
  };
  /**
   * Hatalı sinyal koruması — dolum ÖNCESİ (dolum sonrası ortak staleGuard'dadır):
   * limit henüz dolmadıysa ve fiyat T1'i gördüyse ya da limitten maxEntryDistR'den fazla uzaklaştıysa
   * setup biter (kovalanmaz). Fiyatlar ayna uzayında (long mantığı).
   */
  const preFill = (s: { conditions: Condition[]; signalAt?: number }, g?: { from: number; entry: number; stop: number; t1: number }) => {
    if (!g || s.signalAt || s.conditions.some((c) => c.status === 'fail')) return;
    const risk = g.entry - g.stop;
    const after = ltf.filter((x) => x.t > g.from);
    const hit = after.find((x) => x.h >= g.t1);
    if (hit) { s.conditions.push(cond('stale', 'Sinyal güncel mi', 'fail', `Limit dolmadan T1 ${side.f(g.t1)} görüldü (${fmtTR(hit.t)} TR) — fırsat geçti, kovalanmaz`)); return; }
    const lastC = after[after.length - 1]?.c;
    if (risk > 0 && lastC !== undefined && (lastC - g.entry) / risk > conf.params.general.maxEntryDistR)
      s.conditions.push(cond('stale', 'Sinyal güncel mi', 'fail', `Fiyat ${side.f(lastC)} limitten ${((lastC - g.entry) / risk).toFixed(1)}R uzak — kovalanmaz`));
  };
  const finish = (s: Parameters<typeof finalize>[1], guard?: Parameters<typeof preFill>[1]): Setup => {
    preFill(s, guard);
    const st = finalize(ctx, s);
    const nonOk = st.conditions.filter((c) => c.status !== 'ok');
    if (st.status === 'EKSIK' && nonOk.length === 1 && nonOk[0].id === 'filters') {
      st.status = 'BEKLE'; st.remaining = 0;
      st.missing = nonOk[0].detail;
      st.key = `${st.strategy}+${st.symbol}+${st.dir}+${st.zoneId}+BEKLE`;
    }
    return st;
  };
  const phase = (): string => {
    if (!tr) return '—';
    if (phaseE) return 'E';
    if (sp && sosAfter(sp.end) !== null) return 'D';
    if (sp && n - 1 - sp.end <= F.phaseCBars) return 'C';
    if (ev.sc && ev.ar && !ev.st) return 'A';
    return 'B';
  };
  const sosAfter = (from: number): number | null => {
    if (!tr) return null;
    for (let i = from + 1; i < n; i++) {
      const x = h1[i];
      if (!(x.c > tr.eq && rv(h1, i) >= F.rvHigh)) continue;
      if (dir === -1) return i; // SOW: kapanış < TR.eq + RV ≥ 1.5
      if (x.c > tr.high) return i;
      for (let j = i + 1; j <= Math.min(n - 1, i + F.lpsSosBars); j++) if (h1[j].c > tr.high) return j;
    }
    return null;
  };

  // ================= 1) SPRING / UTAD girişi =================
  {
    const conds: Condition[] = [condBias, condZone, condTR];
    const notices: NonNullable<Setup['notices']> = [];
    const ov = [...overlaysBase];
    let methods: EntryMethod[] = [];
    let signalAt: number | undefined;
    const notes: string[] = [];
    let zone: ReturnType<typeof entryZone> = null, ch: ReturnType<typeof chochAfter> = null;
    let guard: Parameters<typeof preFill>[1];
    const springKey = sp ? `F-spring-${dir}-${sp.t}` : '';
    if (!tr) {
      conds.push(cond('trigger', `${side.w.spring}`, 'wait', 'Önce TR'));
    } else if (!sp) {
      conds.push(cond('trigger', `${side.w.spring}`, 'wait', `${side.w.bandLow} ${side.f(tr.low)} ${side.w.beyond} iğne (≤ ${F.springMaxDepthAtr}×ATR ${(F.springMaxDepthAtr * A).toFixed(0)}) + ${side.w.back} kapanış (CP ≥ 0.5) bekleniyor`, side.P(tr.low)));
      conds.push(cond('volume', 'Hacim şartı', 'wait', `${side.w.spring} mumunda RV ≤ ${F.rvLow} (düşük) veya RV ≥ ${F.rvHigh} + CP ≥ ${F.cpStrong} (emilim)`));
      conds.push(cond('choch', `LTF CHoCH (${F.ltf})`, 'wait', `${side.w.spring} sonrası`));
      conds.push(cond('test', 'Giriş bölgesine test + test hacmi', 'wait', 'CHoCH sonrası'));
      const pe = tr.low, ps = tr.low - F.springMaxDepthAtr * 0.5 * A - F.stopAtr * A;
      const tg = targets(tr, pe, ps);
      conds.push(cond('rr', 'RR şartı', 'wait', `Önizleme: T3 RR ${tg.rr3.toFixed(1)} · T2 RR ${tg.rr2.toFixed(1)} (şart T3 ≥ ${F.minRR3}, T2 ≥ ${F.minRR2})`));
      conds.push(filterCond(fBlocks()));
    } else {
      const fail = springFailed(h1, sp, tr);
      const depth = (tr.low - sp.low) / A;
      conds.push(fail ? cond('trigger', side.w.spring, 'fail', `Başarısız ${side.w.spring.toLowerCase()} (${fmtTR(sp.t)} TR): ${fail}`)
        : cond('trigger', side.w.spring, 'ok', `${fmtTR(sp.t)} TR${sp.twoBar ? ' (2 mumlu)' : ''} · ${side.w.low} ${side.f(sp.low)} (${depth.toFixed(2)}×ATR) · kapanış ${side.f(sp.close)} · CP ${sp.cp.toFixed(2)}`, side.P(sp.low)));
      ov.push({ kind: 'line', style: 'level', label: `${side.w.spring} ${side.w.low}`, price: side.P(sp.low), from: sp.t, cond: 'trigger' });
      const vtxt = { DUSUK: 'düşük hacimli', EMILIM: 'emilim', KARARSIZ: 'kararsız' }[sp.type];
      conds.push(sp.type !== 'KARARSIZ' ? cond('volume', 'Hacim şartı', 'ok', `RV ${sp.rv.toFixed(2)} · ${vtxt} ${side.w.spring.toLowerCase()}`)
        : dir === 1 ? cond('volume', 'Hacim şartı', 'wait', `Hacim kararsız (RV ${sp.rv.toFixed(2)}) — test hacmi belirleyici olur`)
          : cond('volume', 'Hacim şartı', 'fail', `Hacim kararsız (RV ${sp.rv.toFixed(2)}) — UTAD'da kararsız hacim = YOK`));
      if (!fail) notices.push({ key: springKey, title: `🌀 F · BTC ${side.w.spring} adayı`, body: `F: BTC ${side.w.spring.toLowerCase()} adayı ${side.f(sp.low)} – CHoCH bekleniyor` });
      else notices.push({ key: `F-cancel-${dir}-${sp.t}`, requires: springKey, title: '⛔ F · BTC kurulum iptal', body: `F: BTC kurulum iptal – başarısız ${side.w.spring.toLowerCase()} (${fail})` });
      // Kolay hareket kontrolü
      if (n - 1 - sp.end >= 6) {
        let easy = false;
        for (let k = sp.end + 1; k <= sp.end + 6; k++) if (h1[k].c > sp.high && rv(h1, k) >= 1.0) easy = true;
        if (!easy) notes.push(`${side.w.spring.toLowerCase()} sonrası tepki zayıf`);
      }
      // Sıkışma (ek güç)
      const pre = h1.slice(Math.max(tr.first, sp.i - 4), sp.i);
      const trBars = h1.slice(tr.first, sp.i);
      if (pre.length === 4 && trBars.length) {
        const avg = (a: Candle[]) => a.reduce((x, y) => x + (y.h - y.l), 0) / a.length;
        if (avg(pre) < 0.6 * avg(trBars)) { stars++; tags.push('sıkışma'); }
      }
      // CHoCH
      const deadline = sp.t + F.chochMaxHours * HOUR;
      ch = fail ? null : chochAfter(ltf, sp.t, deadline);
      const lh = lastPivotHighBefore(ltf, sp.t);
      if (fail) conds.push(cond('choch', `LTF CHoCH (${F.ltf})`, 'wait', '—'));
      else if (ch && typeof ch === 'object') conds.push(cond('choch', `LTF CHoCH (${F.ltf})`, 'ok', `${F.ltf} ${side.f(ch.level)} ${side.w.choch} kapanış · ${fmtTR(ch.t)} TR`, side.P(ch.level)));
      else if (now > deadline) conds.push(cond('choch', `LTF CHoCH (${F.ltf})`, 'fail', `${F.chochMaxHours} adet 1H mum içinde CHoCH gelmedi — zaman aşımı`));
      else conds.push(cond('choch', `LTF CHoCH (${F.ltf})`, 'wait', ch === 'nopivot' ? 'LTF pivot yok' : `${F.ltf}'de ${side.f(lh!)} ${side.w.choch} kapanış bekleniyor (kalan ${durationText(deadline - now)})`, lh !== undefined ? side.P(lh) : undefined));
      if (lh !== undefined) ov.push({ kind: 'line', style: 'liq', label: 'CHoCH seviyesi', price: side.P(lh), from: sp.t, cond: 'choch' });
      // Giriş bölgesi + test
      if (ch && typeof ch === 'object') zone = entryZone(ltf, sp.t, ch.i);
      if (zone && ch && typeof ch === 'object') {
        const tz = testZone(ltf, h1, zone, ch.i, sp.vol, now);
        const [zlo, zhi] = [side.P(zone.low), side.P(zone.high)].sort((a, b) => a - b);
        ov.push({ kind: 'zone', style: zone.kind === 'FVG' ? 'fvg' : 'ob', label: `Giriş bölgesi (${F.ltf} ${zone.kind})`, top: zhi, bottom: zlo, from: ch.t, tf: F.ltf, cond: 'test' });
        if (tz.state === 'ok') { signalAt = tz.t; conds.push(cond('test', 'Giriş bölgesine test + test hacmi', 'ok', `${fmtTR(tz.t)} TR zone'a test · 1H hacmi < ${side.w.spring.toLowerCase()} hacmi`, side.P(zone.high))); }
        else if (tz.state === 'broken') { conds.push(cond('test', 'Giriş bölgesine test + test hacmi', 'fail', `Zone giriş olmadan kapanışla kırıldı (${fmtTR(tz.t)} TR) — iptal`)); notices.push({ key: `F-cancel-${dir}-${sp.t}`, requires: springKey, title: '⛔ F · BTC kurulum iptal', body: 'F: BTC kurulum iptal – giriş bölgesi kırıldı' }); }
        else conds.push(cond('test', 'Giriş bölgesine test + test hacmi', 'wait', `Limit ${side.f(zone.high)} — ${tz.why}`, side.P(zone.high)));
        const entry = zone.high, stop = sp.low - F.stopAtr * A;
        const tg = targets(tr, entry, stop);
        const middle = entry > tr.low + F.trMiddlePct * hgt;
        const m = mkMethod('spring', `${side.w.spring} → ${F.ltf} zone limit`, entry, stop, tg);
        methods = [m];
        guard = { from: ch.t, entry, stop, t1: tg.t1 };
        conds.push(middle ? cond('rr', 'RR şartı', 'fail', `TR ortası — giriş ${side.f(entry)} TR yüksekliğinin %${F.trMiddlePct * 100}'inin ötesinde`)
          : tg.rr3 >= F.minRR3 && tg.rr2 >= F.minRR2 ? cond('rr', 'RR şartı', 'ok', `T3 RR ${tg.rr3.toFixed(2)} · T2 RR ${tg.rr2.toFixed(2)}`, side.P(tg.t3))
            : cond('rr', 'RR şartı', 'fail', `RR yetersiz — T3 ${tg.rr3.toFixed(2)} (≥${F.minRR3}) · T2 ${tg.rr2.toFixed(2)} (≥${F.minRR2})`));
        if (tz.state === 'ok') {
          const after = ltf.filter((x) => x.t >= tz.t);
          if (after.some((x) => x.h >= tg.t1)) notices.push({ key: `F-T1-${dir}-${sp.t}`, title: '🎯 F · T1', body: 'F: T1 – %50 kapat, stop girişe' });
          const tamKey = `F+BTCUSD+${dir}+S${sp.t}+TAM`;
          if (after.some((x) => x.l <= stop) || fail) notices.push({ key: `F-exit-${dir}-${sp.t}`, requires: tamKey, title: '⛔ F · ÇIKIŞ', body: `F: BTC kurulum iptal – ${fail ? 'başarısız ' + side.w.spring.toLowerCase() : 'stop görüldü'} (açık işlemde ÇIKIŞ)` });
        }
      } else {
        conds.push(cond('test', 'Giriş bölgesine test + test hacmi', 'wait', 'CHoCH sonrası belirlenir'));
        const tg = targets(tr, sp.close, sp.low - F.stopAtr * A);
        conds.push(cond('rr', 'RR şartı', 'wait', `Önizleme (kapanıştan): T3 RR ${tg.rr3.toFixed(1)} · T2 RR ${tg.rr2.toFixed(1)}`));
      }
      if (ch && typeof ch === 'object' && fail === null && now > sp.t + F.chochMaxHours * HOUR && !zone) { /* zaman aşımı yukarıda */ }
      conds.push(filterCond(fBlocks({ t: ch && typeof ch === 'object' && new Date(ch.t).getUTCDay() === 0 ? ch.t : sp.t, okAfter: sundayOk(sp.low, sp.t) })));
    }
    tradeOverlays(ov, methods[0]);
    const st = finish({
      ...base, id: `F-BTCUSD-spring-${dir}`, sub: `Wyckoff ${side.w.spring} · Faz ${phase()}${quality ? ' · ' + quality : ''}`, dir, conditions: conds, methods, defaultMethod: methods[0]?.id,
      invalidation: sp ? `${side.w.spring} ${side.w.low}u ${side.f(sp.low)} ötesinde kapanış, zone kırılması veya ${F.chochMaxHours} saat içinde CHoCH gelmemesi` : 'TR kırılırsa (Faz E)',
      overlays: ov, signalAt, zoneId: sp ? `S${sp.t}` : tr ? `TR${tr.firstT}` : 'none', stars, tags, warnings: notes, notices,
      info: { f: fInfo('SPRING', sp, ch, zone) },
    }, guard);
    out.push(st);
  }

  // ================= 2) SOS → LPS (spring kaçtıysa) =================
  if (tr && !phaseE) {
    const sos = sosAfter(sp ? sp.end : tr.last);
    if (sos !== null) {
      const conds: Condition[] = [condBias, condZone, condTR];
      const ov = [...overlaysBase];
      let methods: EntryMethod[] = [];
      let signalAt: number | undefined;
      let guard: Parameters<typeof preFill>[1];
      conds.push(cond('trigger', `${side.w.sos} → ${side.w.lps}`, 'ok', `${side.w.sos} ${fmtTR(h1[sos].t)} TR · kapanış ${side.f(h1[sos].c)} · RV ${rv(h1, sos).toFixed(2)}`, side.P(h1[sos].c)));
      let d = -1;
      for (let k = sos + 1; k < n; k++) if (d < 0 || h1[k].l < h1[d].l) d = k;
      if (d < 0) {
        conds.push(cond('volume', 'Hacim şartı', 'wait', 'Düşük hacimli geri çekilme bekleniyor'));
        conds.push(cond('choch', `LTF CHoCH (${F.ltf})`, 'wait', `${side.w.lps} dibinde`));
        conds.push(cond('test', 'Giriş bölgesine dönüş', 'wait', '—'));
        conds.push(cond('rr', 'RR şartı', 'wait', `T2 RR ≥ ${F.lpsMinRR}`));
      } else {
        const pbRv = h1.slice(sos + 1, d + 1).map((_, k) => rv(h1, sos + 1 + k));
        const lowVol = pbRv.every((r) => r <= F.rvLow);
        const dip = h1[d].l;
        const dipOk = dir === 1 ? dip >= tr.eq : dip >= tr.eq; // long: en kötü ≥ TR.eq (ideal ≥ TR.high − 0.25 ATR); LPSY: tepe ≤ TR.eq
        const ideal = dir === 1 && dip >= tr.high - 0.25 * A;
        conds.push(!lowVol ? cond('volume', 'Hacim şartı', 'fail', `Geri çekilmede RV > ${F.rvLow} olan mum var (maks ${Math.max(...pbRv).toFixed(2)})`)
          : !dipOk ? cond('volume', 'Hacim şartı', 'fail', `Geri çekilme TR EQ ${side.f(tr.eq)} ötesine taştı`)
            : cond('volume', 'Hacim şartı', 'ok', `Geri çekilme düşük hacimli (maks RV ${Math.max(...pbRv, 0).toFixed(2)}) · ${side.w.lps} ${side.f(dip)}${ideal ? ' (eski direnç destek oldu)' : ''}`, side.P(dip)));
        const chL = chochAfter(ltf, h1[d].t, h1[d].t + F.chochMaxHours * HOUR);
        const lh = lastPivotHighBefore(ltf, h1[d].t);
        conds.push(chL && typeof chL === 'object' ? cond('choch', `LTF CHoCH (${F.ltf})`, 'ok', `${side.f(chL.level)} ${side.w.choch} kapanış · ${fmtTR(chL.t)} TR`, side.P(chL.level))
          : cond('choch', `LTF CHoCH (${F.ltf})`, 'wait', lh !== undefined ? `${F.ltf}'de ${side.f(lh)} ${side.w.choch} kapanış bekleniyor` : 'LTF pivot yok'));
        if (chL && typeof chL === 'object') {
          const zone = entryZone(ltf, h1[d].t, chL.i);
          if (zone) {
            const tz = testZone(ltf, h1, zone, chL.i, null, now);
            const [zlo, zhi] = [side.P(zone.low), side.P(zone.high)].sort((a, b) => a - b);
            ov.push({ kind: 'zone', style: 'ob', label: `${side.w.lps} giriş bölgesi`, top: zhi, bottom: zlo, from: chL.t, tf: F.ltf, cond: 'test' });
            if (tz.state === 'ok') { signalAt = tz.t; conds.push(cond('test', 'Giriş bölgesine dönüş', 'ok', `${fmtTR(tz.t)} TR zone'a dönüş (${side.w.lps}: test hacmi şartı yok)`)); }
            else if (tz.state === 'broken') conds.push(cond('test', 'Giriş bölgesine dönüş', 'fail', 'Zone kapanışla kırıldı — iptal'));
            else conds.push(cond('test', 'Giriş bölgesine dönüş', 'wait', `Limit ${side.f(zone.high)} — zone'a dönüş bekleniyor`, side.P(zone.high)));
            const entry = zone.high, stop = dip - F.stopAtr * A;
            let sosTop = -Infinity;
            for (let k = sos; k <= d; k++) sosTop = Math.max(sosTop, h1[k].h);
            const t1 = dir === 1 ? sosTop : tr.high, t2 = tr.high + hgt;
            const m = mkMethod('lps', `${side.w.lps} → ${F.ltf} zone limit`, entry, stop, { t1, t2 });
            methods = [m];
            guard = { from: chL.t, entry, stop, t1 };
            conds.push((m.rr2 ?? 0) >= F.lpsMinRR ? cond('rr', 'RR şartı', 'ok', `T2 RR ${(m.rr2 ?? 0).toFixed(2)} (≥ ${F.lpsMinRR})`) : cond('rr', 'RR şartı', 'fail', `RR yetersiz — T2 ${(m.rr2 ?? 0).toFixed(2)} (≥ ${F.lpsMinRR})`));
          } else { conds.push(cond('test', 'Giriş bölgesine dönüş', 'wait', '—')); conds.push(cond('rr', 'RR şartı', 'wait', '—')); }
        } else { conds.push(cond('test', 'Giriş bölgesine dönüş', 'wait', 'CHoCH sonrası')); conds.push(cond('rr', 'RR şartı', 'wait', `T2 RR ≥ ${F.lpsMinRR}`)); }
      }
      conds.push(filterCond(fBlocks({ t: h1[sos].t, okAfter: sundayOk(d >= 0 ? h1[d].l : tr.low, h1[sos].t) })));
      tradeOverlays(ov, methods[0]);
      out.push(finish({ ...base, id: `F-BTCUSD-lps-${dir}`, sub: `Wyckoff ${side.w.sos} → ${side.w.lps} · Faz D`, dir, conditions: conds, methods, defaultMethod: methods[0]?.id,
        invalidation: `${side.w.lps} ${side.w.low}u veya TR EQ ötesinde kapanış`, overlays: ov, signalAt, zoneId: `L${h1[sos].t}`, stars, tags, info: { f: fInfo(dir === 1 ? 'LPS' : 'LPSY', null, null, null) } }, guard));
    }
  }

  // ================= 3) AGRESİF (sadece long, güçlü / çok güçlü bölge) =================
  if (tr && dir === 1 && (quality === 'güçlü' || quality === 'çok güçlü') && tags.some((t) => t.startsWith('eşit'))) {
    const cands = [...demandZones(D.h1, '1h', 3), ...demandZones(D.h4, '4h', 3)].filter((z) => z.high <= tr!.low && tr!.low - z.high <= A).sort((a, b) => b.high - a.high);
    const z = cands[0];
    if (z) {
      const conds: Condition[] = [condBias, condZone, condTR];
      conds.push(cond('trigger', 'Agresif bölge', 'ok', `Eşit diplerin altında ${z.tf.toUpperCase()} ${z.type} ${z.low.toFixed(1)}–${z.high.toFixed(1)} (CHoCH beklenmez)`, z.high));
      conds.push(cond('volume', 'Hacim şartı', 'ok', 'Agresif girişte hacim şartı yok'));
      conds.push(cond('choch', `LTF CHoCH (${F.ltf})`, 'ok', 'Agresif: CHoCH beklenmez'));
      const after = ltf.filter((x) => x.t > tr!.lastT);
      const touch = after.find((x) => x.l <= z.high);
      const broken = after.find((x) => x.c < z.low);
      let signalAt: number | undefined;
      if (broken) conds.push(cond('test', 'Limit dolumu', 'fail', `Bölge kapanışla kırıldı (${fmtTR(broken.t)} TR)`));
      else if (touch) { signalAt = touch.t; conds.push(cond('test', 'Limit dolumu', 'ok', `${fmtTR(touch.t)} TR limit ${z.high.toFixed(1)} görüldü`)); }
      else conds.push(cond('test', 'Limit dolumu', 'wait', `Limit ${z.high.toFixed(1)} bekleniyor`, z.high));
      const stop = z.low - F.stopAtr * A;
      const tg = targets(tr, z.high, stop);
      conds.push(tg.rr3 >= F.minRR3 && tg.rr2 >= F.minRR2 ? cond('rr', 'RR şartı', 'ok', `T3 RR ${tg.rr3.toFixed(2)} · T2 RR ${tg.rr2.toFixed(2)}`) : cond('rr', 'RR şartı', 'fail', `RR yetersiz — T3 ${tg.rr3.toFixed(2)} · T2 ${tg.rr2.toFixed(2)}`));
      conds.push(filterCond(fBlocks()));
      const m = mkMethod('aggr', 'Agresif: bölge üst kenarı limit', z.high, stop, tg, 'AGRESİF');
      const ov = [...overlaysBase, { kind: 'zone' as const, style: 'ob' as const, label: `Agresif ${z.tf.toUpperCase()} ${z.type}`, top: z.high, bottom: z.low, from: z.t, cond: 'trigger' }];
      tradeOverlays(ov, m);
      out.push(finish({ ...base, id: 'F-BTCUSD-aggr-1', sub: `Wyckoff AGRESİF · eşit dipler altı`, dir: 1, conditions: conds, methods: [m], defaultMethod: 'aggr', invalidation: `Bölge altı ${z.low.toFixed(1)} kapanış`, overlays: ov, signalAt, zoneId: `A${z.t}`, stars, tags: [...tags, 'AGRESİF'], info: { f: fInfo('AGRESIF', null, null, null) } }));
    }
  }
  return out.sort((a, b) => ({ TAM: 0, BEKLE: 1, EKSIK: 2, YOK: 3 })[a.status] - ({ TAM: 0, BEKLE: 1, EKSIK: 2, YOK: 3 })[b.status] || a.remaining - b.remaining);

  function fInfo(entryType: string, s: Spring | null, c: ReturnType<typeof chochAfter>, z: ReturnType<typeof entryZone>) {
    const b = fBlocks();
    return {
      setup: 'F', symbol: 'BTCUSD', evaluated_at_utc: new Date(now).toISOString(), source: data!.source, entry_type: entryType,
      bias: { value: dir === 1 ? 'LONG' : 'SHORT', ema50_4h: bias.ema, close_4h: bias.close },
      htf_zone: near[0] ? { tf: near[0].tf, type: near[0].type, low: Math.min(side.P(near[0].low), side.P(near[0].high)), high: Math.max(side.P(near[0].low), side.P(near[0].high)), quality } : null,
      tr: tr ? { tf: tr.tf, low: Math.min(side.P(tr.low), side.P(tr.high)), high: Math.max(side.P(tr.low), side.P(tr.high)), eq: side.P(tr.eq), touches_low: tr.touchesLow, touches_high: tr.touchesHigh, bars: tr.bars, stale: tr.stale, phase: phase(),
        events: { SC: ev.sc ? new Date(ev.sc.t).toISOString() : null, AR: ev.ar ? new Date(ev.ar.t).toISOString() : null, ST: ev.st ? new Date(ev.st.t).toISOString() : null } } : null,
      trigger: s ? { time_utc: new Date(s.t).toISOString(), low: side.P(s.low), close: side.P(s.close), cp: +s.cp.toFixed(2), rv: +s.rv.toFixed(2), volume_type: s.type } : null,
      choch: c && typeof c === 'object' ? { tf: F.ltf, level: side.P(c.level), confirmed: true, time_utc: new Date(c.t).toISOString() } : null,
      entry_zone: z ? { low: Math.min(side.P(z.low), side.P(z.high)), high: Math.max(side.P(z.low), side.P(z.high)) } : null,
      blocks: b.blocks, notes: b.notes, clock: clock(), atr1h: A,
    };
  }
}
export const _u = { cp, F_MS };
