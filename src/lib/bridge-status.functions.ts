import { createServerFn } from "@tanstack/react-start";
import { getBridgeStatus, type BridgeStatus } from "./mt5-bridge";

export interface PublicBridgeStatus {
  status: BridgeStatus;
  lastReportAt: string | null;
}

/** Public: returns only a status word and the last report time — no latency, errors or other details. */
export const fetchBridgeStatus = createServerFn({ method: "GET" }).handler(async (): Promise<PublicBridgeStatus> => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("connection_health")
    .select("status, terminal_connected, checked_at")
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[bridge-status]", error.message);
    return { status: "NOT_CONNECTED", lastReportAt: null };
  }
  return { status: getBridgeStatus(data), lastReportAt: data?.checked_at ?? null };
});
