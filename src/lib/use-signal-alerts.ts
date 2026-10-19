import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { EngineResult } from "./signal-engine";
import { defaultNotifications, useStored, type NotificationSettings } from "./settings";
import { signalToAlert, type AlertSources } from "./signal-alerts";

const SEEN_KEY = "gs-alerted-signals";

/** Shows one dismissible in-app pop-up per genuinely new live signal. */
export function useSignalAlerts(result: EngineResult, src: AlertSources, now: number) {
  const [prefs] = useStored<NotificationSettings>("gs-notify", defaultNotifications);
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!seen.current) {
      try { seen.current = new Set(JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? "[]") as string[]); }
      catch { seen.current = new Set(); }
    }
    const hit = signalToAlert(result, src, prefs, seen.current, now);
    if (!hit) return;
    seen.current.add(hit.key);
    try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen.current].slice(-200))); } catch { /* ignore */ }
    const s = hit.signal;
    toast(`${s.side} · ${s.symbol} · ${s.timeframe} — UNVALIDATED SIGNAL`, {
      id: hit.key,
      description: `Signal candle ${new Date(s.sourceCandleTime).toISOString().slice(11, 16)} UTC · detected ${new Date(s.createdAt).toISOString().slice(11, 19)} UTC. Strategy in testing — signals only, no trading.`,
      duration: Infinity,
      closeButton: true,
      action: { label: "Dismiss", onClick: () => {} },
    });
  }, [result, src.candlesLive, src.tickLive, prefs, now]);
}
