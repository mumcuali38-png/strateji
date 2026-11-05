// Kullanıcı ayarlarıyla (tampon, kontrat, bakiye, risk) giriş yöntemini yeniden hesapla.
export function us100Ratio(settings, st) {
  const q = st?.symbols?.US100?.price;
  const u = Number(settings.us100Price);
  if (u > 0 && q > 0) return { ratio: u / q, user: true };
  return { ratio: st?.params?.us100PerQqq ?? 41, user: false };
}
/** Enstrüman değerleri: ayarlardaki düzeltme > config/symbols.json (EK §1.2) */
export function instrOf(sym, cfg, settings) {
  const o = settings.instr?.[sym] ?? {};
  const num = (v, d) => (v === '' || v === undefined || v === null || !Number.isFinite(Number(v)) ? d : Number(v));
  return {
    brokerSymbol: o.brokerSymbol || cfg.brokerSymbol || sym, unitSize: cfg.unitSize ?? 1, unitLabel: cfg.unitLabel ?? '1',
    valuePerUnit: num(o.valuePerUnit, cfg.valuePerUnit ?? cfg.contract), lotStep: num(o.lotStep, cfg.lotStep ?? 0.01), minLot: num(o.minLot, cfg.minLot ?? 0.01),
    spread: num(o.spread, cfg.spread ?? 0), spreadType: cfg.spreadType ?? 'abs',
  };
}
/** Hesap para birimi → USD kuru (EK §1.2). EUR: EURUSD fiyatı; TRY: 1 / USD/TRY (günlük). */
export function fxToUsd(settings, st) {
  const c = settings.currency || 'USD';
  if (c === 'USD') return 1;
  if (c === 'EUR') return st?.symbols?.EURUSD?.price || null;
  if (c === 'TRY') { const r = st?.fx?.['USD/TRY']?.rate; return r ? 1 / r : null; }
  return null;
}
export function padFor(sym, priceLvl, cfg, settings, ratio) {
  const b = settings.buffers?.[sym];
  const buf = b !== undefined && b !== '' ? Number(b) : cfg.buffer;
  const conv = (v, t) => (t === 'pct' ? (priceLvl * v) / 100 : t === 'us100pts' ? v / ratio : v);
  const ins = instrOf(sym, cfg, settings);
  return conv(buf, cfg.bufferType) + conv(ins.spread, ins.spreadType);
}
export function recompute(m, setup, cfg, settings, st) {
  const { ratio } = us100Ratio(settings, st);
  const dir = setup.dir || 1;
  // F: stop yapıya göre kesin (ATR payı dahil) — tampon/spread eklenmez
  const stop = m.fixedStop ? m.stop : m.stopStructural - dir * padFor(setup.symbol, m.stopStructural, cfg, settings, ratio);
  const risk = Math.abs(m.entry - stop);
  const rr = risk > 0 ? Math.abs(m.tp1 - m.entry) / risk : 0;
  const rr2 = m.tp2 !== undefined && risk > 0 ? Math.abs(m.tp2 - m.entry) / risk : undefined;
  const rr3 = m.tp3 !== undefined && risk > 0 ? Math.abs(m.tp3 - m.entry) / risk : undefined;
  // Lot (EK §3.1): lot = floor( riskUSD / (stop/birim × birimDeğeri) / lotAdımı ) × lotAdımı
  const ins = instrOf(setup.symbol, cfg, settings);
  const kur = fxToUsd(settings, st);
  const bal = Number(settings.balance) || 0;
  const riskUsd = bal * (Number(settings.riskPct) || 0) / 100 * (kur ?? 0);
  const distPts = cfg.proxy ? risk * ratio : risk; // US100: QQQ mesafesi → US100 puanı
  const perLot = (distPts / ins.unitSize) * ins.valuePerUnit; // 1 lotun bu stoptaki zararı ($)
  let lotOk = true, lotNote = '';
  if (!bal) { lotOk = false; lotNote = 'AYAR GEREKLİ — Ayarlar → Hesap bakiyesi'; }
  else if (!settings.instrConfirmed) { lotOk = false; lotNote = 'AYAR GEREKLİ — Ayarlar → Enstrüman: broker değerlerini doğrula'; }
  else if (kur === null) { lotOk = false; lotNote = `Kur yok (${settings.currency}→USD) — bir sonraki taramayı bekleyin`; }
  let lot = perLot > 0 ? Math.floor(riskUsd / perLot / ins.lotStep + 1e-9) * ins.lotStep : 0;
  let capNote = '';
  let leverage = 0;
  if (setup.strategy === 'F' && bal > 0) { // kaldıraç ≤ 3× bakiye
    const maxLev = st?.params?.F?.maxLeverage ?? 3;
    const maxLot = Math.floor((maxLev * bal * (kur ?? 1)) / (m.entry * ins.valuePerUnit) / ins.lotStep + 1e-9) * ins.lotStep;
    if (lot > maxLot) { lot = maxLot; capNote = `Kaldıraç ${maxLev}x sınırı: risk %${settings.riskPct}'in altında kaldı`; }
    leverage = (lot * m.entry * ins.valuePerUnit) / (bal * (kur ?? 1));
  }
  if (lotOk && lot < ins.minLot) {
    const realPct = bal > 0 ? (ins.minLot * perLot) / (bal * (kur ?? 1)) * 100 : 0;
    lotNote = `Risk çok küçük — min lot ${ins.minLot} ile risk %${realPct.toFixed(2)} olur`;
    lot = ins.minLot;
  }
  return { ...m, stop, rr, rr2, rr3, lot, lotOk, lotNote, riskUsd, risk, leverage, capNote, ins };
}
