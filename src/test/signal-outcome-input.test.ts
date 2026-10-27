import { describe, expect, it } from "vitest";
import { mapSavedSignalToTickInput, type SavedSignalOutcomeInput, type SignalOutcomeInputFailureReason } from "@/lib/signal-outcome-input";
import { evaluateTickOutcome, TICK_MAX_WINDOW_MS } from "@/lib/signal-outcomes-tick";

// Synthetic fixtures ONLY; no production imports, clients, history, fills or inferred outcomes.
const CREATED = "2026-10-27T10:05:03.250Z";
const EXPIRES = "2026-10-27T10:20:00.000Z";
const T0 = Date.UTC(2026, 9, 27, 10, 5, 3, 250);
const END = Date.UTC(2026, 9, 27, 10, 20);
const fixture = (side: "BUY" | "SELL" = "BUY", overrides: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-000000000001", symbol: "XAUUSD", side, timeframe: "M5",
  entry: 4000, stop_loss: side === "BUY" ? 3995 : 4005,
  take_profit_1: side === "BUY" ? 4010 : 3990,
  created_at: CREATED, expires_at: EXPIRES,
  entry_reference: side === "BUY" ? "ask" : "bid",
  strategy_version: "m15ema20-50_m5pullback_v1", source_candle_time: "2026-10-27T10:00:00.000Z",
  entry_low: null, entry_high: null,
  ...overrides,
} satisfies Record<keyof SavedSignalOutcomeInput, unknown>);
const rejected = (input: unknown, reason: SignalOutcomeInputFailureReason, field?: keyof SavedSignalOutcomeInput) => {
  expect(mapSavedSignalToTickInput(input)).toMatchObject({ state: "REJECTED", reason,
    unvalidated: true, provenance: "NOT_ESTABLISHED", finalizationEligible: false, ...(field ? { field } : {}) });
};

describe("isolated saved signal input mapper (UNVALIDATED)", () => {
  it.each(["BUY", "SELL"] as const)("maps exact persisted %s prices and partway-M5 UTC times", (side) => {
    expect(mapSavedSignalToTickInput(fixture(side))).toEqual({ state: "MAPPED",
      signalId: "00000000-0000-4000-8000-000000000001", unvalidated: true,
      provenance: "NOT_ESTABLISHED", finalizationEligible: false,
      signal: { side, symbol: "XAUUSD", entry: 4000, stopLoss: side === "BUY" ? 3995 : 4005,
        takeProfit1: side === "BUY" ? 4010 : 3990, createdAt: T0, expiresAt: END, evidence: "none" } });
  });
  it.each([
    ["positive offset", "2026-10-27T12:05:03.250+02:00"],
    ["negative offset", "2026-10-27T08:05:03.250-02:00"],
    ["Postgres zero-padded fraction", "2026-10-27 10:05:03.250000+00:00"],
  ])("preserves UTC instant: %s", (_name, created_at) => {
    expect(mapSavedSignalToTickInput(fixture("BUY", { created_at }))).toMatchObject({ state: "MAPPED", signal: { createdAt: T0 } });
  });
  it.each([
    ["epoch", "1970-01-01T00:00:00.000Z", "1970-01-01T00:00:00.001Z", 0, 1],
    ["Date maximum", "+275760-09-12T23:59:59.999Z", "+275760-09-13T00:00:00.000Z", 8.64e15 - 1, 8.64e15],
    ["leap-day midnight", "2024-02-29T23:59:59.999Z", "2024-03-01T00:00:00.000Z", Date.UTC(2024, 1, 29, 23, 59, 59, 999), Date.UTC(2024, 2, 1)],
  ])("maps timestamp boundary: %s", (_name, created_at, expires_at, createdAt, expiresAt) => {
    expect(mapSavedSignalToTickInput(fixture("BUY", { created_at, expires_at, source_candle_time: created_at })))
      .toMatchObject({ state: "MAPPED", signal: { createdAt, expiresAt } });
  });
  it("allows exactly the evaluator's maximum window", () => {
    expect(mapSavedSignalToTickInput(fixture("BUY", { expires_at: new Date(T0 + TICK_MAX_WINDOW_MS).toISOString() })))
      .toMatchObject({ state: "MAPPED", signal: { expiresAt: T0 + TICK_MAX_WINDOW_MS } });
  });
  it.each([
    ["equal", CREATED, "INVALID_WINDOW"],
    ["reversed", "2026-10-27T10:05:03.249Z", "INVALID_WINDOW"],
    ["over limit", new Date(T0 + TICK_MAX_WINDOW_MS + 1).toISOString(), "WINDOW_LIMIT_EXCEEDED"],
  ] as const)("rejects %s observation window", (_name, expires_at, reason) => rejected(fixture("BUY", { expires_at }), reason));
  it.each([
    ["local time", "2026-10-27T10:05:03.250", "INVALID_TIMESTAMP"],
    ["date only", "2026-10-27", "INVALID_TIMESTAMP"],
    ["numeric epoch", T0, "INVALID_TIMESTAMP"],
    ["invalid calendar", "2026-02-30T10:05:03.250Z", "INVALID_TIMESTAMP"],
    ["non-leap day", "2025-02-29T10:05:03.250Z", "INVALID_TIMESTAMP"],
    ["leap second", "2026-10-27T10:05:60.250Z", "INVALID_TIMESTAMP"],
    ["24 hour rollover", "2026-10-27T24:00:00.000Z", "INVALID_TIMESTAMP"],
    ["bad month", "2026-13-27T10:05:03.250Z", "INVALID_TIMESTAMP"],
    ["bad offset", "2026-10-27T10:05:03.250+24:00", "INVALID_TIMESTAMP"],
    ["unknown offset", "2026-10-27T10:05:03.250-00:00", "INVALID_TIMESTAMP"],
    ["sub-ms precision", "2026-10-27T10:05:03.250001Z", "TIMESTAMP_PRECISION"],
    ["pre-epoch", "1969-12-31T23:59:59.999Z", "UNSUPPORTED_TIMESTAMP"],
    ["offset beyond Date range", "+275760-09-13T00:00:00.000-00:01", "UNSUPPORTED_TIMESTAMP"],
    ["not a timestamp", "not-a-date", "INVALID_TIMESTAMP"],
  ] as const)("rejects timestamp: %s", (_name, created_at, reason) => rejected(fixture("BUY", { created_at }), reason, "created_at"));
  it("rejects precision loss in expiry independently", () => rejected(fixture("BUY", { expires_at: "2026-10-27T10:20:00.000001Z" }), "TIMESTAMP_PRECISION", "expires_at"));
  it.each([
    ["BUY", 4000, 4010], ["BUY", 4001, 4010], ["BUY", 3995, 4000], ["BUY", 3995, 3999],
    ["SELL", 4000, 3990], ["SELL", 3999, 3990], ["SELL", 4005, 4000], ["SELL", 4005, 4001],
  ] as const)("rejects %s stop %s target %s geometry", (side, stop_loss, take_profit_1) =>
    rejected(fixture(side, { stop_loss, take_profit_1 }), "INVALID_PRICE_GEOMETRY"));
  it.each([
    ["entry", 0], ["entry", -1], ["entry", NaN], ["entry", Infinity], ["entry", "4000"],
    ["stop_loss", null], ["stop_loss", -Infinity], ["take_profit_1", 0], ["take_profit_1", NaN],
  ] as const)("rejects invalid %s = %s without coercion", (field, value) => rejected(fixture("BUY", { [field]: value }), "INVALID_PRICE", field));
  it("rejects finite prices producing infinite reward/risk", () => rejected(fixture("BUY", {
    entry: Number.MIN_VALUE * 2, stop_loss: Number.MIN_VALUE, take_profit_1: Number.MAX_VALUE,
  }), "NUMERIC_RANGE"));
  it.each(["BUY", "SELL"] as const)("preserves unusual valid %s target/risk distances without imposing strategy rules", (side) => {
    expect(mapSavedSignalToTickInput(fixture(side, { entry: 100, stop_loss: side === "BUY" ? 99.875 : 100.125,
      take_profit_1: side === "BUY" ? 100.03125 : 99.96875 })))
      .toMatchObject({ state: "MAPPED", signal: { entry: 100, stopLoss: side === "BUY" ? 99.875 : 100.125,
        takeProfit1: side === "BUY" ? 100.03125 : 99.96875 } });
  });
  it.each([
    ["id", "", "INVALID_ID"], ["symbol", "XAUUSDm", "UNSUPPORTED_SYMBOL"],
    ["side", "buy", "INVALID_SIDE"], ["side", "HOLD", "INVALID_SIDE"],
    ["timeframe", "M15", "UNSUPPORTED_TIMEFRAME"], ["entry_reference", "bid", "ENTRY_REFERENCE_MISMATCH"],
  ] as const)("rejects unsupported %s = %s", (field, value, reason) => rejected(fixture("BUY", { [field]: value }), reason, field));
  it.each(["entry_reference", "strategy_version", "source_candle_time"] as const)("rejects nullable legacy %s without inference", (field) =>
    rejected(fixture("BUY", { [field]: null }), "LEGACY_METADATA_MISSING", field));
  it.each(["entry_reference", "strategy_version", "source_candle_time"] as const)("rejects missing legacy %s", (field) => {
    const row: Record<string, unknown> = fixture(); delete row[field]; rejected(row, "MISSING_FIELD", field);
  });
  it("rejects blank strategy metadata", () => rejected(fixture("BUY", { strategy_version: " " }), "INVALID_METADATA", "strategy_version"));
  it("rejects malformed source timestamp", () => rejected(fixture("BUY", { source_candle_time: "bad" }), "INVALID_TIMESTAMP", "source_candle_time"));
  it("rejects source time later than actual creation", () => rejected(fixture("BUY", { source_candle_time: EXPIRES }), "INVALID_METADATA", "source_candle_time"));
  it.each([
    { entry_low: 3999 }, { entry_high: 4001 }, { entry_low: 4000, entry_high: 4000 },
  ])("rejects ambiguous entry range %j", (range) => rejected(fixture("BUY", range), "AMBIGUOUS_ENTRY"));
  it.each([null, undefined, [], 4000, "signal", new Date(0)])("rejects runtime non-record %s", (input) => rejected(input, "INVALID_RECORD"));
  it("rejects aliases instead of missing persisted fields", () => {
    const row: Record<string, unknown> = fixture(); delete row['stop_loss']; row['stopLoss'] = 3995;
    rejected(row, "MISSING_FIELD", "stop_loss");
  });
  it("does not execute record getters", () => {
    let reads = 0;
    const row = fixture(); Object.defineProperty(row, "entry", { get: () => { reads++; return 4000; } });
    rejected(row, "INVALID_RECORD", "entry"); expect(reads).toBe(0);
  });
  it("does not accept inherited fields", () => rejected(Object.create(fixture()), "INVALID_RECORD"));
  it("is deterministic and does not mutate frozen input", () => {
    const row = Object.freeze(fixture()); const before = { ...row };
    expect(mapSavedSignalToTickInput(row)).toEqual(mapSavedSignalToTickInput(row)); expect(row).toEqual(before);
  });
  it("never promotes demo/status flags or caller-supplied evidence to provenance", () => {
    const result = mapSavedSignalToTickInput(fixture("BUY", { is_demo: false, status: "expired", evidence: "tick_history", verified_mt5: true }));
    expect(result).toMatchObject({ state: "MAPPED", provenance: "NOT_ESTABLISHED", finalizationEligible: false,
      unvalidated: true, signal: { evidence: "none" } });
    if (result.state !== "MAPPED") throw new Error("Expected representable fixture");
    expect(evaluateTickOutcome(result.signal, [], [], { nowMsc: END, clockMarginMs: 0, maxQuietMs: 1000 }))
      .toMatchObject({ state: "REJECTED", reason: "UNVERIFIED_EVIDENCE", unvalidated: true });
  });
  it("ignores TP2 and precomputed R instead of changing TP1 mapping", () => {
    expect(mapSavedSignalToTickInput(fixture("BUY", { take_profit_2: 4020, rr_tp1: 999, rr_worst: 999 })))
      .toEqual(mapSavedSignalToTickInput(fixture()));
  });
});