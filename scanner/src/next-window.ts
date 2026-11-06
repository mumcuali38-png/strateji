/**
 * Bir sonraki tarama penceresinin başlangıcına kalan dakika (pencere açıksa 0).
 * scan-loop.sh (erken tetiklenen işte bekleme) ve scan-f iş akışı (ana taramayı önceden başlatma) kullanır.
 * Pencereler: hafta içi ön pencere 08:00 TR (XAU), ana pencere 10:00–20:00 TR; hafta sonu kripto açıksa 10:00–20:00.
 */
import { loadConfig, type Config } from './config.ts';
import { DAY, MIN, trDayStart, trDow, parseHM, inTrRange } from './time.ts';

export function minutesToWindow(conf: Config, now: number): number {
  const S = conf.params.scan;
  const open = (t: number) => {
    const wd = S.weekdays.includes(trDow(t));
    return ((wd || S.cryptoWeekend) && inTrRange(t, S.windowTR[0], S.windowTR[1])) || (wd && inTrRange(t, S.preWindowTR[0], S.preWindowTR[1]));
  };
  if (open(now)) return 0;
  for (let d = 0; d < 8; d++) {
    const day = trDayStart(now) + d * DAY;
    const wd = S.weekdays.includes(trDow(day + 12 * 3600_000));
    const starts = [...(wd ? [S.preWindowTR[0]] : []), ...(wd || S.cryptoWeekend ? [S.windowTR[0]] : [])].map((h) => day + parseHM(h) * MIN).filter((t) => t > now).sort((a, b) => a - b);
    if (starts.length) return Math.ceil((starts[0] - now) / MIN);
  }
  return 99999;
}

if (process.argv[1]?.endsWith('next-window.ts')) console.log(minutesToWindow(loadConfig(), Date.now()));
