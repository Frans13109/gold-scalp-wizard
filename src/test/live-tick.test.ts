import { describe, expect, it } from "vitest";
import { evaluateTick } from "@/lib/live-tick";
const now = Date.parse("2026-10-16T14:00:00Z");
const row = (s: number) => ({ bid: 4180.1, ask: 4180.3, price: 4180.1, tick_time: new Date(now - s * 1000).toISOString() });
describe("live tick freshness", () => {
  it("missing -> MISSING", () => expect(evaluateTick(null, true, now).state).toBe("MISSING"));
  it("fresh -> LIVE with bid as price", () => { const t = evaluateTick(row(2), true, now); expect(t.state).toBe("LIVE"); expect(t.price).toBe(4180.1); });
  it("quiet 30s -> STALE", () => expect(evaluateTick(row(30), true, now).state).toBe("STALE"));
  it("old 5min -> CONNECTION_LOST", () => expect(evaluateTick(row(300), true, now).state).toBe("CONNECTION_LOST"));
  it("bridge not connected -> CONNECTION_LOST even if fresh", () => expect(evaluateTick(row(1), false, now).state).toBe("CONNECTION_LOST"));
  it("invalid numbers -> MISSING", () => expect(evaluateTick({ ...row(1), bid: NaN }, true, now).state).toBe("MISSING"));
});
