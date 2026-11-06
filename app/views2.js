import { SHORT, STRATS } from './config.js';
import { esc, tr, ny, dateTR, dayNameTR, dur, price, MIN, DAY, HOUR, trDayStart, COND_ICON, dirTxt, trMinutes } from './fmt.js';
import { trades, lsGet, lsSet } from './store.js';
import { modal, toast, download } from './ui.js';
import { chart as loadChart } from './data.js';
import { mountChart } from './chart.js';

/* ---------- HABER ---------- */
export function renderNews(App, el, sub) {
  const n = App.data.news;
  if (!n) { el.innerHTML = '<div class="card empty">Takvim henüz yok — "news" iş akışı saatte bir çalışır</div>'; return; }
  const now = Date.now();
  const stale = now - (n.ffFetchedAt ?? n.fetchedAt) > 2 * HOUR || n.stale;
  const next = n.events.filter((e) => e.impact === 'High' && e.t > now).sort((a, b) => a.t - b.t)[0];
  const head = `<div class="tabs2"><a class="btn ${sub !== 'son' ? 'primary' : ''}" href="#/haber">Takvim</a><a class="btn ${sub === 'son' ? 'primary' : ''}" href="#/haber/son">Son dakika</a></div>`;
  if (sub === 'son') {
    el.innerHTML = `${head}<div class="card"><h2>Son dakika başlıkları</h2><div class="muted small">FMP · bildirim atmaz</div>${n.fmp !== 'ok' ? '<div class="empty">FMP yok (FMP_KEY tanımlı değil veya erişilemedi)</div>' : `<div class="list">${n.headlines.map((h) => `<div class="li"><div class="grow">${h.url ? `<a href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a>` : esc(h.title)}<div class="muted small">${tr(h.t)} TR · ${esc(h.source)}</div></div></div>`).join('')}</div>`}</div>`;
    return;
  }
  const today = trDayStart(now);
  const rows = (list) => list.map((e) => `<tr class="${e.impact !== 'High' ? 'dim' : ''}"><td class="num">${tr(e.t)}<div class="muted small">${ny(e.t)} NY</div></td><td>${esc(e.currency)}</td><td>${e.impact === 'High' ? '🔴' : '🟠'}</td><td><b>${esc(e.title)}</b></td><td class="num">${esc(e.forecast ?? '—')}</td><td class="num">${esc(e.previous ?? '—')}</td><td class="num">${esc(e.actual ?? '—')}</td><td class="muted small">${esc(e.source)}</td></tr>`).join('');
  const th = '<thead><tr><th>Saat TR</th><th>Para</th><th>Etki</th><th>Olay</th><th>Beklenti</th><th>Önceki</th><th>Gerçek</th><th>Kaynak</th></tr></thead>';
  const todayEv = n.events.filter((e) => e.t >= today && e.t < today + DAY);
  const weekEv = n.events.filter((e) => e.t >= today + DAY);
  el.innerHTML = `${head}
    ${stale ? `<div class="banner warn" style="border-radius:10px;margin-bottom:10px">⚠️ Takvim eski — son güncelleme ${tr(n.ffFetchedAt ?? n.fetchedAt)} ${dateTR(n.ffFetchedAt ?? n.fetchedAt)}. Son kopya kullanılıyor.</div>` : ''}
    ${next ? `<div class="card" style="border-left:5px solid var(--danger)"><div class="muted">Sıradaki kırmızı haber</div><div class="h1" style="margin:4px 0">${esc(next.currency)} ${esc(next.title)}</div><div class="num" style="font-size:1.6rem;font-weight:700">${dur(next.t - now)}</div><div class="muted">${dayNameTR(next.t)} ${tr(next.t)} TR · ${ny(next.t)} NY · −${App.data.state?.params?.news?.beforeMin ?? 30} dk / +${App.data.state?.params?.news?.afterMin ?? 15} dk setuplar askıda</div></div>` : ''}
    <div class="card"><h2>Bugün</h2><div class="tbl-wrap"><table class="tbl">${th}<tbody>${rows(todayEv) || '<tr><td colspan="8" class="muted">Bugün ilgili haber yok</td></tr>'}</tbody></table></div></div>
    <div class="card"><h2>Bu hafta</h2><div class="tbl-wrap"><table class="tbl">${th}<tbody>${weekEv.map((e) => `<tr class="${e.impact !== 'High' ? 'dim' : ''}"><td class="num">${dayNameTR(e.t)} ${tr(e.t)}<div class="muted small">${ny(e.t)} NY</div></td><td>${esc(e.currency)}</td><td>${e.impact === 'High' ? '🔴' : '🟠'}</td><td><b>${esc(e.title)}</b></td><td class="num">${esc(e.forecast ?? '—')}</td><td class="num">${esc(e.previous ?? '—')}</td><td class="num">${esc(e.actual ?? '—')}</td><td class="muted small">${esc(e.source)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">—</td></tr>'}</tbody></table></div>
    <div class="muted small">Takvim: Forex Factory · ${n.fmp === 'ok' ? 'Gerçek değerler: FMP' : 'FMP yok'} · güncelleme ${tr(n.fetchedAt)} TR</div></div>`;
}

/* ---------- GÜNLÜK ---------- */
export async function renderJournal(App, el, openId) {
  const list = (await trades.all()).sort((a, b) => b.t - a.t);
  const done = list.filter((t) => t.result);
  const wins = done.filter((t) => t.result === 'TP' || (t.r ?? 0) > 0);
  const totR = done.reduce((a, t) => a + (Number(t.r) || 0), 0);
  const byStrat = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'M2', 'T4S', 'N7', 'IB', 'TD'].filter((s) => s.length === 1 || list.some((t) => t.strategy === s)).map((s) => { const x = done.filter((t) => t.strategy === s); return { s, n: list.filter((t) => t.strategy === s).length, w: x.filter((t) => (t.r ?? 0) > 0).length, d: x.length, r: x.reduce((a, t) => a + (Number(t.r) || 0), 0), rr: x.length ? x.reduce((a, t) => a + (t.rr || 0), 0) / x.length : 0 }; });
  const hours = {};
  for (const t of done) { const hh = Math.floor(trMinutes(t.t) / 60); hours[hh] = (hours[hh] ?? 0) + (Number(t.r) || 0); }
  const hk = Object.entries(hours).sort((a, b) => b[1] - a[1]);
  const syms = {};
  for (const t of list) syms[t.symbol] = (syms[t.symbol] ?? 0) + 1;
  const maxN = Math.max(1, ...byStrat.map((x) => x.n));
  const maxR = Math.max(1, ...byStrat.map((x) => Math.abs(x.r)));
  const lastBackup = App.settings.lastBackup || 0;
  const remind = list.length && Date.now() - lastBackup > 7 * DAY;
  el.innerHTML = `
    <div class="row" style="justify-content:space-between"><div class="h1">İşlem günlüğü</div>
      <div class="btns" style="margin:0"><button class="btn" data-add>+ Elle ekle</button><button class="btn" data-export>⇩ JSON dışa aktar</button><label class="btn">⇧ İçe aktar<input type="file" accept="application/json" data-import hidden></label></div></div>
    ${remind ? `<div class="banner warn" style="border-radius:10px;margin-bottom:10px">💾 Haftalık yedek zamanı — veriler sadece bu tablette (IndexedDB). <button class="btn act" data-export>Yedek al</button></div>` : ''}
    <div class="grid2">
      <div class="card"><h2>İstatistik</h2>
        <div class="kv"><span>İşlem <b>${list.length}</b></span><span>Kapanan <b>${done.length}</b></span><span>Win rate <b>${done.length ? Math.round((wins.length / done.length) * 100) : 0}%</b></span><span>Toplam <b>${totR >= 0 ? '+' : ''}${totR.toFixed(2)}R</b></span></div>
        <h3 style="margin-top:12px">Strateji bazında</h3>
        <div class="bars">${byStrat.map((x) => `<div class="bar"><span>${x.s.length > 1 ? `⭐${x.s}` : x.s} · ${x.n} işlem</span><span class="t"><i style="width:${(x.n / maxN) * 100}%"></i></span><span class="num">${x.d ? Math.round((x.w / x.d) * 100) : 0}% WR</span></div><div class="bar"><span class="muted small">toplam R</span><span class="t"><i class="${x.r < 0 ? 'neg' : ''}" style="width:${(Math.abs(x.r) / maxR) * 100}%"></i></span><span class="num">${x.r >= 0 ? '+' : ''}${x.r.toFixed(1)}R · ort RR ${x.rr.toFixed(1)}</span></div>`).join('')}</div>
      </div>
      <div class="card"><h2>Saat ve sembol</h2>
        <div>En iyi saat dilimi: <b>${hk[0] ? `${hk[0][0]}:00–${+hk[0][0] + 1}:00 TR (${(+hk[0][1]).toFixed(1)}R)` : '—'}</b></div>
        <div>En kötü saat dilimi: <b>${hk.length > 1 ? `${hk[hk.length - 1][0]}:00–${+hk[hk.length - 1][0] + 1}:00 TR (${(+hk[hk.length - 1][1]).toFixed(1)}R)` : '—'}</b></div>
        <h3 style="margin-top:12px">Sembol dağılımı</h3>
        <div class="bars">${Object.entries(syms).map(([s, n]) => `<div class="bar"><span>${SHORT[s] ?? s}</span><span class="t"><i style="width:${(n / Math.max(...Object.values(syms))) * 100}%"></i></span><span class="num">${n}</span></div>`).join('') || '<div class="muted">—</div>'}</div>
      </div>
    </div>
    <div class="card"><h2>İşlemler</h2><div class="list">${list.map((t) => `<div class="li" data-edit="${t.id}"><span class="dir ${t.dir === 1 ? 'long' : 'short'}" style="font-size:.9rem">${dirTxt(t.dir)}</span><div class="grow"><b>${SHORT[t.symbol] ?? t.symbol} ${t.strategy}</b> · ${esc(t.sub ?? '')}<div class="muted small">${dateTR(t.t)} ${tr(t.t)} TR · giriş ${t.entry} · lot ${t.lot}${t.maeR !== undefined ? ` · MAE −${t.maeR}R / MFE +${t.mfeR}R` : ''}${t.rules_followed === false ? ' · ⚠️ kurala uyulmadı' : t.rules_followed ? ' · ✔ kurala uygun' : ''}</div></div><span class="badge ${t.result === 'TP' ? 'tam' : t.result === 'SL' ? 'news' : 'yok'}">${t.result ?? 'açık'}${t.r !== null && t.r !== undefined && t.r !== '' ? ` ${t.r > 0 ? '+' : ''}${t.r}R` : ''}${t.resultUsd !== undefined && t.resultUsd !== null ? ` · $${t.resultUsd}` : ''}${t.auto ? ' · oto' : ''}</span></div>`).join('') || '<div class="empty">Henüz işlem yok · setup kartında "İşleme girdim" ile eklenir</div>'}</div></div>`;
  const doExport = async () => {
    download(`strateji-gunluk-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: 'strateji-radar', v: 1, trades: await trades.all() }, null, 1));
    App.settings.lastBackup = Date.now(); App.save(); toast('Yedek indirildi');
  };
  el.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', doExport));
  el.querySelector('[data-import]').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const arr = Array.isArray(j) ? j : j.trades;
      for (const t of arr) if (t && t.id) await trades.put(t);
      toast(`${arr.length} işlem içe aktarıldı`); App.render();
    } catch { toast('Dosya okunamadı'); }
  });
  el.querySelector('[data-add]').addEventListener('click', () => editTrade(App, { id: `${Date.now()}`, t: Date.now(), strategy: 'B', symbol: 'XAUUSD', dir: 1, entry: '', stop: '', tp1: '', lot: '', note: '', result: null, r: null }, true));
  el.querySelectorAll('[data-edit]').forEach((r) => r.addEventListener('click', () => { const t = list.find((x) => x.id === r.dataset.edit); if (t) editTrade(App, t); }));
  if (openId) { const t = list.find((x) => x.id === openId); if (t) editTrade(App, t); }
}
function editTrade(App, t, isNew = false) {
  const f = (k, label, type = 'number', extra = '') => `<div class="field"><label>${label}</label><input name="${k}" type="${type}" step="any" value="${esc(t[k] ?? '')}" ${extra}></div>`;
  modal(`<h2>${isNew ? 'Yeni işlem' : `${SHORT[t.symbol] ?? t.symbol} ${t.strategy} · ${dirTxt(t.dir)}`}</h2>
    <form class="form" id="tf">
      <div class="field"><label>Strateji</label><select name="strategy">${['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'M2', 'T4S', 'N7', 'IB', 'TD'].map((s) => `<option ${s === t.strategy ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label>Sembol</label><select name="symbol">${Object.keys(SHORT).map((s) => `<option value="${s}" ${s === t.symbol ? 'selected' : ''}>${SHORT[s]}</option>`).join('')}</select></div>
      <div class="field"><label>Yön</label><select name="dir"><option value="1" ${t.dir === 1 ? 'selected' : ''}>LONG</option><option value="-1" ${t.dir === -1 ? 'selected' : ''}>SHORT</option></select></div>
      ${f('entry', 'Gerçek giriş')}${f('stop', 'Stop')}${f('tp1', 'Hedef')}${f('lot', 'Lot')}
      <div class="field"><label>Sonuç</label><select name="result"><option value="">Açık</option>${['TP', 'SL', 'BE', 'MANUEL'].map((x) => `<option ${t.result === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      ${f('r', 'R değeri (ör. 2.1 / -1)')}
      <div class="field" style="grid-column:1/-1"><label>Not</label><textarea name="note" rows="3">${esc(t.note ?? '')}</textarea></div>
      <div class="field" style="grid-column:1/-1"><label>Ekran görüntüsü (opsiyonel)</label><input type="file" accept="image/*" name="shot">${t.shot ? `<img src="${t.shot}" alt="ekran görüntüsü" style="max-width:100%;border-radius:8px;margin-top:6px">` : ''}</div>
    </form>
    <div class="btns"><button class="btn primary" data-save>Kaydet</button>${isNew ? '' : '<button class="btn" data-del>Sil</button>'}</div>`, (sheet, close) => {
    const form = sheet.querySelector('#tf');
    form.result.addEventListener('change', () => {
      const e = Number(form.entry.value), s = Number(form.stop.value), tp = Number(form.tp1.value);
      if (form.result.value === 'SL') form.r.value = -1;
      if (form.result.value === 'BE') form.r.value = 0;
      if (form.result.value === 'TP' && e && s && tp) form.r.value = (Math.abs(tp - e) / Math.abs(e - s)).toFixed(2);
    });
    sheet.querySelector('[data-save]').addEventListener('click', async () => {
      const fd = new FormData(form);
      const o = { ...t };
      for (const k of ['strategy', 'symbol', 'note', 'result']) o[k] = fd.get(k) || (k === 'result' ? null : '');
      o.dir = Number(fd.get('dir'));
      for (const k of ['entry', 'stop', 'tp1', 'lot', 'r']) o[k] = fd.get(k) === '' ? null : Number(fd.get(k));
      const file = fd.get('shot');
      if (file && file.size) o.shot = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
      await trades.put(o); close(); toast('Kaydedildi'); App.render();
    });
    sheet.querySelector('[data-del]')?.addEventListener('click', async () => { if (confirm('Bu işlem silinsin mi?')) { await trades.del(t.id); close(); App.render(); } });
  });
}

/* ---------- GEÇMİŞ ---------- */
export function renderHistory(App, el) {
  const h = App.data.history ?? [];
  const f = App.histFilter;
  const list = h.filter((e) => (!f.s || e.strategy === f.s) && (!f.sym || e.symbol === f.sym) && (!f.o || (e.result?.outcome ?? 'ACIK') === f.o) && (!f.k || e.kind === f.k));
  const sum = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((s) => {
    const x = h.filter((e) => e.strategy === s && e.kind === 'TAM');
    const tp = x.filter((e) => e.result?.outcome === 'TP').length, sl = x.filter((e) => e.result?.outcome === 'SL').length, open = x.filter((e) => !e.result || e.result.outcome === 'ACIK').length;
    const rs = x.filter((e) => e.result?.r !== undefined).map((e) => e.result.r);
    const avg = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;
    return x.length ? `<div><b>${s}:</b> ${x.length} setup · ${tp} TP · ${sl} SL · ${open} açık · ort. ${avg >= 0 ? '+' : ''}${avg.toFixed(1)}R</div>` : '';
  }).join('');
  const sel = (k, opts, label) => `<div class="field"><label>${label}</label><select data-f="${k}"><option value="">Hepsi</option>${opts.map(([v, t]) => `<option value="${v}" ${f[k] === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
  const OUT = { TP: '🎯 TP', SL: '🛑 SL', ACIK: '⏳ açık', ZAMAN_ASIMI: '⌛ zaman aşımı', DOLMADI: '∅ dolmadı' };
  el.innerHTML = `<div class="h1">Geçmiş tarama (30 gün)</div>
    <div class="card"><h2>Özet (TAM olaylar)</h2>${sum || '<div class="muted">Henüz olay yok</div>'}<div class="muted small" style="margin-top:6px">Sonuçlar kayıtlı mumlardan otomatik değerlendirilir (ek kredi yok). Kuralların gerçekte çalışıp çalışmadığını gösterir.</div></div>
    <div class="card"><div class="form">${sel('s', ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((s) => [s, s]), 'Strateji')}${sel('sym', Object.keys(SHORT).map((s) => [s, SHORT[s]]), 'Sembol')}${sel('o', Object.entries(OUT), 'Sonuç')}${sel('k', [['TAM', 'TAM'], ['HAZIR', '1 şart kaldı']], 'Tür')}</div></div>
    <div class="card"><div class="list">${list.map((e, i) => `<div class="li" data-ev="${i}"><span class="badge ${e.kind === 'TAM' ? 'tam' : 'eksik'}">${e.kind === 'TAM' ? '🔵 TAM' : '🟡 1 şart'}</span><div class="grow"><b>${SHORT[e.symbol]} ${e.strategy} ${dirTxt(e.dir)}</b> · ${esc(e.sub)}<div class="muted small">${dateTR(e.t)} ${tr(e.t)} TR${e.method ? ` · giriş ${e.method.entry} · RR ${e.method.rr}` : ''}</div></div><div style="text-align:right"><div>${OUT[e.result?.outcome ?? 'ACIK'] ?? '—'}</div><div class="muted small num">MFE ${e.result?.mfeR ?? 0}R · MAE ${e.result?.maeR ?? 0}R</div></div></div>`).join('') || '<div class="empty">Filtreye uyan olay yok</div>'}</div></div>`;
  el.querySelectorAll('[data-f]').forEach((s) => s.addEventListener('change', () => { App.histFilter[s.dataset.f] = s.value; App.render(); }));
  el.querySelectorAll('[data-ev]').forEach((r) => r.addEventListener('click', () => {
    const e = list[Number(r.dataset.ev)];
    modal(`<h2>${SHORT[e.symbol]} ${e.strategy} ${dirTxt(e.dir)} · ${esc(e.sub)}</h2><div class="muted">${dateTR(e.t)} ${tr(e.t)} TR · ${e.kind === 'TAM' ? 'TAM' : '1 şart kaldı'} · sonuç ${OUT[e.result?.outcome ?? 'ACIK']}</div>
      <div class="chart-wrap" id="hchart" style="margin:10px 0"></div>
      <div class="conds">${e.conditions.map((c) => `<div class="cond"><span>${COND_ICON[c.status]}</span><div><div class="lb">${esc(c.label)}</div><div class="dt">${esc(c.detail)}</div></div></div>`).join('')}</div>
      ${e.method ? `<div class="kv" style="margin-top:10px"><span>Giriş <b>${e.method.entry}</b></span><span>Stop <b>${e.method.stop}</b></span><span>TP1 <b>${e.method.tp1}</b></span><span>RR <b>${e.method.rr}</b></span></div>` : ''}`, (sheet) => {
      loadChart(e.symbol).then((cd) => { const c = sheet.querySelector('#hchart'); if (c && cd) mountChart(c, { chartData: cd, setup: { overlays: e.overlays, signalAt: e.signalAt ?? e.t, dir: e.dir, tfs: ['1m', '5m', '15m', '1h', '4h'], chartTf: '5m' }, sessions: App.conf.sessions, layers: { ...App.settings.layers }, asOf: App.data.state?.lastScan }); });
    });
  }));
}

/* ---------- BİLDİRİM GEÇMİŞİ ---------- */
export async function notifHistory(App) {
  const { notifs } = await import('./store.js');
  const list = (await notifs.all()).filter((n) => Date.now() - n.t < 30 * DAY).sort((a, b) => b.t - a.t);
  modal(`<h2>🔔 Bildirim merkezi (30 gün)</h2><div class="list">${list.map((n) => `<a class="li" href="${esc(n.url ?? '#/ozet')}" data-close style="text-decoration:none;color:inherit"><div class="grow"><b>${esc(n.title)}</b><div class="small">${esc(n.body)}</div><div class="muted small">${dateTR(n.t)} ${tr(n.t)} TR</div></div></a>`).join('') || '<div class="empty">Bu cihaza son 30 günde bildirim gelmedi</div>'}</div>`);
}
export const _x = { HOUR, price, lsGet, lsSet, STRATS };
