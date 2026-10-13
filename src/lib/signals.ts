import { type Candle, indicators } from "./market";
import type { StrategySettings } from "./settings";

export type Signal = {
  id: string; side: "BUY" | "SELL"; time: number; entryLow: number; entryHigh: number;
  sl: number; tp: number; rr: number; reasons: string[]; demo: true;
};

export function trendOf(m15: Candle[], i = m15.length - 1): "UP" | "DOWN" | "RANGE" {
  const ind = indicators(m15.slice(0, i + 1));
  const n = ind.ema9.length - 1;
  if (ind.ema21[n] > ind.ema50[n] && m15[i].c > ind.ema50[n]) return "UP";
  if (ind.ema21[n] < ind.ema50[n] && m15[i].c < ind.ema50[n]) return "DOWN";
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
    const cross = (a: number[], b: number[], up: boolean) => (up ? a[i - 1] <= b[i - 1] && a[i] > b[i] : a[i - 1] >= b[i - 1] && a[i] < b[i]);
    for (const side of ["BUY", "SELL"] as const) {
      const up = side === "BUY";
      if (!cross(ind.ema9, ind.ema21, up)) continue;
      const reasons = [`M5 EMA9 crossed ${up ? "above" : "below"} EMA21`];
      if (s.requireTrendAlignment) { if (trend !== (up ? "UP" : "DOWN")) continue; reasons.push(`M15 trend ${trend}`); }
      const r = ind.rsi[i];
      if (up ? r < s.rsiBuyMin : r > s.rsiSellMax) continue;
      reasons.push(`RSI ${r.toFixed(1)}`);
      if (s.requireMacdConfirm) { const h = ind.macd.hist[i]; if (up ? h <= 0 : h >= 0) continue; reasons.push("MACD histogram confirms"); }
      if (s.requireCandleConfirm) { const c = m5[i]; if (up ? c.c <= c.o : c.c >= c.o) continue; reasons.push(`${up ? "Bullish" : "Bearish"} confirmation candle`); }
      if (!spreadOk) continue;
      const a = ind.atr[i], px = m5[i].c;
      const sl = up ? px - a * s.slAtrMult : px + a * s.slAtrMult;
      const risk = Math.abs(px - sl);
      const tp = up ? px + risk * s.minRR : px - risk * s.minRR;
      out.push({ id: `${side}-${m5[i].t}`, side, time: m5[i].t, entryLow: px - a * 0.15, entryHigh: px + a * 0.15, sl, tp, rr: s.minRR, reasons, demo: true });
    }
  }
  return out.reverse();
}
