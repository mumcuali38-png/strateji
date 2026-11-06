import type { TF } from './types.ts';

export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** Strateji saati: sabit UTC-5 (yaz saati yok) */
export const NY_OFFSET = -5 * HOUR;
/** Gösterim: Türkiye UTC+3 */
export const TR_OFFSET = 3 * HOUR;

export const TF_MS: Record<TF, number> = {
  '1m': MIN, '3m': 3 * MIN, '5m': 5 * MIN, '15m': 15 * MIN,
  '1h': HOUR, '4h': 4 * HOUR, '1d': DAY, '1w': 7 * DAY,
};

export const TF_LABEL: Record<TF, string> = {
  '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '1h': '1H', '4h': '4H', '1d': '1D', '1w': '1W',
};

/** NY (UTC-5) saatine göre gün içi dakika */
export function nyMinutes(t: number): number {
  const d = new Date(t + NY_OFFSET);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
export function trMinutes(t: number): number {
  const d = new Date(t + TR_OFFSET);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
/** NY gününün başlangıcı (UTC epoch ms) */
export function nyDayStart(t: number): number {
  return Math.floor((t + NY_OFFSET) / DAY) * DAY - NY_OFFSET;
}
/** NY haftanın günü (0 = Pazar) */
export function nyDow(t: number): number {
  return new Date(t + NY_OFFSET).getUTCDay();
}
export function trDow(t: number): number {
  return new Date(t + TR_OFFSET).getUTCDay();
}
export function trDayStart(t: number): number {
  return Math.floor((t + TR_OFFSET) / DAY) * DAY - TR_OFFSET;
}
export function utcDateStr(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}
export function nyDateStr(t: number): string {
  return new Date(t + NY_OFFSET).toISOString().slice(0, 10);
}

/** Mum kovasının başlangıcı: NY gece yarısından hizalı (4H: 00,04,08,12,16,20 NY). Haftalık: NY Pazartesi 00:00 */
export function bucketStart(t: number, tf: TF): number {
  if (tf === '1w') {
    const shifted = t + NY_OFFSET;
    const days = Math.floor(shifted / DAY);
    const dow = (days + 4) % 7; // 1970-01-01 Perşembe
    const monday = days - ((dow + 6) % 7);
    return monday * DAY - NY_OFFSET;
  }
  const ms = TF_MS[tf];
  return Math.floor((t + NY_OFFSET) / ms) * ms - NY_OFFSET;
}

export function parseHM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}
export function hm(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
export function fmtTR(t: number): string { return hm(trMinutes(t)); }
export function fmtNY(t: number): string { return hm(nyMinutes(t)); }
export function fmtTRNY(t: number): string { return `${fmtTR(t)} TR (${fmtNY(t)} NY)`; }

/** Verilen NY dakika aralığında mı? [start, end) */
export function inNyRange(t: number, start: string, end: string): boolean {
  const m = nyMinutes(t);
  const s = parseHM(start), e = parseHM(end);
  return s <= e ? m >= s && m < e : m >= s || m < e;
}
export function inTrRange(t: number, start: string, end: string): boolean {
  const m = trMinutes(t);
  const s = parseHM(start), e = parseHM(end);
  return s <= e ? m >= s && m < e : m >= s || m < e;
}
/** Bugünün (NY) belirli saatinin epoch değeri */
export function nyTimeOnDay(t: number, h: string): number {
  return nyDayStart(t) + parseHM(h) * MIN;
}
export function durationText(ms: number): string {
  const total = Math.max(0, Math.round(ms / MIN));
  const h = Math.floor(total / 60), m = total % 60;
  if (h === 0) return `${m} dk`;
  return `${h}s ${m}dk`;
}

/** NY yerel saati (yaz saati UYGULANIR — borsa saatine bağlı kurallar için, örn. H/US100). Dakika cinsinden. */
const NY_FMT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' });
export function nyLocal(t: number): { min: number; dow: number } {
  const p = Object.fromEntries(NY_FMT.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { min: (Number(p.hour) % 24) * 60 + Number(p.minute), dow };
}
/** NY borsa seansı içinde mi (hafta içi, yerel saat [from, to)) */
export function inNyLocal(t: number, from: string, to: string): boolean {
  const { min, dow } = nyLocal(t);
  return dow >= 1 && dow <= 5 && min >= parseHM(from) && min < parseHM(to);
}

/** NY'nin UTC farkı (dakika; EST −300, EDT −240) */
export function nyOffsetMin(t: number): number {
  const { min } = nyLocal(t); const u = new Date(t);
  let d = min - (u.getUTCHours() * 60 + u.getUTCMinutes());
  if (d > 720) d -= 1440; if (d < -720) d += 1440;
  return d;
}
/** Bugünkü (NY yerel günü) NY borsa seansı [from, to) — mutlak zaman. Yaz saati uygulanır. */
export function nySession(t: number, from: string, to: string): { start: number; end: number; open: boolean } {
  const off = nyOffsetMin(t) * MIN;
  const day = Math.floor((t + off) / DAY) * DAY - off;
  const start = day + parseHM(from) * MIN, end = day + parseHM(to) * MIN;
  const { dow } = nyLocal(t);
  return { start, end, open: dow >= 1 && dow <= 5 && t >= start && t < end };
}
