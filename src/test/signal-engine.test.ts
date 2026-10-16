import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/market";
import { evaluateSignal, completed, priceDigits, signalKey, isExpired, ENGINE } from "@/lib/signal-engine";

const M5 = 300_000, M15 = 900_000;
const END = Date.parse("2026-10-16T12:00:00Z"); // close time of last completed candles
const NOW = END + 2_000;

/** Deterministic zig-zag trend: +up, -down alternating; ends on an "up" bar. dir=-1 mirrors for a downtrend. */
function series(n: number, tf: number, dir: 1 | -1, up = 1.0, down = 0.6): Candle[] {
  const out: Candle[] = [];
  let p = 4000;
  for (let i = 0; i < n; i++) {
    const step = (n - 1 - i) % 2 === 0 ? up : -down;
    const o = p, c = p + dir * step;
    out.push({ t: END - (n - i) * tf, o, c, h: Math.max(o, c) + 0.3, l: Math.min(o, c) - 1.0 });
    p = c;
  }
  return out;
}
const tick = (bid: number, spread = 0.2, ageMs = 1000) => ({ bid, ask: +(bid + spread).toFixed(2), tickTime: new Date(NOW - ageMs).toISOString() });
const bull5 = series(120, M5, 1), bull15 = series(100, M15, 1);
const bear5 = series(120, M5, -1), bear15 = series(100, M15, -1);
const lastC = (c: Candle[]) => c[c.length - 1]!.c;

describe("signal engine", () => {
  it("bullish M15 + bullish M5 → BUY at ask with 2:1 and correct rounding", () => {
    const r = evaluateSignal(bull5, bull15, tick(lastC(bull5)), NOW);
    expect(r.state).toBe("SIGNAL");
    if (r.state !== "SIGNAL") return;
    const s = r.signal;
    expect(s.side).toBe("BUY");
    expect(s.entry).toBeCloseTo(lastC(bull5) + 0.2, 6);
    expect(s.stopLoss).toBeLessThan(s.entry);
    expect(s.takeProfit).toBeGreaterThan(s.entry);
    expect(s.rr).toBeGreaterThanOrEqual(2 - 1e-9);
    expect(Number(s.stopLoss.toFixed(2))).toBe(s.stopLoss);
    expect(s.isDemo).toBe(true);
    expect(s.m15Bias).toBe("BULLISH");
  });
  it("bearish M15 + bearish M5 → SELL at bid", () => {
    const r = evaluateSignal(bear5, bear15, tick(lastC(bear5)), NOW);
    expect(r.state).toBe("SIGNAL");
    if (r.state !== "SIGNAL") return;
    expect(r.signal.side).toBe("SELL");
    expect(r.signal.entry).toBeCloseTo(lastC(bear5), 6);
    expect(r.signal.stopLoss).toBeGreaterThan(r.signal.entry);
    expect(r.signal.takeProfit).toBeLessThan(r.signal.entry);
  });
  it("conflicting timeframes → no trade", () => {
    const r = evaluateSignal(bear5, bull15, tick(lastC(bear5)), NOW);
    expect(r.state).toBe("NO_TRADE");
    if (r.state === "NO_TRADE") expect(r.reason).toBe("M5_NOT_MET");
  });
  it("flat M15 → no confirmed trend", () => {
    const flat = series(100, M15, 1, 0.6, 0.6);
    const r = evaluateSignal(bull5, flat.map((c) => ({ ...c, c: 4000, o: 4000, h: 4001, l: 3999 })), tick(lastC(bull5)), NOW);
    expect(r.state === "NO_TRADE" && r.reason).toBe("NO_M15_TREND");
  });
  it("weak setup (overbought RSI, no pullback) → M5 not met", () => {
    const strong = series(120, M5, 1, 1.0, -0.2).map((c) => ({ ...c, l: Math.min(c.o, c.c) - 0.05 }));
    const r = evaluateSignal(strong, bull15, tick(lastC(strong)), NOW);
    expect(r.state === "NO_TRADE" && r.reason).toBe("M5_NOT_MET");
  });
  it("stale or missing tick → waiting for data", () => {
    expect(evaluateSignal(bull5, bull15, tick(lastC(bull5), 0.2, 30_000), NOW).state === "NO_TRADE").toBe(true);
    const r = evaluateSignal(bull5, bull15, null, NOW);
    expect(r.state === "NO_TRADE" && r.reason).toBe("WAITING_FOR_DATA");
  });
  it("stale candles → waiting for data", () => {
    const r = evaluateSignal(bull5, bull15, { ...tick(0), bid: 4000, ask: 4000.2, tickTime: new Date(NOW + 3_600_000).toISOString() }, NOW + 3_600_000);
    expect(r.state === "NO_TRADE" && r.reason).toBe("WAITING_FOR_DATA");
  });
  it("excessive spread → rejected", () => {
    const r = evaluateSignal(bull5, bull15, tick(lastC(bull5), 0.5), NOW);
    expect(r.state === "NO_TRADE" && r.reason).toBe("SPREAD_TOO_HIGH");
  });
  it("invalid stop distance → rejected", () => {
    const r = evaluateSignal(bull5, bull15, tick(lastC(bull5)), NOW, { ...ENGINE, maxStop: 0.6 });
    expect(r.state === "NO_TRADE" && r.reason).toBe("INVALID_STOP");
  });
  it("missing / short history → insufficient", () => {
    expect(evaluateSignal([], [], tick(4000), NOW).state === "NO_TRADE").toBe(true);
    const r = evaluateSignal(bull5.slice(-20), bull15, tick(lastC(bull5)), NOW);
    expect(r.state === "NO_TRADE" && r.reason).toBe("INSUFFICIENT_HISTORY");
  });
  it("candle boundaries: a forming candle is never used", () => {
    const forming: Candle = { t: END, o: 4100, h: 4200, l: 4000, c: 4190 };
    expect(completed([...bull5, forming], M5, NOW)).toHaveLength(bull5.length);
    expect(completed([...bull5, forming], M5, END + M5)).toHaveLength(bull5.length + 1);
    const a = evaluateSignal(bull5, bull15, tick(lastC(bull5)), NOW);
    const b = evaluateSignal([...bull5, forming], bull15, tick(lastC(bull5)), NOW);
    expect(b.state).toBe(a.state);
    if (a.state === "SIGNAL" && b.state === "SIGNAL") expect(b.signal.sourceCandleTime).toBe(a.signal.sourceCandleTime);
  });
  it("duplicates: same candle → same key even as ticks change", () => {
    const a = evaluateSignal(bull5, bull15, tick(lastC(bull5)), NOW);
    const b = evaluateSignal(bull5, bull15, tick(lastC(bull5) + 0.1), NOW + 1000);
    if (a.state !== "SIGNAL" || b.state !== "SIGNAL") throw new Error("expected signals");
    expect(signalKey(a.signal)).toBe(signalKey(b.signal));
  });
  it("expiry after 3 M5 bars", () => {
    const r = evaluateSignal(bull5, bull15, tick(lastC(bull5)), NOW);
    if (r.state !== "SIGNAL") throw new Error("expected signal");
    expect(isExpired(r.signal, NOW)).toBe(false);
    expect(isExpired(r.signal, END + 3 * M5)).toBe(true);
  });
  it("price precision from quote", () => {
    expect(priceDigits(4180.12, 4180.3)).toBe(2);
    expect(priceDigits(4180.123)).toBe(3);
  });
});
