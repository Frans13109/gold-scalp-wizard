/** Pure, opt-in research evaluator. Not wired to ingestion, persistence, or trading.
 * A resolved result is an UNVALIDATED bid-candle estimate, never a trade result.
 * Require the entire creation-to-expiry window: partial candles cannot be observed safely.
 */
export const OUTCOME_M5_MS = 300_000;
/** Isolated safety limits for review; not signal-generation/expiry rules. */
export const OUTCOME_MAX_WINDOW_MS = 24 * 60 * 60_000;
export const OUTCOME_MAX_INPUT_CANDLES = 2_048;

export interface OutcomeSignal {
  side: "BUY" | "SELL";
  symbol: "XAUUSD";
  timeframe: "M5";
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  /** UTC epoch milliseconds; creation is actual evaluation time, not source-bar time. */
  createdAt: number;
  expiresAt: number;
  /** Research input assertion ONLY, not proof. Future server adapter must verify stored lineage;
   * neither this string nor is_demo authenticates a source. Never use this API as a trust boundary. */
  provenance: "verified_mt5" | "simulated" | "legacy_unknown";
}

export interface OutcomeCandle {
  symbol: string;
  timeframe: string;
  source: string;
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type OutcomeEvaluation =
  | { state: "REJECTED"; reason: "UNVERIFIED_PROVENANCE" | "INVALID_SIGNAL" | "INVALID_CANDLE" | "CONFLICTING_DUPLICATE" | "LIMIT_EXCEEDED"; unvalidated: true }
  | { state: "INCOMPLETE"; reason: "PARTIAL_BOUNDARY" | "WINDOW_NOT_CLOSED" | "MISSING_CANDLE"; unvalidated: true }
  | { state: "RESOLVED"; outcome: "sl" | "tp1" | "expired"; exitPrice: number | null; resultR: number | null; closedAt: number; unvalidated: true; method: "bid_candle_estimate" };

const positive = (v: number) => Number.isFinite(v) && v > 0;
const validTime = (v: number) => Number.isSafeInteger(v) && v >= 0 && Number.isFinite(new Date(v).getTime());
const aligned = (v: number) => v % OUTCOME_M5_MS === 0;
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const signalShape = (v: unknown): v is OutcomeSignal => record(v)
  && (v.side === "BUY" || v.side === "SELL") && v.symbol === "XAUUSD" && v.timeframe === "M5"
  && typeof v.entry === "number" && typeof v.stopLoss === "number" && typeof v.takeProfit1 === "number"
  && typeof v.createdAt === "number" && typeof v.expiresAt === "number";
const candleShape = (v: unknown): v is OutcomeCandle => record(v)
  && typeof v.symbol === "string" && typeof v.timeframe === "string" && typeof v.source === "string"
  && typeof v.openTime === "number" && typeof v.open === "number" && typeof v.high === "number"
  && typeof v.low === "number" && typeof v.close === "number";
const sameCandle = (a: OutcomeCandle, b: OutcomeCandle) =>
  a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close;

/** No clock reads, I/O, fixtures, or input mutation. Caller supplies a deterministic UTC time.
 * Full-window validation precedes resolution, including bars after a potential first hit.
 * This intentionally refuses to infer wins/losses from incomplete observation windows.
 */
export function evaluateOutcome(signal: unknown, candles: unknown, now: unknown): OutcomeEvaluation {
  const rejected = (reason: Extract<OutcomeEvaluation, { state: "REJECTED" }>["reason"]): OutcomeEvaluation =>
    ({ state: "REJECTED", reason, unvalidated: true });
  const incomplete = (reason: Extract<OutcomeEvaluation, { state: "INCOMPLETE" }>["reason"]): OutcomeEvaluation =>
    ({ state: "INCOMPLETE", reason, unvalidated: true });
  if (!signalShape(signal) || typeof now !== "number") return rejected("INVALID_SIGNAL");
  if (signal.provenance !== "verified_mt5") return rejected("UNVERIFIED_PROVENANCE");
  if (!Array.isArray(candles)) return rejected("INVALID_CANDLE");
  if (candles.length > OUTCOME_MAX_INPUT_CANDLES) return rejected("LIMIT_EXCEEDED");
  const buy = signal.side === "BUY";
  if (signal.symbol !== "XAUUSD" || signal.timeframe !== "M5" || !["BUY", "SELL"].includes(signal.side)
    || ![signal.entry, signal.stopLoss, signal.takeProfit1].every(positive)
    || !(buy ? signal.stopLoss < signal.entry && signal.entry < signal.takeProfit1
      : signal.takeProfit1 < signal.entry && signal.entry < signal.stopLoss)
    || !validTime(signal.createdAt) || !validTime(signal.expiresAt) || !validTime(now)
    || signal.expiresAt <= signal.createdAt || now < signal.createdAt) return rejected("INVALID_SIGNAL");
  const risk = Math.abs(signal.entry - signal.stopLoss);
  const reward = Math.abs(signal.takeProfit1 - signal.entry);
  // Reject non-finite derived ratios even when no candle touches a level.
  if (!positive(risk) || !positive(reward) || !Number.isFinite(reward / risk)) return rejected("INVALID_SIGNAL");
  if (signal.expiresAt - signal.createdAt > OUTCOME_MAX_WINDOW_MS) return rejected("LIMIT_EXCEEDED");
  if (!aligned(signal.createdAt) || !aligned(signal.expiresAt)) return incomplete("PARTIAL_BOUNDARY");
  if (now < signal.expiresAt) return incomplete("WINDOW_NOT_CLOSED");

  const byTime = new Map<number, OutcomeCandle>();
  for (const c of candles) {
    if (!candleShape(c)) return rejected("INVALID_CANDLE");
    // Other markets, timeframes, and simulated bars never supply observation coverage.
    if (c.symbol !== "XAUUSD" || c.timeframe !== "M5" || c.source !== "mt5_bridge") continue;
    if (!validTime(c.openTime)) return rejected("INVALID_CANDLE");
    // Source/earlier bars and bars opening at expiry are outside the window.
    if (c.openTime < signal.createdAt || c.openTime >= signal.expiresAt) continue;
    if (!aligned(c.openTime) || ![c.open, c.high, c.low, c.close].every(positive)
      || c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close) || c.high < c.low)
      return rejected("INVALID_CANDLE");
    const previous = byTime.get(c.openTime);
    if (previous && !sameCandle(previous, c)) return rejected("CONFLICTING_DUPLICATE");
    byTime.set(c.openTime, c);
  }
  for (let t = signal.createdAt; t < signal.expiresAt; t += OUTCOME_M5_MS) {
    if (!byTime.has(t)) return incomplete("MISSING_CANDLE");
  }
  for (const c of [...byTime.values()].sort((a, b) => a.openTime - b.openTime)) {
    const stop = buy ? c.low <= signal.stopLoss : c.high >= signal.stopLoss;
    const target = buy ? c.high >= signal.takeProfit1 : c.low <= signal.takeProfit1;
    if (!stop && !target) continue;
    // Worst-case SL first whenever OHLC touches both, even with a favourable opening gap.
    const adverseGap = buy ? c.open < signal.stopLoss : c.open > signal.stopLoss;
    const exitPrice = stop ? (adverseGap ? c.open : signal.stopLoss) : signal.takeProfit1;
    const resultR = (buy ? exitPrice - signal.entry : signal.entry - exitPrice) / risk;
    if (!Number.isFinite(resultR)) return rejected("INVALID_SIGNAL");
    return { state: "RESOLVED", outcome: stop ? "sl" : "tp1", exitPrice, resultR,
      closedAt: c.openTime + OUTCOME_M5_MS, unvalidated: true, method: "bid_candle_estimate" };
  }
  return { state: "RESOLVED", outcome: "expired", exitPrice: null, resultR: null,
    closedAt: signal.expiresAt, unvalidated: true, method: "bid_candle_estimate" };
}