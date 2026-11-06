/**
 * ⭐ kurulum ayrıntı ekranı: şart tablosu (✅/❌/⏳), seviyeler, emir kartı (ortak lot / günlük / MT5 pasif), açık pozisyon, mini grafik.
 * Rota: #/star/{M2|T4S|TD|N7|IB}/{SEMBOL}
 */
import { esc, price, tr, dateTR, dur, COND_ICON, HOUR } from './fmt.js';
import { instrOf, fxToUsd } from './calc.js';
import { splitLot } from './order.js';
import { getAdapter, MT5_OFF_MSG, MAGIC } from './broker.js';
import { copy, modal, toast } from './ui.js';
import { trades, skipped } from './store.js';
import { mountChart } from './chart.js';
import { chart as loadChart } from './data.js';
import { starName, starRatio, STAR_IDS, starConfirm, setStarConfirm } from './star.js';

const ST = {
  TAM: ['tam', '🔵 TAM'], TAM_BEKLE: ['bekle', '🟠 TAM – BEKLE (teyit 1/2)'], EKSIK: ['eksik', '🟡 EKSİK'], YOK: ['yok', '⚪ YOK'],
  VERI_GECIKMESI: ['eksik', '⚠ VERİ GECİKMESİ'], AKTIF: ['tam', '🔵 AKTİF'], ACIK: ['tam', '● AÇIK'],
};
export const dirHtml = (d) => (d === 1 ? '<span class="dir long">▲ LONG</span>' : d === -1 ? '<span class="dir short">▼ SHORT</span>' : '');
/** Satırın gösterilecek durumu: açık pozisyon girişi bekliyorsa TAM, girildiyse AÇIK */
export function rowState(row) {
  const p = row?.position;
  if (p?.open) return p.entryT ? 'ACIK' : 'TAM';
  return row?.status ?? 'YOK';
}
export function rowBadge(row) {
  const k = rowState(row);
  const [c, t] = ST[k] ?? ST.YOK;
  return `<span class="badge ${c}">${t}${k === 'EKSIK' && row?.levels?.distAtr !== null && row?.levels?.distAtr !== undefined ? ` · ${row.levels.distAtr.toFixed(2)} ATR` : ''}</span>`;
}

const symCfg = (App, sym) => App.conf.symbols?.[sym] ?? App.conf.star?.newSymbols?.[sym] ?? { decimals: 2, unitSize: 1, valuePerUnit: 1, lotStep: 0.01, minLot: 0.01 };
const isNew = (App, sym) => !!App.conf.star?.newSymbols?.[sym];

/**
 * Lot (ortak lot modülü kuralı, EK §3.1): lot = floor(riskUSD / (stop mesafesi / birim × birim değeri) / lot adımı) × lot adımı.
 * ⭐ risk: Ayarlar > ⭐ (varsayılan %0,5). Oranlı enstrümanda mesafe ETF → CFD'ye oranla çevrilir.
 */
export function starLot(App, sym, entry, stop) {
  const s = App.settings, cfg = symCfg(App, sym), ins = instrOf(sym, cfg, s);
  const etf = App.conf.star?.instruments?.[sym]?.cls === 'etf';
  const rat = etf ? starRatio(App, sym) : { ratio: 1 };
  const kur = fxToUsd(s, App.data.state);
  const bal = Number(s.balance) || 0;
  const riskPct = Number(s.starRiskPct ?? App.conf.star?.common?.riskPct ?? 0.5);
  const riskUsd = bal * riskPct / 100 * (kur ?? 0);
  const out = { lot: null, note: '', riskUsd, riskPct, ratio: rat.ratio, ins, parts: [] };
  if (!bal) { out.note = 'AYAR GEREKLİ — Ayarlar → Hesap bakiyesi'; return out; }
  if (isNew(App, sym) ? !s.instrConfirmedStar : !s.instrConfirmed) { out.note = 'AYAR GEREKLİ — Ayarlar → enstrüman değerlerini doğrula'; return out; }
  if (kur === null) { out.note = `Kur yok (${s.currency}→USD)`; return out; }
  if (!(rat.ratio > 0)) { out.note = 'Oran yok — Ayarlar → ⭐ → CFD fiyatı'; return out; }
  const dist = Math.abs(entry - stop) * (etf ? rat.ratio : 1);
  const perLot = (dist / ins.unitSize) * ins.valuePerUnit;
  let lot = perLot > 0 ? Math.floor(riskUsd / perLot / ins.lotStep + 1e-9) * ins.lotStep : 0;
  if (lot < ins.minLot) { out.note = `Risk çok küçük — min lot ${ins.minLot} ile risk %${(ins.minLot * perLot / (bal * (kur ?? 1)) * 100).toFixed(2)}`; lot = ins.minLot; }
  out.lot = +lot.toFixed(6);
  out.riskReal = lot * perLot;
  return out;
}

function orderHtml(App, id, sym, row) {
  const cfgS = App.conf.star.setups[id];
  const o = row.order ?? (row.position?.open ? { ref_price: row.position.entry ?? row.position.ref, stop: row.position.stop, t1: row.position.t1, t1_fraction: cfgS.p.t1Fraction ?? null, type: cfgS.tf === '1d' ? 'MARKET_NEXT_OPEN' : 'MARKET' } : null);
  if (!o) return '';
  const ins = App.data.star?.instruments?.[sym] ?? {};
  const dec = ins.decimals ?? 2, etf = ins.cls === 'etf';
  const dir = row.position?.dir ?? row.dir;
  const rat = etf ? starRatio(App, sym) : null;
  const cfd = (x) => (x === null || x === undefined ? '—' : etf ? (rat?.ratio ? `${price(x * rat.ratio, 2)} <span class="muted small">(${esc(ins.label.split(' ')[1] ?? 'ETF')} ${price(x, dec)})</span>` : `<span class="muted small">ETF</span> ${price(x, dec)}`) : price(x, dec));
  const L = starLot(App, sym, o.ref_price, o.stop);
  const step = L.ins.lotStep;
  const parts = L.lot && o.t1 ? splitLot(L.lot, step) : [];
  const exitTxt = id === 'M2' ? `1H kapanış ${dir === 1 ? 'DA5' : 'DU5'} ötesi (şu an ${price(dir === 1 ? row.levels?.exitDn : row.levels?.exitUp, dec)})` : id === 'T4S' ? `4H kapanış ${dir === 1 ? 'DA10' : 'DU10'} ötesi` : `günlük kapanış ${dir === 1 ? 'DA20' : 'DU20'} ötesi`;
  const warns = [];
  if (row.news) warns.push(`HABER RİSKİ — ${esc(row.news.title)} ${tr(row.news.t)} TR (testte haber filtresi yoktu; giriş engellenmez)`);
  if (rat?.old) warns.push(`${esc(rat.text)} — seviyeleri CFD'de kontrol et${rat.block ? ' · WTI kartı ⏳ (oran haftalık zorunlu)' : ''}`);
  if (row.sameDir?.length) warns.push(`Aynı yönde ${row.sameDir.map(esc).join(', ')} pozisyonu da açık — bilgi (engellemez)`);
  const pf = App.data.star?.portfolio;
  const openPct = (pf?.open ?? []).filter((x) => x.riskOn).length * (L.riskPct ?? 0.5);
  if (openPct + L.riskPct > (App.conf.star?.common?.openRiskWarnPct ?? 3)) warns.push(`Toplam açık ⭐ risk %${(openPct + L.riskPct).toFixed(2)} > %3 — sarı uyarı (engellemez)`);
  const mt5On = getAdapter(App.settings).status() === 'CONNECTED';
  const side = `${dir === 1 ? 'BUY' : 'SELL'}${o.type === 'MARKET_NEXT_OPEN' ? ' (ertesi açılış)' : ''}`;
  const text = `${starName(App, id)} ${sym} ${side} ~${etf && rat?.ratio ? (o.ref_price * rat.ratio).toFixed(2) : o.ref_price.toFixed(dec)} SL ${etf && rat?.ratio ? (o.stop * rat.ratio).toFixed(2) : o.stop.toFixed(dec)}${o.t1 ? ` T1 ${etf && rat?.ratio ? (o.t1 * rat.ratio).toFixed(2) : o.t1.toFixed(dec)} (%50)` : ''} LOT ${L.lot ?? '—'} · çıkış: ${exitTxt.replace(/ \(şu an.*\)/, '')}`;
  return `<div class="order ${dir === 1 ? 'dl' : 'ds'}" data-star-order data-text="${esc(text)}">
    <div class="row" style="justify-content:space-between"><b>Emir kartı · ${esc(starName(App, id))} · ${esc(ins.label ?? sym)} ${dirHtml(dir)}</b><span class="muted small">MAGIC ${MAGIC[id] ?? '—'}</span></div>
    ${row.news ? `<div class="banner news" style="border-radius:10px">⚠ HABER RİSKİ — ${esc(row.news.title)} ${tr(row.news.t)} TR</div>` : ''}
    <div class="ogrid">
      <span class="k">Emir</span><span class="v mono">${esc(side)}</span><span class="d">${row.position?.entryT ? 'girildi (sanal)' : 'piyasa'}</span>
      <span class="k">Giriş</span><span class="v">~${cfd(o.ref_price)}</span><span class="d"></span>
      <span class="k" style="color:var(--short)">SL</span><span class="v">${cfd(o.stop)}</span><span class="d">${id === 'M2' || id === 'T4S' || id === 'TD' ? `${App.conf.star.setups[id].p.stopAtr} ATR` : ''}</span>
      ${o.t1 ? `<span class="k" style="color:var(--info)">T1 LIMIT</span><span class="v">${cfd(o.t1)}</span><span class="d">1,5R · %50 (stop emriyle birlikte gir)</span>` : '<span class="k">Hedef</span><span class="v">yok</span><span class="d">kâr alma yok</span>'}
      <span class="k">Çıkış</span><span class="v" style="font-size:.9rem;white-space:normal">${esc(exitTxt)}</span><span class="d"></span>
      <span class="k">Lot</span><span class="v">${L.lot ?? '—'}</span><span class="d">${parts.length === 2 ? `${parts[0]} (T1) + ${parts[1]}` : esc(L.note || '')}</span>
      <span class="k">Risk</span><span class="v">${L.riskReal ? `$${L.riskReal.toFixed(0)}` : '—'}</span><span class="d">%${L.riskPct}</span>
    </div>
    ${o.t1 ? '<div class="muted small">Aynı mum içinde hem stop hem T1 görülürse stop önce sayılır (testteki muhafazakâr varsayım — "aynı mum — stop önceliği").</div>' : ''}
    ${warns.map((w) => `<div class="warnline">⚠️ ${w}</div>`).join('')}
    <div class="btns">
      <button class="btn big primary" data-sact="copy">⧉ Kopyala</button>
      <button class="btn big mt5 ${dir === 1 ? 'l' : 's'} ${mt5On ? '' : 'off'}" data-sact="mt5" aria-disabled="${!mt5On}">📤 MT5'e Gönder</button>
      <button class="btn big" data-sact="entered">✔ Girdim</button>
      <button class="btn big" data-sact="skip">✖ Girmedim</button>
    </div></div>`;
}

function positionHtml(App, id, row) {
  const p = row.position;
  if (!p?.open) {
    const c = row.lastClosed;
    return c ? `<div class="card"><h3>Son ${esc(starName(App, id))} işlemi</h3><div>${dirHtml(c.dir)} ${dateTR(c.closedT)} ${tr(c.closedT)} TR · ${esc(c.reason ?? '')} · <b class="num ${c.r > 0 ? 'pos' : 'neg'}">${c.r > 0 ? '+' : ''}${c.r?.toFixed(2)}R</b></div></div>` : '';
  }
  const dec = App.data.star?.instruments?.[row.position.sym]?.decimals ?? 2;
  const f = (x) => price(x, dec);
  return `<div class="card live ${p.dir === 1 ? 'dl' : 'ds'}"><h3>Açık pozisyon (sanal, testteki gibi) ${dirHtml(p.dir)}</h3>
    <div class="ogrid"><span class="k">Giriş</span><span class="v">${f(p.entry ?? p.ref)}</span><span class="d">${p.entryT ? `${tr(p.entryT)} TR açılış` : 'sonraki açılış bekleniyor'}</span>
    <span class="k">Stop</span><span class="v">${f(p.stop)}</span><span class="d">${p.stopAtBe ? '<b>BE</b>' : ''}</span>
    ${p.t1 ? `<span class="k">T1</span><span class="v">${f(p.t1)}</span><span class="d">${p.t1Done ? '✅' : '⏳'}</span>` : ''}
    <span class="k">Anlık R</span><span class="v ${p.rNow > 0 ? 'pos' : p.rNow < 0 ? 'neg' : ''}">${p.rNow === null ? '—' : `${p.rNow > 0 ? '+' : ''}${p.rNow.toFixed(2)}R`}</span><span class="d"></span>
    ${p.t1 ? `<span class="k">Onay</span><span class="v" style="font-size:.9rem;white-space:normal">${starConfirm(App, p.id).t1order ? '✅ T1 limit emri girildi' : '<button class="btn" data-conf="t1order">T1 limit emri girildi mi? → Evet</button>'}</span><span class="d"></span>` : ''}
    ${p.t1Done ? `<span class="k">Stop → giriş</span><span class="v" style="font-size:.9rem;white-space:normal">${starConfirm(App, p.id).be ? '✅ stop girişe çekildi' : `<button class="btn primary" data-conf="be">Stopu ${f(p.entry)} yaptım</button>`}</span><span class="d">${starConfirm(App, p.id).be ? '' : '<b style="color:var(--short)">zorunlu onay</b>'}</span>` : ''}
    <span class="k">Çıkış seviyesi</span><span class="v">${f(p.exitLevel)}</span><span class="d">${p.exitPending ? '<b style="color:var(--short)">son kapanışta çıkış VAR — kalanı kapat</b>' : 'son kapanışta çıkış yok'}</span></div></div>`;
}

export function renderStarDetail(App, el, id, sym) {
  const st = App.data.star, cfg = App.conf.star?.setups?.[id];
  if (!st || !cfg) { el.innerHTML = '<div class="card">⭐ veri yok</div>'; return; }
  sym = cfg.symbols.includes(sym) ? sym : cfg.symbols[0];
  const row = st.setups?.[id]?.rows?.[sym];
  const ins = st.instruments?.[sym] ?? {};
  const chips = cfg.symbols.map((y) => { const r = st.setups?.[id]?.rows?.[y]; return `<button class="chip ${y === sym ? 'on' : ''}" data-go="#/star/${id}/${y}">${esc(st.instruments?.[y]?.label ?? y)} ${r ? rowBadge(r).replace('class="badge', 'class="badge sm') : ''}</button>`; }).join('');
  const setChips = STAR_IDS.map((k) => `<button class="chip ${k === id ? 'on' : ''}" data-go="#/star/${k}/${App.conf.star.setups[k].symbols.includes(sym) ? sym : App.conf.star.setups[k].symbols[0]}">${esc(starName(App, k))}</button>`).join('');
  if (!row || !st.setups[id].active) {
    el.innerHTML = `<div class="chips">${setChips}</div><div class="card" style="margin-top:10px">${esc(starName(App, id))} henüz devrede değil (sıradaki adımlarda eklenecek).</div>`;
    return;
  }
  const show = row.status === 'TAM' || row.status === 'TAM_BEKLE' || (row.position?.open && !row.position.entryT) || (row.position?.open && row.position.exitPending);
  const wtiBlock = ins.cls === 'etf' && starRatio(App, sym).block;
  el.innerHTML = `<div class="chips">${setChips}</div><div class="chips" style="margin-top:6px">${chips}</div>
    <div class="row" style="justify-content:space-between;margin:10px 0"><div class="h1" style="margin:0">${esc(starName(App, id))} · ${esc(ins.label ?? sym)} ${dirHtml(row.position?.dir ?? row.dir)}</div>${wtiBlock ? '<span class="badge yok">⏳ oran eski (WTI)</span>' : rowBadge(row)}</div>
    <div class="split"><div><div class="card" id="starchart"></div></div><div>
    <div class="card"><h3>Şartlar</h3><table class="tbl">${(row.conditions ?? []).map((c, i) => `<tr><td style="width:28px">${COND_ICON[c.status]}</td><td><b>${i + 1}. ${esc(c.label)}</b><div class="muted small">${esc(c.detail)}</div></td></tr>`).join('')}</table>
      ${row.status === 'EKSIK' && row.levels?.level ? `<div class="muted small" style="margin-top:6px">Kırılım seviyesi: <b class="num">${price(row.levels.level, ins.decimals)}</b>, fiyata uzaklık: <b class="num">${row.levels.distAtr?.toFixed(2) ?? '—'} ATR</b></div>` : ''}
      ${row.sameDir?.length ? `<div class="muted small" style="margin-top:6px">ℹ️ Aynı yönde açık: ${row.sameDir.map(esc).join(', ')} (engellemez)</div>` : ''}</div>
    ${show && !wtiBlock ? orderHtml(App, id, sym, row) : ''}
    ${positionHtml(App, id, { ...row, position: row.position ? { ...row.position, sym } : null })}
    <details class="card"><summary class="muted small">Çıktı (JSON, şartname §8)</summary><pre class="code small">${esc(JSON.stringify(row.json, null, 1))}</pre></details>
    </div></div>`;
  // Grafik
  const ch = el.querySelector('#starchart');
  const p = row.position, o = row.order;
  const overlays = [];
  const add = (v, style, label) => { if (Number.isFinite(v)) overlays.push({ kind: 'line', style, label, price: v }); };
  if (p?.open) { add(p.entry ?? p.ref, 'entry', 'Giriş'); add(p.stop, 'stop', p.stopAtBe ? 'Stop (BE)' : 'Stop'); add(p.t1, 'tp', 'T1'); }
  else if (o) { add(o.ref_price, 'entry', 'Giriş ~'); add(o.stop, 'stop', 'Stop'); add(o.t1, 'tp', 'T1'); }
  loadChart(`star/${id}_${sym}`).then((cd) => {
    if (!ch.isConnected) return;
    App.chartCtl?.destroy?.();
    App.chartCtl = mountChart(ch, { chartData: cd, setup: { tfs: [cfg.tf], chartTf: cfg.tf, overlays, dir: p?.dir ?? row.dir }, sessions: App.conf.sessions, layers: App.settings.layers, onLayers: () => App.save(), tf: cfg.tf, onTf: () => {}, asOf: st.lastScan });
  });
  el.querySelectorAll('[data-conf]').forEach((b) => b.addEventListener('click', () => { setStarConfirm(App, row.position.id, b.dataset.conf); toast('Onaylandı'); App.render(); }));
  // Emir kartı
  const card = el.querySelector('[data-star-order]');
  if (!card) return;
  const dir = p?.dir ?? row.dir, sigId = row.signalId ?? p?.id;
  card.querySelector('[data-sact="copy"]').addEventListener('click', () => copy(card.dataset.text));
  card.querySelector('[data-sact="mt5"]').addEventListener('click', () => toast(MT5_OFF_MSG, 3500));
  card.querySelector('[data-sact="skip"]').addEventListener('click', () => {
    skipped.put({ signal_id: sigId, t: Date.now(), reason: 'DIGER', reasonText: 'Girmedim', note: '', strategy: id, symbol: sym, dir, entry: o?.ref_price ?? p?.ref, stop: o?.stop ?? p?.stop, tp1: o?.t1 ?? null, tp2: null, signalAt: p?.signalT ?? null, lastEntry: null, virtual_result_r: null, warnings: [] });
    App.skipped = skipped.map(); toast('Kaydedildi'); App.render();
  });
  card.querySelector('[data-sact="entered"]').addEventListener('click', () => {
    const plan = o?.ref_price ?? p?.entry ?? p?.ref, stop = o?.stop ?? p?.stop, t1 = o?.t1 ?? p?.t1 ?? null;
    const L = starLot(App, sym, plan, stop);
    const dec = ins.decimals ?? 2;
    modal(`<h3>Girdim — ${esc(starName(App, id))} ${esc(ins.label ?? sym)} ${dir === 1 ? '▲ LONG' : '▼ SHORT'}</h3>
      <div class="form"><div class="field"><label>Gerçek giriş fiyatı${ins.cls === 'etf' ? ' (ETF fiyatı cinsinden)' : ''}</label><input id="fe" type="number" step="any" value="${Number(plan).toFixed(dec)}" style="min-height:48px"></div>
      <div class="field"><label>Lot</label><input id="fl" type="number" step="any" value="${L.lot ?? ''}" style="min-height:48px"></div>
      <div class="field"><label>Spread (fiyat)</label><input id="fs" type="number" step="any" value="" placeholder="opsiyonel" style="min-height:48px"></div></div>
      <div class="btns"><button class="btn primary big" data-ok>Kaydet</button></div>`, (sh, close) => {
      sh.querySelector('[data-ok]').addEventListener('click', async () => {
        const e = Number(sh.querySelector('#fe').value), lot = sh.querySelector('#fl').value === '' ? null : Number(sh.querySelector('#fl').value);
        const spread = sh.querySelector('#fs').value === '' ? null : Number(sh.querySelector('#fs').value);
        if (!(e > 0)) return toast('Giriş fiyatı gir');
        const R = Math.abs(plan - stop);
        // Kayma (R): gerçek giriş − planlanan giriş, aleyhte pozitif (§10)
        const slipR = R > 0 ? +((dir * (e - plan)) / R).toFixed(3) : null;
        await trades.put({ id: `${Date.now()}`, t: Date.now(), strategy: id, star: true, symbol: sym, dir, sub: App.conf.star.setups[id].title, method: 'market', signal_id: sigId, setupId: sigId,
          signalBar: p?.signalT ?? null, suggested: { entry: plan, stop, tp1: t1, lot: L.lot, type: 'market' }, plannedEntry: plan,
          entry: e, stop, tp1: t1, tp2: null, rr: t1 ? 1.5 : 0, lot, riskUsd: +(L.riskReal ?? L.riskUsd ?? 0).toFixed(2), slipR, spread, ratio: L.ratio,
          note: '', result: null, r: null, exitReason: null, events: [] });
        close(); toast(`Günlüğe kaydedildi · kayma ${slipR ?? '—'}R`); App.go('#/gunluk');
      });
    });
  });
}
