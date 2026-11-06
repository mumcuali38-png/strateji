/**
 * Emir kartı (EK §3.2), spread kontrolü (§3.3), haber kilidi bandı (§3.4), son giriş sayacı (§3.5),
 * risk kilidi (§3.1), MT5'e Gönder (pasif, §4.1) — TAM/BEKLE setupların kartında.
 */
import { esc, price, tr, dur, dirTxt } from './fmt.js';
import { us100Ratio, instrOf, fxToUsd } from './calc.js';
import { getAdapter, MAGIC } from './broker.js';

/** Lotu iki parçaya böler (%50 TP1 / %50 TP2); lot adımı korunur, tek kalan TP1 parçasına eklenir (EK §9 not) */
export function splitLot(lot, step) {
  const n = Math.round(lot / step + 1e-9);
  if (n < 2) return [n * step];
  const b = Math.floor(n / 2), a = n - b;
  return [+(a * step).toFixed(6), +(b * step).toFixed(6)];
}
const lotTxt = (x, step) => x.toFixed(Math.max(2, String(step).split('.')[1]?.length ?? 0));

/** Strateji başına minimum RR şartları: [alan, min] (spread dahil yeniden kontrol edilir) */
export function rrRules(strategy, P) {
  if (strategy === 'H') return [['rr2', P?.H?.minRR2 ?? 2, 'T2']];
  if (strategy === 'G') return [['rr', P?.G?.minRR1 ?? 1, 'T1'], ['rr2', P?.G?.minRR2 ?? 2, 'T2']];
  if (strategy === 'F') return [['rr2', P?.F?.minRR2 ?? 1.5, 'T2'], ['rr3', P?.F?.minRR3 ?? 3, 'T3']];
  return [['rr', P?.risk?.minRR ?? 2, 'TP1']];
}

/** Spread dahil RR (EK §3.3): long'da giriş = entry + spread, short'ta entry − spread */
export function spreadRR(m, dir, spreadPx) {
  const e = m.entry + dir * spreadPx;
  const risk = Math.abs(e - m.stop);
  const r = (tp) => (tp === undefined || !(risk > 0) ? undefined : (dir === 1 ? tp - e : e - tp) / risk);
  return { entryEff: e, rr: r(m.tp1), rr2: r(m.tp2), rr3: r(m.tp3) };
}

/** Emir tipi: limit setupta fiyatın konumuna göre LIMIT / STOP; piyasa seçilirse BUY/SELL */
export function orderSide(dir, type, entry, px) {
  const side = dir === 1 ? 'BUY' : 'SELL';
  if (type === 'market') return side;
  if (!Number.isFinite(px)) return `${side} LIMIT`;
  const better = dir === 1 ? entry <= px : entry >= px;
  return `${side} ${better ? 'LIMIT' : 'STOP'}`;
}

/** Kopyala metni: `XAUUSD BUY LIMIT 4056.85 SL 4045.60 TP1 4071.20 TP2 4088.00 LOT 0.06 (2×0.03)` */
export function orderText(o) {
  const f = (x) => price(x, o.dec);
  const parts = o.parts.length === 2 ? (o.parts[0] === o.parts[1] ? ` (2×${lotTxt(o.parts[0], o.step)})` : ` (${lotTxt(o.parts[0], o.step)}+${lotTxt(o.parts[1], o.step)})`) : '';
  return `${o.symbol} ${o.side} ${f(o.entry)} SL ${f(o.stop)} TP1 ${f(o.tp1)}${o.tp2 !== undefined ? ` TP2 ${f(o.tp2)}` : ''}`
    + (o.lot !== null ? ` LOT ${lotTxt(o.lot, o.step)}${parts}` : ' LOT —');
}

/** Bugünün açık riski (%): sonucu girilmemiş işlemler (EK §3.1 risk kilidi) */
export function openRiskPct(list, balanceUsd) {
  if (!(balanceUsd > 0)) return 0;
  return list.filter((t) => !t.result).reduce((a, t) => a + (Number(t.riskUsd) || 0), 0) / balanceUsd * 100;
}

/** Emir kartının tüm verisi (UI'dan bağımsız; test edilebilir) */
export function buildOrder(App, s, m, cfg) {
  const st = App.data.state, set = App.settings, P = App.conf.params ?? st?.params ?? {};
  const ins = m.ins ?? instrOf(s.symbol, cfg, set);
  const isUs = s.symbol === 'US100';
  const { ratio, user } = us100Ratio(set, st);
  const conv = (x) => (x === undefined ? undefined : isUs ? x * ratio : x); // US100: QQQ → US100 (broker fiyatı)
  const px = st?.symbols?.[s.symbol]?.price;
  const risk = Math.abs(m.entry - m.stop);
  const inZone = Number.isFinite(px) && risk > 0 && Math.abs(px - m.entry) <= 0.3 * risk;
  const sel = App.orderType?.[s.id];
  const type = sel === 'market' && inZone ? 'market' : m.type === 'market' ? 'market' : 'limit';
  const entry = type === 'market' && Number.isFinite(px) ? px : m.entry;
  const dec = isUs ? 1 : cfg.decimals;
  // Mesafe birimi: FX pip, US100 puan, diğerleri fiyat ($)
  const unitName = isUs ? 'puan' : ins.unitSize < 1 ? 'pip' : '$';
  const units = (d) => (isUs ? d * ratio : d / ins.unitSize);
  const usd = (d) => (m.lotOk ? units(d) * ins.valuePerUnit * m.lot : null);
  const spreadPx = ins.spreadType === 'us100pts' ? ins.spread / ratio : ins.spread;
  const srr = spreadRR({ ...m, entry }, s.dir || 1, spreadPx);
  const rules = rrRules(s.strategy, P);
  const spreadFail = rules.filter(([k, min]) => srr[k] !== undefined && m[k] !== undefined && srr[k] < min).map(([k, min, l]) => `${l} RR ${srr[k].toFixed(2)} < ${min}`);
  const parts = m.lotOk ? splitLot(m.lot, ins.lotStep) : [];
  const bal = (Number(set.balance) || 0) * (fxToUsd(set, st) ?? 0);
  // Gerçek risk: yuvarlanmış lotun stoptaki zararı (hedef riskUsd'nin altında olabilir)
  const riskReal = m.lotOk ? usd(Math.abs(entry - m.stop)) : m.riskUsd;
  const riskPct = bal > 0 ? (riskReal / bal) * 100 : 0;
  const warnings = [];
  const locks = [];
  if (App.limits?.reached) locks.push({ code: 'BUGUN_DUR', text: `BUGÜN DUR — ${App.limits.why}` });
  const openPct = App.limits?.openRiskPct ?? 0, maxOpen = Number(set.maxOpenRiskPct) || 0;
  if (maxOpen > 0 && bal > 0 && openPct + riskPct > maxOpen + 1e-9) locks.push({ code: 'RISK_DOLU', text: `RİSK DOLU — açık risk %${openPct.toFixed(2)} + bu işlem %${riskPct.toFixed(2)} > %${maxOpen}` });
  if (spreadFail.length) warnings.push({ code: 'SPREAD_RR', text: `Spread ile RR yetersiz (${spreadFail.join(' · ')}; spread ${ins.spreadType === 'us100pts' ? ins.spread + ' puan' : price(ins.spread, cfg.decimals)})` });
  const nr = st?.symbols?.[s.symbol]?.newsRisk;
  const ev = nr?.event ?? nr?.next;
  const newsSoon = ev && ev.t - Date.now() <= 30 * 60000 && Date.now() - ev.t <= 15 * 60000;
  if (newsSoon) warnings.push({ code: 'HABER_30DK', band: true, text: `HABER RİSKİ – ${ev.currency} ${ev.title} ${tr(ev.t)} TR` });
  // Aynı fikir: aynı paritede aynı yönde başka bir TAM kurulum (örn. B ve G) → tek işlem
  const same = Object.entries(st?.strategies ?? {}).flatMap(([k, by]) => (k === s.strategy ? [] : (by?.[s.symbol] ?? []).filter((x) => (x.status === 'TAM' || x.status === 'BEKLE') && x.dir === s.dir).map(() => k)));
  if (same.length) warnings.push({ code: 'AYNI_FIKIR', text: `Aynı fikir — ${[...new Set(same)].join(', ')} ile aynı yönde TAM: tek işlem aç (çift risk yok)` });
  if (isUs && !user) warnings.push({ code: 'US100_ORAN', text: `US100 seviyeleri QQQ × ${ratio.toFixed(1)} tahminidir — Ayarlar'dan US100 güncel fiyatını gir` });
  const now = Date.now();
  const deadline = s.lastEntry ? { t: s.lastEntry, left: s.lastEntry - now, expired: now >= s.lastEntry } : null;
  const o = {
    signalId: s.id, symbol: ins.brokerSymbol, dir: s.dir, type, side: orderSide(s.dir, type, entry, px), inZone, dec, step: ins.lotStep,
    entry: conv(entry), stop: conv(m.stop), tp1: conv(m.tp1), tp2: conv(m.tp2),
    rr: m.rr, rr2: m.rr2, rr3: m.rr3, srr, lot: m.lotOk ? m.lot : null, parts, riskUsd: riskReal, riskTarget: m.riskUsd, riskPct,
    dist: { unitName, stop: units(Math.abs(entry - m.stop)), tp1: units(Math.abs(m.tp1 - entry)), tp2: m.tp2 !== undefined ? units(Math.abs(m.tp2 - entry)) : undefined, stopUsd: usd(Math.abs(entry - m.stop)), tp1Usd: usd(Math.abs(m.tp1 - entry)), tp2Usd: m.tp2 !== undefined ? usd(Math.abs(m.tp2 - entry)) : undefined },
    deadline, warnings, locks, magic: MAGIC[s.strategy], lotNote: m.lotNote,
  };
  o.text = orderText(o);
  return o;
}

/** Kalan süre metni */
export function deadlineTxt(d) {
  if (!d) return '';
  return d.expired ? `⏰ SÜRE DOLDU (${tr(d.t)} TR) — limit emri iptal edin` : `Son giriş ${tr(d.t)} TR · <b>${dur(d.left)}</b> kaldı`;
}

export function orderCardHtml(App, s, o) {
  const U = (x) => (o.dist.unitName === '$' ? `$${x.toFixed(2)}` : `${x.toFixed(1)} ${o.dist.unitName}`);
  const $ = (x) => (x === null || x === undefined ? '' : ` · <b>$${x.toFixed(0)}</b>`);
  const f = (x) => price(x, o.dec);
  const adapter = getAdapter(App.settings);
  const mt5On = adapter.status() === 'CONNECTED';
  const locked = o.locks.length > 0;
  const band = o.warnings.find((w) => w.band);
  const skipped = App.skipped?.[s.id];
  return `<div class="order ${o.dir === 1 ? 'dl' : 'ds'}" data-order>
    ${band ? `<div class="banner news" style="border-radius:10px">🔴 ${esc(band.text)}</div>` : ''}
    ${o.locks.map((l) => `<div class="lockline">🔒 ${esc(l.text)}</div>`).join('')}
    <div class="row" style="justify-content:space-between"><b>Emir kartı · ${esc(s.strategy)} · ${esc(o.symbol)} <span class="dir ${o.dir === 1 ? 'long' : 'short'}">${dirTxt(o.dir)}</span>${s.info?.g?.quality ? ` · ${esc(s.info.g.quality)}` : s.stars ? ` · ${'★'.repeat(s.stars)}` : ''}</b>
      <div class="seg"><button class="seg-b ${o.type === 'limit' ? 'on' : ''}" data-otype="limit">Limit</button><button class="seg-b ${o.type === 'market' ? 'on' : ''}" data-otype="market" ${o.inZone ? '' : 'disabled title="Fiyat bölgede değil"'}>Piyasa</button></div></div>
    <div class="ogrid">
      <span class="k">Emir</span><span class="v mono">${esc(o.side)}</span><span class="d">${o.inZone ? 'fiyat bölgede' : ''}</span>
      <span class="k">Giriş</span><span class="v">${f(o.entry)}</span><span class="d"></span>
      <span class="k" style="color:var(--short)">SL</span><span class="v">${f(o.stop)}</span><span class="d">${U(o.dist.stop)}${$(o.dist.stopUsd)}</span>
      <span class="k" style="color:var(--info)">TP1</span><span class="v">${f(o.tp1)}</span><span class="d">RR ${o.rr.toFixed(2)} · TP1'de %50${$(o.dist.tp1Usd)}</span>
      ${o.tp2 !== undefined ? `<span class="k" style="color:var(--info)">TP2</span><span class="v">${f(o.tp2)}</span><span class="d">RR ${o.rr2?.toFixed(2) ?? '—'} · kalan %50${$(o.dist.tp2Usd)}</span>` : ''}
      <span class="k">Lot</span><span class="v">${o.lot !== null ? lotTxt(o.lot, o.step) : '—'}</span><span class="d">${o.parts.length === 2 ? `${lotTxt(o.parts[0], o.step)} (TP1) + ${lotTxt(o.parts[1], o.step)} (TP2)` : o.lot !== null ? 'tek parça (min lot)' : esc(o.lotNote || 'AYAR GEREKLİ')}</span>
      <span class="k">Risk</span><span class="v">$${o.riskUsd.toFixed(0)}</span><span class="d">%${o.riskPct.toFixed(2)}${o.riskTarget - o.riskUsd > 0.5 ? ` (hedef $${o.riskTarget.toFixed(0)})` : ''} · spread dahil RR ${o.srr.rr?.toFixed(2) ?? '—'}${o.srr.rr2 !== undefined ? ` / ${o.srr.rr2.toFixed(2)}` : ''}</span>
    </div>
    ${o.deadline ? `<div class="deadline ${o.deadline.expired ? 'exp' : ''}" data-deadline="${o.deadline.t}">${deadlineTxt(o.deadline)}</div>` : ''}
    ${o.warnings.filter((w) => !w.band).map((w) => `<div class="warnline">⚠️ ${esc(w.text)}</div>`).join('')}
    ${skipped ? `<div class="muted small">Girmedim · ${esc(skipped.reasonText)}${skipped.note ? ' — ' + esc(skipped.note) : ''} (${tr(skipped.t)} TR)</div>` : ''}
    <div class="btns">
      <button class="btn big primary" data-act="ocopy">⧉ Kopyala</button>
      <button class="btn big mt5 ${o.dir === 1 ? 'l' : 's'} ${mt5On && !locked ? '' : 'off'}" data-act="mt5" aria-disabled="${!mt5On || locked}">📤 MT5'e Gönder</button>
      <button class="btn big" data-act="entered">✔ Girdim</button>
      <button class="btn big" data-act="skip">✖ Girmedim</button>
    </div>
  </div>`;
}

export const SKIP_REASONS = [['GEC_GORDUM', 'Geç gördüm'], ['KORKTUM', 'Korktum'], ['KURAL_DISI', 'Kurala uymadı bence'], ['HABER', 'Haber'], ['RISK_DOLU', 'Risk dolu'], ['SPREAD', 'Spread'], ['DIGER', 'Diğer']];
