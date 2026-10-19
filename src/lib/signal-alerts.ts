// Decides whether a freshly computed engine result should raise an in-app pop-up. Pure; no side effects.
import { isExpired, signalKey, type EngineResult, type EngineSignal } from "./signal-engine";
import type { NotificationSettings } from "./settings";

export interface AlertSources {
  /** True only when M5 and M15 candles are real, fresh MT5 data (not demo/stale). */
  candlesLive: boolean;
  /** True only when the bid/ask tick is fresh live data. */
  tickLive: boolean;
}

export function signalToAlert(
  result: EngineResult, src: AlertSources, prefs: NotificationSettings, seen: ReadonlySet<string>, now: number,
): { key: string; signal: EngineSignal } | null {
  if (!src.candlesLive || !src.tickLive) return null;
  if (result.state !== "SIGNAL") return null;
  const s = result.signal;
  if (isExpired(s, now)) return null;
  if (!prefs.inApp) return null;
  if (s.side === "BUY" ? !prefs.buy : !prefs.sell) return null;
  const key = signalKey(s);
  if (seen.has(key)) return null;
  return { key, signal: s };
}
