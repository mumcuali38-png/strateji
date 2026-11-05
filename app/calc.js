// Kullanıcı ayarlarıyla (tampon, kontrat, bakiye, risk) giriş yöntemini yeniden hesapla.
export function us100Ratio(settings, st) {
  const q = st?.symbols?.US100?.price;
  const u = Number(settings.us100Price);
  if (u > 0 && q > 0) return { ratio: u / q, user: true };
  return { ratio: st?.params?.us100PerQqq ?? 41, user: false };
}
export function padFor(sym, priceLvl, cfg, settings, ratio) {
  const b = settings.buffers?.[sym];
  const buf = b !== undefined && b !== '' ? Number(b) : cfg.buffer;
  const conv = (v, t) => (t === 'pct' ? (priceLvl * v) / 100 : t === 'us100pts' ? v / ratio : v);
  return conv(buf, cfg.bufferType) + conv(cfg.spread, cfg.spreadType ?? cfg.bufferType);
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
  const contract = Number(settings.contracts?.[setup.symbol]) || cfg.contract;
  const riskUsd = (Number(settings.balance) || 0) * (Number(settings.riskPct) || 0) / 100;
  const distPts = cfg.proxy ? risk * ratio : risk;
  let lot = distPts > 0 ? riskUsd / (distPts * contract) : 0;
  let capNote = '';
  let leverage = 0;
  if (setup.strategy === 'F') { // miktar BTC; kaldıraç en fazla 3x
    const maxLev = st?.params?.F?.maxLeverage ?? 3;
    const bal = Number(settings.balance) || 0;
    if (bal > 0 && lot * m.entry > maxLev * bal) { lot = (maxLev * bal) / m.entry; capNote = `Kaldıraç ${maxLev}x sınırı: risk %${settings.riskPct}'in altında kaldı`; }
    leverage = bal > 0 ? (lot * m.entry) / bal : 0;
  }
  return { ...m, stop, rr, rr2, rr3, lot, riskUsd, risk, leverage, capNote };
}
