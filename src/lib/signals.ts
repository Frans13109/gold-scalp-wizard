import { type Candle, at, indicators } from "./market";
import type { StrategySettings } from "./settings";

export type Signal = {
  id: string; side: "BUY" | "SELL"; time: number; entryLow: number; entryHigh: number;
  sl: number; tp: number; tp2: number; rr: number; score: number; expiresAt: number; invalidation: string; reasons: string[]; demo: true;
};

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
      const reasons = [`M5 EMA9 crossed ${up ? "above" : "below"} EMA21`];
      if (s.requireTrendAlignment) { if (trend !== (up ? "UP" : "DOWN")) continue; reasons.push(`M15 trend ${trend}`); }
      const r = at(ind.rsi, i);
      if (up ? r < s.rsiBuyMin : r > s.rsiSellMax) continue;
      reasons.push(`RSI ${r.toFixed(1)}`);
      if (s.requireMacdConfirm) { const h = at(ind.macd.hist, i); if (up ? h <= 0 : h >= 0) continue; reasons.push("MACD histogram confirms"); }
      if (s.requireCandleConfirm) { const c = at(m5, i); if (up ? c.c <= c.o : c.c >= c.o) continue; reasons.push(`${up ? "Bullish" : "Bearish"} confirmation candle`); }
      if (!spreadOk) continue;
      const a = at(ind.atr, i), bar = at(m5, i), px = bar.c;
      const sl = up ? px - a * s.slAtrMult : px + a * s.slAtrMult;
      const risk = Math.abs(px - sl);
      const tp = up ? px + risk * s.minRR : px - risk * s.minRR;
      const tp2 = up ? px + risk * s.minRR * 1.6 : px - risk * s.minRR * 1.6;
      let score = 40 + reasons.length * 10;
      if (trend === (up ? "UP" : "DOWN")) score += 10;
      score = Math.min(100, score);
      const invalidation = `M5 close ${up ? "below" : "above"} ${sl.toFixed(2)} or M15 trend flips`;
      out.push({ id: `${side}-${bar.t}`, side, time: bar.t, entryLow: px - a * 0.15, entryHigh: px + a * 0.15, sl, tp, tp2, rr: s.minRR, score, expiresAt: bar.t + 3 * 300000, invalidation, reasons, demo: true });
    }
  }
  return out.reverse();
}
