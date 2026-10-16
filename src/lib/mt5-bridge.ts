/**
 * Future READ-ONLY MT5 bridge contract.
 * A Python service on Windows (MetaTrader5 package) attached to a locally logged-in
 * Exness MT5 terminal will expose XAUUSD market data only. Broker login stays inside
 * the MT5 terminal on Windows; this app never receives passwords or secrets.
 * It must NEVER accept order requests or broker passwords. Not implemented yet.
 */
import type { Candle, Timeframe } from "./market";

export type BridgeStatus = "NOT_CONNECTED" | "CONNECTING" | "CONNECTED" | "ERROR";

export interface Mt5ReadOnlyBridge {
  /** GET /health -> { ok, terminalConnected, symbol, serverTime } */
  health(): Promise<{ ok: boolean; terminalConnected: boolean; symbol: string; serverTime: number }>;
  /** GET /tick?symbol=XAUUSD -> latest bid/ask/spread */
  tick(symbol: string): Promise<{ bid: number; ask: number; spread: number; time: number }>;
  /** GET /candles?symbol=XAUUSD&tf=M5&count=300 */
  candles(symbol: string, tf: Timeframe, count: number): Promise<Candle[]>;
}

export const bridgeEndpoints = [
  { method: "GET", path: "/health", desc: "Bridge + terminal heartbeat" },
  { method: "GET", path: "/tick?symbol=XAUUSD", desc: "Latest bid / ask / spread" },
  { method: "GET", path: "/candles?symbol=XAUUSD&tf=M5|M15&count=N", desc: "OHLC history" },
];

/** A health report older than this is treated as NOT_CONNECTED. */
export const HEALTH_MAX_AGE_MS = 120_000;

export interface HealthRow {
  status: BridgeStatus;
  terminal_connected: boolean;
  checked_at: string;
}

/**
 * Derives the displayed status from the latest server-validated health report.
 * CONNECTED only if healthy AND received within HEALTH_MAX_AGE_MS; missing/stale -> NOT_CONNECTED.
 */
export function getBridgeStatus(row: HealthRow | null | undefined, now: number = Date.now()): BridgeStatus {
  if (!row) return "NOT_CONNECTED";
  const t = Date.parse(row.checked_at);
  if (!Number.isFinite(t) || now - t > HEALTH_MAX_AGE_MS || t - now > HEALTH_MAX_AGE_MS) return "NOT_CONNECTED";
  if (row.status === "ERROR" || !row.terminal_connected) return "ERROR";
  return row.status === "CONNECTED" ? "CONNECTED" : "NOT_CONNECTED";
}
