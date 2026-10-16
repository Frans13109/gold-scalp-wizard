import type { Candle, Timeframe } from "./market";

/** Minimum candles needed for meaningful EMA/RSI/MACD/ATR readings. */
export const MIN_LIVE_CANDLES = 30;
/** Newest candle must have opened within this window to count as live (allows for a few missed closes). */
export const LIVE_MAX_AGE_MS: Record<Timeframe, number> = { M5: 15 * 60_000, M15: 45 * 60_000 };

export interface CandleRow {
  open_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type LiveState = "LIVE" | "MISSING" | "STALE";
export interface LiveSeries { state: LiveState; candles: Candle[]; lastOpenAt: string | null }

/** Sorts ascending by open_time, drops duplicates/invalid rows, and decides whether the series is fresh enough to show as live. */
export function evaluateCandles(rows: CandleRow[] | null | undefined, tf: Timeframe, now: number = Date.now()): LiveSeries {
  const seen = new Set<number>();
  const candles: Candle[] = [];
  for (const r of rows ?? []) {
    const t = Date.parse(r.open_time);
    const o = Number(r.open), h = Number(r.high), l = Number(r.low), c = Number(r.close);
    if (!Number.isFinite(t) || seen.has(t) || ![o, h, l, c].every(Number.isFinite)) continue;
    seen.add(t);
    candles.push({ t, o, h, l, c });
  }
  candles.sort((a, b) => a.t - b.t);
  const last = candles[candles.length - 1];
  if (!last || candles.length < MIN_LIVE_CANDLES) return { state: "MISSING", candles, lastOpenAt: last ? new Date(last.t).toISOString() : null };
  const age = now - last.t;
  const fresh = age <= LIVE_MAX_AGE_MS[tf] && age > -LIVE_MAX_AGE_MS[tf];
  return { state: fresh ? "LIVE" : "STALE", candles, lastOpenAt: new Date(last.t).toISOString() };
}
