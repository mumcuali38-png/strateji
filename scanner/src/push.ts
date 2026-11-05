import webpush from 'web-push';
import type { Setup, StrategyId, NewsEvent } from './types.ts';
import type { Config } from './config.ts';
import { durationText, fmtTR, trMinutes, parseHM } from './time.ts';

export interface Prefs {
  strategies?: Partial<Record<StrategyId, boolean>>;
  symbols?: Record<string, boolean>;
  matrix?: Record<string, boolean>;
  ready?: boolean; news?: boolean; cancel?: boolean;
  quiet?: { from: string; to: string } | null;
  balance?: number; riskPct?: number; contracts?: Record<string, number>; currency?: string;
  instr?: Record<string, { valuePerUnit?: number; lotStep?: number; minLot?: number }>;
}
export interface Sub { endpoint: string; keys: { p256dh: string; auth: string }; prefs?: Prefs; label?: string }
export interface Msg { kind: 'tam' | 'ready' | 'news' | 'cancel' | 'test' | 'info' | 'trade'; title: string; body: string; url: string; tag: string; strategy?: StrategyId; symbol?: string; setup?: Setup; /** İşlem bildirimleri: sinyal kimliği (uygulama açık işlemle eşler) */ signal?: string }

export const SHORT: Record<string, string> = { XAUUSD: 'XAU', EURUSD: 'EUR', GBPUSD: 'GBP', BTCUSD: 'BTC', ETHUSD: 'ETH', US100: 'US100' };

export function parseSubs(raw: string | undefined): Sub[] {
  if (!raw) return [];
  try {
    const j = JSON.parse(raw);
    const arr = Array.isArray(j) ? j : [j];
    return arr.filter((s) => s && s.endpoint && s.keys);
  } catch { console.warn('PUSH_SUBSCRIPTIONS JSON okunamadı'); return []; }
}

/**
 * Lot (EK §3.1): lot = floor( riskUSD / (stopMesafesi/birim × birimDeğeri) / lotAdımı ) × lotAdımı.
 * US100 (QQQ verisi): mesafe US100 puanına çevrilir. F: kaldıraç ≤ 3× bakiye.
 */
export function lotCalc(riskUsd: number, dist: number, unitSize: number, valuePerUnit: number, lotStep: number): number {
  if (!(dist > 0) || !(valuePerUnit > 0)) return 0;
  const raw = riskUsd / ((dist / unitSize) * valuePerUnit);
  return Math.floor(raw / lotStep + 1e-9) * lotStep;
}
export function lotFor(conf: Config, s: Setup, prefs?: Prefs): number | null {
  const m = s.methods.find((x) => x.id === s.defaultMethod) ?? s.methods[0];
  if (!m || !prefs?.balance) return null; // bakiye girilmeden lot yok ("AYAR GEREKLİ")
  const cfg = conf.symbols[s.symbol];
  const ov = prefs.instr?.[s.symbol] ?? {};
  const riskUsd = prefs.balance * (prefs.riskPct ?? conf.params.risk.riskPct) / 100;
  let dist = Math.abs(m.entry - m.stop);
  if (cfg.proxy) dist *= conf.params.us100PerQqq; // US100 CFD: QQQ mesafesi US100 puanına çevrilir
  const step = ov.lotStep ?? cfg.lotStep ?? 0.01;
  let lot = lotCalc(riskUsd, dist, cfg.unitSize ?? 1, ov.valuePerUnit ?? cfg.valuePerUnit ?? cfg.contract, step);
  if (s.strategy === 'F') lot = Math.min(lot, Math.floor((conf.params.F.maxLeverage * prefs.balance) / (m.entry * (cfg.valuePerUnit ?? 1)) / step) * step);
  return lot;
}

export function tamMsg(conf: Config, s: Setup, prefs?: Prefs): Msg {
  const m = s.methods.find((x) => x.id === s.defaultMethod) ?? s.methods[0];
  const f = (x: number | undefined) => (x === undefined ? '—' : x.toFixed(conf.symbols[s.symbol].decimals));
  const lot = lotFor(conf, s, prefs);
  const dir = s.dir === 1 ? 'LONG' : 'SHORT';
  if (s.strategy === 'G') {
    const q = (s.info?.g as { quality?: string } | undefined)?.quality ?? 'normal';
    return { kind: 'tam', strategy: s.strategy, symbol: s.symbol, setup: s, title: `🔵 G · XAU ${s.dir === 1 ? '▲' : '▼'} ${dir} TAM`, body: `G: XAU ${dir} TAM — limit ${f(m?.entry)}, stop ${f(m?.stop)}, T1 ${f(m?.tp1)}, T2 ${f(m?.tp2)}, RR ${m ? (m.rr2 ?? m.rr).toFixed(1) : '—'}, kalite ${q}${lot !== null ? ` · ${lot.toFixed(2)} lot` : ''}`, url: `./#/G/XAUUSD/${encodeURIComponent(s.id)}`, tag: s.key };
  }
  if (s.strategy === 'F') {
    const bekle = s.status === 'BEKLE';
    const tag = m?.tag ? ` · ${m.tag}` : '';
    return {
      kind: 'tam', strategy: s.strategy, symbol: s.symbol, setup: s,
      title: bekle ? `🟠 F · BTC ${s.dir === 1 ? '▲' : '▼'} ${dir} TAM – BEKLE` : `🔵 F · BTC ${s.dir === 1 ? '▲' : '▼'} ${dir} TAM${tag}`,
      body: `F: BTC ${dir} ${bekle ? 'TAM – BEKLE (' + (s.missing ?? '').replace(/^BLOK: /, '') + ')' : 'TAM'}${tag} – giriş ${f(m?.entry)}, stop ${f(m?.stop)}, T1/T2/T3 ${f(m?.tp1)}/${f(m?.tp2)}/${f(m?.tp3)}, RR ${m ? (m.rr3 ?? m.rr2 ?? m.rr).toFixed(1) : '—'}${lot !== null ? ` · ${lot.toFixed(2)} lot` : ''}`,
      url: `./#/${s.strategy}/${s.symbol}/${encodeURIComponent(s.id)}`, tag: s.key,
    };
  }
  return {
    kind: 'tam', strategy: s.strategy, symbol: s.symbol, setup: s,
    title: `🔵 TAM · ${SHORT[s.symbol]} ${s.strategy} ${s.dir === 1 ? '▲' : '▼'} ${dir}`,
    body: `${SHORT[s.symbol]} ${s.strategy} ${dir} · Giriş ${f(m?.entry)} · SL ${f(m?.stop)} · TP ${f(m?.tp1)} · RR ${m ? m.rr.toFixed(1) + (m.rr2 !== undefined ? ` / TP2 ${m.rr2.toFixed(1)}` : '') : '—'}${lot !== null ? ` · ${lot.toFixed(2)} lot` : ''}${m?.tag ? ` · ${m.tag}` : ''}`,
    url: `./#/${s.strategy}/${s.symbol}/${encodeURIComponent(s.id)}`, tag: s.key,
  };
}
export function readyMsg(s: Setup): Msg {
  const w = s.conditions.find((c) => c.status === 'wait');
  if (s.strategy === 'G') return { kind: 'ready', strategy: s.strategy, symbol: s.symbol, setup: s, title: '🟡 G · XAU 1 şart kaldı', body: `G: 1 şart kaldı: ${w ? `${w.label} — ${w.detail}` : '—'}`, url: `./#/G/XAUUSD/${encodeURIComponent(s.id)}`, tag: s.key };
  if (s.strategy === 'F') return { kind: 'ready', strategy: s.strategy, symbol: s.symbol, setup: s, title: '🟡 F · BTC 1 şart kaldı', body: `F: BTC 1 şart kaldı: ${w ? `${w.label} — ${w.detail}` : '—'}`, url: `./#/F/BTCUSD/${encodeURIComponent(s.id)}`, tag: s.key };
  return { kind: 'ready', strategy: s.strategy, symbol: s.symbol, setup: s, title: `🟡 Hazırlan · ${SHORT[s.symbol]} ${s.strategy}`, body: `${SHORT[s.symbol]} ${s.strategy}: sadece ${w ? `${w.label} — ${w.detail}` : 'son şart'} bekleniyor`, url: `./#/${s.strategy}/${s.symbol}/${encodeURIComponent(s.id)}`, tag: s.key };
}
export function cancelMsg(s: Setup, why: string, open = false): Msg {
  // Dolmuş (açık) işlemde iptal = ÇIKIŞ (EK §3.8, en yüksek öncelik, sessiz saati deler)
  if (open) return { kind: 'cancel', strategy: s.strategy, symbol: s.symbol, setup: s, signal: s.id, title: `⛔ ÇIKIŞ · ${SHORT[s.symbol]} ${s.strategy} ${s.dir === 1 ? '▲ LONG' : '▼ SHORT'}`, body: `${s.strategy}: kurulum iptal — ${why}. Açık işlemi kapat.`, url: `./#/islemler/${encodeURIComponent(s.id)}`, tag: `${s.id}+IPTAL` };
  return { kind: 'cancel', strategy: s.strategy, symbol: s.symbol, setup: s, title: `⛔ İptal · ${SHORT[s.symbol]} ${s.strategy}`, body: `${SHORT[s.symbol]} ${s.strategy} ${s.dir === 1 ? 'LONG' : 'SHORT'} iptal: ${why}`, url: `./#/${s.strategy}/${s.symbol}/${encodeURIComponent(s.id)}`, tag: `${s.id}+IPTAL` };
}
/** Son giriş süresi doldu (EK §3.5) — orta öncelik */
export function expiredMsg(s: Setup): Msg {
  return { kind: 'info', strategy: s.strategy, symbol: s.symbol, setup: s, title: `⏰ SÜRE DOLDU · ${SHORT[s.symbol]} ${s.strategy}`, body: `${SHORT[s.symbol]} ${s.strategy} ${s.dir === 1 ? 'LONG' : 'SHORT'}: son giriş ${fmtTR(s.lastEntry!)} TR geçti — dolmamış limit emrini iptal et`, url: `./#/${s.strategy}/${s.symbol}/${encodeURIComponent(s.id)}`, tag: `${s.id}+SURE` };
}
export function newsMsg(e: NewsEvent, now: number, affected: string[]): Msg {
  return { kind: 'news', title: `⚠️ HABER RİSKİ · ${e.currency} ${e.title}`, body: `${e.currency} ${e.title} ${durationText(e.t - now)} sonra (${fmtTR(e.t)} TR) · ${affected.map((s) => SHORT[s]).join(', ')} setupları askıda`, url: './#/haber', tag: `news+${e.id}` };
}

function allowed(m: Msg, prefs: Prefs | undefined, now: number): boolean {
  if (!prefs) return true;
  if (m.kind === 'test') return true;
  if (m.kind === 'ready' && prefs.ready === false) return false;
  if (m.kind === 'news' && prefs.news === false) return false;
  if (m.kind === 'cancel' && prefs.cancel === false) return false;
  if (m.strategy && prefs.strategies?.[m.strategy] === false) return false;
  if (m.symbol && prefs.symbols?.[m.symbol] === false) return false;
  if (m.strategy && m.symbol && prefs.matrix?.[`${m.strategy}:${m.symbol}`] === false) return false;
  return true;
}
/** Sessiz saatler (EK §1.1): bildirim gider ama sesiz; TAM ve ÇIKIŞ/iptal sessiz saati deler */
export function isSilent(m: Msg, prefs: Prefs | undefined, now: number): boolean {
  const q = prefs?.quiet ?? { from: '00:00', to: '07:00' };
  if (!q?.from || !q?.to) return false;
  const t = trMinutes(now), a = parseHM(q.from), b = parseHM(q.to);
  const inQuiet = a <= b ? t >= a && t < b : t >= a || t < b;
  const loud = m.kind === 'tam' || m.kind === 'cancel' || m.kind === 'test' || /ÇIKIŞ|⛔/.test(m.title + m.body);
  return inQuiet && !loud;
}

export async function sendAll(conf: Config, msgs: Msg[], now: number): Promise<{ sent: number; failed: number; log: string[] }> {
  const subs = parseSubs(process.env.PUSH_SUBSCRIPTIONS);
  const pub = process.env.VAPID_PUBLIC, priv = process.env.VAPID_PRIVATE;
  const log: string[] = [];
  if (!msgs.length) return { sent: 0, failed: 0, log };
  if (!pub || !priv || !subs.length) { log.push(`Bildirim gönderilmedi (${!pub || !priv ? 'VAPID anahtarı yok' : 'abonelik yok'}) — ${msgs.length} mesaj`); return { sent: 0, failed: 0, log }; }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || `https://${(process.env.GITHUB_REPOSITORY_OWNER || 'example')}.github.io`, pub, priv);
  let sent = 0, failed = 0;
  for (const sub of subs) {
    for (const m0 of msgs) {
      if (!allowed(m0, sub.prefs, now)) continue;
      const m = m0.kind === 'tam' && m0.setup ? tamMsg(conf, m0.setup, sub.prefs) : m0;
      const payload = JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag, kind: m.kind, t: now, signal: m.signal, silent: isSilent(m0, sub.prefs, now) });
      try {
        await webpush.sendNotification(sub as webpush.PushSubscription, payload, { TTL: 900, urgency: m.kind === 'ready' ? 'normal' : 'high' });
        sent++;
      } catch (e) {
        failed++;
        const code = (e as { statusCode?: number }).statusCode;
        log.push(`Gönderim hatası ${code ?? ''} ${sub.label ?? sub.endpoint.slice(0, 40)}…${code === 404 || code === 410 ? ' (abonelik geçersiz — uygulamadan yeni kod kopyalayın)' : ''}`);
      }
    }
  }
  log.push(`Bildirim: ${sent} gönderildi, ${failed} hata`);
  return { sent, failed, log };
}
