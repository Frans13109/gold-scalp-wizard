import { describe, expect, it } from "vitest";
import { trendStat } from "@/lib/trend-stat";

describe("header trend tile", () => {
  it("live and fresh → only the real engine bias", () => {
    expect(trendStat(true, "UP", "BEARISH")).toEqual({ label: "Engine M15 bias", value: "BEARISH", tone: "bear" });
  });
  it("live unavailable → practice trend labelled as demo data", () => {
    expect(trendStat(false, "UP", "NONE")).toEqual({ label: "Practice trend (demo data)", value: "UP", tone: "bull" });
  });
});
