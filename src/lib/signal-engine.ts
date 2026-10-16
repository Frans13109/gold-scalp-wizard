// Gold Scalp Wizard signal engine — DEMO/TESTING ONLY. Produces signals, never orders.
// M15 trend filter (completed candles) + M5 pullback entry (completed candles) + live bid/ask risk levels.
import { type Candle, at, ema, rsi, atr } from "./market";

export const STRATEGY_VERSION = "m15ema20-50_m5pullback_v1";
const M5_MS = 5 * 60_000, M15_MS = 15 * 60_000;

export const ENGINE = {
  minM15: 60, minM5: 50,
  /** Latest completed candle must have closed within these windows. */
  m15MaxCloseAgeMs: 20 * 60_000, m5MaxCloseAgeMs: 10 * 60_000,
  tickMaxAgeMs: 10_000,
  maxSpread: 0.35,
  slAtrMult: 1.5, rr: 2,
  minStop: 0.5, maxStop: 20, minStopSpreadMult: 3,
  rsiBuy: [50, 70] as const, rsiSell: [30, 50] as const,
  maxBarAtr: 3,
  expiryBars: 3,
};

export type Bias = "BULLISH" | "BEARISH" | "NONE";
export type NoTradeReason =
  | "WAITING_FOR_DATA" | "INSUFFICIENT_HISTORY" | "NO_M15_TREND" | "M5_NOT_MET"
  | "SPREAD_TOO_HIGH" | "INVALID_STOP" | "RR_NOT_MET";

export const REASON_TEXT: Record<NoTradeReason | "SIGNAL_EXPIRED", string> = {
  WAITING_FOR_DATA: "Waiting for fresh MT5 data",
  INSUFFICIENT_HISTORY: "Insufficient candle history",
  NO_M15_TREND: "No confirmed M15 trend",
  M5_NOT_MET: "M5 entry conditions not met",
  SPREAD_TOO_HIGH: "Spread too high",
  INVALID_STOP: "Stop distance invalid",
  RR_NOT_MET: "Reward-to-risk requirement not met",
  SIGNAL_EXPIRED: "Signal expired",
};

export interface EngineTick { bid: number; ask: number; tickTime: string }
export interface EngineIndicators {
  m15: { ema20: number; ema50: number; close: number; candleTime: string } | null;
  m5: { ema9: number; ema20: number; rsi14: number; atr14: number; close: number; candleTime: string } | null;
  spread: number | null;
}
export interface EngineSignal {
  side: "BUY" | "SELL"; symbol: "XAUUSD"; timeframe: "M5";
  entry: number; entryReference: "ask" | "bid"; stopLoss: number; takeProfit: number; rr: number;
  digits: number; sourceCandleTime: string; createdAt: string; expiresAt: string;
  m15Bias: Bias; reasons: string[]; invalidation: string; strategyVersion: string; isDemo: true;
}
export type EngineResult =
  | { state: "SIGNAL"; signal: EngineSignal; bias: Bias; ind: EngineIndicators; details: string[] }
  | { state: "NO_TRADE"; reason: NoTradeReason; bias: Bias; ind: EngineIndicators; details: string[] };

/** Only candles whose period has fully ended. Forming candles never trigger signals. */
export function completed(c: Candle[], tfMs: number, now: number): Candle[] {
  return [...c].sort((a, b) => a.t - b.t).filter((x) => x.t + tfMs <= now);
}

/** Price precision inferred from the live quote (e.g. 2 or 3 digits), minimum 2. */
export function priceDigits(...prices: number[]): number {
  let d = 2;
  for (const p of prices) {
    const s = String(p);
    const i = s.indexOf(".");
    if (i >= 0) d = Math.max(d, Math.min(5, s.length - i - 1));
  }
  return d;
}
const roundTo = (v: number, d: number, mode: "floor" | "ceil" | "round" = "round") => {
  const f = 10 ** d;
  const x = Math.round(v * f * 1e6) / 1e6; // guard float noise before floor/ceil
  return (mode === "floor" ? Math.floor(x) : mode === "ceil" ? Math.ceil(x) : Math.round(x)) / f;
};

export function m15Bias(m15: Candle[]): { bias: Bias; ema20: number; ema50: number; close: number } {
  const close = m15.map((x) => x.c);
  const e20 = at(ema(close, 20), -1), e50 = at(ema(close, 50), -1), c = at(close, -1);
  const bias: Bias = e20 > e50 && c > e20 ? "BULLISH" : e20 < e50 && c < e20 ? "BEARISH" : "NONE";
  return { bias, ema20: e20, ema50: e50, close: c };
}

export function evaluateSignal(m5Raw: Candle[], m15Raw: Candle[], tick: EngineTick | null, now: number = Date.now(), cfg = ENGINE): EngineResult {
  const ind: EngineIndicators = { m15: null, m5: null, spread: tick ? tick.ask - tick.bid : null };
  const m5 = completed(m5Raw, M5_MS, now), m15 = completed(m15Raw, M15_MS, now);
  const no = (reason: NoTradeReason, bias: Bias, details: string[] = []): EngineResult => ({ state: "NO_TRADE", reason, bias, ind, details });

  if (m15.length < cfg.minM15 || m5.length < cfg.minM5)
    return no("INSUFFICIENT_HISTORY", "NONE", [`M15 completed: ${m15.length}/${cfg.minM15}`, `M5 completed: ${m5.length}/${cfg.minM5}`]);
  const l15 = at(m15, -1), l5 = at(m5, -1);
  const tickAge = tick ? now - Date.parse(tick.tickTime) : Infinity;
  const tickOk = !!tick && Number.isFinite(tickAge) && tickAge <= cfg.tickMaxAgeMs && tickAge > -cfg.tickMaxAgeMs
    && tick.bid > 0 && tick.ask >= tick.bid;
  if (now - (l15.t + M15_MS) > cfg.m15MaxCloseAgeMs || now - (l5.t + M5_MS) > cfg.m5MaxCloseAgeMs || !tickOk)
    return no("WAITING_FOR_DATA", "NONE", [!tickOk ? "Live bid/ask tick missing or older than 10 s" : "Latest completed candle is too old"]);

  const t = m15Bias(m15);
  ind.m15 = { ema20: t.ema20, ema50: t.ema50, close: t.close, candleTime: new Date(l15.t).toISOString() };
  const close5 = m5.map((x) => x.c);
  const e9 = ema(close5, 9), e20 = ema(close5, 20), r = rsi(close5, 14), a = atr(m5, 14);
  const i = m5.length - 1;
  const prev = at(m5, i - 1);
  const E9 = at(e9, i), E20 = at(e20, i), E20p = at(e20, i - 1), E9p = at(e9, i - 1), R = at(r, i), A = at(a, i);
  ind.m5 = { ema9: E9, ema20: E20, rsi14: R, atr14: A, close: l5.c, candleTime: new Date(l5.t).toISOString() };
  if (t.bias === "NONE") return no("NO_M15_TREND", "NONE", [`M15 EMA20 ${t.ema20.toFixed(2)} vs EMA50 ${t.ema50.toFixed(2)}, close ${t.close.toFixed(2)}`]);

  const up = t.bias === "BULLISH";
  const [rLo, rHi] = up ? cfg.rsiBuy : cfg.rsiSell;
  const checks: [string, boolean][] = [
    [`M5 EMA9 ${up ? "above" : "below"} EMA20`, up ? E9 > E20 : E9 < E20],
    [`M5 EMA20 ${up ? "rising" : "falling"}`, up ? E20 > E20p : E20 < E20p],
    [`Pullback touched EMA9 in last 2 candles`, up ? l5.l <= E9 || prev.l <= E9p : l5.h >= E9 || prev.h >= E9p],
    [`Confirmed close ${up ? "above" : "below"} EMA9`, up ? l5.c > E9 : l5.c < E9],
    [`${up ? "Bullish" : "Bearish"} confirmation candle`, up ? l5.c > l5.o : l5.c < l5.o],
    [`RSI 14 between ${rLo} and ${rHi}`, R >= rLo && R <= rHi],
    [`Candle range ≤ ${cfg.maxBarAtr}× ATR (no spike)`, l5.h - l5.l <= cfg.maxBarAtr * A],
  ];
  const failed = checks.filter(([, ok]) => !ok).map(([k]) => `Failed: ${k}`);
  if (failed.length) return no("M5_NOT_MET", t.bias, failed);

  const tk = tick as EngineTick;
  const spread = tk.ask - tk.bid;
  if (spread > cfg.maxSpread) return no("SPREAD_TOO_HIGH", t.bias, [`Spread ${spread.toFixed(3)} > max ${cfg.maxSpread}`]);
  const digits = priceDigits(tk.bid, tk.ask);
  const dir = up ? 1 : -1;
  const entry = roundTo(up ? tk.ask : tk.bid, digits);
  const dist = cfg.slAtrMult * A;
  if (!(dist >= Math.max(cfg.minStop, cfg.minStopSpreadMult * spread)) || dist > cfg.maxStop)
    return no("INVALID_STOP", t.bias, [`Stop distance ${dist.toFixed(2)} outside ${Math.max(cfg.minStop, cfg.minStopSpreadMult * spread).toFixed(2)}–${cfg.maxStop}`]);
  // Round stop away from entry and target away from entry so the rounded R:R never drops below cfg.rr.
  const stopLoss = roundTo(entry - dir * dist, digits, up ? "floor" : "ceil");
  const risk = Math.abs(entry - stopLoss);
  const takeProfit = roundTo(entry + dir * risk * cfg.rr, digits, up ? "ceil" : "floor");
  const rr = Math.abs(takeProfit - entry) / risk;
  if (!(risk > 0) || rr < cfg.rr - 1e-9) return no("RR_NOT_MET", t.bias, [`R:R ${rr.toFixed(2)} < ${cfg.rr}`]);

  const closeAt = l5.t + M5_MS;
  return {
    state: "SIGNAL", bias: t.bias, ind, details: [],
    signal: {
      side: up ? "BUY" : "SELL", symbol: "XAUUSD", timeframe: "M5",
      entry, entryReference: up ? "ask" : "bid", stopLoss, takeProfit, rr, digits,
      sourceCandleTime: new Date(l5.t).toISOString(), createdAt: new Date(now).toISOString(),
      expiresAt: new Date(closeAt + cfg.expiryBars * M5_MS).toISOString(),
      m15Bias: t.bias, reasons: [`M15 bias ${t.bias}`, ...checks.map(([k]) => k)],
      invalidation: `M5 close ${up ? "below" : "above"} ${stopLoss.toFixed(digits)} or M15 bias flips`,
      strategyVersion: STRATEGY_VERSION, isDemo: true,
    },
  };
}

/** Duplicate key: one signal per side per completed M5 candle per strategy version. */
export const signalKey = (s: Pick<EngineSignal, "symbol" | "side" | "timeframe" | "sourceCandleTime" | "strategyVersion">) =>
  [s.symbol, s.side, s.timeframe, s.sourceCandleTime, s.strategyVersion].join("|");

export const isExpired = (s: Pick<EngineSignal, "expiresAt">, now: number = Date.now()) => Date.parse(s.expiresAt) <= now;
