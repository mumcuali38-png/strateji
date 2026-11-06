/**
 * ⭐ Portföy sekmesi (docs/kurulum_P_Portfoy_ortak_spec.md §9) ve ⭐ ayarları.
 * ⭐ = backtestten geçmiş kurulum; parametreler kilitli (config/star.json, salt okunur).
 * Renk: yeşil ▲ LONG / kırmızı ▼ SHORT (yazı + ok ile birlikte); durumlar mevcut rozetlerle.
 */
import { esc, price, tr, dateTR, dur, DAY, HOUR } from './fmt.js';
import { toast } from './ui.js';
import { rowBadge } from './star-detail.js';

export const STAR_IDS = ['M2', 'T4S', 'N7', 'IB', 'TD'];
const NY = -5 * HOUR;

/** ⭐ adı (haber engeli açıksa test dışı kullanım: "(H)") */
export function starName(App, id) {
  const n = App.conf.star?.setups?.[id]?.name ?? `⭐${id}`;
  return App.settings.starNewsBlock ? `${n}(H)` : n;
}

/**
 * Oranlı enstrüman (ETF → CFD) oranı (ortak §3, §7.10). Kullanıcı CFD fiyatını girer; o anki ETF fiyatıyla oran sabitlenir.
 * 7 günden eskiyse "oran eski"; WTI'de zorunlu (kart ⏳). US100 için oran girilmediyse varsayılan 41,05.
 */
export function starRatio(App, sym, now = Date.now()) {
  const ins = App.data.star?.instruments?.[sym] ?? App.conf.star?.instruments?.[sym];
  const r = App.settings.starRatios?.[sym];
  const maxAge = (App.conf.star?.common?.ratioMaxAgeDays ?? 7) * DAY;
  if (r?.ratio > 0) {
    const old = now - r.t > maxAge;
    return { ratio: r.ratio, t: r.t, user: true, old, block: old && !!ins?.ratioMandatoryWeekly, text: old ? `oran eski (${dateTR(r.t)})` : `oran ${r.ratio.toFixed(4)} · ${dateTR(r.t)}` };
  }
  if (ins?.ratioDefault) return { ratio: ins.ratioDefault, t: 0, user: false, old: false, block: false, text: `varsayılan oran ${ins.ratioDefault}` };
  return { ratio: null, t: 0, user: false, old: true, block: !!ins?.ratioMandatoryWeekly, text: 'oran yok — CFD fiyatını gir (Ayarlar > ⭐)' };
}
const isEtf = (App, sym) => (App.data.star?.instruments?.[sym]?.cls ?? App.conf.star?.instruments?.[sym]?.cls) === 'etf';

const regimeBadge = (r) => {
  if (!r) return '';
  if (r.value === null || r.value === undefined) return `<span class="badge yok" title="Rejim için ${r.days ?? 0}/210 seans günü">⏳ rejim</span>`;
  return r.value === 1 ? '<span class="dirchip l2" title="Rejim +1: sadece LONG">▲ LONG</span>' : r.value === -1 ? '<span class="dirchip s2" title="Rejim −1: sadece SHORT">▼ SHORT</span>' : '<span class="dirchip n" title="Rejim 0: işlem yok">— rejim 0</span>';
};
const DATA_TXT = { OK: ['yok', '✓ veri'], VERI_GECIKMESI: ['eksik', '⚠ VERİ GECİKMESİ'], VERI_EKSIK: ['yok', '⏳ veri eksik'], VERI_YOK: ['yok', '⏳ veri yok'] };
const dataBadge = (x) => { const [c, t] = DATA_TXT[x?.status] ?? DATA_TXT.VERI_YOK; return `<span class="badge ${c}">${t}</span>`; };
const rTxt = (r) => (r === null || r === undefined || !Number.isFinite(r) ? '—' : `${r > 0 ? '+' : ''}${r.toFixed(1)}R`);
const rCls = (r) => (r > 0 ? 'pos' : r < 0 ? 'neg' : '');

function ocoCell(id, row) {
  const j = row?.json ?? {};
  const y = id === 'N7' ? j.nr7 : j.inside_day;
  const ok = row?.conditions?.find((c) => c.id === 'sinyal')?.status === 'ok';
  const lbl = id === 'N7' ? 'dün NR7' : 'dün iç gün';
  const c = row?.candidate;
  return `<span class="small">${lbl} ${y ? (ok ? '✅' : '—') : '⏳'}</span>${c ? `<div class="muted small">${id === 'N7' && c.ratio !== null && c.ratio !== undefined ? `bugün %${Math.round(c.ratio * 100)}` : c.cand ? 'bugün aday' : ''}</div>` : ''}`;
}
function weekStrip(App, st) {
  const p = st?.portfolio ?? {};
  const warnAt = App.conf.star?.common?.openRiskWarnPct ?? 3;
  const warn = (p.openRiskPct ?? 0) > warnAt;
  return `<div class="card star-week ${warn ? 'warn' : ''}"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
    <div><div class="muted small">Bu hafta kapanmış ⭐ R (Pzt 08:00 TR'den beri)</div><div class="big num ${rCls(p.weekR)}">${rTxt(p.weekR ?? 0)}</div></div>
    <div><div class="muted small">Açık risk</div><div class="big num">%${(p.openRiskPct ?? 0).toFixed(2)}</div></div>
    <div><div class="muted small">Açık ⭐ pozisyon</div><div class="big num">${(p.open ?? []).length}</div></div>
  </div>
  <div class="muted small" style="margin-top:6px">Sadece bilgi — haftalık limit yok, yeni girişi engellemez.${warn ? ` <b style="color:var(--eksik)">⚠ Toplam açık risk %${warnAt}'ü geçti (engellemez).</b>` : ''}</div></div>`;
}

function setupCard(App, id, st) {
  const cfg = App.conf.star?.setups?.[id] ?? {};
  const out = st?.setups?.[id] ?? {};
  const rows = (cfg.symbols ?? []).map((sym) => {
    const ins = st?.instruments?.[sym];
    const row = out.rows?.[sym] ?? {};
    const rat = isEtf(App, sym) ? starRatio(App, sym) : null;
    const active = out.active;
    return `<tr ${active ? `data-go="#/star/${id}/${sym}" style="cursor:pointer"` : ''}>
      <td><b>${esc(ins?.label ?? sym)}</b>${rat ? `<div class="muted small" style="${rat.old ? 'color:var(--eksik)' : ''}">${esc(rat.text)}</div>` : ''}</td>
      <td>${cfg.regime ? regimeBadge(ins?.regime) : ocoCell(id, row)}</td>
      <td>${(row.position?.dir ?? row.dir) === 1 ? '<span class="dirchip l2">▲ LONG</span>' : (row.position?.dir ?? row.dir) === -1 ? '<span class="dirchip s2">▼ SHORT</span>' : '<span class="muted">—</span>'}</td>
      <td>${active ? rowBadge(row) : ins?.status && ins.status !== 'OK' ? dataBadge(ins) : '<span class="badge yok">⚪ sıradaki adımda</span>'}</td>
      <td class="num ${rCls(row.position?.rNow)}">${row.position?.open ? rTxt(row.position.rNow) : '—'}</td></tr>`;
  }).join('');
  const slip = (id === 'N7' || id === 'IB') && (App.starSlip?.avg ?? 0) > 0.05 ? `<div class="warnline">⚠️ Avantaj ince — kayma ort. ${App.starSlip.avg.toFixed(3)}R > 0,05R · broker/spread kontrol</div>` : '';
  return `<div class="card star-card">${slip}<div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(starName(App, id))} <span class="muted small">· ${esc(cfg.title ?? '')}</span></h2><span class="muted small">${esc(cfg.tf === '1d' ? 'Günlük' : cfg.tf?.toUpperCase() ?? '')}</span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Enstrüman</th><th>${cfg.regime ? 'Rejim' : id === 'N7' ? 'NR7' : 'İç gün'}</th><th>Yön</th><th>Durum</th><th>Açık R</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
}

/** Aylık takvim: gün gün ⭐ R (strateji günü). Yeşil = kâr, kırmızı = zarar; değer yazıyla da gösterilir. */
function calendar(st, now = Date.now()) {
  const cal = st?.portfolio?.calendar ?? {};
  const d = new Date(now + NY);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  const first = Date.UTC(y, m, 1), days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  let total = 0;
  const cells = [...Array(lead).fill('<div class="cal-c empty"></div>'), ...Array.from({ length: days }, (_, i) => {
    const key = new Date(Date.UTC(y, m, i + 1)).toISOString().slice(0, 10);
    const r = cal[key];
    if (Number.isFinite(r)) total += r;
    return `<div class="cal-c ${Number.isFinite(r) ? rCls(r) : ''}"><span class="d">${i + 1}</span><span class="num">${Number.isFinite(r) ? rTxt(r) : ''}</span></div>`;
  })];
  const mn = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'][m];
  return { total, html: `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${mn} ${y} · ⭐ R</h2><b class="num ${rCls(total)}">${rTxt(total)}</b></div>
    <div class="cal">${['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((x) => `<div class="cal-h">${x}</div>`).join('')}${cells.join('')}</div></div>` };
}

function expectation(App, monthR) {
  const e = App.conf.star?.expectation;
  if (!e) return '';
  const row = (x) => `<tr><td>${esc(x.label)}</td><td class="num">${x.perWeek}</td><td class="num">+${x.totalR}R</td><td class="num">+${x.monthlyR}R</td><td class="num">${x.posMonths}</td><td class="num">${x.worstWeekR}R</td><td class="num">${x.maxDdR}R</td></tr>`;
  const [lo, hi] = e.targetMonthlyR ?? [5, 7];
  return `<div class="card"><h2>Test beklentisi (maliyet dahil, haftalık limit yok)</h2>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Dönem</th><th>İşlem/hafta</th><th>Toplam</th><th>Aylık ort.</th><th>Pozitif ay</th><th>En kötü hafta</th><th>En büyük düşüş</th></tr></thead><tbody>${row(e.train)}${row(e.last)}</tbody></table></div>
    <div class="row" style="gap:16px;margin-top:8px;flex-wrap:wrap"><div>Bu ay gerçekleşen: <b class="num ${rCls(monthR)}">${rTxt(monthR)}</b></div><div class="muted">Beklenen: aylık +${e.last.monthlyR}R (son 1 yıl) · gerçekçi hedef +${lo}–${hi}R</div></div>
    <div class="muted small" style="margin-top:6px">Limit olmadığı için kötü haftalar −10R'ye, kötü aylar −13R'ye kadar inebilir (eğitimde görüldü). Art arda küçük zararlar normaldir.</div></div>`;
}

export function renderStar(App, el) {
  const st = App.data.star;
  if (!st) { el.innerHTML = '<div class="h1">⭐ Portföy</div><div class="card">⭐ tarama verisi henüz yok — tarama döngüsü 7/24 çalışır; ilk taramadan sonra burada görünür.</div>'; return; }
  const cal = calendar(st);
  const age = Date.now() - st.lastScan;
  el.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:8px"><div class="h1" style="margin:0">⭐ Portföy</div>
    <div class="muted small">Son ⭐ tarama ${tr(st.lastScan)} ${age > 15 * 60000 ? `<b style="color:var(--eksik)">(${dur(age)} önce)</b>` : '✓'} · ⭐ kredi bugün ${st.credits?.star ?? 0}</div></div>
    ${st.news ? `<div class="banner news" style="border-radius:10px;margin-bottom:10px">⚠ HABER RİSKİ: ${esc(st.news.title)} ${tr(st.news.t)} TR (${st.news.minutes} dk) — ⭐ girişleri engellenmez, sadece uyarı</div>` : ''}
    ${confirmBanner(App)}
    ${weekStrip(App, st)}
    <div class="star-grid">${STAR_IDS.map((id) => setupCard(App, id, st)).join('')}</div>
    ${cal.html}
    ${expectation(App, cal.total)}
    <div class="card muted small">⭐ = kurallar sabit, 3,7 yıllık eğitim + son 1 yıllık ayrı sınavdan geçmiş kurulum. Parametreler kilitli (Ayarlar > ⭐ Kurulumlar'da salt okunur). MT5 butonu tüm emir kartlarında görünür ama pasif.</div>`;
}

/** Ayarlar > ⭐ Kurulumlar kartı */
export function starSettingsHtml(App) {
  const sc = App.conf.star;
  if (!sc) return '';
  const s = App.settings;
  const etfs = Object.entries(sc.instruments).filter(([, i]) => i.cls === 'etf');
  const ratioRows = etfs.map(([sym, i]) => {
    const r = starRatio(App, sym);
    const etfPx = App.data.star?.instruments?.[sym]?.price;
    return `<tr><td><b>${esc(i.label)}</b>${i.ratioMandatoryWeekly ? ' <span class="badge eksik">haftalık zorunlu</span>' : i.ratioWeekly ? ' <span class="muted small">haftada bir</span>' : ''}</td><td class="num">${price(etfPx, 2)}</td>
      <td><input type="number" step="any" data-star-ratio="${sym}" placeholder="CFD fiyatı" style="width:120px;min-height:44px"></td><td class="small" style="${r.old ? 'color:var(--eksik)' : ''}">${esc(r.text)}</td></tr>`;
  }).join('');
  const lockRows = Object.entries(sc.setups).map(([id, x]) => `<tr><td><b>${esc(x.name)}</b></td><td class="small mono">${esc(Object.entries(x.p).map(([k, v]) => `${k}=${v}`).join(' · '))}</td><td class="small">${esc(x.symbols.join(', '))}</td></tr>`).join('');
  return `<div class="card"><h2>⭐ Kurulumlar</h2>
    <div class="form">
      <div class="field"><label>⭐ işlem başı risk % (${sc.common.riskMinPct}–${sc.common.riskMaxPct})</label><input data-path="starRiskPct" type="number" step="0.05" min="${sc.common.riskMinPct}" max="${sc.common.riskMaxPct}" value="${esc(s.starRiskPct ?? sc.common.riskPct)}"></div>
    </div>
    <label class="switch"><span>Haber engeli (kırmızı USD habere ≤ 30 dk) — <b>testte yoktu</b>; açarsan ⭐ yanına "(H)" eklenir (test dışı kullanım)</span><input type="checkbox" data-path="starNewsBlock" ${s.starNewsBlock ? 'checked' : ''}></label>
    <h3 style="margin-top:12px">ETF → CFD oranları</h3>
    <p class="muted small">Seviyeler ETF üzerinde hesaplanır, oranla CFD'ye çevrilir. Brokerındaki CFD fiyatını gir; oran o anki ETF fiyatıyla sabitlenir. 7 günden eskiyse "oran eski" uyarısı; WTI'de kart ⏳ olur (USO yapısı nedeniyle oran kayar).</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Enstrüman</th><th>Son ETF</th><th>CFD fiyatı</th><th>Durum</th></tr></thead><tbody>${ratioRows}</tbody></table></div>
    <div class="btns"><button class="btn ${s.instrConfirmedStar ? '' : 'primary'}" data-confirm-instr-star>${s.instrConfirmedStar ? '✓ ⭐ yeni enstrümanlar doğrulandı · ' + dateTR(s.instrConfirmedStar) : '⭐ yeni enstrüman değerlerini (USDJPY, AUDUSD, US500, US30, XAG, WTI) doğruladım'}</button></div>
    <h3 style="margin-top:12px">🔒 Kilitli parametreler (salt okunur)</h3>
    <p class="muted small">Değiştirilirse ⭐ kaldırılır ve kurulum "test edilmemiş" olur. Şartnameler: <span class="mono">docs/kurulum_*_spec.md</span></p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Kurulum</th><th>Parametreler</th><th>Enstrümanlar</th></tr></thead><tbody>${lockRows}</tbody></table></div></div>`;
}
export function bindStarSettings(App, el) {
  el.querySelectorAll('[data-star-ratio]').forEach((inp) => inp.addEventListener('change', () => {
    const sym = inp.dataset.starRatio, cfd = Number(inp.value), etf = App.data.star?.instruments?.[sym]?.price;
    if (!(cfd > 0)) return;
    if (!(etf > 0)) { toast('ETF fiyatı henüz yok — ⭐ taramasından sonra tekrar dene'); return; }
    App.settings.starRatios = { ...(App.settings.starRatios ?? {}), [sym]: { cfd, etf, ratio: cfd / etf, t: Date.now() } };
    App.save(); toast(`${sym} oranı ${(cfd / etf).toFixed(4)} kaydedildi`); App.render();
  }));
  el.querySelector('[data-confirm-instr-star]')?.addEventListener('click', () => { App.settings.instrConfirmedStar = Date.now(); App.save(); toast('⭐ enstrüman değerleri doğrulandı'); App.render(); });
}

/** T4.3 / T4.4 / TD.4: kullanıcı onayları (cihazda) — T1 limit emri girildi mi, T1 sonrası stop girişe çekildi mi */
export function starConfirm(App, id) { return App.settings.starConfirm?.[id] ?? {}; }
export function setStarConfirm(App, id, k) {
  App.settings.starConfirm = { ...(App.settings.starConfirm ?? {}), [id]: { ...starConfirm(App, id), [k]: Date.now() } };
  App.save();
}
/** Bekleyen zorunlu onaylar: T1 gerçekleşti ama "stop girişe" onaylanmadı */
export function pendingBe(App) {
  return (App.data.star?.portfolio?.open ?? []).filter((x) => x.t1Done && !starConfirm(App, x.id).be);
}
let lastRemind = 0;
/** Onaylanmazsa her 5 dk hatırlatma (uygulama açıkken) */
export function starReminder(App) {
  const p = pendingBe(App);
  if (!p.length || Date.now() - lastRemind < 5 * 60000) return;
  lastRemind = Date.now();
  const x = p[0];
  toast(`⚠ ${App.conf.star?.setups?.[x.setup]?.name ?? x.setup} ${x.sym}: T1 alındı — stopu girişe (${x.entry}) çek ve onayla`, 6000);
}
function confirmBanner(App) {
  const p = pendingBe(App);
  return p.map((x) => `<div class="lockline" style="margin-bottom:8px" data-go="#/star/${x.setup}/${x.sym}">⚠ ${esc(App.conf.star?.setups?.[x.setup]?.name ?? x.setup)} ${esc(x.sym)}: T1 alındı — stopu girişe (${esc(String(x.entry))}) çek · onay bekleniyor</div>`).join('');
}
