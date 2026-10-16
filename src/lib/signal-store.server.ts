// Server only: runs the DEMO signal engine after new MT5 candles arrive and stores results. Never places orders.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { evaluateSignal, type EngineResult } from "./signal-engine";
import { evaluateCandles } from "./live-candles";

export async function runSignalEngine(db: SupabaseClient<Database>, now = Date.now()): Promise<EngineResult | null> {
  // Lifecycle: active signals past expiry become expired (no other rows touched).
  await db.from("signals").update({ status: "expired" }).eq("status", "active").lt("expires_at", new Date(now).toISOString());

  const load = (tf: "M5" | "M15") => db.from("market_candles").select("open_time, open, high, low, close")
    .eq("symbol", "XAUUSD").eq("timeframe", tf).eq("source", "mt5_bridge").order("open_time", { ascending: false }).limit(300);
  const [m5, m15, tick] = await Promise.all([load("M5"), load("M15"),
    db.from("market_ticks_latest").select("bid, ask, tick_time").eq("symbol", "XAUUSD").maybeSingle()]);
  if (m5.error || m15.error || tick.error) return null;

  const t = tick.data ? { bid: Number(tick.data.bid), ask: Number(tick.data.ask), tickTime: tick.data.tick_time } : null;
  const res = evaluateSignal(evaluateCandles(m5.data, "M5", now).candles, evaluateCandles(m15.data, "M15", now).candles, t, now);
  if (res.state !== "SIGNAL") return res;
  const s = res.signal;
  // Duplicate setups hit the unique index and are silently ignored (ignoreDuplicates), never re-inserted.
  const { error } = await db.from("signals").upsert({
    symbol: s.symbol, side: s.side, timeframe: s.timeframe,
    entry: s.entry, stop_loss: s.stopLoss, take_profit_1: s.takeProfit, rr_tp1: s.rr, rr_worst: s.rr,
    confluence_score: 100, reasons: s.reasons, invalidation_rule: s.invalidation,
    status: "active", is_demo: true, created_at: s.createdAt, expires_at: s.expiresAt,
    m15_bias: s.m15Bias, indicators: JSON.parse(JSON.stringify(res.ind)), spread: res.ind.spread,
    strategy_version: s.strategyVersion, source_candle_time: s.sourceCandleTime, entry_reference: s.entryReference,
  }, { onConflict: "symbol,side,timeframe,source_candle_time,strategy_version", ignoreDuplicates: true });
  if (error) console.error("[signal-engine] store", error.message);
  return res;
}
