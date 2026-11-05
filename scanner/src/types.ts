export interface Candle { t: number; o: number; h: number; l: number; c: number; v?: number }
export type TF = '1m' | '3m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';
export type Dir = 1 | -1;
export type CondStatus = 'ok' | 'fail' | 'wait';
/** BEKLE = TAM ama zaman/ortam bloğu var (sadece F: "TAM – BEKLE") */
export type Status = 'TAM' | 'BEKLE' | 'EKSIK' | 'YOK';
export type StrategyId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export interface Condition {
  id: string;
  label: string;
  status: CondStatus;
  detail: string;
  /** Grafikte vurgulanacak seviye (varsa) */
  level?: number;
}

export interface EntryMethod {
  id: string;
  label: string;
  type: 'market' | 'limit';
  entry: number;
  /** Yapısal stop (tampon/spread hariç) — uygulama kendi tamponuyla yeniden hesaplayabilir */
  stopStructural: number;
  stop: number;
  tp1: number;
  tp2?: number;
  tp3?: number;
  rr: number;
  rr2?: number;
  rr3?: number;
  note?: string;
  tag?: string;
  /** Stop yapıya göre kesin (F): uygulama tampon/spread eklemez */
  fixedStop?: boolean;
}

export interface Overlay {
  kind: 'zone' | 'line';
  style: 'ob' | 'fvg' | 'ifvg' | 'breaker' | 'mb' | 'rb' | 'range' | 'eq' | 'liq' | 'entry' | 'stop' | 'tp' | 'line4h' | 'level';
  label: string;
  price?: number;
  top?: number;
  bottom?: number;
  from?: number;
  to?: number;
  tf?: TF;
  cond?: string;
}

export interface ExtraItem { name: string; sign: 1 | 0 | -1; detail: string }
export interface Extra { summary: 'Var' | 'Yok' | 'Ters'; items: ExtraItem[] }

export interface Setup {
  id: string;
  key: string;
  strategy: StrategyId;
  symbol: string;
  sub: string;
  dir: Dir | 0;
  status: Status;
  remaining: number;
  conditions: Condition[];
  methods: EntryMethod[];
  defaultMethod?: string;
  invalidation?: string;
  missing?: string;
  none?: { why: string; waiting: string; ends: string };
  extra?: Extra;
  stars?: number;
  warnings?: string[];
  tags?: string[];
  overlays: Overlay[];
  chartTf: TF;
  tfs: TF[];
  signalAt?: number;
  evaluatedAt: number;
  zoneId: string;
  info?: Record<string, unknown>;
  /** Grafik dosyası anahtarı (varsayılan: sembol). F: BTCUSD_F */
  chartKey?: string;
  /** Tek seferlik olay bildirimleri (anahtar başına bir kez). requires: bu anahtar daha önce bildirildiyse gönder */
  notices?: { key: string; title: string; body: string; requires?: string }[];
}

export interface NewsEvent {
  id: string;
  t: number;
  currency: string;
  impact: 'High' | 'Medium' | 'Low' | 'Holiday';
  title: string;
  forecast?: string;
  previous?: string;
  actual?: string;
  source: string;
  symbols?: string[];
}

export interface NewsFile {
  fetchedAt: number;
  ffFetchedAt?: number;
  stale?: boolean;
  fmp: 'ok' | 'yok' | 'hata';
  events: NewsEvent[];
  headlines: { t: number; title: string; source: string; url?: string }[];
  error?: string;
}

export interface SymbolCfg {
  td: string;
  label: string;
  name: string;
  decimals: number;
  contract: number;
  buffer: number;
  bufferType: 'abs' | 'pct' | 'us100pts';
  spread: number;
  spreadType?: 'abs' | 'pct' | 'us100pts';
  currencies: string[];
  strategies: StrategyId[];
  crypto: boolean;
  proxy?: boolean;
}
