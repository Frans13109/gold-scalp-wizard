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

/** Status stays NOT_CONNECTED until a real verified health check exists. */
export function getBridgeStatus(): BridgeStatus {
  return "NOT_CONNECTED";
}
