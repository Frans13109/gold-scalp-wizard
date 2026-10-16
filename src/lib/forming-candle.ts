import type { Candle } from "./market";

/** Builds the currently forming M5 candle from live BID ticks (same basis as MT5 closed candles). */
export const M5_MS = 5 * 60_000;

export interface FormingCandle extends Candle {
  /** Time of the newest tick applied (ms). */
  lastTick: number;
  /** True when the first observed tick came well after the interval opened, so the open may differ from MT5's. */
  partial: boolean;
}

export interface BidTick { bid: number; tickTime: string }

const PARTIAL_AFTER_MS = 5_000;

/** Pure reducer: applies one tick. Ignores invalid, duplicate and out-of-order ticks; rolls over at each M5 boundary. */
export function applyTick(prev: FormingCandle | null, tick: BidTick): FormingCandle | null {
  const ts = Date.parse(tick.tickTime);
  const p = Number(tick.bid);
  if (!Number.isFinite(ts) || !Number.isFinite(p) || p <= 0) return prev;
  if (prev && ts <= prev.lastTick) return prev; // duplicate or older tick
  const t = Math.floor(ts / M5_MS) * M5_MS;
  if (!prev || t > prev.t) return { t, o: p, h: p, l: p, c: p, lastTick: ts, partial: ts - t > PARTIAL_AFTER_MS };
  return { ...prev, h: Math.max(prev.h, p), l: Math.min(prev.l, p), c: p, lastTick: ts };
}

/**
 * Returns the forming candle to draw after the closed series, or null.
 * Closed MT5 candles are authoritative: once a closed candle exists for the interval, the forming one is dropped.
 * Only drawn while ticks are LIVE and the forming interval is the current one.
 */
export function formingToShow(closed: Candle[], forming: FormingCandle | null, tickLive: boolean, now: number = Date.now()): FormingCandle | null {
  if (!forming || !tickLive) return null;
  if (forming.t !== Math.floor(now / M5_MS) * M5_MS) return null;
  const last = closed[closed.length - 1];
  if (last && last.t >= forming.t) return null;
  return forming;
}
