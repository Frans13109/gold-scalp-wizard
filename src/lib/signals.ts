import { type Candle, at, indicators } from "./market";
import type { StrategySettings } from "./settings";

export type Signal = {
  id: string; side: "BUY" | "SELL"; time: number; entry: number; entryLow: number; entryHigh: number;
  sl: number; tp: number; tp2: number; rr: number; rr2: number; rrWorst: number;
  /** Confluence score: % of strategy checks passed. NOT a win probability. */
  score: number; expiresAt: number; invalidation: string; reasons: string[]; demo: true;
};

/** Reward-to-risk measured from a fill price. */
export function rrOf(entry: number, sl: number, tp: number): number {
  return Math.abs(tp - entry) / Math.abs(entry - sl);
}

export function trendOf(m15: Candle[], i = m15.length - 1): "UP" | "DOWN" | "RANGE" {
  const ind = indicators(m15.slice(0, i + 1));
  const e21 = at(ind.ema21, -1), e50 = at(ind.ema50, -1), c = at(m15, i).c;
  if (e21 > e50 && c > e50) return "UP";
  if (e21 < e50 && c < e50) return "DOWN";
  return "RANGE";
}

/** Scan M5 candles with M15 trend filter. Signals only — never places orders. */
export function scan(m5: Candle[], m15: Candle[], s: StrategySettings): Signal[] {
  const ind = indicators(m5);
  const out: Signal[] = [];
  const spreadOk = s.demoSpread <= s.maxSpread;
  for (let i = 60; i < m5.length; i++) {
    const m15i = Math.min(Math.floor(i / 3) - 1, m15.length - 1);
    if (m15i < 50) continue;
    const trend = trendOf(m15, m15i);
    const cross = (a: number[], b: number[], up: boolean) => (up ? at(a, i - 1) <= at(b, i - 1) && at(a, i) > at(b, i) : at(a, i - 1) >= at(b, i - 1) && at(a, i) < at(b, i));
    for (const side of ["BUY", "SELL"] as const) {
      const up = side === "BUY";
      if (!cross(ind.ema9, ind.ema21, up)) continue;
      const bar = at(m5, i), r = at(ind.rsi, i), h = at(ind.macd.hist, i);
      // Each confluence check is evaluated independently; "required" ones also gate the signal.
      const checks = {
        trend: trend === (up ? "UP" : "DOWN"),
        momentum: up ? r >= s.rsiBuyMin : r <= s.rsiSellMax,
        macd: up ? h > 0 : h < 0,
        candle: up ? bar.c > bar.o : bar.c < bar.o,
        spread: spreadOk,
      };
      if (s.requireTrendAlignment && !checks.trend) continue;
      if (!checks.momentum) continue;
      if (s.requireMacdConfirm && !checks.macd) continue;
      if (s.requireCandleConfirm && !checks.candle) continue;
      if (!checks.spread) continue;
      const reasons = [`M5 EMA9 crossed ${up ? "above" : "below"} EMA21`, `M15 trend ${trend}`, `RSI ${r.toFixed(1)}`];
      if (checks.macd) reasons.push("MACD histogram confirms");
      if (checks.candle) reasons.push(`${up ? "Bullish" : "Bearish"} confirmation candle`);
      const passed = Object.values(checks).filter(Boolean).length;
      const confluence = Math.round((passed / Object.keys(checks).length) * 100);
      const a = at(ind.atr, i), entry = bar.c, dir = up ? 1 : -1;
      const sl = entry - dir * a * s.slAtrMult;
      const risk = Math.abs(entry - sl);
      const tp = entry + dir * risk * s.minRR;
      const tp2 = entry + dir * risk * s.minRR * 1.6;
      const entryLow = entry - a * 0.15, entryHigh = entry + a * 0.15;
      const worst = up ? entryHigh : entryLow;
      const invalidation = `M5 close ${up ? "below" : "above"} ${sl.toFixed(2)} or M15 trend flips`;
      out.push({ id: `${side}-${bar.t}`, side, time: bar.t, entry, entryLow, entryHigh, sl, tp, tp2,
        rr: rrOf(entry, sl, tp), rr2: rrOf(entry, sl, tp2), rrWorst: rrOf(worst, sl, tp),
        score: confluence, expiresAt: bar.t + 3 * 300000, invalidation, reasons, demo: true });
    }
  }
  return out.reverse();
}
