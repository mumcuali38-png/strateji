// ⭐ OCO kurulumları (N7, IB) çalıştırıcısı: sinyal → çift teyit → OCO emir kaydı → sanal sonuç → satır + bildirim + grafik.
import type { StarId, SymbolCfg } from '../types.ts';
import { pack } from '../candles.ts';
import { DAY, MIN, fmtTR } from '../time.ts';
import type { StarConfig } from './config.ts';
import { doubleScan, signalId, type Pending } from './guard.ts';
import { candidate, detect, nextSession, simulate, type OcoKind, type OcoOrder, type OcoSim } from './oco.ts';
import type { StarPos } from './trend.ts';
import type { SigLog, StarMsg } from './setups.ts';
import type { StarSeries } from './run.ts';

export const OCO_IDS: StarId[] = ['N7'];
const KIND: Partial<Record<StarId, OcoKind>> = { N7: 'NR7', IB: 'IB' };
const SH: Record<string, string> = { XAUUSD: 'XAU', USDJPY: 'USDJPY', AUDUSD: 'AUDUSD', US100: 'US100', US500: 'US500', US30: 'US30', XAGUSD: 'XAG', WTI: 'WTI', BTCUSD: 'BTC', ETHUSD: 'ETH' };
const dirW = (d: number) => (d === 1 ? '▲ LONG' : '▼ SHORT');

export interface OcoDeps {
  sc: StarConfig; now: number; series: Record<string, StarSeries>; orders: OcoOrder[]; positions: StarPos[]; pending: Record<string, Pending>; signals: SigLog[];
  livePrice: (sym: string, why: 'final' | 'pos') => Promise<{ price: number | null; src: string; live: boolean }>;
  urgent: Set<string>; watch: Set<string>; newsLabel: { title: string; t: number; minutes?: number } | null;
  symCfg: (sym: string) => SymbolCfg | undefined;
}

/** Sanal sonucu portföy pozisyonuna çevir (haftalık R, takvim, açık risk) */
function toPos(o: OcoOrder, sim: OcoSim, day: { c: number }): StarPos | null {
  if (sim.dir === null || sim.entry === null) return null;
  const k = sim.k === 'HEDEF' ? 'CIKIS' : sim.k === 'STOP' ? 'STOP' : 'CIKIS';
  return {
    id: o.id, setup: o.setup, sym: o.sym, dir: sim.dir, signalT: o.dayT, signalEnd: o.dayEnd, signalClose: day.c, atr: 0, ref: sim.dir === 1 ? o.H : o.L, notifiedAt: o.notifiedAt,
    entry: sim.entry, entryT: sim.fillT, stop: sim.stop!, stop0: sim.stop!, R: sim.R!, t1: sim.target, t1Done: false, stopAtBe: false,
    open: sim.state === 'DOLDU', closedT: sim.exitT, exit: sim.exit, reason: sim.reason, r: sim.r, rNow: sim.rNow, exitPending: null,
    events: [{ k: 'GIRIS', t: sim.fillT!, price: sim.entry }, ...(sim.exitT !== null ? [{ k: k as 'CIKIS' | 'STOP', t: sim.exitT, price: sim.exit!, r: sim.r ?? undefined }] : [])],
  };
}

export async function runOco(id: StarId, d: OcoDeps): Promise<{ rows: Record<string, unknown>; msgs: StarMsg[]; charts: Record<string, unknown> }> {
  const { sc, now } = d;
  const cfg = sc.setups[id], kind = KIND[id]!, name = cfg.name, P = cfg.p;
  const etf = sc.common.etfSessionNY;
  const rows: Record<string, unknown> = {}, msgs: StarMsg[] = [], charts: Record<string, unknown> = {};
  for (const sym of cfg.symbols) {
    const s = d.series[sym];
    if (!s) continue;
    const ins = s.ins, dec = ins.decimals, tick = ins.tick, S = SH[sym] ?? sym, url = `./#/star/${id}/${sym}`;
    const fx = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : x.toFixed(dec));
    const conds: { id: string; label: string; status: 'ok' | 'fail' | 'wait'; detail: string }[] = [];
    // --- Mevcut emir / pozisyon (son 3 gün) ---
    const mine = d.orders.filter((o) => o.setup === id && o.sym === sym && now - o.sessEnd < 3 * DAY).sort((a, b) => b.dayT - a.dayT);
    let active: { o: OcoOrder; sim: OcoSim } | null = null;
    let last: { o: OcoOrder; sim: OcoSim } | null = null;
    for (const o of mine) {
      const inSess = now >= o.sessStart && now < o.sessEnd;
      const lp = (inSess || now < o.sessEnd + 2 * 3600_000) && (o.liveFill || inSess) ? await d.livePrice(sym, 'pos') : { price: null, src: '', live: false };
      const sim = simulate(o, ins.cls, s.h1, now, P.targetR, lp.price, etf);
      const day = s.daysAll.find((g) => g.t === o.dayT) ?? { c: (o.H + o.L) / 2 };
      // Anlık fiyatla dolum (C adımı): fiyat seviyeyi geçti → "doldu" varsayımı, kullanıcı onayı istenir
      if (sim.state === 'BEKLIYOR' && inSess && lp.live && lp.price !== null && !o.liveFill) {
        if (lp.price >= o.H) o.liveFill = { dir: 1, t: now, price: lp.price };
        else if (lp.price <= o.L) o.liveFill = { dir: -1, t: now, price: lp.price };
      }
      const pos = toPos(o, sim, day);
      const pi = d.positions.findIndex((x) => x.id === o.id);
      if (pos) { if (pi >= 0) d.positions[pi] = pos; else d.positions.push(pos); }
      if (sim.state === 'BEKLIYOR' || sim.state === 'DOLDU') { d.watch.add(sym); if (!active) active = { o, sim }; }
      if (!last) last = { o, sim };
      // Bildirimler (6 saatten eski olay bildirilmez)
      const fresh = (t: number | null) => t !== null && now - t <= 6 * 3600_000;
      if ((sim.dir !== null && fresh(sim.fillT)) || (o.liveFill && sim.dir === null && fresh(o.liveFill.t))) {
        const dir = sim.dir ?? o.liveFill!.dir;
        msgs.push({ key: `${o.id}+DOLDU`, title: `🔵 ${name} · ${S} ${dirW(dir)} doldu`, body: `${name}: ${S} ${dirW(dir)} doldu — giriş ${fx(sim.entry ?? o.liveFill?.price)}${sim.gap ? ' (açılış boşluğu — R ve hedef gerçek girişe göre)' : ''}, stop ${fx(dir === 1 ? o.L : o.H)}, hedef ${fx(sim.target ?? (dir === 1 ? o.H + P.targetR * o.R : o.L - P.targetR * o.R))}${sim.dir === null ? ' · anlık fiyatla tespit — brokerda doldu mu kontrol et' : ''}`, url, loud: true, setup: id, symbol: sym });
      }
      if (sim.state === 'CIFT' && fresh(sim.fillT)) msgs.push({ key: `${o.id}+CIFT`, title: `${name} · ${S} çift kırılım`, body: `${name}: ${S} ${sim.reason}. OCO ilk dokunanı doldurduysa işlem günlükte "test dışı (çift kırılım)" olarak işaretlenir.`, url, loud: false, setup: id, symbol: sym });
      if (sim.state === 'KAPANDI' && fresh(sim.exitT)) {
        const w = sim.k === 'HEDEF' ? 'hedef' : sim.k === 'STOP' ? 'stop' : 'seans sonu kapanış';
        msgs.push({ key: `${o.id}+${sim.k}`, title: `⛔ ${name} · ${S} ${w}`, body: `${name}: ${S} ${w}, R ${sim.r!.toFixed(2)}`, url, loud: true, setup: id, symbol: sym });
      }
      // E: seans bitimine 10 dk kala
      if ((sim.state === 'DOLDU' || (o.liveFill && sim.state === 'BEKLIYOR')) && now >= o.sessEnd - P.sessionEndWarnMin * MIN && now < o.sessEnd) {
        msgs.push({ key: `${o.id}+SEANS10`, title: `⛔ ${name} · ${S} seans sonu`, body: `${name}: seans sonu — pozisyonu kapat (${fmtTR(o.sessEnd)} TR)`, url, loud: true, setup: id, symbol: sym });
      }
    }
    // --- Sinyal (son kapanmış seans günü) ---
    const det = detect(kind, s.daysAll, tick);
    const day = det.day;
    const nxt = day ? nextSession(ins.cls, day.end, sc.common) : null;
    const sid = day ? signalId(id, sym, day.t) : '';
    const hasOrder = !!day && mine.some((o) => o.dayT === day.t);
    const openPos = active?.sim.state === 'DOLDU' && active.o.dayT !== day?.t;
    const cand = candidate(kind, s.days, s.live?.day, tick);
    let status: string = 'YOK', scanSeq = 0, note = '';
    const H = day?.h ?? NaN, L = day?.l ?? NaN, R = H - L;
    const cfgSym = d.symCfg(sym);
    const ratio = ins.cls === 'etf' ? ins.ratioDefault ?? null : 1;
    const spreadPx = cfgSym && ratio ? (cfgSym.spread ?? 0) / ratio : null;
    const spreadOk = spreadPx !== null && R > 0 ? spreadPx <= P.spreadMaxR * R : null;
    // 1 Veri
    if (!s.h1.length) { conds.push({ id: 'veri', label: 'Veri tamam ve taze', status: 'wait', detail: '⏳ veri yok' }); }
    else if (!s.fresh) { conds.push({ id: 'veri', label: 'Veri tamam ve taze', status: 'fail', detail: 'VERİ GECİKMESİ — son kapanış beklenenden 2 saatten eski' }); status = 'VERI_GECIKMESI'; }
    else if (det.ok === null) conds.push({ id: 'veri', label: 'Veri tamam ve taze', status: 'wait', detail: `⏳ ${det.why}` });
    else conds.push({ id: 'veri', label: 'Veri tamam ve taze', status: 'ok', detail: `son 7 seans günü geçerli · son gün ${day!.key} (${day!.n} adet 1H)` });
    // 2 Sinyal
    const sigLabel = kind === 'NR7' ? 'Dünkü seans NR7' : 'Dünkü seans iç gün (NR7 değil)';
    conds.push({ id: 'sinyal', label: sigLabel, status: det.ok ? 'ok' : det.ok === false ? 'fail' : 'wait', detail: det.ok !== null ? `${det.why} · H ${fx(H)} L ${fx(L)}${kind === 'IB' && det.prev ? ` (dün H ${fx(det.prev.h)} L ${fx(det.prev.l)})` : ''}` : '—' });
    // 3 Seans / seviyeler
    const sessOk = !!nxt && now < nxt.end;
    conds.push({ id: 'seans', label: 'Bu seans içindeyiz ve seviyeler henüz kırılmadı', status: !det.ok ? 'wait' : !sessOk ? 'fail' : active?.o.dayT === day?.t && active?.sim.state === 'DOLDU' ? 'fail' : 'ok', detail: nxt ? `ertesi seans ${fmtTR(nxt.start)} – ${fmtTR(nxt.end)} TR${now < nxt.start ? ' (henüz başlamadı — emirler açılışta)' : ''}` : '—' });
    // 4 Açık pozisyon
    conds.push({ id: 'pozisyon', label: `Açık ${name} yok`, status: openPos ? 'fail' : 'ok', detail: openPos ? `açık ${name} var` : 'yok' });
    // 5 Koruma
    if (s.fresh && det.ok && sessOk && !openPos && !hasOrder) {
      const ps = doubleScan(d.pending, sid, `${day!.t}|${fx(H)}|${fx(L)}`, now);
      scanSeq = ps.seq;
      if (ps.seq === 1) { status = 'TAM_BEKLE'; note = 'teyit 1/2'; d.urgent.add(sym); conds.push({ id: 'koruma', label: 'Koruma (teyit 2/2, spread, oran)', status: 'wait', detail: 'teyit 1/2 — sonraki taramada veri yeniden çekilip kontrol edilecek' }); }
      else {
        const o: OcoOrder = { id: sid, setup: id, sym, dayKey: day!.key, dayT: day!.t, dayEnd: day!.end, H, L, R, sessStart: nxt!.start, sessEnd: nxt!.end, sessKey: nxt!.key, notifiedAt: now, liveFill: null };
        d.orders.push(o);
        d.signals.push({ id: sid, setup: id, sym, t: now, status: 'TAM' });
        d.watch.add(sym);
        active = { o, sim: simulate(o, ins.cls, s.h1, now, P.targetR, null, etf) };
        last = active;
        const head = kind === 'NR7' ? `${name}: ${S} NR7 — al-stop ${fx(H)}, sat-stop ${fx(L)}, hedefler ±1,5R, seans sonu ${fmtTR(nxt!.end)} TR` : `${name}: ${S} iç gün — al-stop ${fx(H)}, sat-stop ${fx(L)}, hedef ±1,5R`;
        msgs.push({ key: `${sid}+TAM`, title: `🔵 ${name} · ${S} OCO TAM`, body: head, url, loud: true, setup: id, symbol: sym });
      }
    }
    const curOrder = active?.o.dayT === day?.t ? active : hasOrder ? last : null;
    if (curOrder && conds.length < 5) conds.push({ id: 'koruma', label: 'Koruma (teyit 2/2, spread, oran)', status: spreadOk === false ? 'fail' : 'ok', detail: `teyit 2/2${spreadOk === false ? ' · spread R\'nin %5\'inden büyük — giriş önerilmez' : spreadOk ? ' · spread OK' : ''}${ins.cls === 'etf' ? ' · oranı uygulamada kontrol et' : ''}` });
    else if (conds.length < 5) conds.push({ id: 'koruma', label: 'Koruma (teyit 2/2, spread, oran)', status: 'wait', detail: '—' });
    // Durum önceliği
    const act = active;
    if (status !== 'VERI_GECIKMESI' && status !== 'TAM_BEKLE') {
      if (act && (act.sim.state === 'DOLDU' || (act.o.liveFill && act.sim.state === 'BEKLIYOR'))) { status = 'AKTIF'; note = 'pozisyon açık'; }
      else if (act && act.sim.state === 'BEKLIYOR') { status = 'TAM'; note = now < act.o.sessStart ? 'OCO emirleri — seans açılışında gir' : 'OCO emirleri bekliyor'; scanSeq = 2; }
      else if (cand.cand) { status = 'EKSIK'; note = kind === 'NR7' ? 'bugün NR7 adayı — seans bitince belli olacak' : 'bugün iç gün adayı — seans bitince belli olacak'; }
      else { status = 'YOK'; note = det.ok === null ? det.why : `${kind === 'NR7' ? 'dün NR7 değil' : 'dün iç gün değil'}${last?.sim.reason ? ` · son: ${last.sim.reason}` : ''}`; }
    }
    // Son kontrol (elle giriş, N7.3 / IB.3): fiyat seviyeyi > 0,25R geçmişse KAÇTI
    const px = s.price;
    const ord = act?.o ?? null;
    const manualKacti = ord && act!.sim.state === 'BEKLIYOR' && px !== null ? (px > ord.H + P.kactiR * ord.R || px < ord.L - P.kactiR * ord.R) : false;
    const sim = act?.sim ?? last?.sim ?? null;
    const o = ord ?? (last?.o ?? null);
    const orders = o ? {
      buy_stop: { entry: o.H, stop: o.L, target: o.H + P.targetR * o.R }, sell_stop: { entry: o.L, stop: o.H, target: o.L - P.targetR * o.R },
      oco: true, expires_at_utc: new Date(o.sessEnd).toISOString().replace(/\.\d+Z$/, 'Z'), lots: null,
    } : null;
    const fillDir = sim?.dir ?? o?.liveFill?.dir ?? null;
    rows[sym] = {
      status, dir: fillDir, note, conditions: conds, signalId: o?.id ?? null, news: d.newsLabel,
      order: o ? { ...o, state: sim?.state ?? null, sim, manualKacti } : null,
      position: sim && (sim.state === 'DOLDU') ? { id: o!.id, open: true, dir: sim.dir, entry: sim.entry, entryT: sim.fillT, stop: sim.stop, t1: sim.target, rNow: sim.rNow, sessEnd: o!.sessEnd, gap: sim.gap } : null,
      lastClosed: last && last.sim.state !== 'BEKLIYOR' && last.sim.state !== 'DOLDU' ? { ...last.sim, id: last.o.id, closedT: last.sim.exitT ?? last.o.sessEnd, dir: last.sim.dir } : null,
      candidate: cand, spreadOk,
      levels: { H, L, R, price: px, level: null, distAtr: null },
      json: {
        setup: id, star: true, symbol: sym, evaluated_at_utc: new Date(now).toISOString().replace(/\.\d+Z$/, 'Z'), scan_seq: scanSeq,
        status: status === 'TAM_BEKLE' ? 'TAM_BEKLE' : status,
        ...(kind === 'NR7'
          ? { nr7: day ? { day: day.key, high: day.h, low: day.l, range: +(day.h - day.l).toFixed(dec + 2), min7: det.min7 } : null }
          : { inside_day: day ? { day: day.key, high: day.h, low: day.l, prev_high: det.prev?.h ?? null, prev_low: det.prev?.l ?? null, is_nr7: det.nr7 } : null }),
        orders,
        position: { open: sim?.state === 'DOLDU', dir: sim?.dir === 1 ? 'LONG' : sim?.dir === -1 ? 'SHORT' : null, fill: sim?.entry ?? null, slip_r: null, r_now: sim?.rNow ?? null },
        protection: { double_scan_ok: scanSeq === 2 || !!ord, spread_ok: spreadOk, ...(kind === 'NR7' ? { ratio_fresh: null } : {}), blocked_by: manualKacti ? 'KACTI' : spreadOk === false ? 'SPREAD' : null },
      },
    };
    // Mini grafik: 1H mumları (son ~10 gün), sinyal günü kutusu (H/L) uygulamada çizgi
    const show = s.h1.slice(-240);
    charts[`${id}_${sym}`] = { t: now, symbol: `${id}_${sym}`, decimals: dec, source: s.source, tfs: { '1h': pack(show).map((r) => r.slice(0, 5)) } };
  }
  return { rows, msgs, charts };
}
