/** Başarılı Trader'lar bölmesi (EK §6.4–6.5) — sinyal değil, teyit bilgisi; emir kartı açılmaz. */
import { esc, tr, dateTR, ago, dirTxt } from './fmt.js';

export const PAIRS = [['XAUUSD', 'XAU'], ['EURUSD', 'EURUSD'], ['GBPUSD', 'GBPUSD'], ['XAGUSD', 'XAG'], ['US100', 'US100'], ['BTCUSD', 'BTC'], ['ETHUSD', 'ETH']];
const WARN = 'Bu veriler gecikmeli olabilir, en iyi trader\'lar pozisyonlarını gizleyebilir ve geçmiş başarı devam etmeyebilir. Kurulumlarımızı teyit amacıyla kullan; tek başına işlem açma.';

/** Uyum satırı: bizim aktif kurulumlarımız ↔ trader çoğunluğu */
export function agreement(setups, p, topLongPct = null) {
  const n = (p?.long ?? 0) + (p?.short ?? 0);
  return setups.filter((s) => s.dir && ['TAM', 'BEKLE', 'EKSIK'].includes(s.status)).map((s) => {
    const st = `${s.strategy} ${s.dir === 1 ? 'LONG' : 'SHORT'} ${s.status === 'EKSIK' ? 'EKSİK' : s.status}`;
    if (!n && topLongPct !== null) { // eToro yoksa kripto için OKX büyük trader oranı
      const pct = Math.round(s.dir === 1 ? topLongPct : 100 - topLongPct);
      const ok = pct >= 60 ? true : pct <= 40 ? false : null;
      return { s, ok, text: `${st} — OKX büyük trader'ların %${pct}'i ${s.dir === 1 ? 'LONG' : 'SHORT'} → ${ok === true ? 'uyumlu ✅' : ok === false ? 'uyumsuz ⚠️' : 'karışık ●'}` };
    }
    if (!n) return { s, text: `${st} — trader verisi yok`, ok: null };
    const same = s.dir === 1 ? p.long : p.short, pct = Math.round((same / n) * 100);
    const ok = pct >= 60 ? true : pct <= 30 ? false : null;
    return { s, ok, text: `${s.strategy} ${s.dir === 1 ? 'LONG' : 'SHORT'} ${s.status === 'EKSIK' ? 'EKSİK' : s.status} — trader'ların %${pct}'i ${s.dir === 1 ? 'LONG' : 'SHORT'} → ${ok === true ? 'uyumlu ✅' : ok === false ? 'uyumsuz ⚠️' : 'karışık ●'}` };
  });
}

export function renderTraders(App, el, sym = 'XAUUSD') {
  const d = App.data.traders;
  const tabs = `<div class="chips">${PAIRS.map(([k, l]) => `<button class="chip ${k === sym ? 'on' : ''}" data-go="#/trader/${k}">${l}</button>`).join('')}</div>`;
  if (!d) { el.innerHTML = `<div class="h1">Başarılı Trader'lar</div>${tabs}<div class="card empty">Henüz veri yok — tarama 15 dk'da bir günceller</div><div class="card muted small">${esc(WARN)}</div>`; return; }
  const p = d.pairs?.[sym] ?? { traders: [], long: 0, short: 0 };
  const n = p.long + p.short;
  const setups = Object.values(App.data.state?.strategies ?? {}).flatMap((by) => by?.[sym] ?? []).map((s) => App.effective(s));
  const crowd = d.crowd?.[sym];
  const cot = d.cot?.[sym];
  const okx = d.okx?.[sym];
  const pctTxt = (x) => `%${Math.round(x)} LONG / %${Math.round(100 - x)} SHORT`;
  const lp = n ? (p.long / n) * 100 : 0;
  el.innerHTML = `<div class="row" style="justify-content:space-between"><div class="h1">Başarılı Trader'lar</div><div class="muted small">${dateTR(d.updatedAt)} ${tr(d.updatedAt)} TR (${ago(d.updatedAt)}) · gecikmeli olabilir</div></div>
    ${tabs}
    ${d.status === 'no_keys' ? `<div class="banner warn" style="border-radius:10px;margin:8px 0">eToro anahtarı tanımlı değil — trader pozisyonları yok; bölme kalabalık oranı (Myfxbook/OANDA) + COT (forex) ve OKX büyük trader oranıyla (BTC/ETH) çalışıyor. Eklemek için: eToro → Ayarlar → Trading → API Key Management → yeni anahtar (Real, sadece Read) → GitHub Secrets'a <b>ETORO_API_KEY</b> ve <b>ETORO_USER_KEY</b>.</div>` : d.status !== 'ok' ? `<div class="banner warn" style="border-radius:10px;margin:8px 0">eToro: ${esc(d.status)}</div>` : ''}
    ${p.error ? `<div class="muted small">${esc(p.error)}</div>` : ''}
    <div class="card"><h2>${esc(PAIRS.find((x) => x[0] === sym)?.[1] ?? sym)}: ${n} trader → <span style="color:var(--long)">${p.long} LONG</span> / <span style="color:var(--short)">${p.short} SHORT</span></h2>
      ${n ? `<div class="lsbar"><i class="l" style="width:${lp}%"></i><i class="s" style="width:${100 - lp}%"></i></div>` : '<div class="muted">Filtreye uyan trader\'ın bu paritede açık pozisyonu yok</div>'}
      <div class="list" style="margin-top:10px">
        ${agreement(setups, p, okx?.topLongPct ?? null).map((a) => `<div class="li"><span>${a.ok === true ? '✅' : a.ok === false ? '⚠️' : '●'}</span><div class="grow">${esc(a.text)}</div></div>`).join('') || '<div class="muted small">Bu paritede aktif kurulumumuz yok</div>'}
        ${sym === 'BTCUSD' || sym === 'ETHUSD' ? '' : `<div class="li"><span>👥</span><div class="grow">Kalabalık (${esc(d.crowdSource ?? 'Myfxbook / OANDA')}): ${crowd === null || crowd === undefined ? 'veri yok' : `%${Math.round(crowd)} LONG / %${Math.round(100 - crowd)} SHORT${crowd >= 70 ? ' — <b>Kalabalık aşırı LONG — ters sinyal olabilir</b>' : crowd <= 30 ? ' — <b>Kalabalık aşırı SHORT — ters sinyal olabilir</b>' : ''}`}</div></div>`}
        ${sym === 'BTCUSD' || sym === 'ETHUSD' ? `<div class="li"><span>🐋</span><div class="grow">Büyük trader'lar (OKX, pozisyon): ${okx?.topLongPct !== null && okx?.topLongPct !== undefined ? `${pctTxt(okx.topLongPct)} <span class="muted small">(oran ${okx.topLS?.toFixed(2)})</span>` : 'veri yok'}
          ${okx?.topLongPct !== null && okx?.topLongPct !== undefined ? `<div class="lsbar" style="margin-top:6px"><i class="l" style="width:${okx.topLongPct}%"></i><i class="s" style="width:${100 - okx.topLongPct}%"></i></div>` : ''}</div></div>
        <div class="li"><span>👥</span><div class="grow">Tüm hesaplar (OKX): ${okx?.allLongPct !== null && okx?.allLongPct !== undefined ? `${pctTxt(okx.allLongPct)}${okx.allLongPct >= 70 ? ' — <b>Kalabalık aşırı LONG — ters sinyal olabilir</b>' : okx.allLongPct <= 30 ? ' — <b>Kalabalık aşırı SHORT — ters sinyal olabilir</b>' : ''}` : 'veri yok'}</div></div>` : ''}
        <div class="li"><span>🏦</span><div class="grow">COT (haftalık, spekülatif net): ${cot ? `${cot.net.toLocaleString('tr-TR')} · 4 hafta değişim ${cot.change4w >= 0 ? '+' : ''}${cot.change4w.toLocaleString('tr-TR')}${cot.z !== undefined ? ` (z ${cot.z.toFixed(1)})` : ''}` : sym === 'BTCUSD' || sym === 'ETHUSD' ? 'kripto için yok' : 'veri yok'}</div></div>
      </div></div>
    <div class="card"><h2>Trader listesi</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Trader</th><th>Yön</th><th>Açılış</th><th>Giriş</th><th>12 ay</th><th>Maks. DD</th><th>Risk</th><th>Güncelleme</th></tr></thead><tbody>
      ${p.traders.map((t) => `<tr><td><a href="https://www.etoro.com/people/${encodeURIComponent(t.username)}" target="_blank" rel="noopener">${esc(t.username)}</a></td><td><span class="dir ${t.dir === 1 ? 'long' : 'short'}" style="font-size:.85rem">${dirTxt(t.dir)}</span></td><td class="num small">${t.openedAt ? `${dateTR(Date.parse(t.openedAt))} ${tr(Date.parse(t.openedAt))}` : '—'}</td><td class="num">${t.openRate ?? '—'}</td><td class="num">${t.gain12m !== null ? `${t.gain12m >= 0 ? '+' : ''}${t.gain12m.toFixed(1)}%` : '—'}</td><td class="num">${t.maxDD !== null ? `${Math.abs(t.maxDD).toFixed(1)}%` : '—'}</td><td class="num">${t.riskScore ?? '—'}</td><td class="num small">${tr(t.fetchedAt)}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">—</td></tr>'}
    </tbody></table></div>
    <div class="muted small">Filtre: ≥${d.filters.minMonths} ay · DD ≤ %${d.filters.maxDDPct} · ≥${d.filters.minTrades} işlem · son 3 ay ${d.filters.last3mPositive ? 'pozitif' : 'serbest'} · risk ≤ ${d.filters.maxRisk} · paritede 90 günde ≥${d.filters.minPairTrades90d} işlem · kaynak: ${esc(d.source)}</div></div>
    <div class="card warnbox">⚠️ ${esc(WARN)}</div>`;
}
