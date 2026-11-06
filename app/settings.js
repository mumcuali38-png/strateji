import { ACTIONS_URL, PARAMS_EDIT_URL, RULES_URL, SECRETS_URL, SHORT, VERSION } from './config.js';
import { esc, tr, dateTR, ago } from './fmt.js';
import { copy, modal, toast } from './ui.js';
import { DEFAULTS } from './store.js';
import { instrOf, fxToUsd } from './calc.js';

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => { const p = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4); return Uint8Array.from(atob(p), (c) => c.charCodeAt(0)); };

/** Tarayıcıda VAPID anahtar çifti üret (ECDSA P-256) — web-push ile uyumlu base64url */
export async function genVapid() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = await crypto.subtle.exportKey('raw', k.publicKey);
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey);
  return { publicKey: b64u(pub), privateKey: jwk.d };
}
export function prefsOf(App) {
  const s = App.settings;
  return {
    strategies: s.notify.strategies, matrix: s.notify.matrix, ready: s.notify.ready, news: s.notify.news, cancel: s.notify.cancel, direction: s.notify.direction !== false,
    quiet: s.notify.quiet?.from && s.notify.quiet?.to ? s.notify.quiet : null,
    // Bakiye USD'ye çevrilmiş gider (sunucu lotu USD hesaplar); enstrüman doğrulanmadıysa bildirimde lot yazılmaz
    balance: s.instrConfirmed && Number(s.balance) ? +(Number(s.balance) * (fxToUsd(s, App.data.state) ?? 0)).toFixed(2) : undefined, riskPct: Number(s.riskPct), currency: s.currency,
    instr: Object.fromEntries(Object.keys(App.conf.symbols ?? {}).map((k) => { const i = instrOf(k, App.conf.symbols[k], s); return [k, { valuePerUnit: i.valuePerUnit, lotStep: i.lotStep, minLot: i.minLot }]; })),
  };
}
export async function subscribe(App) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Bu tarayıcı Web Push desteklemiyor');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Bildirim izni verilmedi');
  const key = App.data.state?.vapidPublic || App.settings.vapidPublic;
  if (!key) throw new Error('VAPID genel anahtarı yok — önce Ayarlar > Bildirim > "VAPID anahtarı üret" ve secret olarak ekleyin');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && App.settings.subKey && App.settings.subKey !== key) { await sub.unsubscribe(); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(key) });
  App.settings.subKey = key; App.save();
  return sub.toJSON();
}
export async function subscriptionCode(App) {
  const sub = await subscribe(App);
  return JSON.stringify({ ...sub, label: `${navigator.userAgent.includes('Android') ? 'Android' : 'Cihaz'} ${new Date().toISOString().slice(0, 10)}`, prefs: prefsOf(App) });
}
export async function testNotification() {
  const reg = await navigator.serviceWorker.ready;
  if (Notification.permission !== 'granted') await Notification.requestPermission();
  await reg.showNotification('🔔 Test bildirimi (yerel)', { body: 'Bu cihazda bildirim gösterimi çalışıyor. Sunucu testi için Actions → scan → push_test.', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'local-test', data: { url: './#/ayarlar' } });
}

export function renderSettings(App, el) {
  const s = App.settings, st = App.data.state, P = App.conf.params, syms = App.conf.symbols ?? {};
  const field = (path, label, val, type = 'number', ph = '') => `<div class="field"><label>${label}</label><input data-path="${path}" type="${type}" step="any" value="${esc(val ?? '')}" placeholder="${esc(ph)}"></div>`;
  const sw = (path, label, val) => `<label class="switch"><span>${label}</span><input type="checkbox" data-path="${path}" ${val ? 'checked' : ''}></label>`;
  const now = new Date();
  const dstNote = now.getUTCMonth() >= 2 && now.getUTCMonth() <= 10;
  const credDays = st?.credits?.days ?? [];
  const stratSym = { A: ['XAUUSD'], B: ['XAUUSD'], C: ['US100'], D: ['US100', 'XAUUSD', 'GBPUSD', 'BTCUSD', 'ETHUSD'], E: ['EURUSD', 'XAUUSD', 'GBPUSD'], F: ['BTCUSD'], G: ['XAUUSD'] };
  const draft = s.paramsDraft ?? P ?? {};
  el.innerHTML = `<div class="h1">Ayarlar</div>
  <div class="card"><h2>Hesap</h2><div class="form">
    ${field('balance', 'Hesap bakiyesi (zorunlu)', s.balance, 'number', 'örn. 10000')}
    <div class="field"><label>Hesap para birimi</label><select data-path="currency">${['USD', 'EUR', 'TRY'].map((c) => `<option ${s.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    ${field('riskPct', 'İşlem başı risk %', s.riskPct)}
    ${field('maxDailyLossPct', 'Günlük maks. zarar %', s.maxDailyLossPct)}
    ${field('maxOpenRiskPct', 'Aynı anda maks. toplam risk %', s.maxOpenRiskPct)}
    ${field('maxTradesPerDay', 'Günlük maks. işlem (opsiyonel)', s.maxTradesPerDay, 'number', 'boş = limit yok')}
    <div class="field"><label>Broker bağlantısı</label><select data-path="broker"><option value="off" selected>Kapalı</option><option value="metaapi" disabled>MetaApi (yakında)</option><option value="ea" disabled>EA Köprüsü (yakında)</option></select></div>
  </div>
  <div class="muted small">${!Number(s.balance) ? '<b style="color:var(--eksik)">⚙️ Bakiye girilmeden lot hesaplanmaz (AYAR GEREKLİ).</b> ' : ''}${s.currency !== 'USD' ? `Kur ${s.currency}→USD: <b class="num">${fxToUsd(s, st)?.toFixed(4) ?? 'henüz yok (günde 1 kez çekilir)'}</b> · ` : ''}Günlük zarar limiti aşılırsa (günlüğe göre) tüm setuplar YOK gösterilir.</div></div>

  <div class="card"><h2>Enstrüman tablosu</h2>
    <p class="muted small">Brokerındaki değerlerle karşılaştır, farklıysa düzelt, sonra <b>Değerleri doğruladım</b>'a bas. Doğrulanmadan lot hesaplanmaz.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Sembol</th><th>Broker sembolü</th><th>1 lotta değer</th><th>Lot adımı</th><th>Min lot</th><th>Tipik spread</th><th>Stop tamponu</th></tr></thead><tbody>
    ${Object.entries(syms).map(([k, c]) => { const i = instrOf(k, c, s); const inp = (path, v, w = 96, type = 'number') => `<input data-path="${path}" type="${type}" step="any" value="${esc(v ?? '')}" style="width:${w}px;min-height:44px">`; return `<tr><td><b>${esc(c.label)}</b></td><td>${inp(`instr.${k}.brokerSymbol`, i.brokerSymbol, 110, 'text')}</td><td class="num"><span class="muted small">${esc(i.unitLabel)} = $</span>${inp(`instr.${k}.valuePerUnit`, i.valuePerUnit, 80)}</td><td>${inp(`instr.${k}.lotStep`, i.lotStep, 70)}</td><td>${inp(`instr.${k}.minLot`, i.minLot, 70)}</td><td>${inp(`instr.${k}.spread`, i.spread, 90)} <span class="muted small">${i.spreadType === 'us100pts' ? 'puan' : 'fiyat'}</span></td><td>${inp(`buffers.${k}`, s.buffers?.[k] ?? '', 80).replace('value=""', `placeholder="${c.buffer}"`)} <span class="muted small">${c.bufferType === 'pct' ? '%' : c.bufferType === 'us100pts' ? 'puan' : 'fiyat'}</span></td></tr>`; }).join('')}
    </tbody></table></div>
    <div class="btns"><button class="btn ${s.instrConfirmed ? '' : 'primary'}" data-confirm-instr>${s.instrConfirmed ? '✓ Doğrulandı · ' + dateTR(s.instrConfirmed) : 'Değerleri doğruladım'}</button></div>
    <div class="form" style="margin-top:10px">${field('us100Price', 'US100 güncel fiyatı (QQQ oranı için)', s.us100Price, 'number', 'örn. 25000')}</div>
    <div class="muted small">US100 seviyeleri QQQ fiyatıdır; US100 fiyatı girilirse oran (US100/QQQ) ile çevrilip yanında gösterilir. "Pip" notu: XAU'da 1 pip brokera göre 0.01 veya 0.10 $ olabilir — uygulama mesafeleri fiyat/dolar cinsinden gösterir.</div></div>

  <div class="card"><h2>Bildirim</h2>
    <ol class="steps">
      <li>Bildirim izni ver ve abonelik kodunu kopyala → <a href="${SECRETS_URL}" target="_blank" rel="noopener">GitHub Secrets</a>'ta <span class="mono">PUSH_SUBSCRIPTIONS</span> değerine yapıştır (birden fazla cihaz: <span class="mono">[kod1, kod2]</span>).</li>
      <li>Aşağıdaki tercihleri değiştirirsen kodu <b>yeniden kopyalayıp</b> secret'ı güncelle (tercihler kodun içinde taşınır).</li>
    </ol>
    <div class="btns"><button class="btn primary" data-sub>🔔 İzin ver + abonelik kodunu kopyala</button><button class="btn" data-test>Test bildirimi gönder</button><a class="btn" href="${ACTIONS_URL}" target="_blank" rel="noopener">Sunucu testi (Actions)</a></div>
    <textarea class="code hidden" id="subcode" readonly></textarea>
    <div style="margin-top:10px">${sw('notify.ready', '🟡 "Hazırlan" (1 şart kaldı) bildirimleri', s.notify.ready)}${sw('notify.news', '⚠️ Haber riski bildirimleri', s.notify.news)}${sw('notify.cancel', '⛔ İptal bildirimleri', s.notify.cancel)}${sw('notify.direction', '🧭 Piyasa Yönü etiket değişimi (sessiz, günde en fazla 3)', s.notify.direction !== false)}</div>
    <div class="form">${field('notify.quiet.from', 'Sessiz saat başlangıç (TR)', s.notify.quiet?.from, 'time')}${field('notify.quiet.to', 'Sessiz saat bitiş (TR)', s.notify.quiet?.to, 'time')}</div>
    <div class="muted small">Sessiz saatlerde bildirimler sessiz gelir; sadece 🔵 TAM ve ⛔ ÇIKIŞ sesli.</div>
    <h3 style="margin-top:12px">Strateji × sembol</h3>
    <div class="tbl-wrap"><table class="mx"><thead><tr><th></th>${Object.keys(SHORT).map((y) => `<th>${SHORT[y]}</th>`).join('')}</tr></thead><tbody>
    ${['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((k) => `<tr><th><label class="chk" style="min-height:40px"><input type="checkbox" data-path="notify.strategies.${k}" ${s.notify.strategies?.[k] !== false ? 'checked' : ''}> ${k}</label></th>${Object.keys(SHORT).map((y) => stratSym[k].includes(y) ? `<td><input type="checkbox" data-path="notify.matrix.${k}:${y}" ${s.notify.matrix?.[`${k}:${y}`] !== false ? 'checked' : ''} aria-label="${k} ${y}"></td>` : '<td class="muted">·</td>').join('')}</tr>`).join('')}
    </tbody></table></div>
    <details style="margin-top:12px"><summary class="btn">🔑 VAPID anahtarı (ilk kurulum)</summary>
      <p class="muted small">Bildirim için bir kez VAPID anahtar çifti gerekir. Bu cihazda üretilir, hiçbir yere gönderilmez. İki değeri GitHub Secrets'a ekle: <span class="mono">VAPID_PUBLIC</span> ve <span class="mono">VAPID_PRIVATE</span>. Gizli anahtarı başka yerde paylaşma.</p>
      <div class="btns"><button class="btn" data-vapid>Anahtar üret</button></div><div id="vapid"></div>
      <div class="field" style="margin-top:8px"><label>Genel anahtar (tarama henüz yayınlamadıysa)</label><input data-path="vapidPublic" type="text" value="${esc(s.vapidPublic ?? '')}" placeholder="${esc(st?.vapidPublic ?? 'B…')}"></div>
    </details></div>

  <div class="card"><h2>Parametreler</h2>
    <p class="muted small">Parametreler tarayıcıyı (GitHub Actions) etkiler. Burada değiştir → oluşan JSON'u kopyala → <a href="${PARAMS_EDIT_URL}" target="_blank" rel="noopener">config/params.json</a> dosyasına yapıştırıp "Commit changes". Bir sonraki taramada geçerli olur.</p>
    <div class="form">
      ${field('p.swing.5m', 'Swing n (1m/3m/5m)', draft.swing?.['5m'])}${field('p.swing.15m', 'Swing n (15m)', draft.swing?.['15m'])}${field('p.swing.1h', 'Swing n (1H)', draft.swing?.['1h'])}${field('p.swing.4h', 'Swing n (4H)', draft.swing?.['4h'])}${field('p.swing.1d', 'Swing n (1D)', draft.swing?.['1d'])}
      ${field('p.displacementMult', 'Displacement katsayısı', draft.displacementMult)}${field('p.A.maxOutsideBars', 'A: dışarıda maks. 5m mum', draft.A?.maxOutsideBars)}${field('p.A.maxExcursionAtr1h', 'A: maks. uzaklık (×ATR 1H)', draft.A?.maxExcursionAtr1h)}
      ${field('p.B.liqMinAtr', 'B: likidite min (×ATR)', draft.B?.liqMinAtr)}${field('p.B.liqMaxAtr', 'B: likidite maks (×ATR)', draft.B?.liqMaxAtr)}${field('p.B.confirmMaxBars', 'B: onay maks. mum', draft.B?.confirmMaxBars)}
      ${field('p.news.beforeMin', 'Haber penceresi önce (dk)', draft.news?.beforeMin)}${field('p.news.afterMin', 'Haber penceresi sonra (dk)', draft.news?.afterMin)}${field('p.risk.minRR', 'Minimum RR', draft.risk?.minRR)}
      <div class="field"><label>F: CHoCH zaman dilimi</label><select data-path="p.F.ltf"><option value="15m" ${draft.F?.ltf !== '5m' ? 'selected' : ''}>15m (varsayılan)</option><option value="5m" ${draft.F?.ltf === '5m' ? 'selected' : ''}>5m (daha hassas)</option></select></div>
      ${field('p.F.maxLeverage', 'F: maks. kaldıraç (x)', draft.F?.maxLeverage)}
      ${field('p.traders.minMonths', "Trader'lar: min. geçmiş (ay)", draft.traders?.minMonths)}${field('p.traders.maxDDPct', "Trader'lar: maks. DD %", draft.traders?.maxDDPct)}${field('p.traders.minTrades', "Trader'lar: min. işlem", draft.traders?.minTrades)}${field('p.traders.maxRisk', "Trader'lar: maks. risk skoru", draft.traders?.maxRisk)}${field('p.traders.minPairTrades90d', "Trader'lar: paritede 90 günde min. işlem", draft.traders?.minPairTrades90d)}
    </div>
    <label class="switch"><span>Kripto için hafta sonu tarama (BTC/ETH) — <b>kredi uyarısı:</b> hafta sonu ~240 kredi/gün (800'lük günlük limitin içinde; hafta içi bütçesini etkilemez)</span><input type="checkbox" data-path="p.scan.cryptoWeekend" ${draft.scan?.cryptoWeekend ? 'checked' : ''}></label>
    <div class="btns"><button class="btn primary" data-params>params.json önerisini kopyala</button><button class="btn" data-params-reset>Varsayılana dön</button></div></div>

  <div class="card"><h2>Görünüm</h2><div class="form">
    <div class="field"><label>Tema</label><select data-path="theme"><option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Koyu</option><option value="light" ${s.theme === 'light' ? 'selected' : ''}>Açık</option></select></div>
    <div class="field"><label>Yazı boyutu</label><select data-path="fontSize"><option value="normal" ${s.fontSize !== 'large' ? 'selected' : ''}>Normal</option><option value="large" ${s.fontSize === 'large' ? 'selected' : ''}>Büyük</option></select></div>
    <div class="field"><label>Grafik varsayılan TF</label><select data-path="chartTf"><option value="">Setupa göre</option>${['1m', '5m', '15m', '1h', '4h', '1d'].map((t) => `<option ${s.chartTf === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
  </div></div>

  <div class="card"><h2>Veri</h2>
    <div>Son tarama: <b>${st ? `${dateTR(st.lastScan)} ${tr(st.lastScan)} TR (${ago(st.lastScan)})` : '—'}</b></div>
    <div>Kredi: <b class="num">${st?.credits?.used ?? '—'}/800 bugün</b> <span class="muted small">(uygulama sınırı ${st?.credits?.hardStop ?? 760}, dakikada 7)</span> <span class="muted small">(sıfırlama UTC 00:00 = 03:00 TR)</span></div>
    <div class="bars" style="margin-top:8px">${credDays.slice(-7).map((d) => `<div class="bar"><span class="small">${d.date.slice(5)}</span><span class="t"><i style="width:${Math.min(100, (d.used / 800) * 100)}%"></i></span><span class="num">${d.used}</span></div>`).join('')}</div>
    <div style="margin-top:8px">Takvim güncelliği: <b>${App.data.news ? `${tr(App.data.news.fetchedAt)} TR (${ago(App.data.news.fetchedAt)})` : '—'}</b> · FMP: ${App.data.news?.fmp ?? '—'}</div>
    <div class="muted small">Veri adresi: <span class="mono">${esc(App.dataBase)}</span></div>
    <div class="btns"><a class="btn" href="#/gunluk">Günlük yedekle / yükle</a><button class="btn" data-onb>İlk kurulum adımlarını göster</button></div></div>

  <div class="card"><h2>Hakkında</h2>
    <p><b>Uygulama sinyal verir, karar senindir.</b> Strateji Radar sinyal ve durum gösterir, işlem açmaz. Karar her zaman kullanıcınındır.</p>
    <div class="btns"><button class="btn" data-hardrefresh>↻ Uygulamayı güncelle (önbelleği yenile)</button></div>
    <div class="muted small">Ayarların, günlüğün ve bildirim aboneliğin silinmez.</div>
    <div class="muted small">Sürüm ${esc(VERSION)} · <a href="${RULES_URL}" target="_blank" rel="noopener">Kural dosyası (MASTERPROMPT.md)</a></div>
    ${dstNote ? '<div class="warnline">⚠️ Mart–Kasım: New York yaz saatinde. Strateji saatleri bilinçli olarak sabit UTC-5\'tir; borsa saatleri 1 saat kaymış görünebilir.</div>' : ''}
  </div>`;

  const setPath = (obj, path, v) => { const ks = path.split('.'); let o = obj; for (const k of ks.slice(0, -1)) { o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}; o = o[k]; } o[ks[ks.length - 1]] = v; };
  el.querySelectorAll('[data-path]').forEach((inp) => inp.addEventListener('change', () => {
    const path = inp.dataset.path;
    const v = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
    if (path.startsWith('p.')) { s.paramsDraft = structuredClone(s.paramsDraft ?? P); setPath(s.paramsDraft, path.slice(2), v); }
    else if (path.startsWith('notify.matrix.')) { s.notify.matrix = s.notify.matrix || {}; s.notify.matrix[path.slice(14)] = v; }
    else setPath(s, path, v);
    if (path.startsWith('instr.')) s.instrConfirmed = 0;
    App.save(); App.applyTheme();
    if (/^(notify\.|instr\.|balance|riskPct|currency)/.test(path)) toast('Tercih kaydedildi — abonelik kodunu yeniden kopyalayın');
  }));
  el.querySelector('[data-sub]').addEventListener('click', async () => {
    try { const code = await subscriptionCode(App); const ta = el.querySelector('#subcode'); ta.value = code; ta.classList.remove('hidden'); await copy(code); }
    catch (e) { toast(e.message, 4000); }
  });
  el.querySelector('[data-hardrefresh]')?.addEventListener('click', async () => {
    toast('Güncelleniyor…');
    try {
      for (const k of await caches.keys()) if (k !== 'data-v1') await caches.delete(k);
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update();
    } catch { /* yok say */ }
    location.reload();
  });
  el.querySelector('[data-confirm-instr]').addEventListener('click', () => { s.instrConfirmed = Date.now(); App.save(); toast('Enstrüman değerleri doğrulandı — abonelik kodunu yeniden kopyalayın'); App.render(); });
  el.querySelector('[data-test]').addEventListener('click', async () => { try { await testNotification(); } catch (e) { toast(e.message); } });
  el.querySelector('[data-vapid]').addEventListener('click', async () => {
    const k = await genVapid();
    s.vapidPublic = k.publicKey; App.save();
    el.querySelector('#vapid').innerHTML = `<div class="field"><label>VAPID_PUBLIC</label><textarea class="code" style="min-height:60px" readonly>${k.publicKey}</textarea><button class="btn" data-cp="${k.publicKey}">Kopyala</button></div>
      <div class="field"><label>VAPID_PRIVATE (gizli!)</label><textarea class="code" style="min-height:44px" readonly>${k.privateKey}</textarea><button class="btn" data-cp="${k.privateKey}">Kopyala</button></div>`;
    el.querySelectorAll('[data-cp]').forEach((b) => b.addEventListener('click', () => copy(b.dataset.cp)));
  });
  el.querySelector('[data-params]').addEventListener('click', () => copy(JSON.stringify(s.paramsDraft ?? P, null, 2)));
  el.querySelector('[data-params-reset]').addEventListener('click', () => { s.paramsDraft = null; App.save(); App.render(); toast('Depodaki değerler gösteriliyor'); });
  el.querySelector('[data-onb]').addEventListener('click', () => onboarding(App, true));
}

export function onboarding(App, force = false) {
  if (App.settings.onboarded && !force) return;
  let step = 0;
  const steps = [
    () => `<h2>1/3 · Ana ekrana ekle</h2><p>Chrome'da sağ üstteki <b>⋮</b> menüsüne dokun → <b>Ana ekrana ekle</b> → <b>Yükle</b>.</p>
      <div class="illus">┌──────────────────────────┐
│  strateji  ·  github.io  ⋮ │ ← dokun
├──────────────────────────┤
│  ↻ Yenile                 │
│  ☆ Yer işareti            │
│  ⊕ Ana ekrana ekle   ◀──  │
│  ⚙ Ayarlar                │
└──────────────────────────┘</div><p class="muted small">Uygulama tam ekran açılır ve kapalıyken de bildirim alabilir.</p>`,
    () => `<h2>2/3 · Bildirimler</h2><ol class="steps"><li>Aşağıdaki butonla izin ver; abonelik kodu panoya kopyalanır.</li><li>GitHub → strateji → Settings → Secrets and variables → Actions → <b>PUSH_SUBSCRIPTIONS</b> (yoksa New repository secret) → yapıştır → Save.</li><li>VAPID anahtarı yoksa Ayarlar → Bildirim → "VAPID anahtarı" ile üret ve iki secret olarak ekle.</li></ol>
      <div class="illus">Settings ▸ Secrets and variables ▸ Actions
  [ New repository secret ]
  Name:   PUSH_SUBSCRIPTIONS
  Secret: {"endpoint":"https://fcm…","keys":{…},"prefs":{…}}
  [ Add secret ]</div>
      <div class="btns"><button class="btn primary" data-onsub>🔔 İzin ver + kodu kopyala</button><a class="btn" href="${SECRETS_URL}" target="_blank" rel="noopener">Secrets sayfası</a></div>`,
    () => `<h2>3/3 · Bakiye ve risk</h2><div class="form"><div class="field"><label>Bakiye</label><input id="ob-bal" type="number" step="any" value="${App.settings.balance}"></div><div class="field"><label>Risk %</label><input id="ob-risk" type="number" step="any" value="${App.settings.riskPct}"></div></div><p class="muted small">Lot hesabı: (bakiye × risk%) / (stop mesafesi × kontrat). Ayarlar'dan değiştirilebilir.</p>`,
  ];
  const close = modal('<div id="onb"></div><div class="btns"><button class="btn" data-skip>Atla</button><button class="btn primary" data-next>İleri</button></div>', (sheet, cls) => {
    const draw = () => { sheet.querySelector('#onb').innerHTML = steps[step](); sheet.querySelector('[data-next]').textContent = step === 2 ? 'Bitir' : 'İleri'; sheet.querySelector('[data-onsub]')?.addEventListener('click', async () => { try { await copy(await subscriptionCode(App)); } catch (e) { toast(e.message, 4000); } }); };
    draw();
    sheet.querySelector('[data-skip]').addEventListener('click', () => { App.settings.onboarded = true; App.save(); cls(); });
    sheet.querySelector('[data-next]').addEventListener('click', () => {
      if (step === 2) {
        App.settings.balance = Number(sheet.querySelector('#ob-bal').value) || DEFAULTS.balance;
        App.settings.riskPct = Number(sheet.querySelector('#ob-risk').value) || DEFAULTS.riskPct;
        App.settings.onboarded = true; App.save(); cls(); App.render(); return;
      }
      step++; draw();
    });
  });
  return close;
}
