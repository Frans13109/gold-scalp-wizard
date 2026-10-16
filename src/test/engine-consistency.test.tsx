import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Candle } from "@/lib/market";
import { evaluateSignal, type NoTradeReason } from "@/lib/signal-engine";
import { EnginePanel } from "@/components/EnginePanel";

const M5 = 300_000, M15 = 900_000;
const END = Date.parse("2026-10-16T16:15:00Z");
const NOW = END + 2_000;

/** Seeded random walk so every run checks the same varied mix of trends. */
function walk(seed: number, n: number, tf: number, drift: number): Candle[] {
  let s = seed, p = 4170;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) - 0.5;
  return Array.from({ length: n }, (_, i) => {
    const o = p, c = p + drift + rnd() * 4;
    p = c;
    return { t: END - (n - i) * tf, o, c, h: Math.max(o, c) + Math.abs(rnd()) * 2, l: Math.min(o, c) - Math.abs(rnd()) * 2 };
  });
}
const tick = { bid: 4166.695, ask: 4166.935, tickTime: new Date(NOW - 1000).toISOString() };
const AFTER_TREND: NoTradeReason[] = ["M5_NOT_MET", "SPREAD_TOO_HIGH", "INVALID_STOP", "RR_NOT_MET"];

describe("engine bias and no-trade reason come from one consistent result", () => {
  it("bias NONE never pairs with an M5/entry-stage reason; such reasons always carry a real bias", () => {
    let none = 0, after = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const drift15 = ((seed % 7) - 3) * 0.4, drift5 = ((seed % 5) - 2) * 0.3;
      const r = evaluateSignal(walk(seed, 120, M5, drift5), walk(seed * 31, 80, M15, drift15), tick, NOW);
      if (r.state !== "NO_TRADE") continue;
      if (r.bias === "NONE") { none++; expect(AFTER_TREND).not.toContain(r.reason); }
      if (AFTER_TREND.includes(r.reason)) { after++; expect(r.bias).not.toBe("NONE"); }
    }
    expect(none).toBeGreaterThan(0);
    expect(after).toBeGreaterThan(0);
  });

  it("panel shows 'No confirmed M15 trend' with bias NONE, never the M5 message", () => {
    // Shape of the live 16:00 M15 case: EMA20 above EMA50 but close below EMA20.
    const flat15 = walk(5, 80, M15, 0).map((c) => ({ ...c, o: 4170, c: 4170, h: 4171, l: 4169 }));
    const r = evaluateSignal(walk(9, 120, M5, 0.2), flat15, tick, NOW);
    expect(r.state === "NO_TRADE" && r.reason).toBe("NO_M15_TREND");
    render(<EnginePanel result={r} now={NOW} />);
    const box = screen.getByTestId("engine-no-trade");
    expect(within(box).getByText("No confirmed M15 trend")).toBeTruthy();
    expect(within(box).queryByText("M5 entry conditions not met")).toBeNull();
    expect(screen.getByTestId("engine-bias").textContent).toBe("NONE");
    expect(screen.getByTestId("engine-checked-at").textContent).toContain("16:15:02");
  });
});
