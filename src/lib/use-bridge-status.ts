import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { fetchBridgeStatus, type PublicBridgeStatus } from "./bridge-status.functions";

const fallback: PublicBridgeStatus = { status: "NOT_CONNECTED", lastReportAt: null };

/** Single status source for the top bar and MT5 page; refreshes every 30 s. */
export function useBridgeStatus(): PublicBridgeStatus {
  const fn = useServerFn(fetchBridgeStatus);
  const q = useQuery({ queryKey: ["bridge-status"], queryFn: () => fn(), refetchInterval: 30_000, staleTime: 25_000 });
  return q.data ?? fallback;
}

export const statusLabel = (s: PublicBridgeStatus["status"]) => s.replace("_", " ");
