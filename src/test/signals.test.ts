import { describe, expect, it } from "vitest";
import { demoM5, toM15 } from "@/lib/market";
import { rrOf, scan } from "@/lib/signals";
import { defaultStrategy } from "@/lib/settings";
import { getBridgeStatus } from "@/lib/mt5-bridge";

describe("signal math (demo data)", () => {
  const m5 = demoM5();
  const sigs = scan(m5, toM15(m5), { ...defaultStrategy, requireTrendAlignment: false, requireMacdConfirm: false, requireCandleConfirm: false });

  it("produces both sides", () => {
    expect(sigs.some((s) => s.side === "BUY")).toBe(true);
    expect(sigs.some((s) => s.side === "SELL")).toBe(true);
  });

  it("levels are on the correct side and R:R is consistent", () => {
    for (const s of sigs) {
      const dir = s.side === "BUY" ? 1 : -1;
      expect(dir * (s.entry - s.sl)).toBeGreaterThan(0);
      expect(dir * (s.tp - s.entry)).toBeGreaterThan(0);
      expect(dir * (s.tp2 - s.tp)).toBeGreaterThan(0);
      expect(s.rr).toBeCloseTo(rrOf(s.entry, s.sl, s.tp), 10);
      expect(s.rr).toBeCloseTo(defaultStrategy.minRR, 6);
      expect(s.rrWorst).toBeLessThan(s.rr);
      expect(s.entryLow).toBeLessThan(s.entry);
      expect(s.entryHigh).toBeGreaterThan(s.entry);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect(s.demo).toBe(true);
    }
  });

  it("blocks signals when spread exceeds max", () => {
    expect(scan(m5, toM15(m5), { ...defaultStrategy, demoSpread: 1, maxSpread: 0.3 })).toHaveLength(0);
  });

});

describe("MT5 bridge status", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const ago = (s: number) => new Date(now - s * 1000).toISOString();
  it("missing report -> NOT_CONNECTED", () => {
    expect(getBridgeStatus(null, now)).toBe("NOT_CONNECTED");
  });
  it("fresh healthy report -> CONNECTED", () => {
    expect(getBridgeStatus({ status: "CONNECTED", terminal_connected: true, checked_at: ago(30) }, now)).toBe("CONNECTED");
  });
  it("stale healthy report -> NOT_CONNECTED", () => {
    expect(getBridgeStatus({ status: "CONNECTED", terminal_connected: true, checked_at: ago(121) }, now)).toBe("NOT_CONNECTED");
  });
  it("fresh error report -> ERROR", () => {
    expect(getBridgeStatus({ status: "ERROR", terminal_connected: false, checked_at: ago(10) }, now)).toBe("ERROR");
  });
  it("stale error report -> NOT_CONNECTED", () => {
    expect(getBridgeStatus({ status: "ERROR", terminal_connected: false, checked_at: ago(600) }, now)).toBe("NOT_CONNECTED");
  });
});
