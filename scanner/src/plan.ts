import type { Config } from './config.ts';
import type { Credits } from './twelvedata.ts';
import { MIN, inTrRange, parseHM, trDayStart, trDow, utcDateStr, nySession } from './time.ts';

export interface PlanItem { sym: string; interval: '1min' | '5min' | '1h' | '1day'; size: number; bootstrap?: boolean }

/**
 * Bu taramanın istek planı (MASTERPROMPT §15).
 * - Günde bir kez bootstrap (5m ~2500 mum + 1day 60 mum)
 * - Artımlı: son mumdan bu yana boşluk kadar (en az 6) — istek başına 1 kredi
 * - 17:25–19:00 TR: ilgili semboller 1min (5m bundan üretilir)
 * - QQQ: NY borsa seansı (yaz saatli, 09:30–15:45 NY) — 20:00 TR sonrası da (Kurulum H/US100); diğerleri 20:00'de durur
 * - Ön pencere (hafta içi 08:00–10:00 TR): sadece preWindowSymbols (XAU — Kurulum G)
 * - Bütçe: her sembol için (bu istek + günün kalan taramaları) öncelik sırasıyla ayrılır; sığmayan atlanır.
 */
export function planFetch(conf: Config, now: number, credits: Credits, lastBar: (sym: string, iv: '1min' | '5min') => number | undefined, warnings: string[] = []): PlanItem[] {
  const S = conf.params.scan;
  const weekday = S.weekdays.includes(trDow(now));
  const symbolsToday = S.priority.filter((sym) => conf.symbols[sym] && !credits.unavailable?.[sym] && (weekday || (S.cryptoWeekend && conf.symbols[sym].crypto)));
  const windowEnd = trDayStart(now) + parseHM(S.windowTR[1]) * MIN;
  const step = S.intervalMin * MIN;
  const windowStart = trDayStart(now) + parseHM(S.windowTR[0]) * MIN;
  const preStart = trDayStart(now) + parseHM(S.preWindowTR[0]) * MIN;
  const pre = weekday && inTrRange(now, S.preWindowTR[0], S.preWindowTR[1]) && !inTrRange(now, S.windowTR[0], S.windowTR[1]);
  const isPreSym = (sym: string) => weekday && S.preWindowSymbols.includes(sym);
  const sess = nySession(now, ...(S.qqqSessionNY ?? ['09:30', '15:45']) as [string, string]);
  const qqqStart = sess.start, qqqEnd = sess.end;
  const mainOpen = inTrRange(now, S.windowTR[0], S.windowTR[1]);
  const futureScans = (sym: string) => {
    const end = sym === 'US100' ? qqqEnd : windowEnd;
    const start = sym === 'US100' ? Math.max(now, qqqStart - step) : isPreSym(sym) ? Math.max(now, preStart - step) : Math.max(now, windowStart - step);
    return Math.max(0, Math.floor((end - start) / step) - 1);
  };
  const oneMin = inTrRange(now, S.oneMinuteTR[0], S.oneMinuteTR[1]);
  const needBootstrap = credits.bootstrapDate !== utcDateStr(now);
  let budget = credits.hardStop - credits.used;
  const plan: PlanItem[] = [];
  if (needBootstrap) {
    for (const sym of symbolsToday) plan.push({ sym, interval: '5min', size: S.bootstrap5m, bootstrap: true });
    for (const sym of S.bootstrap1dSymbols.filter((s) => symbolsToday.includes(s))) plan.push({ sym, interval: '1day', size: S.bootstrap1d, bootstrap: true });
    for (const sym of S.bootstrap1hSymbols.filter((s) => symbolsToday.includes(s))) plan.push({ sym, interval: '1h', size: S.bootstrap1h, bootstrap: true });
    if (weekday) for (const fx of S.fxPairs ?? []) plan.push({ sym: `FX:${fx}`, interval: '1day', size: 2, bootstrap: true }); // hesap para birimi kuru (günde 1 kredi)
    if (weekday) for (const d of S.directionDaily ?? []) plan.push({ sym: `DIR:${d}`, interval: '1day', size: S.bootstrap1d, bootstrap: true }); // Piyasa Yönü makro (UUP, IEF) — günde 1'er kredi
    budget -= plan.length;
  }
  for (const sym of symbolsToday) {
    const qqqOpen = pre ? S.preWindowSymbols.includes(sym) : sym === 'US100' ? sess.open && weekday : mainOpen;
    const interval = oneMin && S.oneMinuteSymbols.includes(sym) ? '1min' : '5min';
    // Gelecek taramalar için bütçe ayır (QQQ kapalıyken de açılış sonrası payı korunur)
    const cost = (qqqOpen ? 1 : 0) + futureScans(sym);
    if (cost > budget) { warnings.push(`Kredi bütçesi: ${sym} atlandı (öncelik sırası)`); continue; }
    budget -= cost;
    if (!qqqOpen) continue;
    if (needBootstrap && interval === '5min') continue; // bootstrap son mumları zaten içerir
    const last = lastBar(sym, interval);
    const ms = interval === '1min' ? MIN : 5 * MIN;
    const gap = last ? Math.ceil((now - last) / ms) + 2 : interval === '1min' ? 120 : S.bootstrap5m;
    plan.push({ sym, interval, size: Math.max(S.incrementalOutput, last ? Math.min(gap, S.maxIncrementalOutput) : gap) });
  }
  return plan;
}
