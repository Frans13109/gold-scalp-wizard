/** Pure, opt-in research evaluator. Not wired to ingestion, persistence, or trading.
 * A resolved result is an UNVALIDATED bid-candle estimate, never a trade result.
 * Require the entire creation-to-expiry window: partial candles cannot be observed safely.
 */
export const OUTCOME_M5_MS = 300_000;

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
  /** Must be explicitly established by a future trusted adapter; is_demo is not provenance. */
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
  | { state: "REJECTED"; reason: "UNVERIFIED_PROVENANCE" | "INVALID_SIGNAL" | "INVALID_CANDLE" | "CONFLICTING_DUPLICATE"; unvalidated: true }
  | { state: "INCOMPLETE"; reason: "PARTIAL_BOUNDARY" | "WINDOW_NOT_CLOSED" | "MISSING_CANDLE"; unvalidated: true }
  | { state: "RESOLVED"; outcome: "sl" | "tp1" | "expired"; exitPrice: number | null; resultR: number | null; closedAt: number; unvalidated: true; method: "bid_candle_estimate" };

const positive = (v: number) => Number.isFinite(v) && v > 0;
const validTime = (v: number) => Number.isSafeInteger(v) && v >= 0 && Number.isFinite(new Date(v).getTime());
const aligned = (v: number) => v % OUTCOME_M5_MS === 0;
const sameCandle = (a: OutcomeCandle, b: OutcomeCandle) =>
  a.open === b.open && a.high === b.high && a.low === b.low && a.close === b.close;

/** No clock reads, I/O, fixtures, or input mutation. Caller supplies a deterministic UTC time.
 * Full-window validation precedes resolution, including bars after a potential first hit.
 * This intentionally refuses to infer wins/losses from incomplete observation windows.
 */
export function evaluateOutcome(signal: OutcomeSignal, candles: readonly OutcomeCandle[], now: number): OutcomeEvaluation {
  const rejected = (reason: Extract<OutcomeEvaluation, { state: "REJECTED" }>["reason"]): OutcomeEvaluation =>
    ({ state: "REJECTED", reason, unvalidated: true });
  const incomplete = (reason: Extract<OutcomeEvaluation, { state: "INCOMPLETE" }>["reason"]): OutcomeEvaluation =>
    ({ state: "INCOMPLETE", reason, unvalidated: true });
  if (signal.provenance !== "verified_mt5") return rejected("UNVERIFIED_PROVENANCE");
  const buy = signal.side === "BUY";
  if (signal.symbol !== "XAUUSD" || signal.timeframe !== "M5" || !["BUY", "SELL"].includes(signal.side)
    || ![signal.entry, signal.stopLoss, signal.takeProfit1].every(positive)
    || !(buy ? signal.stopLoss < signal.entry && signal.entry < signal.takeProfit1
      : signal.takeProfit1 < signal.entry && signal.entry < signal.stopLoss)
    || !validTime(signal.createdAt) || !validTime(signal.expiresAt) || !validTime(now)
    || signal.expiresAt <= signal.createdAt || now < signal.createdAt) return rejected("INVALID_SIGNAL");
  if (!aligned(signal.createdAt) || !aligned(signal.expiresAt)) return incomplete("PARTIAL_BOUNDARY");
  if (now < signal.expiresAt) return incomplete("WINDOW_NOT_CLOSED");

  const byTime = new Map<number, OutcomeCandle>();
  for (const c of candles) {
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
  const risk = Math.abs(signal.entry - signal.stopLoss);
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