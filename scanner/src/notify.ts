import type { Config } from './config.ts';
import type { NewsEvent, Setup } from './types.ts';
import { MIN } from './time.ts';
import { cancelMsg, expiredMsg, newsMsg, readyMsg, tamMsg, type Msg } from './push.ts';

/**
 * Durum değişimlerinden bildirim listesi. Tekrar yok: anahtar strateji+sembol+yön+bölge_id+durum.
 * `notified` yerinde güncellenir (data dalında saklanır, 3 günde temizlenir).
 */
export function computeMessages(conf: Config, all: Setup[], prev: { strategies?: Record<string, Record<string, Setup[]>> } | null, notified: Record<string, number>, news: NewsEvent[], now: number): Msg[] {
  const P = conf.params;
  for (const [k, t] of Object.entries(notified)) if (now - t > 3 * 86400_000) delete notified[k];
  const msgs: Msg[] = [];
  for (const s of all) {
    for (const nt of s.notices ?? []) {
      if (nt.key in notified || (nt.requires && !(nt.requires in notified))) continue;
      msgs.push({ kind: 'info', title: nt.title, body: nt.body, url: `./#/${s.strategy}/${s.symbol}/${encodeURIComponent(s.id)}`, tag: nt.key, strategy: s.strategy, symbol: s.symbol });
      notified[nt.key] = now;
    }
    const base = `${s.strategy}+${s.symbol}+${s.dir}+${s.zoneId}+`;
    if (s.lastEntry && s.conditions.some((c) => c.id === 'deadline') && (`${base}TAM` in notified || `${base}BEKLE` in notified) && !(`${s.id}+SURE` in notified)) {
      msgs.push(expiredMsg(s)); notified[`${s.id}+SURE`] = now;
    }
    if ((s.status === 'TAM' || s.status === 'BEKLE') && !(s.key in notified)) { if (!s.info?.mergedWithB) msgs.push(tamMsg(conf, s)); notified[s.key] = now; }
    else if (s.status === 'EKSIK' && s.remaining === 1 && !(s.key in notified)) { msgs.push(readyMsg(s)); notified[s.key] = now; }
  }
  const byId = new Map(all.map((s) => [s.id, s]));
  for (const list of Object.values(prev?.strategies ?? {})) for (const ps of Object.values(list).flat()) {
    if (ps.status !== 'TAM') continue;
    const ns = byId.get(ps.id);
    if (ns?.status === 'TAM') continue;
    const why = ns?.conditions.find((c) => c.status === 'fail')?.detail ?? 'setup listeden düştü';
    if (/stop|tükendi|silindi|delindi|iptal/i.test(why) && !(`${ps.id}+IPTAL` in notified)) { msgs.push(cancelMsg(ps, why)); notified[`${ps.id}+IPTAL`] = now; }
  }
  for (const e of news) {
    if (e.impact !== 'High' || !P.news.currencies.includes(e.currency)) continue;
    const dt = e.t - now;
    if (dt > 0 && dt <= P.news.beforeMin * MIN && !(`news+${e.id}` in notified)) {
      const affected = Object.keys(conf.symbols).filter((sym) => (e.symbols ? e.symbols.includes(sym) : e.currency === 'USD' || conf.symbols[sym].currencies.includes(e.currency)));
      msgs.push(newsMsg(e, now, affected)); notified[`news+${e.id}`] = now;
    }
  }
  return msgs;
}
