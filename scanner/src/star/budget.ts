// ⭐ kredi bütçesi. Öncelik (kullanıcı onayı, 06.11.2026): açık ⭐ pozisyon > mevcut kurulumlar (A–H) > ⭐ sinyal taraması.
// Mevcut kurulumların günün geri kalanında harcayacağı kredi, kendi planlayıcıları (planFetch) ileri simüle edilerek ayrılır.
import type { Config } from '../config.ts';
import type { Credits } from '../twelvedata.ts';
import { planFetch } from '../plan.ts';
import { DAY, MIN, utcDateStr } from '../time.ts';

/** Mevcut taramanın (A–H) bu UTC gününün kalanında yapacağı tahmini istek sayısı */
export function existingReserve(conf: Config, now: number, credits: Credits): number {
  const step = conf.params.scan.intervalMin * MIN;
  const dayEnd = Math.floor(now / DAY) * DAY + DAY; // Twelve Data sayacı UTC 00:00'da sıfırlanır
  const sim: Credits = { ...credits, used: 0, hardStop: 1e9, log: [], days: [], exhausted: false, unavailable: { ...(credits.unavailable ?? {}) } };
  const last: Record<string, number> = {};
  let total = 0;
  for (let t = Math.ceil((now + 1) / step) * step; t < dayEnd; t += step) {
    const plan = planFetch(conf, t, sim, (sym, iv) => last[`${sym}${iv}`] ?? t - step);
    for (const p of plan) last[`${p.sym}${p.interval}`] = t;
    if (plan.some((p) => p.bootstrap)) sim.bootstrapDate = utcDateStr(t);
    total += plan.length;
  }
  return total;
}

/** ⭐ için bu taramada kullanılabilir kredi. Açık pozisyon takibi `reserve`'i yok sayar (en üst öncelik), sadece sert sınıra bakar. */
export function starBudget(credits: Credits, reserve: number): { signal: number; position: number } {
  const left = credits.hardStop - credits.used;
  return { signal: Math.max(0, left - reserve), position: Math.max(0, left) };
}
