// ⭐ bildirim tekrar koruması (§7.7): her anahtar bir kez. notified.json A–H ile ortak (3 günde temizlenir).
import type { StarMsg } from './setups.ts';

export function starMsgsToSend(msgs: StarMsg[], notified: Record<string, number>, now: number): StarMsg[] {
  const out: StarMsg[] = [];
  for (const m of msgs) {
    if (m.key in notified) continue;
    notified[m.key] = now;
    out.push(m);
  }
  return out;
}
