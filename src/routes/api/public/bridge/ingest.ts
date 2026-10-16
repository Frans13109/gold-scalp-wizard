import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Read-only MT5 bridge receiving endpoint (server only).
 * Auth: HMAC-SHA256 over `${timestamp}.${requestId}.${rawBody}` with BRIDGE_HMAC_SECRET.
 * Headers: X-Bridge-Timestamp (unix seconds), X-Bridge-Request-Id (UUID), X-Bridge-Signature (hex).
 * Rejects stale timestamps (>300s skew) and reused request IDs. Accepts market data only — never orders.
 */
const MAX_SKEW_S = 300;
const MAX_TICK_AGE_MS = 60_000;
const TICK_MIN_INTERVAL_MS = 700;

const num = z.number().finite();
const candle = z.object({
  timeframe: z.enum(["M5", "M15"]),
  open_time: z.string().datetime({ offset: true }),
  open: num.positive(), high: num.positive(), low: num.positive(), close: num.positive(),
  tick_volume: z.number().int().nonnegative().optional(),
  spread: num.nonnegative().optional(),
}).refine((c) => c.high >= c.low && c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close), "invalid OHLC");

const payload = z.discriminatedUnion("type", [
  z.object({ type: z.literal("candles"), symbol: z.literal("XAUUSD"), candles: z.array(candle).min(1).max(500) }),
  z.object({
    type: z.literal("tick"), symbol: z.literal("XAUUSD"),
    bid: num.positive(), ask: num.positive(),
    tick_time: z.string().datetime({ offset: true }),
  }),
  z.object({
    type: z.literal("health"),
    terminal_connected: z.boolean(),
    last_market_data_at: z.string().datetime({ offset: true }).nullable(),
    latency_ms: z.number().int().nonnegative().max(600000).nullable(),
    error_message: z.string().max(300).nullable(),
  }),
]);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const out = new Uint8Array(new ArrayBuffer(32));
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const Route = createFileRoute("/api/public/bridge/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["BRIDGE_HMAC_SECRET"];
        if (!secret || secret.length < 32) return json(503, { error: "bridge not configured" });

        const ts = request.headers.get("x-bridge-timestamp") ?? "";
        const requestId = request.headers.get("x-bridge-request-id") ?? "";
        const sig = hexToBytes(request.headers.get("x-bridge-signature") ?? "");
        if (!/^\d{10}$/.test(ts) || !z.string().uuid().safeParse(requestId).success || !sig)
          return json(401, { error: "unauthorized" });
        if (Math.abs(Date.now() / 1000 - Number(ts)) > MAX_SKEW_S) return json(401, { error: "stale request" });

        const raw = await request.text();
        if (raw.length > 256_000) return json(413, { error: "too large" });

        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
        // crypto.subtle.verify is constant-time.
        const ok = await crypto.subtle.verify("HMAC", key, sig, enc.encode(`${ts}.${requestId}.${raw}`));
        if (!ok) return json(401, { error: "unauthorized" });

        let body: z.infer<typeof payload>;
        try {
          const parsed = payload.safeParse(JSON.parse(raw));
          if (!parsed.success) return json(400, { error: "invalid payload" });
          body = parsed.data;
        } catch {
          return json(400, { error: "invalid json" });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let prevTick: { tick_time: string; received_at: string } | null = null;
        if (body.type === "tick") {
          if (body.ask < body.bid || body.ask - body.bid >= 50) return json(400, { error: "invalid payload" });
          const tt = Date.parse(body.tick_time);
          if (Math.abs(Date.now() - tt) > MAX_TICK_AGE_MS) return json(422, { error: "stale tick" });
          const { data } = await supabaseAdmin.from("market_ticks_latest").select("tick_time, received_at").eq("symbol", "XAUUSD").maybeSingle();
          prevTick = data;
          // Rate limit: at most one tick per TICK_MIN_INTERVAL_MS (checked before logging the request ID).
          if (prevTick && Date.now() - Date.parse(prevTick.received_at) < TICK_MIN_INTERVAL_MS) return json(429, { error: "rate limited" });
        }

        // Replay protection: request_id is a primary key; a duplicate insert fails.
        const { error: replayErr } = await supabaseAdmin.from("bridge_request_log").insert({ request_id: requestId });
        if (replayErr) return json(409, { error: "replayed request" });

        if (body.type === "tick") {
          if (prevTick && Date.parse(body.tick_time) < Date.parse(prevTick.tick_time)) return json(200, { ok: true, ignored: "older tick" });
          // Displayed price = bid (the price MT5 charts show). Ticks never touch market_candles.
          const { error } = await supabaseAdmin.from("market_ticks_latest").upsert({
            symbol: "XAUUSD", bid: body.bid, ask: body.ask, price: body.bid, tick_time: body.tick_time, received_at: new Date().toISOString(),
          }, { onConflict: "symbol" });
          if (error) { console.error("[bridge] tick", error.message); return json(500, { error: "store failed" }); }
          // Housekeeping: request IDs older than 1 hour can no longer pass the timestamp check.
          if (Math.random() < 0.01) await supabaseAdmin.from("bridge_request_log").delete().lt("received_at", new Date(Date.now() - 3_600_000).toISOString());
          return json(200, { ok: true });
        }

        if (body.type === "candles") {
          const rows = body.candles.map((c) => ({ ...c, tick_volume: c.tick_volume ?? null, spread: c.spread ?? null, symbol: "XAUUSD", source: "mt5_bridge" as const }));
          const { error } = await supabaseAdmin.from("market_candles").upsert(rows, { onConflict: "symbol,timeframe,open_time" });
          if (error) { console.error("[bridge] candles", error.message); return json(500, { error: "store failed" }); }
          return json(200, { ok: true, stored: rows.length });
        }

        const { error } = await supabaseAdmin.from("connection_health").insert({
          status: body.terminal_connected ? "CONNECTED" : "ERROR",
          terminal_connected: body.terminal_connected,
          last_market_data_at: body.last_market_data_at,
          latency_ms: body.latency_ms,
          error_message: body.error_message,
        });
        if (error) { console.error("[bridge] health", error.message); return json(500, { error: "store failed" }); }
        return json(200, { ok: true });
      },
    },
  },
});
