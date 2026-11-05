/**
 * Canlı işlem ekranı (EK §3.6), yönetim adımları (§3.7), otomatik günlük (§3.10),
 * "Neden girmedim" sanal sonuçları (§3.11). Fiyat ve TP/SL olayları taramanın işlem takibinden
 * (history.json → track) gelir; ek API isteği yok.
 */
import { SHORT } from './config.js';
import { esc, tr, dateTR, dur, price, dirTxt } from './fmt.js';
import { trades, skipped } from './store.js';
import { modal, toast } from './ui.js';

const RES = { TP1: 'TP', TP2: 'TP', SL: 'SL', BE: 'BE' };
const trackOf = (App, id) => (id ? (App.data.history ?? []).find((h) => h.id === id && h.kind === 'TAM')?.track : undefined);
const sigOf = (t) => t.signal_id || t.setupId;

/** R hesabı: TP1'de %50 alındıysa kalan %50 kapanış fiyatından */
export function closeR(t, exitPrice) {
  const risk = Math.abs(Number(t.entry) - Number(t.stop));
  if (!(risk > 0)) return 0;
  const rOf = (p) => ((p - t.entry) * t.dir) / risk;
  const tp1 = (t.events ?? []).find((e) => e.type === 'TP1_USER');
  return +(tp1 ? 0.5 * rOf(tp1.price) + 0.5 * rOf(exitPrice) : rOf(exitPrice)).toFixed(2);
}

/**
 * Taramanın takibine göre açık işlemleri günceller: MAE/MFE, olaylar; takip KAPANDI ise
 * işlem kendiliğinden kapanır (kullanıcı sonradan düzeltebilir). Girmediklerimin sanal sonucu da yazılır.
 */
export async function syncTrades(App) {
  const list = await trades.all();
  let closed = 0;
  for (const t of list) {
    if (t.result) continue;
    const tk = trackOf(App, sigOf(t));
    if (!tk || tk.status === 'DOLMADI' || tk.status === 'BEKLIYOR') continue; // tarama dolum görmedi: MAE/MFE yok
    const upd = { ...t, maeR: tk.maeR, mfeR: tk.mfeR, scanEvents: tk.events };
    if (tk.status === 'KAPANDI' && tk.events.length) {
      const last = tk.events[tk.events.length - 1];
      // Kullanıcının gerçek girişiyle yeniden: TP1 → %50, son olay fiyatı → kalan
      const tp1 = tk.events.find((e) => e.type === 'TP1');
      const evs = [...(t.events ?? []).filter((e) => e.type !== 'TP1_USER'), ...(tp1 && last.type !== 'TP1' ? [{ type: 'TP1_USER', t: tp1.t, price: tp1.price }] : [])];
      upd.events = evs;
      upd.r = closeR({ ...t, events: evs }, last.price);
      upd.result = RES[last.type] ?? 'MANUEL';
      upd.exit = last.price; upd.closedAt = last.t; upd.auto = true;
      upd.resultUsd = +(upd.r * (Number(t.riskUsd) || 0)).toFixed(2);
      closed++;
    }
    await trades.put(upd);
  }
  if (closed) toast(`${closed} işlem tarama sonucuna göre kapandı — günlükte kontrol et`);
  // Girmedim → sanal sonuç (kaçan R)
  const sk = skipped.all();
  let ch = false;
  for (const x of sk) {
    if (x.virtual_result_r !== null && x.virtual_result_r !== undefined) continue;
    const tk = trackOf(App, x.signal_id);
    if (tk?.status === 'KAPANDI') { x.virtual_result_r = tk.resultR ?? 0; x.virtual_outcome = tk.events.at(-1)?.type ?? '—'; ch = true; }
    else if (tk?.status === 'DOLMADI') { x.virtual_result_r = 0; x.virtual_outcome = 'DOLMADI'; ch = true; }
  }
  if (ch) for (const x of sk) skipped.put(x);
}

function steps(t, tk) {
  const ev = new Set([...(t.events ?? []).map((e) => e.type), ...(tk?.events ?? []).map((e) => e.type)]);
  const tp1 = ev.has('TP1') || ev.has('TP1_USER'), be = ev.has('BE_USER') || ev.has('BE');
  const out = [[tp1, `TP1 ${price(t.tp1, t.dec)} → %50 kapat`], [be || ev.has('TP2'), 'SL\'yi girişe çek (BE)']];
  if (t.tp2) out.push([ev.has('TP2'), `TP2 ${price(t.tp2, t.dec)} → kalanı kapat`]);
  if (t.strategy === 'G') out.push([false, '20:00 TR zorunlu kapanış · haber öncesi T1 yoksa çık']);
  if (t.strategy === 'F') out.push([false, 'Başarısız spring/UTAD → ÇIKIŞ']);
  if (t.strategy === 'E') out.push([false, 'RB fitil ucunun ötesinde gövde kapanışı → ÇIKIŞ']);
  return out;
}

export async function renderLive(App, el, openSignal) {
  await syncTrades(App);
  const all = (await trades.all()).sort((a, b) => b.t - a.t);
  const open = all.filter((t) => !t.result);
  const st = App.data.state;
  const card = (t) => {
    const cfg = App.conf.symbols?.[t.symbol] ?? {};
    t.dec = cfg.decimals ?? 2;
    const tk = trackOf(App, sigOf(t));
    const px = t.symbol === 'BTCUSD' && t.strategy === 'F' ? st?.symbols?.BTCUSD?.price ?? tk?.lastPrice : st?.symbols?.[t.symbol]?.price ?? tk?.lastPrice;
    const risk = Math.abs(t.entry - t.stop);
    const liveR = Number.isFinite(px) && risk > 0 ? ((px - t.entry) * t.dir) / risk : null;
    const to = (lvl) => (Number.isFinite(px) && lvl ? `${price(Math.abs(lvl - px), t.dec)}` : '—');
    const rCls = liveR === null ? '' : liveR >= 0 ? 'pos' : 'neg';
    return `<div class="card live ${t.dir === 1 ? 'dl' : 'ds'} ${openSignal && sigOf(t) === openSignal ? 'flash' : ''}" data-trade="${t.id}">
      <div class="row" style="justify-content:space-between"><div><span class="dir ${t.dir === 1 ? 'long' : 'short'}">${dirTxt(t.dir)}</span> <b>${esc(SHORT[t.symbol] ?? t.symbol)} · ${esc(t.strategy)}</b> <span class="muted small">${esc(t.sub ?? '')}</span></div>
        <div class="liveR ${rCls}">${liveR === null ? '—' : `${liveR >= 0 ? '+' : ''}${liveR.toFixed(2)}R`}</div></div>
      <div class="ogrid">
        <span class="k">Fiyat</span><span class="v">${price(px, t.dec)}</span><span class="d">${st?.lastScan ? `${tr(st.lastScan)} itibarıyla` : ''}</span>
        <span class="k">Giriş</span><span class="v">${price(t.entry, t.dec)}</span><span class="d">lot ${t.lot ?? '—'} · ${dur(Date.now() - t.t)} önce</span>
        <span class="k" style="color:var(--short)">SL</span><span class="v">${price(t.stop, t.dec)}</span><span class="d">kalan ${to(t.stop)}</span>
        <span class="k" style="color:var(--info)">TP1</span><span class="v">${price(t.tp1, t.dec)}</span><span class="d">kalan ${to(t.tp1)}</span>
        ${t.tp2 ? `<span class="k" style="color:var(--info)">TP2</span><span class="v">${price(t.tp2, t.dec)}</span><span class="d">kalan ${to(t.tp2)}</span>` : ''}
        <span class="k">MAE/MFE</span><span class="v small">${t.maeR !== undefined ? `−${t.maeR}R / +${t.mfeR}R` : '—'}</span><span class="d">tarama takibi</span>
      </div>
      <div class="steps">${steps(t, tk).map(([ok, l]) => `<div>${ok ? '✅' : '⬜'} ${esc(l)}</div>`).join('')}</div>
      ${tk?.events?.length ? `<div class="muted small">Tarama: ${tk.events.map((e) => `${e.type} ${tr(e.t)}`).join(' · ')}</div>` : !sigOf(t) ? '<div class="muted small">Elle eklenen işlem — otomatik takip yok</div>' : ''}
      <div class="btns"><button class="btn" data-tp1>TP1 alındı</button><button class="btn" data-be>BE yapıldı</button><button class="btn primary" data-close>Kapattım…</button></div>
    </div>`;
  };
  const sk = skipped.all().sort((a, b) => b.t - a.t);
  const done = sk.filter((x) => x.virtual_result_r !== null && x.virtual_result_r !== undefined);
  const missed = done.reduce((a, x) => a + x.virtual_result_r, 0);
  const byReason = {};
  for (const x of done) { byReason[x.reasonText] = byReason[x.reasonText] ?? { n: 0, r: 0 }; byReason[x.reasonText].n++; byReason[x.reasonText].r += x.virtual_result_r; }
  const notMine = openSignal && !open.some((t) => sigOf(t) === openSignal) ? trackOf(App, openSignal) : null;
  el.innerHTML = `<div class="h1">Açık işlemler</div>
    ${notMine ? `<div class="card"><b>Bu sinyale girmedin.</b> <span class="muted">Tarama takibi: ${esc(notMine.status)}${notMine.resultR !== undefined ? ` · ${notMine.resultR >= 0 ? '+' : ''}${notMine.resultR}R` : ''}</span></div>` : ''}
    ${open.map(card).join('') || '<div class="card empty">Açık işlem yok · TAM kartında "Girdim" ile başlar</div>'}
    <div class="card"><h2>Girmediklerim</h2>
      <div class="kv"><span>Kayıt <b>${sk.length}</b></span><span>Sonuçlanan <b>${done.length}</b></span><span>Kaçan <b>${missed >= 0 ? '+' : ''}${missed.toFixed(2)}R</b></span></div>
      <div class="bars" style="margin-top:8px">${Object.entries(byReason).map(([k, v]) => `<div class="bar"><span>${esc(k)}</span><span class="muted small">${v.n} sinyal</span><span class="num">${v.r >= 0 ? '+' : ''}${v.r.toFixed(2)}R</span></div>`).join('')}</div>
      <div class="list" style="margin-top:8px">${sk.slice(0, 20).map((x) => `<div class="li"><span class="dir ${x.dir === 1 ? 'long' : 'short'}" style="font-size:.85rem">${dirTxt(x.dir)}</span><div class="grow"><b>${esc(SHORT[x.symbol] ?? x.symbol)} ${esc(x.strategy)}</b> · ${esc(x.reasonText)}${x.note ? ` — ${esc(x.note)}` : ''}<div class="muted small">${dateTR(x.t)} ${tr(x.t)} TR</div></div><span class="num">${x.virtual_result_r === null || x.virtual_result_r === undefined ? 'takipte' : `${x.virtual_outcome} ${x.virtual_result_r >= 0 ? '+' : ''}${x.virtual_result_r}R`}</span></div>`).join('') || '<div class="empty">TAM kartında "Girmedim" ile eklenir</div>'}</div>
    </div>`;
  el.querySelectorAll('[data-trade]').forEach((c) => {
    const t = open.find((x) => x.id === c.dataset.trade);
    const addEv = async (type, p) => { t.events = [...(t.events ?? []), { type, t: Date.now(), price: p }]; await trades.put(t); App.render(); };
    c.querySelector('[data-tp1]').addEventListener('click', () => addEv('TP1_USER', t.tp1).then(() => toast('TP1 işaretlendi — %50 kapat, SL girişe')));
    c.querySelector('[data-be]').addEventListener('click', () => addEv('BE_USER', t.entry).then(() => toast('BE işaretlendi')));
    c.querySelector('[data-close]').addEventListener('click', () => closeModal(App, t));
  });
}

function closeModal(App, t) {
  const px = App.data.state?.symbols?.[t.symbol]?.price;
  modal(`<h3>Kapattım — ${esc(SHORT[t.symbol] ?? t.symbol)} ${esc(t.strategy)} ${dirTxt(t.dir)}</h3>
    <div class="form"><div class="field"><label>Çıkış fiyatı</label><input id="cx" type="number" step="any" value="${Number.isFinite(px) ? px : ''}" style="min-height:48px"></div>
    <div class="field"><label>Kurallara uyuldu mu?</label><select id="cr"><option value="">—</option><option value="yes">Evet</option><option value="no">Hayır</option></select></div>
    <div class="field" style="grid-column:1/-1"><label>Not</label><textarea id="cn" rows="2">${esc(t.note ?? '')}</textarea></div></div>
    <div class="btns"><button class="btn primary big" data-ok>Kaydet</button></div>`, (sh, close) => {
    sh.querySelector('[data-ok]').addEventListener('click', async () => {
      const x = Number(sh.querySelector('#cx').value);
      if (!(x > 0)) return toast('Çıkış fiyatı gir');
      const r = closeR(t, x);
      const rf = sh.querySelector('#cr').value;
      Object.assign(t, { exit: x, closedAt: Date.now(), r, result: Math.abs(x - t.entry) < 1e-9 ? 'BE' : r > 0 && Math.abs(x - (t.tp2 ?? t.tp1)) / Math.abs(t.entry - t.stop) < 0.05 ? 'TP' : r <= -0.95 ? 'SL' : 'MANUEL',
        resultUsd: +(r * (Number(t.riskUsd) || 0)).toFixed(2), rules_followed: rf === '' ? null : rf === 'yes', note: sh.querySelector('#cn').value, events: [...(t.events ?? []), { type: 'MANUAL_CLOSE', t: Date.now(), price: x }] });
      await trades.put(t); close(); toast(`Kapandı · ${r >= 0 ? '+' : ''}${r}R`); App.render();
    });
  });
}
