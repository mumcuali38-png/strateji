import type { Config } from './config.ts';
import type { Setup } from './types.ts';
import { HOUR, nyDayStart, nyTimeOnDay, parseHM, MIN, fmtTR } from './time.ts';
import { statusOf } from './context.ts';

/**
 * Son giriş zamanı (EK §3.5) — her kurulumun kendi şartnamesinden:
 * G 05:00 NY (13:00 TR) · C ve D1 11:00 NY (19:00 TR) · F spring/UTAD + chochMaxHours (24 sa) ·
 * A/B/E sinyalin oluştuğu killzone'un bitişi · D2 ve diğerleri sinyal + maxSignalAgeHours.
 */
export function lastEntryOf(conf: Config, s: Setup, now: number): number | undefined {
  if (!s.dir || s.status === 'YOK') return undefined;
  const ref = s.signalAt ?? s.evaluatedAt ?? now;
  const P = conf.params;
  switch (s.strategy) {
    case 'H': { const v = (s.info as { h?: { validUntil?: number } } | undefined)?.h?.validUntil; if (v) return v; break; }
    case 'G': { const t = (s.info as { g?: { timeline?: { lastEntry?: number } } } | undefined)?.g?.timeline?.lastEntry; return t; }
    case 'C': return nyTimeOnDay(ref, conf.sessions.C?.end ?? '11:00');
    case 'F': { const m = /^S(\d+)$/.exec(s.zoneId); return m ? Number(m[1]) + (P.F?.chochMaxHours ?? 24) * HOUR : undefined; }
    case 'D': if (s.sub.startsWith('D1')) return nyTimeOnDay(ref, conf.sessions.D1?.entryEnd ?? '11:00'); break;
    case 'A': case 'B': case 'E': {
      const ids = conf.sessions.strategyKillzones?.[s.strategy] ?? [];
      const day = nyDayStart(ref);
      for (const k of conf.sessions.killzones.filter((z) => ids.includes(z.id))) {
        const a = day + parseHM(k.start) * MIN, b = day + parseHM(k.end) * MIN;
        if (ref >= a && ref < b) return b;
      }
      break;
    }
  }
  return s.signalAt ? s.signalAt + P.general.maxSignalAgeHours * HOUR : undefined;
}

/** Tüm setuplara lastEntry yazar (uygulama geri sayım gösterir, bildirim "SÜRE DOLDU" için kullanılır). */
export function annotateDeadlines(conf: Config, setups: Setup[], now: number): void {
  for (const s of setups) {
    const t = lastEntryOf(conf, s, now);
    if (!t) { delete s.lastEntry; continue; }
    s.lastEntry = t;
    // Süre doldu: TAM/BEKLE (dolmamış) setup YOK'a düşer; bildirim notify.ts'te ("SÜRE DOLDU", tek sefer)
    if ((s.status === 'TAM' || s.status === 'BEKLE') && now >= t && !isFilled(s)) {
      s.conditions = [...s.conditions, { id: 'deadline', label: 'Son giriş', status: 'fail', detail: `Son giriş ${fmtTR(t)} TR geçti — SÜRE DOLDU (bekleyen limit emrini kaldır)` }];
      const { status, remaining } = statusOf(s.conditions);
      s.status = status; s.remaining = remaining; delete s.missing;
      s.none = { why: `Son giriş ${fmtTR(t)} TR geçti — SÜRE DOLDU`, waiting: 'Yeni kurulum bekleniyor', ends: 'Senaryo bitti' };
      s.key = `${s.strategy}+${s.symbol}+${s.dir}+${s.zoneId}+${status}`;
    }
  }
}

/** Dolmuş (G: limit doldu) setupta "limit iptal et" mesajı anlamsız */
export function isFilled(s: Setup): boolean {
  const i = s.info as { g?: { filled?: boolean }; h?: { filled?: boolean } } | undefined;
  return !!(i?.g?.filled || i?.h?.filled);
}
