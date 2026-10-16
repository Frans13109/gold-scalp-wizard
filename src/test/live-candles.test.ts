import { describe, expect, it } from "vitest";
import { evaluateCandles, MIN_LIVE_CANDLES, type CandleRow } from "@/lib/live-candles";

const now = Date.UTC(2026, 9, 16, 13, 40);
const rows = (n: number, lastAgoMin: number, stepMin = 5): CandleRow[] =>
  Array.from({ length: n }, (_, i) => {
    const t = now - (lastAgoMin + i * stepMin) * 60_000; // newest first, like the DB query
    return { open_time: new Date(t).toISOString(), open: 2400 + i, high: 2402 + i, low: 2399 + i, close: 2401 + i };
  });

describe("live candle freshness", () => {
  it("fresh: LIVE, ascending order", () => {
    const r = evaluateCandles(rows(40, 5), "M5", now);
    expect(r.state).toBe("LIVE");
    for (let i = 1; i < r.candles.length; i++) expect(r.candles[i]!.t).toBeGreaterThan(r.candles[i - 1]!.t);
    expect(r.lastOpenAt).toBe(new Date(now - 5 * 60_000).toISOString());
  });
  it("missing: no rows or too few rows", () => {
    expect(evaluateCandles([], "M5", now).state).toBe("MISSING");
    expect(evaluateCandles(null, "M15", now).state).toBe("MISSING");
    expect(evaluateCandles(rows(MIN_LIVE_CANDLES - 1, 5), "M5", now).state).toBe("MISSING");
  });
  it("stale: newest candle too old", () => {
    expect(evaluateCandles(rows(40, 20), "M5", now).state).toBe("STALE");
    expect(evaluateCandles(rows(40, 50, 15), "M15", now).state).toBe("STALE");
    expect(evaluateCandles(rows(40, 30, 15), "M15", now).state).toBe("LIVE");
  });
  it("drops duplicates and invalid rows", () => {
    const base = rows(40, 5);
    const r = evaluateCandles([...base, base[0]!, { ...base[1]!, open_time: "bad" }], "M5", now);
    expect(r.candles.length).toBe(40);
  });
});
