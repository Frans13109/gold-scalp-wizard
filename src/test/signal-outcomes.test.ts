import { describe, expect, it } from "vitest";
import { evaluateOutcome, OUTCOME_M5_MS as M5, OUTCOME_MAX_WINDOW_MS, OUTCOME_MAX_INPUT_CANDLES, type OutcomeCandle, type OutcomeSignal } from "@/lib/signal-outcomes";

// Synthetic unit-test data only. Never imported into the dashboard or database.
const start = Date.UTC(2026, 9, 19, 12, 0);
const signal = (side: "BUY" | "SELL" = "BUY"): OutcomeSignal => ({ side, symbol: "XAUUSD", timeframe: "M5",
  entry: 100, stopLoss: side === "BUY" ? 95 : 105, takeProfit1: side === "BUY" ? 110 : 90,
  createdAt: start, expiresAt: start + 3 * M5, provenance: "verified_mt5" });
const bar = (openTime = start, changes: Partial<OutcomeCandle> = {}): OutcomeCandle => ({
  symbol: "XAUUSD", timeframe: "M5", source: "mt5_bridge", openTime,
  open: 100, high: 102, low: 98, close: 100, ...changes });
const window = (first: Partial<OutcomeCandle> = {}) => [bar(start, first), bar(start + M5), bar(start + 2 * M5)];
const run = (s = signal(), bars = window(), now = start + 3 * M5) => evaluateOutcome(s, bars, now);

describe("isolated unvalidated outcome evaluator", () => {
  it.each(["BUY", "SELL"] as const)("%s exact SL touch gives -1R", side => {
    expect(run(signal(side), window(side === "BUY" ? { low: 95 } : { high: 105 }))).toMatchObject({
      state: "RESOLVED", outcome: "sl", exitPrice: side === "BUY" ? 95 : 105, resultR: -1,
      closedAt: start + M5, unvalidated: true, method: "bid_candle_estimate" });
  });
  it.each(["BUY", "SELL"] as const)("%s exact TP1 touch gives +2R", side => {
    expect(run(signal(side), window(side === "BUY" ? { high: 110 } : { low: 90 }))).toMatchObject({
      state: "RESOLVED", outcome: "tp1", exitPrice: side === "BUY" ? 110 : 90, resultR: 2 });
  });
  it.each(["BUY", "SELL"] as const)("%s both levels touched resolves SL conservatively", side => {
    expect(run(signal(side), window({ low: 90, high: 110 }))).toMatchObject({ outcome: "sl", resultR: -1 });
  });
  it.each(["BUY", "SELL"] as const)("%s adverse opening gap uses worse exit", side => {
    const first = side === "BUY" ? { open: 93, low: 92, high: 100, close: 99 } : { open: 107, high: 108, low: 100, close: 101 };
    expect(run(signal(side), window(first))).toMatchObject({ outcome: "sl", exitPrice: side === "BUY" ? 93 : 107, resultR: -1.4 });
  });
  it.each(["BUY", "SELL"] as const)("%s favourable opening gap does not inflate reward", side => {
    const first = side === "BUY" ? { open: 112, low: 111, high: 114, close: 113 } : { open: 88, low: 86, high: 89, close: 87 };
    expect(run(signal(side), window(first))).toMatchObject({ outcome: "tp1", resultR: 2 });
  });
  it("favourable gap with both levels still uses stop first", () => {
    expect(run(signal(), window({ open: 112, high: 114, low: 94, close: 100 }))).toMatchObject({ outcome: "sl", resultR: -1 });
  });
  it("expiry is not fabricated breakeven", () => {
    expect(run()).toEqual({ state: "RESOLVED", outcome: "expired", exitPrice: null, resultR: null,
      closedAt: start + 3 * M5, unvalidated: true, method: "bid_candle_estimate" });
  });
  it("computes R from actual saved levels, not a hardcoded target multiple", () => {
    expect(run({ ...signal(), takeProfit1: 107 }, window({ high: 107 }))).toMatchObject({ resultR: 1.4 });
  });
  it("ignores source candles and candles opening at expiry", () => {
    expect(run(signal(), [bar(start - M5, { low: 90, high: 110 }), ...window(), bar(start + 3 * M5, { low: 90 })])).toMatchObject({ outcome: "expired" });
  });
  it("never resolves from a forming or not-yet-observed full window", () => {
    expect(run(signal(), window({ high: 110 }), start + M5)).toMatchObject({ state: "INCOMPLETE", reason: "WINDOW_NOT_CLOSED" });
  });
  it("partial creation candle cannot confirm an otherwise visible target", () => {
    expect(run({ ...signal(), createdAt: start + 7_000 }, window({ high: 110 }))).toMatchObject({ state: "INCOMPLETE", reason: "PARTIAL_BOUNDARY" });
  });
  it("partial expiry candle cannot confirm loss", () => {
    expect(run({ ...signal(), expiresAt: start + 2 * M5 + 7_000 }, window({ low: 95 }))).toMatchObject({ state: "INCOMPLETE", reason: "PARTIAL_BOUNDARY" });
  });
  it("missing coverage even after a potential hit cannot confirm a result", () => {
    expect(run(signal(), [bar(start, { high: 110 }), bar(start + M5)])).toMatchObject({ state: "INCOMPLETE", reason: "MISSING_CANDLE" });
  });
  it("missing earlier candle cannot let a later loss decide the result", () => {
    expect(run(signal(), [bar(start + M5, { low: 95 }), bar(start + 2 * M5)])).toMatchObject({ state: "INCOMPLETE" });
  });
  it.each(["simulated", "legacy_unknown"] as const)("rejects %s provenance without legacy backfill", provenance => {
    expect(run({ ...signal(), provenance }, window({ high: 110 }))).toMatchObject({ state: "REJECTED", reason: "UNVERIFIED_PROVENANCE" });
  });
  it.each([{ source: "demo" }, { timeframe: "M15" }, { symbol: "EURUSD" }])("ineligible bars cannot fill coverage: %j", change => {
    expect(run(signal(), [bar(start, change), bar(start + M5), bar(start + 2 * M5)])).toMatchObject({ state: "INCOMPLETE", reason: "MISSING_CANDLE" });
  });
  it.each([NaN, Infinity, 0, -1])("rejects malformed signal price %s", entry => {
    expect(run({ ...signal(), entry })).toMatchObject({ state: "REJECTED", reason: "INVALID_SIGNAL" });
  });
  it("rejects inverted/zero-risk levels", () => {
    expect(run({ ...signal(), stopLoss: 100 })).toMatchObject({ reason: "INVALID_SIGNAL" });
    expect(run({ ...signal("SELL"), takeProfit1: 110 })).toMatchObject({ reason: "INVALID_SIGNAL" });
  });
  it.each([{ high: NaN }, { low: 101 }, { high: 99 }, { openTime: start + 1 }, { openTime: NaN }])("rejects malformed candle %j", changes => {
    expect(run(signal(), window(changes))).toMatchObject({ state: "REJECTED", reason: "INVALID_CANDLE" });
  });
  it("identical duplicate and delayed/reversed uploads give the same earliest result", () => {
    const bars = [bar(start, { high: 110 }), bar(start + M5, { low: 95 }), bar(start + 2 * M5)];
    expect(run(signal(), [...bars].reverse(), start + 20 * M5)).toEqual(run(signal(), [...bars, bar(start, { high: 110 })]));
    expect(run(signal(), bars)).toMatchObject({ outcome: "tp1", closedAt: start + M5 });
  });
  it("conflicting duplicate bars cannot select a convenient result", () => {
    expect(run(signal(), [...window(), bar(start, { high: 110 })])).toMatchObject({ state: "REJECTED", reason: "CONFLICTING_DUPLICATE" });
  });
  it("rejects malformed time and reversed lifetime", () => {
    expect(run({ ...signal(), createdAt: NaN })).toMatchObject({ reason: "INVALID_SIGNAL" });
    expect(run({ ...signal(), expiresAt: start })).toMatchObject({ reason: "INVALID_SIGNAL" });
    expect(run(signal(), window(), start - 1)).toMatchObject({ reason: "INVALID_SIGNAL" });
  });
  it("is deterministic and does not mutate frozen inputs", () => {
    const s = Object.freeze(signal());
    const bars = Object.freeze(window().map(c => Object.freeze(c)));
    expect(run(s, [...bars])).toEqual(run(s, [...bars]));
  });
  it.each([{}, { high: 110 }, { low: 95 }])("missing middle candle cannot resolve %j", first => {
    expect(run(signal(), [bar(start, first), bar(start + 2 * M5)])).toEqual({
      state: "INCOMPLETE", reason: "MISSING_CANDLE", unvalidated: true });
  });
  it.each(["BUY", "SELL"] as const)("%s malformed candle after target rejects full window", side => {
    expect(run(signal(side), [bar(start, side === "BUY" ? { high: 110 } : { low: 90 }),
      bar(start + M5), bar(start + 2 * M5, { close: Infinity })])).toMatchObject({ state: "REJECTED", reason: "INVALID_CANDLE" });
  });
  it("conflicting duplicate after earlier hit rejects", () => {
    expect(run(signal(), [...window({ high: 110 }), bar(start + 2 * M5, { high: 103 })]))
      .toMatchObject({ state: "REJECTED", reason: "CONFLICTING_DUPLICATE" });
  });
  it.each(["BUY", "SELL"] as const)("%s favourable gap touching both uses SL", side => {
    expect(run(signal(side), window(side === "BUY"
      ? { open: 112, high: 114, low: 94, close: 100 }
      : { open: 88, high: 106, low: 86, close: 100 }))).toMatchObject({ outcome: "sl", resultR: -1 });
  });
  it.each(["BUY", "SELL"] as const)("%s adverse gap touching both uses worse open", side => {
    expect(run(signal(side), window(side === "BUY"
      ? { open: 93, high: 111, low: 92, close: 100 }
      : { open: 107, high: 108, low: 89, close: 100 }))).toMatchObject({ outcome: "sl", resultR: -1.4 });
  });
  it.each(["BUY", "SELL"] as const)("%s unusual saved levels use actual risk", side => {
    const s = { ...signal(side), entry: 100.25, stopLoss: side === "BUY" ? 98.75 : 101.75,
      takeProfit1: side === "BUY" ? 100.625 : 99.875 };
    const bars = [bar(start, side === "BUY"
      ? { open: 100.25, low: 100, high: 100.625, close: 100.25 }
      : { open: 100.25, low: 99.875, high: 100.5, close: 100.25 }),
      bar(start + M5), bar(start + 2 * M5)];
    expect(run(s, bars)).toMatchObject({ outcome: "tp1", resultR: 0.25 });
  });
  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER, "2026-10-19T12:00:00Z"])("rejects invalid now %s", now => {
    expect(evaluateOutcome(signal(), window(), now)).toMatchObject({ state: "REJECTED", reason: "INVALID_SIGNAL" });
  });
  it.each(["createdAt", "expiresAt"] as const)("rejects invalid %s timestamps", field => {
    for (const value of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(run({ ...signal(), [field]: value })).toMatchObject({ state: "REJECTED", reason: "INVALID_SIGNAL" });
    }
  });
  it.each(["open", "high", "low", "close"] as const)("rejects malformed candle %s", field => {
    for (const value of [NaN, Infinity, -Infinity, 0, -1]) {
      expect(run(signal(), window({ [field]: value }))).toMatchObject({ state: "REJECTED", reason: "INVALID_CANDLE" });
    }
  });
  it("extreme finite reward/risk overflow cannot become expired", () => {
    expect(run({ ...signal(), entry: 2 * Number.MIN_VALUE, stopLoss: Number.MIN_VALUE,
      takeProfit1: Number.MAX_VALUE })).toMatchObject({ state: "REJECTED", reason: "INVALID_SIGNAL" });
  });
  it("finite extreme prices can yield a finite estimate", () => {
    const s = { ...signal(), entry: 1e300, stopLoss: 5e299, takeProfit1: 1.5e300 };
    const bars = Array.from({ length: 3 }, (_, i) => bar(start + i * M5,
      { open: 1e300, low: 1e300, high: 1.5e300, close: 1e300 }));
    expect(run(s, bars)).toMatchObject({ outcome: "tp1", resultR: 1 });
  });
  it.each([null, undefined, 7, "signal", [], {}, { ...signal(), entry: "100" }])("runtime-invalid signal %j rejects without throwing", s => {
    expect(evaluateOutcome(s, window(), start + 3 * M5)).toMatchObject({ state: "REJECTED", reason: "INVALID_SIGNAL" });
  });
  it.each([null, undefined, 7, {}, "candles", [null], [undefined], [{}], Array(3)])("runtime-invalid candles %j reject without throwing", bars => {
    expect(evaluateOutcome(signal(), bars, start + 3 * M5)).toMatchObject({ state: "REJECTED", reason: "INVALID_CANDLE" });
  });
  it("exact expiry closes the last eligible candle; one millisecond earlier cannot resolve", () => {
    const bars = [bar(start), bar(start + M5), bar(start + 2 * M5, { high: 110 })];
    expect(run(signal(), bars, start + 3 * M5 - 1)).toMatchObject({ state: "INCOMPLETE" });
    expect(run(signal(), bars)).toMatchObject({ outcome: "tp1", closedAt: start + 3 * M5 });
  });
  it("UTC offset representations describe identical instants", () => {
    expect(Date.parse("2026-10-19T14:00:00+02:00")).toBe(start);
    expect(run({ ...signal(), createdAt: Date.parse("2026-10-19T14:00:00+02:00") })).toEqual(run());
  });
  it("24-hour window is allowed only with complete coverage", () => {
    const s = { ...signal(), expiresAt: start + OUTCOME_MAX_WINDOW_MS };
    const bars = Array.from({ length: 288 }, (_, i) => bar(start + i * M5));
    expect(run(s, bars, s.expiresAt)).toMatchObject({ outcome: "expired" });
    expect(run(s, bars.slice(1), s.expiresAt)).toMatchObject({ state: "INCOMPLETE" });
  });
  it("window beyond 24 hours rejects before coverage iteration", () => {
    const s = { ...signal(), expiresAt: start + OUTCOME_MAX_WINDOW_MS + M5 };
    expect(run(s, [], s.expiresAt)).toMatchObject({ state: "REJECTED", reason: "LIMIT_EXCEEDED" });
  });
  it("input limit counts duplicates and rejects above 2048", () => {
    const bars = [...window(), ...Array.from({ length: OUTCOME_MAX_INPUT_CANDLES - 3 }, () => bar())];
    expect(run(signal(), bars)).toMatchObject({ outcome: "expired" });
    expect(run(signal(), [...bars, bar()])).toMatchObject({ state: "REJECTED", reason: "LIMIT_EXCEEDED" });
  });
});