import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUser } from "./use-session";
import { evaluateCandles, type LiveSeries } from "./live-candles";
import type { Timeframe } from "./market";

const empty: LiveSeries = { state: "MISSING", candles: [], lastOpenAt: null };

async function load(tf: Timeframe): Promise<LiveSeries> {
  // Browser client with the user's session: RLS only returns rows to admins/active subscribers.
  const { data, error } = await supabase
    .from("market_candles")
    .select("open_time, open, high, low, close")
    .eq("symbol", "XAUUSD").eq("timeframe", tf).eq("source", "mt5_bridge")
    .order("open_time", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return evaluateCandles(data, tf);
}

/** Real MT5 candles for signed-in subscribers; signed-out visitors never query. Refreshes every 30 s. */
export function useLiveCandles() {
  const user = useUser();
  const enabled = !!user;
  const opts = { enabled, refetchInterval: 30_000, staleTime: 25_000 } as const;
  const m5 = useQuery({ queryKey: ["live-candles", user?.id, "M5"], queryFn: () => load("M5"), ...opts });
  const m15 = useQuery({ queryKey: ["live-candles", user?.id, "M15"], queryFn: () => load("M15"), ...opts });
  return { M5: enabled ? m5.data ?? empty : empty, M15: enabled ? m15.data ?? empty : empty };
}
