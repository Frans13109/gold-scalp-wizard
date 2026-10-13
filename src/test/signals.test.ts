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

  it("MT5 bridge reports NOT_CONNECTED", () => {
    expect(getBridgeStatus()).toBe("NOT_CONNECTED");
  });
});
