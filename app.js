// Strateji Radar — PWA giriş noktası
import { DATA_BASE, TABS, STRATS, SHORT, ACTIONS_URL, SECRETS_URL, loadStaticConfig } from './app/config.js';
import { data, refresh, loadCached } from './app/data.js';
import { loadSettings, saveSettings, trades, skipped } from './app/store.js';
import { fxToUsd } from './app/calc.js';
import { openRiskPct, deadlineTxt } from './app/order.js';
import { tr, ny, dur, nyMinutes, parseHM, nyDayStart, MIN, DAY, HOUR, trMinutes, trDayStart, esc, dateTR } from './app/fmt.js';
import { renderOverview, renderStrategy, tabBest, allSetups } from './app/views.js';
import { renderNews, renderJournal, renderHistory, notifHistory } from './app/views2.js';
import { renderSettings, onboarding } from './app/settings.js';
import { toast } from './app/ui.js';

const App = {
  settings: loadSettings(), conf: {}, data, dataBase: DATA_BASE, links: { actions: ACTIONS_URL, secrets: SECRETS_URL },
  methodSel: {}, orderType: {}, skipped: {}, histFilter: {}, flashIds: new Set(), chartCtl: null, limits: { reached: false, why: '' },
  save() { saveSettings(this.settings); },
  go(h) { if (location.hash === h) this.render(); else location.hash = h; },
  applyTheme() {
    document.documentElement.dataset.theme = this.settings.theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.font = this.settings.fontSize === 'large' ? 'large' : 'normal';
    document.querySelector('meta[name=theme-color]').content = this.settings.theme === 'light' ? '#F6F8FA' : '#0E1116';
  },
  /** Günlük işlem / kayıp limiti doluysa tüm setuplar YOK gösterilir */
  effective(s) {
    if (s.strategy === 'F' && this.limits.openF && s.status !== 'YOK') return { ...s, status: 'YOK', limitNote: 'Açık F işlemi var — aynı anda en fazla 1 F işlemi', none: { why: 'Açık F işlemi var (günlükte sonucu girilmemiş)', waiting: 'Açık F işleminin kapanması', ends: '—' } };
    if (!this.limits.reached || s.status === 'YOK') return s;
    return { ...s, status: 'YOK', limitNote: this.limits.why, none: { why: this.limits.why, waiting: 'Yarın (TR 00:00) sıfırlanır', ends: '—' } };
  },
  render() { render(); },
};
window.App = App;

/* ---------- Üst çubuk ---------- */
function activeKz(now) {
  const kz = App.conf.sessions?.killzones ?? [];
  const m = nyMinutes(now);
  const cur = kz.find((k) => m >= parseHM(k.start) && m < parseHM(k.end));
  if (cur) return { on: true, name: cur.name, left: nyDayStart(now) + parseHM(cur.end) * MIN - now };
  let best = null;
  for (let d = 0; d < 3 && !best; d++) for (const k of kz) { const at = nyDayStart(now) + d * DAY + parseHM(k.start) * MIN; if (at > now && (!best || at < best.at)) best = { at, name: k.name }; }
  return { on: false, name: best?.name, at: best?.at };
}
function topbar() {
  const now = Date.now();
  const st = data.state;
  const kz = activeKz(now);
  const age = st ? now - st.lastScan : Infinity;
  const sc = App.conf.params?.scan ?? { staleWarnMin: 15, staleErrorMin: 30 };
  const inWin = scanWindowOpen(now);
  const cls = !st ? 'err' : !inWin ? 'ok' : age > sc.staleErrorMin * MIN ? 'err' : age > sc.staleWarnMin * MIN ? 'warn' : 'ok';
  const used = st?.credits?.used ?? 0, stop = st?.credits?.hardStop ?? 760;
  const pctc = Math.min(100, (used / stop) * 100);
  document.getElementById('topbar').innerHTML = `
    <div class="grp"><span class="clock">🕐 ${tr(now)} <span class="muted">TR</span></span><span class="muted num">${ny(now)} NY</span></div>
    <span class="sep"></span>
    <div class="grp"><span class="kz ${kz.on ? 'on' : ''}"><span class="dot"></span>${kz.on ? `${kz.name} <span class="muted">(kalan ${dur(kz.left)})</span>` : `Killzone dışı <span class="muted">· ${kz.name ?? ''} ${kz.at ? tr(kz.at) : ''}</span>`}</span></div>
    <span class="sep"></span>
    <div class="grp scan ${cls}" title="Son tarama">Son tarama ${st ? tr(st.lastScan) : '—'} ${cls === 'ok' ? '✓' : cls === 'warn' ? '⚠' : '✕'}${st && inWin ? ` <span class="muted small">· sonraki ${tr(Math.floor(now / 300000) * 300000 + 300000 + 20000)}</span>` : ''}</div>
    <div class="grp" title="Twelve Data günlük kredi">Kredi <span class="num">${used}/${stop}</span> <span class="meter ${pctc > 95 ? 'err' : pctc > 85 ? 'warn' : ''}"><i style="width:${pctc}%"></i></span></div>
    <div class="grp right"><button class="icon-b" data-bell aria-label="Bildirim geçmişi">🔔</button><a class="icon-b" href="#/ayarlar" aria-label="Ayarlar" style="display:inline-flex;align-items:center;text-decoration:none;color:inherit">⚙</a></div>`;
  document.querySelector('[data-bell]').onclick = () => notifHistory(App);
}
function scanWindowOpen(now) {
  const sc = App.conf.params?.scan;
  if (!sc) return true;
  const dow = new Date(now + 3 * HOUR).getUTCDay();
  const m = trMinutes(now);
  const pre = sc.preWindowTR && sc.weekdays.includes(dow) && m >= parseHM(sc.preWindowTR[0]) && m < parseHM(sc.preWindowTR[1]);
  return pre || ((sc.weekdays.includes(dow) || sc.cryptoWeekend) && m >= parseHM(sc.windowTR[0]) && m < parseHM(sc.windowTR[1]));
}

/* ---------- Şeritler ---------- */
function banners() {
  const now = Date.now();
  const out = [];
  const pr = App.conf.params?.news ?? { beforeMin: 30, afterMin: 15 };
  const risk = (data.news?.events ?? []).filter((e) => e.impact === 'High' && now >= e.t - pr.beforeMin * MIN && now <= e.t + pr.afterMin * MIN);
  for (const e of risk) {
    const aff = Object.entries(App.conf.symbols ?? {}).filter(([k, c]) => (e.symbols ? e.symbols.includes(k) : e.currency === 'USD' || c.currencies.includes(e.currency))).map(([k]) => SHORT[k]);
    out.push(`<div class="banner news">🔴 HABER RİSKİ: ${esc(e.currency)} ${esc(e.title)} ${tr(e.t)} TR (${e.t > now ? dur(e.t - now) : 'şimdi'}) — ${aff.join('/')} askıda<a class="act btn" href="#/haber">Haber</a></div>`);
  }
  if (data.offline) out.push(`<div class="banner offline">Çevrimdışı · son veri ${data.state ? tr(data.state.lastScan) : '—'}</div>`);
  if (data.state?.credits?.exhausted) out.push('<div class="banner warn">Kredi bitti — tarama UTC 00:00 (03:00 TR) sonrası yeniden başlar. Son veriler gösteriliyor.</div>');
  if (data.state && !scanWindowOpen(now)) out.push(`<div class="banner info">Tarama penceresi dışında · Tarama ${App.conf.params?.scan?.windowTR?.[0] ?? '10:00'}'da başlar (Pzt–Cum${App.conf.params?.scan?.cryptoWeekend ? '; hafta sonu BTC/ETH' : ''}) · son günün özeti gösteriliyor</div>`);
  if (data.news && (now - (data.news.ffFetchedAt ?? data.news.fetchedAt) > 2 * HOUR || data.news.stale)) out.push('<div class="banner warn">Takvim eski — haber kontrolünü takvim sitesinden de yapın</div>');
  const errs = data.state?.errors ?? [];
  if (errs.length) out.push(`<div class="banner warn" title="${esc(errs.join(' | '))}">⚠ Veri/API hatası: ${esc(errs[0])}${errs.length > 1 ? ` (+${errs.length - 1})` : ''} — sorun sürerse Actions loglarına bakın</div>`);
  for (const w of data.state?.warnings ?? []) out.push(`<div class="banner info">${esc(w)}</div>`);
  if (App.limits.reached) out.push(`<div class="banner warn">⛔ ${esc(App.limits.why)} — tüm setuplar YOK gösteriliyor</div>`);
  document.getElementById('banners').innerHTML = out.join('');
}

/* ---------- Menü ---------- */
function nav(route) {
  const item = (href, ico, label, extra = '', cls = '') => `<a href="${href}" class="${cls} ${route.top === href.split('/')[1] ? 'on' : ''}"><span class="ico">${ico}</span><span class="lbl">${label}</span>${extra}</a>`;
  const tabs = TABS.map((t) => {
    const { best, tam } = tabBest(App, t);
    const ic = best ? ({ TAM: '🔵', BEKLE: '🟠', EKSIK: '🟡' })[best.status] ?? '⚪' : '⚪';
    return item(`#/${t.id}`, t.icon, t.label, `<span>${ic}${tam > 1 ? `<span class="pill tam">${tam}</span>` : tam === 1 ? '' : ''}</span>`);
  }).join('');
  const el = document.getElementById('nav');
  el.innerHTML = item('#/ozet', '◉', 'Özet') + tabs + '<hr>' + item('#/haber', '📰', 'Haber', '', 'sec') + item('#/gunluk', '📒', 'Günlük', '', 'sec') + item('#/gecmis', '🕘', 'Geçmiş', '', 'sec') + item('#/ayarlar', '⚙', 'Ayarlar', '', 'sec') + '<a href="#" class="more" data-more><span class="ico">⋯</span><span class="lbl">Diğer</span></a>';
  el.querySelector('[data-more]').onclick = (e) => { e.preventDefault(); el.classList.toggle('open'); };
  el.querySelectorAll('a:not([data-more])').forEach((a) => a.addEventListener('click', () => el.classList.remove('open')));
}

/* ---------- Yönlendirme ---------- */
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const p0 = parts[0] || 'ozet';
  if (['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(p0)) return { top: STRATS[p0].tab, s: p0, sym: parts[1], id: parts[2] };
  if (['AB', 'C', 'D', 'E', 'F', 'G'].includes(p0)) return { top: p0 };
  return { top: p0, sub: parts[1] };
}
async function render() {
  const route = parseRoute();
  topbar(); banners(); nav(route);
  const el = document.getElementById('main');
  if (!['AB', 'C', 'D', 'E', 'F', 'G'].includes(route.top)) { App.chartCtl?.destroy?.(); App.chartCtl = null; }
  try {
    if (route.top === 'ozet') renderOverview(App, el);
    else if (TABS.some((t) => t.id === route.top)) renderStrategy(App, el, route.top, route);
    else if (route.top === 'haber') renderNews(App, el, route.sub);
    else if (route.top === 'gunluk') await renderJournal(App, el, route.sub);
    else if (route.top === 'gecmis') renderHistory(App, el);
    else if (route.top === 'ayarlar') renderSettings(App, el);
    else renderOverview(App, el);
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="card"><h2>Görüntüleme hatası</h2><p class="muted">${esc(e.message)}</p><button class="btn" data-refresh>Yeniden dene</button></div>`;
  }
  el.querySelectorAll('[data-go]').forEach((x) => x.addEventListener('click', () => App.go(x.dataset.go)));
  el.querySelectorAll('[data-refresh]').forEach((x) => x.addEventListener('click', () => reload(true)));
  App.flashIds.clear();
}

/* Son giriş sayaçları (EK §3.5): kart yeniden çizilmeden metin güncellenir */
function tickDeadlines() {
  document.querySelectorAll('[data-deadline]').forEach((el) => { const t = Number(el.dataset.deadline); el.innerHTML = deadlineTxt({ t, left: t - Date.now(), expired: Date.now() >= t }); el.classList.toggle('exp', Date.now() >= t); });
}

/* ---------- Veri döngüsü ---------- */
async function computeLimits() {
  const s = App.settings;
  const maxN = Number(s.maxTradesPerDay), maxL = Number(s.maxDailyLossPct);
  const allTrades = await trades.all();
  const balUsd = (Number(s.balance) || 0) * (fxToUsd(s, App.data.state) ?? 0);
  App.limits = { reached: false, why: '', openF: allTrades.some((t) => t.strategy === 'F' && !t.result), openRiskPct: openRiskPct(allTrades, balUsd) };
  App.skipped = skipped.map();
  if (!(maxN > 0) && !(maxL > 0)) return;
  const today = trDayStart(Date.now());
  const list = allTrades.filter((t) => t.t >= today);
  if (maxN > 0 && list.length >= maxN) App.limits = { ...App.limits, reached: true, why: `Günlük işlem limiti doldu (${list.length}/${maxN})` };
  const lossUsd = list.reduce((a, t) => a + (Number(t.r) < 0 ? -Number(t.r) * (t.riskUsd || 0) : 0), 0);
  if (maxL > 0 && balUsd > 0 && lossUsd > 0 && lossUsd >= (balUsd * maxL) / 100) App.limits = { ...App.limits, reached: true, why: `BUGÜN DUR — günlük zarar limiti doldu (−$${lossUsd.toFixed(0)} ≥ %${maxL})` };
}
let lastFull = 0;
async function reload(manual = false, api = false) {
  const prev = new Map(allSetups(App).map((s) => [s.id, s.status]));
  const prevGen = data.state?.generatedAt;
  // state.json 15 sn'de bir; haber ve geçmiş dakikada bir (gereksiz istek yok)
  const full = manual || Date.now() - lastFull > 55000;
  const ok = await refresh(full ? ['state', 'news', 'history'] : ['state'], api || manual);
  if (full && ok) lastFull = Date.now();
  await computeLimits();
  if (data.state?.generatedAt !== prevGen) for (const s of allSetups(App)) if (prev.has(s.id) && prev.get(s.id) !== s.status) App.flashIds.add(s.id);
  if (manual) toast(ok ? `Güncellendi · son tarama ${data.state ? tr(data.state.lastScan) : '—'}` : 'Veri alınamadı — son kopya gösteriliyor');
  if (manual || data.state?.generatedAt !== prevGen || !ok) render();
}

/* ---------- Aşağı çekerek yenile ---------- */
function pullToRefresh() {
  const ptr = document.getElementById('ptr');
  let y0 = null, pulled = false;
  window.addEventListener('touchstart', (e) => { y0 = window.scrollY === 0 && !e.target.closest('.chart-box, .modal') ? e.touches[0].clientY : null; pulled = false; }, { passive: true });
  window.addEventListener('touchmove', (e) => { if (y0 === null) return; const dy = e.touches[0].clientY - y0; pulled = dy > 80; ptr.classList.toggle('show', dy > 30); ptr.textContent = pulled ? '↻ Bırak, yenile' : '↓ Yenilemek için çek'; }, { passive: true });
  window.addEventListener('touchend', () => { if (y0 !== null && pulled) reload(true); y0 = null; ptr.classList.remove('show'); });
}

/* ---------- Başlat ---------- */
(async function main() {
  App.applyTheme();
  App.conf = await loadStaticConfig();
  loadCached();
  render();
  await reload(false, true); // açılışta API (anında güncel)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW kaydı başarısız', e));
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'navigate' && e.data.url) location.hash = e.data.url.split('#')[1] ?? '/ozet'; if (e.data?.type === 'push') reload(); });
  }
  window.addEventListener('hashchange', render);
  window.addEventListener('online', () => reload());
  window.addEventListener('offline', () => { data.offline = true; render(); });
  setInterval(() => { topbar(); tickDeadlines(); }, 15000);
  // Tarama her 5 dakikanın ~20. saniyesinde yazar. O anda GitHub API'den (anında güncel) okunur;
  // diğer zamanlarda raw adres (sınırsız ama ~5 dk önbellekli). API: 5 dk'da en fazla 3 istek.
  let slot = 0, tries = 0, lastTry = 0;
  setInterval(() => {
    const now = Date.now(), s = Math.floor(now / 300000) * 300000;
    if (s !== slot) { slot = s; tries = 0; }
    const fresh = (data.state?.lastScan ?? 0) >= s;
    if (!fresh && !document.hidden && scanWindowOpen(now) && now - s >= 23000 && tries < 3 && now - lastTry >= 10000) { tries++; lastTry = now; reload(false, true); }
  }, 2000);
  setInterval(() => reload(), 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) reload(false, true); });
  pullToRefresh();
  if (!App.settings.onboarded) onboarding(App);
})();
export { dateTR };
