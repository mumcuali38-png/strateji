import { STRATS, TABS, SHORT } from './config.js';
import { badge, unmet, COND_ICON, dirTxt, dirCls, esc, price, pct, tr, ny, trny, dur, nyDayStart, parseHM, MIN, DAY, STATUS, dayNameTR } from './fmt.js';
import { recompute, us100Ratio } from './calc.js';
import { mountChart } from './chart.js';
import { chart as loadChart } from './data.js';
import { copy, modal, toast } from './ui.js';
import { trades, skipped } from './store.js';
import { buildOrder, orderCardHtml, SKIP_REASONS } from './order.js';
import { starOverview } from './star.js';
import { getAdapter, MT5_OFF_MSG } from './broker.js';

const ORDER = { TAM: 0, BEKLE: 1, EKSIK: 2, YOK: 3 };
export const rank = (a, b) => (ORDER[a.status] - ORDER[b.status]) || (a.status === 'YOK' ? unmet(a).total - unmet(b).total : a.remaining - b.remaining) || ((b.stars ?? 0) - (a.stars ?? 0));

export function setupsOf(App, s, sym) { return (App.data.state?.strategies?.[s]?.[sym] ?? []).map((x) => App.effective(x)); }
export function bestOf(App, s, sym) { return setupsOf(App, s, sym).sort(rank)[0]; }
export function allSetups(App) {
  const out = [];
  for (const [s, by] of Object.entries(App.data.state?.strategies ?? {})) for (const [sym, list] of Object.entries(by)) for (const x of list) out.push(App.effective(x));
  return out;
}
export function tabBest(App, tab) {
  let best = null, tam = 0;
  for (const s of tab.strategies) for (const sym of tab.symbols) {
    for (const x of setupsOf(App, s, sym)) { if (x.status === 'TAM' || x.status === 'BEKLE') tam++; if (!best || rank(x, best) < 0) best = x; }
  }
  return { best, tam };
}
const symCfg = (App, sym) => App.conf.symbols?.[sym] ?? { decimals: 2, contract: 1, buffer: 0, bufferType: 'abs', spread: 0 };
const dec = (App, sym) => symCfg(App, sym).decimals ?? 2;
function priceTxt(App, sym, x) {
  const p = price(x, dec(App, sym));
  if (sym !== 'US100' || !Number.isFinite(x)) return p;
  const { ratio, user } = us100Ratio(App.settings, App.data.state);
  return user ? `${p} <span class="muted small">(US100 ≈ ${(x * ratio).toFixed(0)})</span>` : p;
}

/* ---------- ÖZET ---------- */
export function renderOverview(App, el) {
  const st = App.data.state;
  if (!st) { el.innerHTML = noData(App); return; }
  const all = allSetups(App);
  const tams = all.filter((x) => x.status === 'TAM' || x.status === 'BEKLE').sort(rank);
  const near = all.filter((x) => x.status === 'EKSIK' && x.remaining === 1).length;
  const symbols = ['XAUUSD', 'EURUSD', 'GBPUSD', 'US100', 'BTCUSD', 'ETHUSD'];
  const nowHtml = tams.length
    ? `<div class="now-strip">${tams.map((s) => tamCard(App, s)).join('')}</div>`
    : `<div class="card now-empty">Şu an TAM setup yok · ${near ? `<span style="color:var(--eksik)">${near} setup 1 şart uzakta</span>` : 'yakın setup yok'}</div>`;
  const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((s) => `<tr><th class="s">${STRATS[s].short}<div class="muted small">${esc(STRATS[s].name.split('· ')[1] ?? '')}</div></th>${symbols.map((sym) => {
    const applicable = (App.conf.symbols?.[sym]?.strategies ?? []).includes(s);
    if (!applicable) return '<td><div class="cell na">·</div></td>';
    const b = bestOf(App, s, sym);
    const news = st.symbols?.[sym]?.newsRisk?.active;
    if (!b) return `<td><div class="cell yok ${news ? 'news' : ''}" data-go="#/${s}/${sym}">—</div></td>`;
    const cls = STATUS[b.status].cls;
    const txt = b.status === 'TAM' ? '🔵 TAM' : b.status === 'BEKLE' ? '🟠 BEKLE' : b.status === 'EKSIK' ? `🟡 ${b.remaining}` : unmet(b).total ? `⚪ ${unmet(b).total}` : '⚪';
    return `<td><div class="cell ${cls} ${news ? 'news' : ''}" data-go="#/${s}/${sym}/${encodeURIComponent(b.id)}" title="${esc(b.sub)}">${txt}</div></td>`;
  }).join('')}</tr>`).join('');
  const sorted = symbols.flatMap((sym) => ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((s) => bestOf(App, s, sym)).filter(Boolean)).sort(rank).slice(0, 8);
  el.innerHTML = `
    <div class="h1">Şu an</div>${nowHtml}
    <div class="card"><h2>Durum ızgarası</h2>
      <div class="tbl-wrap"><table class="matrix"><thead><tr><th></th>${symbols.map((s) => `<th>${SHORT[s]}${st.symbols?.[s]?.newsRisk?.active ? ' 🔴' : ''}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
      <div class="muted small">🔵 TAM · 🟠 TAM–BEKLE · 🟡 N = kalan şart · ⚪ N = YOK, sağlanmayan şart · 🔴 haber riski · boş = uygulanmaz · yön: <span style="color:var(--long)">▲ LONG</span> / <span style="color:var(--short)">▼ SHORT</span></div>
    </div>
    ${starOverview(App)}
    <div class="card"><h2>Yakın setuplar</h2><div class="list">${sorted.map((s) => `<div class="li" data-go="#/${s.strategy}/${s.symbol}/${encodeURIComponent(s.id)}">${badge(s)}<div class="grow"><b>${SHORT[s.symbol]} ${s.strategy}</b> · ${esc(s.sub)}<div class="muted small">${esc(s.status === 'YOK' ? s.none?.why ?? '' : s.missing ?? 'Tüm şartlar sağlandı')}</div></div></div>`).join('') || '<div class="empty">Setup yok</div>'}</div></div>
    <div class="grid2" style="margin-top:12px">
      <div class="card"><h2>Sıradaki kırmızı haberler</h2>${nextNews(App, 3)}</div>
      <div class="card"><h2>Sıradaki pencereler</h2>${nextWindows(App)}</div>
    </div>`;
}
function tamCard(App, s) {
  const cfg = symCfg(App, s.symbol);
  const m0 = s.methods.find((m) => m.id === s.defaultMethod) ?? s.methods[0];
  const m = m0 ? recompute(m0, s, cfg, App.settings, App.data.state) : null;
  return `<div class="card tam-card ${dirCls(s.dir)}" data-go="#/${s.strategy}/${s.symbol}/${encodeURIComponent(s.id)}">
    <div class="row"><span class="dir ${s.dir === 1 ? 'long' : 'short'}">${dirTxt(s.dir)}</span><span class="big">${SHORT[s.symbol]} · ${s.strategy}</span>${badge(s)}${m?.tag ? `<span class="tag aggr">${m.tag}</span>` : ''}</div>
    <div class="muted" style="margin:6px 0">${esc(s.sub)}</div>
    ${m ? `<div class="kv"><span>Giriş <b>${price(m.entry, cfg.decimals)}</b></span><span>SL <b>${price(m.stop, cfg.decimals)}</b></span><span>TP <b>${price(m.tp1, cfg.decimals)}</b></span><span>RR <b>${m.rr.toFixed(2)}</b>${m.rr2 !== undefined ? ` · TP2 <b>${m.rr2.toFixed(2)}</b>` : ''}</span><span>Lot <b>${m.lotOk ? m.lot.toFixed(2) : '—'}</b></span></div>${m.lotOk ? '' : `<div class="warnline">⚙️ ${esc(m.lotNote)}</div>`}` : ''}
  </div>`;
}
export function nextNews(App, n) {
  const ev = (App.data.news?.events ?? []).filter((e) => e.impact === 'High' && e.t > Date.now() - 15 * MIN).sort((a, b) => a.t - b.t).slice(0, n);
  if (!ev.length) return '<div class="empty">Yakın kırmızı haber yok</div>';
  return `<div class="list">${ev.map((e) => `<div class="li"><span class="badge news">🔴 ${esc(e.currency)}</span><div class="grow"><b>${esc(e.title)}</b><div class="muted small">${dayNameTR(e.t)} ${tr(e.t)} TR · ${ny(e.t)} NY</div></div><span class="num">${e.t > Date.now() ? dur(e.t - Date.now()) : 'şimdi'}</span></div>`).join('')}</div>`;
}
export function nextWindows(App) {
  const s = App.conf.sessions;
  if (!s) return '';
  const now = Date.now();
  const items = [];
  for (let d = 0; d < 3; d++) {
    const base = nyDayStart(now) + d * DAY;
    const dow = new Date(base + 12 * 3600000).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (const k of s.killzones) items.push({ name: k.name, at: base + parseHM(k.start) * MIN, end: base + parseHM(k.end) * MIN });
    items.push({ name: 'D1 açılış range', at: base + parseHM(s.D1.rangeStart) * MIN, end: base + parseHM(s.D1.entryEnd) * MIN });
    items.push({ name: 'C penceresi (TNM)', at: base + parseHM(s.C.start) * MIN, end: base + parseHM(s.C.end) * MIN });
  }
  const list = items.filter((i) => i.end > now).sort((a, b) => a.at - b.at).slice(0, 4);
  return `<div class="list">${list.map((i) => `<div class="li"><div class="grow"><b>${i.name}</b><div class="muted small">${tr(i.at)}–${tr(i.end)} TR</div></div><span class="num">${i.at <= now ? '<span style="color:var(--tam)">açık</span> · ' + dur(i.end - now) + ' kaldı' : dur(i.at - now)}</span></div>`).join('')}</div>`;
}
export function noData(App) {
  return `<div class="card"><h2>Henüz tarama verisi yok</h2><p class="muted">Veri adresi: <span class="mono small">${esc(App.dataBase)}</span></p>
  <p>GitHub → Actions → <b>scan</b> iş akışını bir kez elle çalıştırın. İlk tarama tamamlanınca veriler burada görünür.</p>
  <div class="btns"><a class="btn primary" href="${App.links.actions}" target="_blank" rel="noopener">Actions'ı aç</a><button class="btn" data-refresh>Yeniden dene</button></div></div>`;
}

/* ---------- STRATEJİ SEKMESİ ---------- */
export function renderStrategy(App, el, tabId, params) {
  const tab = TABS.find((t) => t.id === tabId);
  const st = App.data.state;
  if (!st) { el.innerHTML = noData(App); return; }
  // Seçim: AB sekmesinde çipler strateji, diğerlerinde sembol
  const chipsAreStrats = tab.strategies.length > 1;
  let strat = params.s && tab.strategies.includes(params.s) ? params.s : tab.strategies[0];
  let sym = params.sym && tab.symbols.includes(params.sym) ? params.sym : null;
  if (!sym) {
    if (chipsAreStrats) sym = tab.symbols[0];
    else sym = [...tab.symbols].sort((a, b) => { const x = bestOf(App, strat, a), y = bestOf(App, strat, b); return x && y ? rank(x, y) : x ? -1 : 1; })[0];
  }
  if (chipsAreStrats && !params.s) {
    const a = bestOf(App, 'A', sym), b = bestOf(App, 'B', sym);
    strat = a && b && rank(b, a) < 0 ? 'B' : 'A';
  }
  const list = setupsOf(App, strat, sym).sort(rank);
  const sel = list.find((x) => x.id === params.id) ?? list[0];
  const chips = chipsAreStrats
    ? tab.strategies.map((s) => { const b = bestOf(App, s, sym); return `<button class="chip ${s === strat ? 'on' : ''}" data-go="#/${s}/${sym}"><span class="dot ${b ? STATUS[b.status].cls : ''}"></span>${esc(STRATS[s].name)}${b?.status === 'EKSIK' ? ` <span class="pill">${b.remaining}</span>` : b?.status === 'YOK' && unmet(b).total ? ` <span class="pill yok">${unmet(b).total}</span>` : ''}</button>`; }).join('')
    : tab.symbols.map((y) => { const b = bestOf(App, strat, y); return `<button class="chip ${y === sym ? 'on' : ''}" data-go="#/${strat}/${y}"><span class="dot ${b ? STATUS[b.status].cls : ''}"></span>${App.conf.symbols?.[y]?.label ?? y}${b?.status === 'EKSIK' ? ` <span class="pill">${b.remaining}</span>` : b?.status === 'YOK' && unmet(b).total ? ` <span class="pill yok">${unmet(b).total}</span>` : ''}${st.symbols?.[y]?.newsRisk?.active ? ' 🔴' : ''}</button>`; }).join('');
  const cands = list.length > 1 ? `<div class="cands">${list.map((x) => `<button class="cand ${x === sel ? 'on' : ''}" data-go="#/${strat}/${sym}/${encodeURIComponent(x.id)}">${badge(x)}<div class="small" style="margin-top:4px">${esc(x.sub)} · ${dirTxt(x.dir)}</div></button>`).join('')}</div>` : '';
  const sp = st.symbols?.[sym];
  const newsLine = sp?.newsRisk ? `<div class="${sp.newsRisk.active ? 'banner news' : 'muted small'}" style="border-radius:10px;margin-bottom:10px">${sp.newsRisk.active ? '🔴 ' : '📰 '}${esc(sp.newsRisk.text)}</div>` : '';
  el.innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:8px"><div class="h1" style="margin:0">${esc(STRATS[strat].name)} · ${esc(App.conf.symbols?.[sym]?.label ?? sym)}</div>
      <div class="muted num">Fiyat ${priceTxt(App, sym, sp?.price)}</div></div>
    <div class="chips" id="chips">${chips}</div>
    ${newsLine}${cands}
    ${sel ? `<div class="split"><div class="chart-wrap" id="chart"></div><div>${condTable(sel)}<div style="height:12px"></div>${sel.status === 'YOK' ? noneBox(App, sel) : setupCard(App, sel)}</div></div>` : `<div class="card empty">Bu sembolde aktif setup yok · sonraki kontrol ${nextScanTxt(App)}</div>`}`;
  // kaydırarak sembol değiştir
  swipe(el.querySelector('#chips'), el, (d) => {
    const ids = chipsAreStrats ? tab.strategies : tab.symbols;
    const curI = ids.indexOf(chipsAreStrats ? strat : sym);
    const nx = ids[(curI + d + ids.length) % ids.length];
    App.go(chipsAreStrats ? `#/${nx}/${sym}` : `#/${strat}/${nx}`);
  });
  if (!sel) return;
  if (App.flashIds.has(sel.id)) el.querySelector('.setup-card, .nonebox')?.classList.add('flash');
  const chartEl = el.querySelector('#chart');
  chartEl.innerHTML = '<div class="empty">Grafik yükleniyor…</div>';
  loadChart(sel.chartKey ?? sym).then((cd) => {
    if (!chartEl.isConnected) return;
    App.chartCtl?.destroy?.();
    App.chartCtl = mountChart(chartEl, { chartData: cd, setup: sel, sessions: App.conf.sessions, layers: App.settings.layers, onLayers: () => App.save(), tf: App.settings.chartTf || undefined, onTf: () => {}, asOf: st.lastScan });
  });
  el.querySelectorAll('.cond').forEach((r) => r.addEventListener('click', () => {
    el.querySelectorAll('.cond').forEach((x) => x.classList.remove('sel'));
    r.classList.add('sel');
    const lvl = r.dataset.level ? Number(r.dataset.level) : null;
    App.chartCtl?.highlight(lvl ?? r.dataset.cond);
  }));
  wireCard(App, el, sel);
}
function nextScanTxt(App) { const t = App.data.state?.lastScan; return t ? tr(t + 5 * MIN) : '—'; }
function swipe(chips, el, cb) {
  let x0 = null, y0 = null;
  const area = el.querySelector('.split') ?? el;
  area.addEventListener('touchstart', (e) => { if (e.target.closest('.chart-box')) return; x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  area.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 90 && Math.abs(dy) < 40) cb(dx < 0 ? 1 : -1);
  });
}
function condTable(s) {
  return `<div class="card"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Şart tablosu</h3>${badge(s)}</div>
    <div class="conds" style="margin-top:8px">${s.conditions.map((c) => `<div class="cond" data-cond="${esc(c.id)}" ${c.level !== undefined ? `data-level="${c.level}"` : ''} role="button" tabindex="0"><span>${COND_ICON[c.status]}</span><div><div class="lb">${esc(c.label)}</div><div class="dt">${esc(c.detail)}</div></div></div>`).join('')}</div>
    <div class="muted small" style="margin-top:6px">Değerlendirme ${tr(s.evaluatedAt)} TR · satıra dokun → grafikte seviye</div></div>`;
}
function noneBox(App, s) {
  return `<div class="card nonebox"><h3>⚪ Setup yok</h3><dl>
    <dt>Neden yok</dt><dd>${esc(s.none?.why ?? '—')}</dd>
    <dt>Ne bekleniyor</dt><dd>${esc(s.none?.waiting ?? '—')}</dd>
    <dt>Senaryo ne zaman biter</dt><dd>${esc(s.none?.ends ?? s.invalidation ?? '—')}</dd></dl>
    ${s.limitNote ? `<div class="inval">${esc(s.limitNote)}</div>` : ''}
    ${gBox(s)}
    ${extraHtml(s)}
    <div class="btns"><button class="btn" data-act="claude">🤖 Claude'a gönder</button></div></div>`;
}
function methodOf(App, s) {
  const key = `${s.id}`;
  const id = App.methodSel[key] ?? s.defaultMethod ?? s.methods[0]?.id;
  return s.methods.find((m) => m.id === id) ?? s.methods[0];
}
function setupCard(App, s) {
  const cfg = symCfg(App, s.symbol);
  const m0 = methodOf(App, s);
  if (!m0) return `<div class="card setup-card"><h3>${badge(s)} ${esc(s.sub)}</h3><div class="muted">${esc(s.missing ?? '')}</div>${extraHtml(s)}<div class="btns"><button class="btn" data-act="claude">🤖 Claude'a gönder</button></div></div>`;
  const m = recompute(m0, s, cfg, App.settings, App.data.state);
  const d = cfg.decimals;
  const dist = (x) => `${price(Math.abs(x - m.entry), d)} · ${pct(x, m.entry)}`;
  const rrWarn = s.status === 'TAM' && m.rr < (App.data.state?.params?.risk?.minRR ?? 2) ? `<div class="warnline">⚠️ Ayarlarındaki tamponla RR ${m.rr.toFixed(2)} &lt; 2</div>` : '';
  const preview = s.status !== 'TAM' ? '<span class="tag">ÖNİZLEME</span>' : '';
  return `<div class="card setup-card ${dirCls(s.dir)}">
    <div class="row"><span class="dir ${s.dir === 1 ? 'long' : 'short'}">${dirTxt(s.dir)}</span><div><b>${s.strategy} · ${esc(s.sub)}</b> ${preview} ${m.tag ? `<span class="tag aggr">${m.tag}</span>` : ''}<div class="muted small">${s.status === 'EKSIK' ? 'Tamamlanırsa olası giriş-stop-hedef' : s.signalAt ? `Sinyal ${tr(s.signalAt)} TR` : ''}</div></div>${s.stars ? `<span class="stars" title="${esc((s.tags ?? []).join(', '))}">${'★'.repeat(s.stars)}${'☆'.repeat(Math.max(0, 4 - s.stars))}</span>` : ''}</div>
    ${s.methods.length > 1 ? `<div class="seg" style="margin-top:10px">${s.methods.map((x) => `<button class="seg-b ${x.id === m.id ? 'on' : ''}" data-method="${x.id}" title="${esc(x.note ?? '')}">${esc(x.label)}${x.id === s.defaultMethod ? ' •' : ''}</button>`).join('')}</div>` : `<div class="muted small" style="margin-top:8px">${esc(m.label)}</div>`}
    <div class="levels">
      <span class="k">Giriş</span><span class="v">${priceTxt(App, s.symbol, m.entry)}</span><span class="d">${m.type === 'limit' ? 'limit' : 'piyasa'}</span>
      <span class="k" style="color:var(--short)">Stop</span><span class="v">${priceTxt(App, s.symbol, m.stop)}</span><span class="d">${dist(m.stop)}</span>
      <span class="k" style="color:var(--info)">TP1</span><span class="v">${priceTxt(App, s.symbol, m.tp1)}</span><span class="d">${dist(m.tp1)}</span>
      ${m.tp2 !== undefined ? `<span class="k" style="color:var(--info)">TP2</span><span class="v">${priceTxt(App, s.symbol, m.tp2)}</span><span class="d">${dist(m.tp2)}</span>` : ''}
      ${m.tp3 !== undefined ? `<span class="k" style="color:var(--info)">TP3</span><span class="v">${priceTxt(App, s.symbol, m.tp3)}</span><span class="d">${dist(m.tp3)}</span>` : ''}
    </div>
    <div class="kv"><span>RR <b>${m.rr.toFixed(2)}</b>${m.rr2 !== undefined ? ` / ${m.rr2.toFixed(2)}` : ''}${m.rr3 !== undefined ? ` / ${m.rr3.toFixed(2)}` : ''}</span><span>Risk <b>$${m.riskUsd.toFixed(0)}</b></span><span>Lot <b>${m.lotOk ? m.lot.toFixed(2) : '—'}</b>${m.lotOk ? ` <span class="muted small">(${esc(m.ins.brokerSymbol)})</span>` : ''}</span>${s.strategy === 'F' && m.lotOk ? `<span>Kaldıraç <b>${m.leverage.toFixed(2)}x</b></span>` : ''}</div>
    ${m.lotNote ? `<div class="warnline">⚙️ ${esc(m.lotNote)}${m.lotOk ? '' : ' <a href="#/ayarlar">Ayarlar</a>'}</div>` : ''}
    ${m.capNote ? `<div class="warnline">⚠️ ${esc(m.capNote)}</div>` : ''}
    ${m.note ? `<div class="muted small" style="margin-top:6px">${esc(m.note)}</div>` : ''}
    ${s.strategy === 'F' || s.strategy === 'G' ? '' : rrWarn}
    ${fBox(s)}${gBox(s)}${hBox(App, s)}
    ${s.invalidation ? `<div class="inval">Geçersiz olur: ${esc(s.invalidation)}</div>` : ''}
    ${(s.warnings ?? []).map((w) => `<div class="warnline">⚠️ ${esc(w)}</div>`).join('')}
    ${s.missing ? `<div class="warnline">⏳ Eksik: ${esc(s.missing)}</div>` : ''}
    ${extraHtml(s)}
    ${s.status === 'TAM' || s.status === 'BEKLE' ? orderCardHtml(App, s, buildOrder(App, s, m, cfg)) + '<div class="btns"><button class="btn" data-act="copy">⧉ Kartı metin olarak kopyala</button><button class="btn" data-act="claude">🤖 Claude\'a gönder</button></div>' : '<div class="btns"><button class="btn primary big" data-act="entered">✔ İşleme girdim</button><button class="btn big" data-act="copy">⧉ Kopyala</button><button class="btn big" data-act="claude">🤖 Claude\'a gönder</button></div>'}
  </div>`;
}
/** F: faz, kalite, saat bilgisi (sonraki funding, hafta sonu, en iyi pencere) */
function fBox(s) {
  const f = s.info?.f;
  if (s.strategy !== 'F' || !f) return '';
  const c = f.clock ?? {};
  return `<div class="fbox">
    <b>Faz</b><span>${esc(f.tr?.phase ?? '—')}${f.tr?.stale ? ' · TR eski' : ''}</span>
    <b>HTF bölge</b><span>${f.htf_zone ? `${esc(f.htf_zone.tf.toUpperCase())} ${esc(f.htf_zone.type)} ${f.htf_zone.low.toFixed(1)}–${f.htf_zone.high.toFixed(1)} · ${esc(f.htf_zone.quality ?? '')}` : '—'}</span>
    <b>Olaylar</b><span>${['SC', 'AR', 'ST'].filter((k) => f.tr?.events?.[k]).join(' · ') || '—'}</span>
    <b>Funding</b><span>sıradaki ${c.nextFunding ? tr(c.nextFunding) + ' TR' : '—'}</span>
    <b>Saat</b><span>${c.saturday ? 'Cumartesi — yeni giriş yok' : c.sunday ? 'Pazar — teyit gerekir' : 'Hafta içi'} · ${c.inBestWindow ? 'en iyi pencerede' : 'pencere dışı (15:30–19:00 TR)'}</span>
    <b>Kaynak</b><span>${esc(f.source ?? '—')} (BTCUSDT) · ${tr(Date.parse(f.evaluated_at_utc))} TR</span>
  </div>`;
}
/** G: günün seviyeleri, bias bileşenleri ve zaman çubuğu (TR) */
/** H: trend / geri çekilme / tetik / koruma satırları (EK H §13) */
function hBox(App, s) {
  const h = s.info?.h;
  if (s.strategy !== 'H' || !h || !h.trend) return '';
  const d = App.conf.symbols?.[s.symbol]?.decimals ?? 2;
  const p = (x) => (Number.isFinite(x) ? Number(x).toFixed(d) : '—');
  const pb = h.pullback ?? {}, tg = h.trigger ?? {}, pr = h.protection ?? {};
  const left = tg.validUntil && !h.filled ? Math.max(0, tg.validUntil - Date.now()) : null;
  const us = h.us100;
  const ratioWarn = us && Number(App.settings.us100Price) > 0 && Math.abs(us.us100 - Number(App.settings.us100Price)) / Number(App.settings.us100Price) > 0.01;
  return `<div class="fbox">
    <b>Trend</b><span>Günlük ✅ · 4H ✅ · ADX ${Number.isFinite(h.trend.adx) ? h.trend.adx.toFixed(1) : '—'} ${h.trend.rising ? '↑' : '↓'}</span>
    <b>Geri çekilme</b><span>${pb.k ? `${pb.k}. · derinlik %${(pb.depth * 100).toFixed(0)} · RSI min ${Number(pb.rsiMin).toFixed(1)}${pb.ote ? ' · OTE' : ''} · H0 ${p(pb.H0)} / L0 ${p(pb.L0)}` : '—'}</span>
    <b>Tetik</b><span>${tg.lh !== undefined ? `${tg.type === 'HOLY_GRAIL' ? 'Holy Grail' : '15m kırılım'} ${p(tg.lh)} · ${h.filled ? 'limit DOLDU' : left !== null ? `geçerli <span class="num">${dur(left)}</span>` : '—'}` : '—'}</span>
    <b>Koruma</b><span>${pr.confirming ? 'Teyit 1/2' : 'Teyit 2/2'} · veri taze${pr.blocks?.length ? ' · ' + pr.blocks.map(esc).join(' · ') : ''}${pr.conflict?.length ? ' · <b>ÇAKIŞMA</b>' : ''}</span>
    <b>Kalite</b><span>${esc(h.qualityText ?? 'normal')}${h.flags?.length ? ' · ' + h.flags.map(esc).join(', ') : ''}</span>
    ${us ? `<b>US100</b><span>QQQ ${p(us.qqq)} × ${Number(us.ratio).toFixed(2)} ≈ ${Number(us.us100).toFixed(0)}${ratioWarn ? ' · <b style="color:var(--eksik)">10.13 oran güncelle</b> (Ayarlar → US100 fiyatı ile %1+ fark)' : ''}</span>` : ''}
  </div>`;
}
function gBox(s) {
  const g = s.info?.g;
  if (s.strategy !== 'G' || !g?.levels) return '';
  const L = g.levels, b = g.bias ?? {};
  const p = (x) => (Number.isFinite(x) ? Number(x).toFixed(2) : '—');
  const ok = (v) => (v ? '✅' : '❌');
  const mo = g.mo, t0 = mo - 4 * 3600000, t1 = mo + 12 * 3600000;
  const pos = (t) => Math.max(0, Math.min(100, ((t - t0) / (t1 - t0)) * 100));
  const ticks = [[t0, 'Asya'], [mo, 'MO'], [mo + 2 * 3600000, 'süpürme'], [mo + 4 * 3600000, 'süp. son'], [mo + 5 * 3600000, 'son giriş'], [t1, 'kapanış']];
  return `<div class="fbox">
    <b>Asya</b><span class="num">AH ${p(L.AH)} · AL ${p(L.AL)} · AR ${p(L.AR)}</span>
    <b>MO</b><span class="num">${p(L.MO)} · ADR20 ${p(L.ADR)}</span>
    <b>Dün / hafta</b><span class="num">PDH ${p(L.PDH)} · PDL ${p(L.PDL)} · WEQ ${p(L.WEQ)}</span>
    <b>Bias</b><span>${esc(b.value ?? '—')} · B1 4H EMA ${b.b1 === 1 ? 'LONG' : b.b1 === -1 ? 'SHORT' : '—'} · B2 ${b.b2 === 1 ? 'DISCOUNT' : 'PREMIUM'} · B3 ${b.b3?.long ? 'LONG ' + esc(b.b3.long) : ''}${b.b3?.short ? ' SHORT ' + esc(b.b3.short) : ''}</span>
    <b>Kalite</b><span>${esc(g.quality ?? '—')}${g.flags?.length ? ' · ' + g.flags.map(esc).join(', ') : ''}</span>
  </div>
  <div class="tline" aria-label="Günün zaman çubuğu (TR)">
    <div class="bar"></div><div class="seg" style="left:${pos(mo + 2 * 3600000)}%;width:${pos(mo + 5 * 3600000) - pos(mo + 2 * 3600000)}%"></div>
    ${ticks.map(([t, l], i) => `<div class="tk ${i % 2 ? 'lo' : ''}" style="left:${pos(t)}%">${tr(t)}<br>${l}</div>`).join('')}
    <div class="now" style="left:${pos(Date.now())}%" title="şimdi"></div>
  </div>`;
}
function extraHtml(s) {
  if (!s.extra) return '';
  const col = { Var: 'var(--tam)', Ters: 'var(--short)', Yok: 'var(--muted)' }[s.extra.summary];
  return `<details class="extra"><summary>Ek teyit: <b style="color:${col}">${s.extra.summary}</b> <span class="muted small">(kurulumu değiştirmez)</span></summary>
    ${s.extra.items.map((i) => `<div>${i.sign === 1 ? '➕' : i.sign === -1 ? '➖' : '▫️'} <b>${esc(i.name)}</b> <span class="muted">${esc(i.detail)}</span></div>`).join('')}</details>`;
}
export function setupText(App, s, forClaude) {
  const cfg = symCfg(App, s.symbol);
  const m0 = methodOf(App, s);
  const m = m0 ? recompute(m0, s, cfg, App.settings, App.data.state) : null;
  const d = cfg.decimals;
  const st = STATUS[s.status];
  const lines = [
    `[Strateji Radar] ${s.strategy} · ${cfg.label ?? s.symbol} · ${s.sub} — ${st.icon} ${st.text}${s.status === 'EKSIK' ? ` (${s.remaining} şart kaldı)` : ''}`,
    `Zaman: ${trny(s.evaluatedAt)}${s.symbol === 'US100' ? ' · seviyeler QQQ fiyatıdır' : ''}`,
  ];
  if (forClaude || s.status !== 'TAM') { lines.push('Şartlar:'); for (const c of s.conditions) lines.push(`${COND_ICON[c.status]} ${c.label} — ${c.detail}`); }
  if (m) lines.push(`Kart: ${dirTxt(s.dir)} · ${m.label} · Giriş ${price(m.entry, d)} · Stop ${price(m.stop, d)} · TP1 ${price(m.tp1, d)}${m.tp2 !== undefined ? ` · TP2 ${price(m.tp2, d)}` : ''}${m.tp3 !== undefined ? ` · TP3 ${price(m.tp3, d)}` : ''} · RR ${m.rr.toFixed(2)}${m.rr3 !== undefined ? `/${m.rr3.toFixed(2)}` : ''} · ${m.lotOk ? `Lot ${m.lot.toFixed(2)} (${m.ins.brokerSymbol})${s.strategy === 'F' ? ` · ${m.leverage.toFixed(2)}x` : ''}` : 'Lot: AYAR GEREKLİ'}${m.tag ? ` · ${m.tag}` : ''}`);
  if (s.status === 'YOK' && s.none) lines.push(`Neden yok: ${s.none.why}`, `Ne bekleniyor: ${s.none.waiting}`);
  if (s.invalidation) lines.push(`Geçersiz: ${s.invalidation}`);
  if (s.extra) lines.push(`Ek teyit: ${s.extra.summary} (${s.extra.items.map((i) => `${i.name} ${i.sign === 1 ? '+' : i.sign === -1 ? '−' : '0'}`).join(', ')})`);
  const nr = App.data.state?.symbols?.[s.symbol]?.newsRisk;
  if (nr) lines.push(`Haber: ${nr.text}`);
  if (forClaude) lines.push('', 'Lütfen bu setupu depodaki kurallara (MASTERPROMPT.md) göre değerlendir. Uygulama sinyal verir, karar benimdir.');
  return lines.join('\n');
}
function wireCard(App, el, s) {
  el.querySelectorAll('[data-method]').forEach((b) => b.addEventListener('click', () => { App.methodSel[s.id] = b.dataset.method; App.render(); }));
  el.querySelector('[data-act="copy"]')?.addEventListener('click', () => copy(setupText(App, s, false)));
  el.querySelector('[data-act="claude"]')?.addEventListener('click', () => copy(setupText(App, s, true)));
  const cur = () => { const cfg = symCfg(App, s.symbol); const m = recompute(methodOf(App, s), s, cfg, App.settings, App.data.state); return { cfg, m, o: s.status === 'TAM' || s.status === 'BEKLE' ? buildOrder(App, s, m, cfg) : null }; };
  el.querySelectorAll('[data-otype]').forEach((b) => b.addEventListener('click', () => { if (b.disabled) return; App.orderType[s.id] = b.dataset.otype; App.render(); }));
  el.querySelector('[data-act="ocopy"]')?.addEventListener('click', () => copy(cur().o.text));
  el.querySelector('[data-act="mt5"]')?.addEventListener('click', () => {
    const { o } = cur();
    if (getAdapter(App.settings).status() !== 'CONNECTED') return toast(MT5_OFF_MSG);
    if (o.locks.length) return toast(`Kilitli: ${o.locks.map((l) => l.text).join(' · ')}`);
  });
  el.querySelector('[data-act="skip"]')?.addEventListener('click', () => {
    modal(`<h3>Neden girmedin?</h3><div class="btns" style="flex-wrap:wrap">${SKIP_REASONS.map(([k, l]) => `<button class="btn" data-r="${k}">${l}</button>`).join('')}</div>
      <div class="field"><label>Not (opsiyonel)</label><input id="skipnote" style="min-height:44px"></div>`, (sh, close) => {
      sh.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => {
        const { m, o } = cur();
        const rec = { signal_id: s.id, t: Date.now(), reason: b.dataset.r, reasonText: SKIP_REASONS.find((x) => x[0] === b.dataset.r)[1], note: sh.querySelector('#skipnote').value.trim(),
          strategy: s.strategy, symbol: s.symbol, dir: s.dir, entry: m.entry, stop: m.stop, tp1: m.tp1, tp2: m.tp2 ?? null, signalAt: s.signalAt ?? s.evaluatedAt, lastEntry: s.lastEntry ?? null, virtual_result_r: null, warnings: o?.warnings.map((w) => w.code) ?? [] };
        skipped.put(rec); App.skipped = skipped.map(); close(); toast('Kaydedildi — sanal sonuç takip edilecek'); App.render();
      }));
    });
  });
  el.querySelector('[data-act="entered"]')?.addEventListener('click', () => {
    const { m, o } = cur();
    const d = symCfg(App, s.symbol).decimals ?? 2;
    const lot0 = m.lotOk ? +m.lot.toFixed(2) : '';
    const entry0 = o && o.type === 'market' ? App.data.state?.symbols?.[s.symbol]?.price ?? m.entry : m.entry;
    const save = async (entry, lot) => {
      const t = { id: `${Date.now()}`, t: Date.now(), strategy: s.strategy, symbol: s.symbol, dir: s.dir, sub: s.sub, method: m.label, signal_id: s.id,
        suggested: { entry: m.entry, stop: m.stop, tp1: m.tp1, tp2: m.tp2 ?? null, lot: m.lotOk ? +m.lot.toFixed(2) : null, parts: o?.parts ?? [], type: o?.type ?? m.type },
        entry, stop: m.stop, tp1: m.tp1, tp2: m.tp2 ?? null, rr: +m.rr.toFixed(2), lot, riskUsd: +(o && o.lot > 0 && lot ? o.riskUsd * lot / o.lot : m.lotOk && m.lot > 0 && lot ? m.riskUsd * lot / m.lot : m.riskUsd).toFixed(2),
        quality: s.info?.g?.quality ?? (s.stars ? `${s.stars}★` : ''), lastEntry: s.lastEntry ?? null, note: '', result: null, r: null, setupId: s.id, events: [] };
      await trades.put(t);
      toast('İşlem başladı — canlı takip ve günlük kaydı açıldı');
      App.go(`#/islemler/${encodeURIComponent(s.id)}`);
    };
    modal(`<h3>Girdim — ${esc(s.strategy)} ${esc(SHORT[s.symbol] ?? s.symbol)} ${dirTxt(s.dir)}</h3>
      <div class="form"><div class="field"><label>Gerçek giriş fiyatı</label><input id="fe" type="number" step="any" value="${Number(entry0).toFixed(d)}" style="min-height:48px"></div>
      <div class="field"><label>Lot</label><input id="fl" type="number" step="any" value="${lot0}" style="min-height:48px"></div></div>
      <div class="btns"><button class="btn primary big" data-ok>Kaydet</button></div>`, (sh, close) => {
      sh.querySelector('[data-ok]').addEventListener('click', async () => {
        const e = Number(sh.querySelector('#fe').value), l = sh.querySelector('#fl').value === '' ? null : Number(sh.querySelector('#fl').value);
        if (!(e > 0)) return toast('Giriş fiyatı gir');
        close(); await save(e, l);
      });
    });
  });
}
export const _m = modal;
