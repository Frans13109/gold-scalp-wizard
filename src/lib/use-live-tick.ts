import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUser } from "./use-session";
import { useBridgeStatus } from "./use-bridge-status";
import { evaluateTick, type LiveTick } from "./live-tick";

/** Latest real tick for subscribers (RLS-gated), polled every second. Signed-out visitors never query. */
export function useLiveTick(): LiveTick {
  const user = useUser();
  const { status } = useBridgeStatus();
  const q = useQuery({
    queryKey: ["live-tick", user?.id],
    enabled: !!user,
    refetchInterval: 1000,
    refetchIntervalInBackground: false,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("market_ticks_latest").select("bid, ask, price, tick_time").eq("symbol", "XAUUSD").maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
  // Re-evaluate age every second even if the query result is unchanged.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  return evaluateTick(user ? q.data : null, status === "CONNECTED", now);
}
