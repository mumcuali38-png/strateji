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
  const stop = m.stopStructural - dir * padFor(setup.symbol, m.stopStructural, cfg, settings, ratio);
  const risk = Math.abs(m.entry - stop);
  const rr = risk > 0 ? Math.abs(m.tp1 - m.entry) / risk : 0;
  const rr2 = m.tp2 !== undefined && risk > 0 ? Math.abs(m.tp2 - m.entry) / risk : undefined;
  const contract = Number(settings.contracts?.[setup.symbol]) || cfg.contract;
  const riskUsd = (Number(settings.balance) || 0) * (Number(settings.riskPct) || 0) / 100;
  const distPts = cfg.proxy ? risk * ratio : risk;
  const lot = distPts > 0 ? riskUsd / (distPts * contract) : 0;
  return { ...m, stop, rr, rr2, lot, riskUsd, risk };
}
