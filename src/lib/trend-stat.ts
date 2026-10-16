import type { Bias } from "./signal-engine";

/** Header trend tile: real engine bias when live M5+M15 data is fresh; otherwise the practice (demo) trend, labelled as such. */
export function trendStat(liveFresh: boolean, practice: "UP" | "DOWN" | "RANGE", bias: Bias) {
  if (liveFresh) return { label: "Engine M15 bias", value: bias, tone: bias === "BULLISH" ? "bull" : bias === "BEARISH" ? "bear" : "muted" } as const;
  return { label: "Practice trend (demo data)", value: practice, tone: practice === "UP" ? "bull" : practice === "DOWN" ? "bear" : "muted" } as const;
}
