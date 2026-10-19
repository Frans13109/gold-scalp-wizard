import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market";
import { evaluateSignal, signalKey } from "@/lib/signal-engine";
import { signalToAlert } from "@/lib/signal-alerts";
import { defaultNotifications } from "@/lib/settings";

// Synthetic test fixtures only (same shape as signal-engine.test.ts); never shown in the app.
const M5 = 300_000, M15 = 900_000;
const END = Date.parse("2026-10-16T12:00:00Z"), NOW = END + 2_000;
function series(n: number, tf: number, dir: 1 | -1): Candle[] {
  const out: Candle[] = []; let p = 4000;
  for (let i = 0; i < n; i++) {
    const step = (n - 1 - i) % 2 === 0 ? 1.0 : -0.6; const o = p, c = p + dir * step;
    out.push({ t: END - (n - i) * tf, o, c, h: Math.max(o, c) + 0.3, l: Math.min(o, c) - 1.0 }); p = c;
  }
  return out;
}
const tick = (c: Candle[]) => { const bid = +c[c.length - 1]!.c.toFixed(2); return { bid, ask: +(bid + 0.2).toFixed(2), tickTime: new Date(NOW - 1000).toISOString() }; };
const b5 = series(120, M5, 1), b15 = series(100, M15, 1), s5 = series(120, M5, -1), s15 = series(100, M15, -1);
const buy = evaluateSignal(b5, b15, tick(b5), NOW);
const sell = evaluateSignal(s5, s15, tick(s5), NOW);
const LIVE = { candlesLive: true, tickLive: true };
const none = new Set<string>();

describe("signal pop-up alerts", () => {
  it("fixtures produce BUY and SELL", () => {
    expect(buy.state === "SIGNAL" && buy.signal.side).toBe("BUY");
    expect(sell.state === "SIGNAL" && sell.signal.side).toBe("SELL");
  });
  it("alerts once for a new live signal, then suppresses duplicates", () => {
    const hit = signalToAlert(buy, LIVE, defaultNotifications, none, NOW);
    expect(hit).not.toBeNull();
    const seen = new Set([hit!.key]);
    expect(signalToAlert(buy, LIVE, defaultNotifications, seen, NOW + 1000)).toBeNull();
    // same candle, new tick → same key → still suppressed
    const again = evaluateSignal(b5, b15, { ...tick(b5), bid: tick(b5).bid + 0.1, ask: tick(b5).ask + 0.1 }, NOW + 1000);
    if (again.state !== "SIGNAL") throw new Error("expected signal");
    expect(signalKey(again.signal)).toBe(hit!.key);
    expect(signalToAlert(again, LIVE, defaultNotifications, seen, NOW + 1000)).toBeNull();
  });
  it("respects In-app, BUY and SELL preferences", () => {
    expect(signalToAlert(buy, LIVE, { ...defaultNotifications, inApp: false }, none, NOW)).toBeNull();
    expect(signalToAlert(buy, LIVE, { ...defaultNotifications, buy: false }, none, NOW)).toBeNull();
    expect(signalToAlert(sell, LIVE, { ...defaultNotifications, buy: false }, none, NOW)).not.toBeNull();
    expect(signalToAlert(sell, LIVE, { ...defaultNotifications, sell: false }, none, NOW)).toBeNull();
  });
  it("rejects demo/stale candles and stale ticks", () => {
    expect(signalToAlert(buy, { candlesLive: false, tickLive: true }, defaultNotifications, none, NOW)).toBeNull();
    expect(signalToAlert(buy, { candlesLive: true, tickLive: false }, defaultNotifications, none, NOW)).toBeNull();
  });
  it("rejects expired signals and NO_TRADE results", () => {
    expect(signalToAlert(buy, LIVE, defaultNotifications, none, END + 3 * M5)).toBeNull();
    const stale = evaluateSignal(b5, b15, null, NOW);
    expect(signalToAlert(stale, LIVE, defaultNotifications, none, NOW)).toBeNull();
  });
});
