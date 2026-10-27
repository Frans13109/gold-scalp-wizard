/** Phase 2A: isolated saved-field mapping only. No I/O, clock reads or production caller.
 * MAPPED means representable input, NOT verified provenance or permission to finalize.
 * UNVALIDATED quote observations are never broker fills or executed trades.
 */
import type { Database } from "@/integrations/supabase/types";
import { TICK_MAX_WINDOW_MS, type TickOutcomeSignal } from "./signal-outcomes-tick";

type SignalRow = Database["public"]["Tables"]["signals"]["Row"];
const fields = [
  "id", "symbol", "side", "timeframe", "entry", "stop_loss", "take_profit_1",
  "created_at", "expires_at", "entry_reference", "strategy_version", "source_candle_time",
  "entry_low", "entry_high",
] as const satisfies readonly (keyof SignalRow)[];
export type SavedSignalOutcomeInput = Pick<SignalRow, (typeof fields)[number]>;
export type SignalOutcomeInputFailureReason =
  | "INVALID_RECORD" | "MISSING_FIELD" | "INVALID_ID" | "UNSUPPORTED_SYMBOL"
  | "INVALID_SIDE" | "UNSUPPORTED_TIMEFRAME" | "INVALID_PRICE" | "INVALID_PRICE_GEOMETRY"
  | "NUMERIC_RANGE" | "INVALID_TIMESTAMP" | "TIMESTAMP_PRECISION"
  | "UNSUPPORTED_TIMESTAMP" | "INVALID_WINDOW" | "WINDOW_LIMIT_EXCEEDED"
  | "LEGACY_METADATA_MISSING" | "INVALID_METADATA" | "ENTRY_REFERENCE_MISMATCH"
  | "AMBIGUOUS_ENTRY";
type MappingBase = {
  unvalidated: true;
  provenance: "NOT_ESTABLISHED";
  finalizationEligible: false;
};
export type SignalOutcomeInputMapping =
  | (MappingBase & { state: "REJECTED"; reason: SignalOutcomeInputFailureReason; field?: keyof SavedSignalOutcomeInput })
  | (MappingBase & { state: "MAPPED"; signalId: string; signal: TickOutcomeSignal & { evidence: "none" } });

const base: MappingBase = { unvalidated: true, provenance: "NOT_ESTABLISHED", finalizationEligible: false };
const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const nonblank = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
type ParsedTime = { ok: true; value: number } | { ok: false; reason: "INVALID_TIMESTAMP" | "TIMESTAMP_PRECISION" | "UNSUPPORTED_TIMESTAMP" };

/** Explicit offset required; no local-time parsing, calendar rollover or sub-ms truncation.
 * PostgreSQL fractions beyond milliseconds are accepted ONLY when the extra digits are zero.
 * Date-range instants before epoch are unsupported by the existing tick evaluator.
 */
function parseTime(value: unknown): ParsedTime {
  if (typeof value !== "string") return { ok: false, reason: "INVALID_TIMESTAMP" };
  const match = /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return { ok: false, reason: "INVALID_TIMESTAMP" };
  const [, y, mo, d, h, mi, s, fraction = "", zone] = match;
  if (zone === undefined) return { ok: false, reason: "INVALID_TIMESTAMP" };
  if (/[^0]/.test(fraction.slice(3))) return { ok: false, reason: "TIMESTAMP_PRECISION" };
  const year = Number(y), month = Number(mo), day = Number(d);
  const hour = Number(h), minute = Number(mi), second = Number(s);
  const ms = Number(fraction.slice(0, 3).padEnd(3, "0"));
  if (value.startsWith("-000000") || month < 1 || month > 12 || day < 1 || day > 31
    || hour > 23 || minute > 59 || second > 59) return { ok: false, reason: "INVALID_TIMESTAMP" };
  let offset = 0;
  if (zone !== "Z") {
    const zh = Number(zone.slice(1, 3)), zm = Number(zone.slice(4, 6));
    if (zh > 23 || zm > 59 || zone === "-00:00") return { ok: false, reason: "INVALID_TIMESTAMP" };
    offset = (zh * 60 + zm) * 60_000 * (zone.startsWith("-") ? -1 : 1);
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, ms);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second)
    return { ok: false, reason: "INVALID_TIMESTAMP" };
  const epoch = date.getTime() - offset;
  if (!Number.isSafeInteger(epoch) || epoch < 0 || epoch > 8.64e15)
    return { ok: false, reason: "UNSUPPORTED_TIMESTAMP" };
  return { ok: true, value: epoch };
}

/** Accepts untrusted runtime input; uses only named persisted fields, never inferred aliases.
 * Nullable migration metadata rejects legacy rows. Metadata presence is NOT authentication.
 * Extra persisted fields (including status/is_demo/rr_tp1/TP2) are not interpreted as evidence.
 */
export function mapSavedSignalToTickInput(input: unknown): SignalOutcomeInputMapping {
  const reject = (reason: SignalOutcomeInputFailureReason, field?: keyof SavedSignalOutcomeInput): SignalOutcomeInputMapping =>
    field === undefined ? { ...base, state: "REJECTED", reason } : { ...base, state: "REJECTED", reason, field };
  if (typeof input !== "object" || input === null || Array.isArray(input)) return reject("INVALID_RECORD");
  const row: Record<string, unknown> = Object.create(null);
  // Own data properties only: do not execute getters or trust inherited required values.
  try {
    const proto: unknown = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) return reject("INVALID_RECORD");
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(input, field);
      if (!descriptor || descriptor.value === undefined && "value" in descriptor) return reject("MISSING_FIELD", field);
      if (!("value" in descriptor)) return reject("INVALID_RECORD", field);
      row[field] = descriptor.value;
    }
  } catch { return reject("INVALID_RECORD"); }
  if (typeof row['id'] !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row['id'])) return reject("INVALID_ID", "id");
  if (row['symbol'] !== "XAUUSD") return reject("UNSUPPORTED_SYMBOL", "symbol");
  if (row['side'] !== "BUY" && row['side'] !== "SELL") return reject("INVALID_SIDE", "side");
  if (row['timeframe'] !== "M5") return reject("UNSUPPORTED_TIMEFRAME", "timeframe");
  const entry = row['entry'], stop = row['stop_loss'], target = row['take_profit_1'];
  if (!positive(entry)) return reject("INVALID_PRICE", "entry");
  if (!positive(stop)) return reject("INVALID_PRICE", "stop_loss");
  if (!positive(target)) return reject("INVALID_PRICE", "take_profit_1");
  const buy = row['side'] === "BUY";
  if (!(buy ? stop < entry && entry < target : target < entry && entry < stop)) return reject("INVALID_PRICE_GEOMETRY");
  const risk = Math.abs(entry - stop), reward = Math.abs(target - entry);
  if (!positive(risk) || !positive(reward) || !Number.isFinite(reward / risk)) return reject("NUMERIC_RANGE");
  const created = parseTime(row['created_at']);
  if (!created.ok) return reject(created.reason, "created_at");
  const expires = parseTime(row['expires_at']);
  if (!expires.ok) return reject(expires.reason, "expires_at");
  if (expires.value <= created.value) return reject("INVALID_WINDOW");
  if (expires.value - created.value > TICK_MAX_WINDOW_MS) return reject("WINDOW_LIMIT_EXCEEDED");
  for (const field of ["strategy_version", "source_candle_time", "entry_reference"] as const) {
    if (row[field] === null || row[field] === "") return reject("LEGACY_METADATA_MISSING", field);
    if (!nonblank(row[field])) return reject("INVALID_METADATA", field);
  }
  if (row['entry_reference'] !== (buy ? "ask" : "bid")) return reject("ENTRY_REFERENCE_MISMATCH", "entry_reference");
  const sourceTime = parseTime(row['source_candle_time']);
  if (!sourceTime.ok) return reject(sourceTime.reason, "source_candle_time");
  if (sourceTime.value > created.value) return reject("INVALID_METADATA", "source_candle_time");
  // Ranged-entry records have no selected-quote manifest; do not guess which entry was intended.
  if (row['entry_low'] !== null || row['entry_high'] !== null) return reject("AMBIGUOUS_ENTRY");
  return {
    ...base, state: "MAPPED", signalId: row['id'],
    signal: { side: row['side'], symbol: "XAUUSD", entry, stopLoss: stop, takeProfit1: target,
      createdAt: created.value, expiresAt: expires.value, evidence: "none" },
  };
}