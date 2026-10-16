/** Latest MT5 tick freshness rules. Displayed price is the bid. */
export const TICK_LIVE_MS = 10_000;
export const TICK_LOST_MS = 120_000;

export interface TickRow { bid: number; ask: number; price: number; tick_time: string }
export type TickState = "LIVE" | "STALE" | "CONNECTION_LOST" | "MISSING";
export interface LiveTick { state: TickState; bid: number | null; ask: number | null; price: number | null; tickTime: string | null; ageMs: number | null }

export function evaluateTick(row: TickRow | null | undefined, bridgeConnected: boolean, now: number = Date.now()): LiveTick {
  if (!row) return { state: "MISSING", bid: null, ask: null, price: null, tickTime: null, ageMs: null };
  const t = Date.parse(row.tick_time);
  const bid = Number(row.bid), ask = Number(row.ask), price = Number(row.price);
  if (!Number.isFinite(t) || ![bid, ask, price].every((n) => Number.isFinite(n) && n > 0))
    return { state: "MISSING", bid: null, ask: null, price: null, tickTime: null, ageMs: null };
  const age = Math.max(0, now - t);
  const state: TickState = !bridgeConnected || age > TICK_LOST_MS ? "CONNECTION_LOST" : age > TICK_LIVE_MS ? "STALE" : "LIVE";
  return { state, bid, ask, price, tickTime: row.tick_time, ageMs: age };
}
