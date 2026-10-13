import { useMemo } from "react";
import { demoM5, toM15, indicators } from "./market";
import { scan, trendOf } from "./signals";
import { defaultStrategy, useStored, type StrategySettings } from "./settings";

export function useDemoMarket() {
  const [strategy] = useStored<StrategySettings>("gs-strategy", defaultStrategy);
  return useMemo(() => {
    const m5 = demoM5();
    const m15 = toM15(m5);
    const signals = scan(m5, m15, strategy);
    const trend = trendOf(m15);
    const ind5 = indicators(m5);
    return { m5, m15, signals, trend, ind5, strategy };
  }, [strategy]);
}
