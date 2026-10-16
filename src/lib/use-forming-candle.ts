import { useEffect, useState } from "react";
import type { LiveTick } from "./live-tick";
import { applyTick, type FormingCandle } from "./forming-candle";

/** Accumulates LIVE bid ticks into the current M5 candle. Stale/lost ticks are never applied. */
export function useFormingCandle(tick: LiveTick): FormingCandle | null {
  const [forming, setForming] = useState<FormingCandle | null>(null);
  const { state, bid, tickTime } = tick;
  useEffect(() => {
    if (state !== "LIVE" || bid == null || !tickTime) return;
    setForming((prev) => applyTick(prev, { bid, tickTime }));
  }, [state, bid, tickTime]);
  return forming;
}
