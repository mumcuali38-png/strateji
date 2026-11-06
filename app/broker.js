/**
 * BrokerAdapter (EK §4.2). Şimdilik sadece DisabledAdapter: her çağrı "DISABLED" döner, emir gönderilmez.
 * İleride MetaApiAdapter / EABridgeAdapter eklenir; Ayarlar → "Broker bağlantısı" değişince adapter değişir, UI aynı kalır.
 *
 * interface BrokerAdapter {
 *   status(): 'DISABLED' | 'CONNECTED' | 'ERROR'
 *   getQuote(symbol): Promise<{ bid, ask }>
 *   placeOrder(req: OrderRequest): Promise<OrderResult>   // pending / market
 *   modifyStopLoss(ticket, newSL): Promise<Result>
 *   cancelOrder(ticket): Promise<Result>
 *   positions(): Promise<Position[]>
 * }
 */
export const MAGIC = { A: 1001, B: 1002, C: 1003, D: 1004, E: 1005, F: 1006, G: 1007, H: 1008 };
export const MT5_OFF_MSG = 'MT5 bağlantısı henüz aktif değil. Seviyeleri Kopyala ile alabilirsin.';

const disabled = { ok: false, error: 'DISABLED', message: MT5_OFF_MSG };
export class DisabledAdapter {
  status() { return 'DISABLED'; }
  async getQuote() { return disabled; }
  async placeOrder() { return disabled; }
  async modifyStopLoss() { return disabled; }
  async cancelOrder() { return disabled; }
  async positions() { return []; }
}

/** Ayarlardaki broker seçimine göre adapter (şimdilik hepsi kapalı) */
export function getAdapter(settings) {
  switch (settings?.broker) {
    // case 'metaapi': return new MetaApiAdapter(settings);   // ileride
    // case 'ea': return new EABridgeAdapter(settings);       // ileride
    default: return new DisabledAdapter();
  }
}

/** Yorum alanı: {Kurulum}-{LONG/SHORT}-{YYYYMMDD} (EK §4.3) */
export function orderComment(strategy, dir, t = Date.now()) {
  const d = new Date(t + 3 * 3600000);
  return `${strategy}-${dir === 1 ? 'LONG' : 'SHORT'}-${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}
