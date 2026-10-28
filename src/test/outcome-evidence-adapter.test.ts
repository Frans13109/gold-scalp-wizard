import { describe, expect, it } from "vitest";
import { adaptStoredEvidence, toExactInt, toExactPrice } from "@/lib/outcome-evidence-adapter";
import { evaluateOutcomeContract } from "@/lib/outcome-integration-contract";

// Synthetic fixtures only — not market data. Everything UNVALIDATED.
const T0 = Date.UTC(2027, 0, 15, 10, 0, 0);
const WIN = 15 * 60_000;
const M = 1_000;
const OPT = { nowMsc: T0 + 3_600_000, clockMarginMs: M, maxQuietMs: 600_000 };
const iso = (ms: number) => new Date(ms).toISOString();
const PK1 = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const PK2 = "aaaaaaaa-bbbb-4ccc-8ddd-000000000002";

const SAFETY = { unvalidated: true, provenance: "NOT_ESTABLISHED", coverage: "NOT_VERIFIED",
  finalizationEligible: false, productionEligible: false };

const buyRow = (over: Record<string, unknown> = {}) => ({
  id: "11111111-2222-4333-8444-555555555555", symbol: "XAUUSD", side: "BUY", timeframe: "M5",
  entry: "2000", stop_loss: "1995", take_profit_1: "2010", created_at: iso(T0), expires_at: iso(T0 + WIN),
  entry_reference: "ask", strategy_version: "v1", source_candle_time: iso(T0 - 300_000),
  entry_low: null, entry_high: null, ...over,
});
const sellRow = (over: Record<string, unknown> = {}) =>
  buyRow({ side: "SELL", stop_loss: "2005", take_profit_1: "1990", entry_reference: "bid", ...over });

const batchRow = (over: Record<string, unknown> = {}) => ({
  batch_pk: PK1, batch_id: "b1", source: "mt5_tick_history", symbol: "XAUUSD",
  from_msc: String(T0 - M), to_msc: String(T0 + WIN - 1 + M), fetched_at_msc: String(T0 + WIN + 5_000),
  coverage_claim: "complete_claimed", tick_count: "3", canonical_version: 1, ...over,
});
const obs = (ord: number, dt: number, bid: string | number, ask: string | number = "2000.3", pk = PK1) =>
  ({ batch_pk: pk, observation_ordinal: ord, time_msc: String(T0 + dt), bid, ask });
const bgObs = () => [obs(0, 60_000, "2000"), obs(1, 360_000, "2000"), obs(2, 660_000, "2000")];
const input = (over: Record<string, unknown> = {}) => ({ signal: buyRow(), batches: [batchRow()], observations: bgObs(), ...over });
const adapt = (x: unknown) => adaptStoredEvidence(x);

describe("valid BUY and SELL rows", () => {
  it("BUY adapts and carries safety labels", () => {
    const r = adapt(input());
    expect(r).toMatchObject({ ...SAFETY, state: "ADAPTED", batchCount: 1, tickCount: 3 });
  });
  it("SELL adapts", () => {
    expect(adapt(input({ signal: sellRow() }))).toMatchObject({ state: "ADAPTED" });
  });
  it("prices accepted as JS numbers too", () => {
    expect(adapt(input({ signal: buyRow({ entry: 2000, stop_loss: 1995, take_profit_1: 2010 }) }))).toMatchObject({ state: "ADAPTED" });
  });
  it("adapted output feeds Phase 3A: BUY TP1 on bid", () => {
    const r = adapt(input({ batches: [batchRow({ tick_count: 4 })], observations: [...bgObs(), obs(3, 300_000, "2010", "2010.3")] }));
    if (r.state !== "ADAPTED") throw new Error("not adapted");
    expect(evaluateOutcomeContract(r.savedSignal, r.rawBatches, OPT)).toMatchObject({
      ...SAFETY, state: "CANDIDATE_OBSERVATION", observation: "TP1_QUOTE_OBSERVED", quoteSide: "bid" });
  });
  it("adapted output feeds Phase 3A: SELL TP1 on ask only", () => {
    const r = adapt(input({ signal: sellRow(), batches: [batchRow({ tick_count: 4 })],
      observations: [...bgObs(), obs(3, 300_000, "1990", "1990.4")] }));
    if (r.state !== "ADAPTED") throw new Error("not adapted");
    expect(evaluateOutcomeContract(r.savedSignal, r.rawBatches, OPT)).toMatchObject({ observation: "NO_LEVEL_OBSERVED", quoteSide: "ask" });
  });
});

describe("historical batch reconstruction", () => {
  it("rebuilds the exact Phase 2B shape with original identity and metadata", () => {
    const r = adapt(input());
    if (r.state !== "ADAPTED") throw new Error("not adapted");
    expect(r.rawBatches).toEqual([{ batchId: "b1", source: "mt5_tick_history", symbol: "XAUUSD", fromMsc: T0 - M,
      toMsc: T0 + WIN - 1 + M, fetchedAtMsc: T0 + WIN + 5_000, coverageClaim: "complete_claimed",
      ticks: [{ timeMsc: T0 + 60_000, bid: 2000, ask: 2000.3 }, { timeMsc: T0 + 360_000, bid: 2000, ask: 2000.3 },
        { timeMsc: T0 + 660_000, bid: 2000, ask: 2000.3 }] }]);
  });
  it("ticks follow storage ordinal, independent of observation row order", () => {
    const a = adapt(input()), b = adapt(input({ observations: bgObs().reverse() }));
    expect(a).toEqual(b);
  });
  it("two batches keep separate identities", () => {
    const r = adapt(input({ batches: [batchRow(), batchRow({ batch_pk: PK2, batch_id: "b2", tick_count: 1 })],
      observations: [...bgObs(), obs(0, 60_000, "2000", "2000.3", PK2)] }));
    expect(r).toMatchObject({ state: "ADAPTED", batchCount: 2, tickCount: 4 });
  });
  it("partial and unknown claims are preserved, never upgraded", () => {
    for (const c of ["partial", "unknown"]) {
      const r = adapt(input({ batches: [batchRow({ coverage_claim: c })] }));
      if (r.state !== "ADAPTED") throw new Error("not adapted");
      expect(r.rawBatches[0]!.coverageClaim).toBe(c);
      expect(evaluateOutcomeContract(r.savedSignal, r.rawBatches, OPT)).toMatchObject({ ...SAFETY, state: "INCOMPLETE" });
    }
  });
  it("zero-tick batch with tick_count 0 adapts", () => {
    expect(adapt(input({ batches: [batchRow({ tick_count: 0 })], observations: [] }))).toMatchObject({ state: "ADAPTED", tickCount: 0 });
  });
});

describe("repeated and same-millisecond ticks", () => {
  it("identical repeated ticks are all preserved", () => {
    const r = adapt(input({ batches: [batchRow({ tick_count: 2 })], observations: [obs(0, 1, "2000"), obs(1, 1, "2000")] }));
    if (r.state !== "ADAPTED") throw new Error("not adapted");
    expect(r.rawBatches[0]!.ticks).toHaveLength(2);
  });
  it("same-ms TP1 and SL survive adaptation and stay AMBIGUOUS", () => {
    const r = adapt(input({ batches: [batchRow({ tick_count: 5 })],
      observations: [...bgObs(), obs(3, 300_000, "2010", "2010.3"), obs(4, 300_000, "1995", "1995.3")] }));
    if (r.state !== "ADAPTED") throw new Error("not adapted");
    expect(evaluateOutcomeContract(r.savedSignal, r.rawBatches, OPT)).toMatchObject({ ...SAFETY, state: "AMBIGUOUS", reason: "SAME_MS_TP1_SL" });
  });
  it("no sequence numbers are invented", () => {
    expect(JSON.stringify(adapt(input()))).not.toMatch(/seq/i);
  });
});

describe("exact bid/ask preservation and precision", () => {
  it("bid and ask keep their exact values", () => {
    const r = adapt(input({ batches: [batchRow({ tick_count: 1 })], observations: [obs(0, 1, "2000.12", "2000.47")] }));
    if (r.state !== "ADAPTED") throw new Error("not adapted");
    expect(r.rawBatches[0]!.ticks[0]).toEqual({ timeMsc: T0 + 1, bid: 2000.12, ask: 2000.47 });
  });
  it.each([["2000.10"], ["2000.0"], ["02000"], ["2000.1234567890123456789"]])("non-unique decimal %s → PRECISION_LOSS or INVALID_PRICE", (p) => {
    const r = adapt(input({ observations: [obs(0, 60_000, p), obs(1, 360_000, "2000"), obs(2, 660_000, "2000")] }));
    expect(r).toMatchObject({ ...SAFETY, state: "REJECTED" });
    expect(["PRECISION_LOSS", "INVALID_PRICE"]).toContain((r as { reason: string }).reason);
  });
  it("toExactPrice rules", () => {
    expect(toExactPrice("2000.5")).toEqual({ ok: true, value: 2000.5 });
    expect(toExactPrice("2000.50")).toEqual({ ok: false, reason: "PRECISION_LOSS" });
    expect(toExactPrice("1e3")).toEqual({ ok: false, reason: "INVALID_PRICE" });
    expect(toExactPrice("-1")).toEqual({ ok: false, reason: "INVALID_PRICE" });
    expect(toExactPrice(0)).toEqual({ ok: false, reason: "INVALID_PRICE" });
  });
  it("toExactInt rules", () => {
    expect(toExactInt("123")).toEqual({ ok: true, value: 123 });
    expect(toExactInt("0123")).toEqual({ ok: false, reason: "INVALID_INTEGER" });
    expect(toExactInt("9007199254740993")).toEqual({ ok: false, reason: "PRECISION_LOSS" });
    expect(toExactInt(1.5)).toEqual({ ok: false, reason: "INVALID_INTEGER" });
    expect(toExactInt(-1)).toEqual({ ok: false, reason: "INVALID_INTEGER" });
  });
  it("signal price with trailing zeros → PRECISION_LOSS", () => {
    expect(adapt(input({ signal: buyRow({ entry: "2000.00" }) }))).toMatchObject({ state: "REJECTED", reason: "PRECISION_LOSS", field: "entry" });
  });
});

describe("malformed and non-finite prices", () => {
  it.each([[NaN], [Infinity], [-2000], [0], ["abc"], [null], [true]])("bid %s → INVALID_PRICE", (p) => {
    expect(adapt(input({ observations: [obs(0, 60_000, p as never), obs(1, 360_000, "2000"), obs(2, 660_000, "2000")] })))
      .toMatchObject({ state: "REJECTED", reason: "INVALID_PRICE", field: "bid" });
  });
  it("crossed quote → CROSSED_QUOTE", () => {
    expect(adapt(input({ observations: [obs(0, 60_000, "2001", "2000"), obs(1, 360_000, "2000"), obs(2, 660_000, "2000")] })))
      .toMatchObject({ state: "REJECTED", reason: "CROSSED_QUOTE" });
  });
  it("non-finite signal price → INVALID_SIGNAL", () => {
    expect(adapt(input({ signal: buyRow({ entry: NaN }) }))).toMatchObject({ state: "REJECTED", reason: "INVALID_SIGNAL" });
  });
});

describe("observation ordinals and tick counts", () => {
  it("missing ordinal → MISSING_ORDINAL", () => {
    expect(adapt(input({ observations: bgObs().slice(0, 2) }))).toMatchObject({ state: "REJECTED", reason: "MISSING_ORDINAL" });
  });
  it("duplicate ordinal → DUPLICATE_ORDINAL", () => {
    expect(adapt(input({ observations: [...bgObs().slice(0, 2), obs(1, 660_000, "2000")] })))
      .toMatchObject({ state: "REJECTED", reason: "DUPLICATE_ORDINAL" });
  });
  it("identical duplicate ordinal row is still rejected", () => {
    expect(adapt(input({ observations: [...bgObs(), bgObs()[2]] }))).toMatchObject({ state: "REJECTED", reason: "DUPLICATE_ORDINAL" });
  });
  it("ordinal beyond tick_count → TICK_COUNT_MISMATCH", () => {
    expect(adapt(input({ observations: [...bgObs(), obs(3, 700_000, "2000")] }))).toMatchObject({ state: "REJECTED", reason: "TICK_COUNT_MISMATCH" });
  });
  it("tick_count larger than rows → MISSING_ORDINAL", () => {
    expect(adapt(input({ batches: [batchRow({ tick_count: 4 })] }))).toMatchObject({ state: "REJECTED", reason: "MISSING_ORDINAL" });
  });
  it("tick_count over limit → TOO_MANY_TICKS", () => {
    expect(adapt(input({ batches: [batchRow({ tick_count: 50_001 })] }))).toMatchObject({ state: "REJECTED", reason: "TOO_MANY_TICKS" });
  });
  it("negative or fractional ordinal → INVALID_OBSERVATION_ROW", () => {
    for (const o of [-1, 0.5, "x"])
      expect(adapt(input({ observations: [{ ...bgObs()[0]!, observation_ordinal: o }, ...bgObs().slice(1)] })))
        .toMatchObject({ state: "REJECTED", reason: "INVALID_OBSERVATION_ROW" });
  });
  it("observation for unknown batch → UNKNOWN_BATCH", () => {
    expect(adapt(input({ observations: [...bgObs(), obs(0, 1, "2000", "2000.3", PK2)] }))).toMatchObject({ state: "REJECTED", reason: "UNKNOWN_BATCH" });
  });
  it("tick outside batch window → TICK_OUTSIDE_WINDOW", () => {
    expect(adapt(input({ observations: [obs(0, -5_000, "2000"), ...bgObs().slice(1)] })))
      .toMatchObject({ state: "REJECTED", reason: "TICK_OUTSIDE_WINDOW" });
  });
});

describe("batch identity and metadata", () => {
  it("duplicate batch_pk → DUPLICATE_BATCH_PK", () => {
    expect(adapt(input({ batches: [batchRow(), batchRow({ batch_id: "b2" })] }))).toMatchObject({ state: "REJECTED", reason: "DUPLICATE_BATCH_PK" });
  });
  it("duplicate batch_id → DUPLICATE_BATCH_ID", () => {
    expect(adapt(input({ batches: [batchRow(), batchRow({ batch_pk: PK2 })] }))).toMatchObject({ state: "REJECTED", reason: "DUPLICATE_BATCH_ID" });
  });
  it.each([
    ["bad pk", { batch_pk: "nope" }], ["upper-case pk", { batch_pk: PK1.toUpperCase() }], ["bad id", { batch_id: "a b" }],
    ["empty id", { batch_id: "" }], ["long id", { batch_id: "x".repeat(129) }], ["live source", { source: "mt5_live" }],
    ["wrong symbol", { symbol: "EURUSD" }], ["bad claim", { coverage_claim: "verified" }],
  ])("%s → INVALID_BATCH_ROW", (_n, over) => {
    expect(adapt(input({ batches: [batchRow(over)] }))).toMatchObject({ ...SAFETY, state: "REJECTED", reason: "INVALID_BATCH_ROW" });
  });
  it("unsupported canonical version", () => {
    expect(adapt(input({ batches: [batchRow({ canonical_version: 2 })] }))).toMatchObject({ state: "REJECTED", reason: "UNSUPPORTED_CANONICAL_VERSION" });
  });
  it("reversed window → INVALID_BATCH_WINDOW", () => {
    expect(adapt(input({ batches: [batchRow({ from_msc: String(T0 + WIN), to_msc: String(T0) })], observations: [] })))
      .toMatchObject({ state: "REJECTED", reason: "INVALID_BATCH_WINDOW" });
  });
  it("unsafe bigint string → PRECISION_LOSS", () => {
    expect(adapt(input({ batches: [batchRow({ to_msc: "9007199254740993" })] }))).toMatchObject({ state: "REJECTED", reason: "PRECISION_LOSS" });
  });
  it("extra or missing batch column → INVALID_BATCH_ROW", () => {
    expect(adapt(input({ batches: [{ ...batchRow(), collector: "x" }] }))).toMatchObject({ reason: "INVALID_BATCH_ROW" });
    const { tick_count: _t, ...missing } = batchRow();
    expect(adapt(input({ batches: [missing] }))).toMatchObject({ reason: "INVALID_BATCH_ROW" });
  });
  it("more than 500 batches → TOO_MANY_BATCHES", () => {
    expect(adapt(input({ batches: Array.from({ length: 501 }, () => batchRow()) }))).toMatchObject({ reason: "TOO_MANY_BATCHES" });
  });
});

describe("timestamp precision", () => {
  it("nonzero sub-ms creation rejected, not rounded", () => {
    expect(adapt(input({ signal: buyRow({ created_at: "2027-01-15T10:00:00.000500Z" }) })))
      .toMatchObject({ state: "REJECTED", reason: "INVALID_SIGNAL", signalReason: "TIMESTAMP_PRECISION" });
  });
  it("microsecond zeros accepted and passed through unchanged", () => {
    const r = adapt(input({ signal: buyRow({ created_at: "2027-01-15T10:00:00.000000Z" }) }));
    if (r.state !== "ADAPTED") throw new Error("not adapted");
    expect(r.savedSignal.created_at).toBe("2027-01-15T10:00:00.000000Z");
  });
  it("timestamp without offset rejected", () => {
    expect(adapt(input({ signal: buyRow({ expires_at: "2027-01-15T10:15:00" }) }))).toMatchObject({ state: "REJECTED", reason: "INVALID_SIGNAL" });
  });
  it("non-integer tick time rejected", () => {
    expect(adapt(input({ observations: [{ ...bgObs()[0]!, time_msc: "1.5" }, ...bgObs().slice(1)] })))
      .toMatchObject({ state: "REJECTED", reason: "INVALID_INTEGER", field: "time_msc" });
  });
});

describe("malformed signal rows and identifiers", () => {
  it.each([
    ["bad id", buyRow({ id: "x" })], ["bad side", buyRow({ side: "LONG" })], ["legacy metadata", buyRow({ strategy_version: null })],
    ["ranged entry", buyRow({ entry_low: "1999" })], ["entry reference mismatch", buyRow({ entry_reference: "bid" })],
  ])("%s → INVALID_SIGNAL", (_n, row) => {
    expect(adapt(input({ signal: row }))).toMatchObject({ ...SAFETY, state: "REJECTED", reason: "INVALID_SIGNAL" });
  });
  it("extra signal column (full DB row) → INVALID_SIGNAL_ROW", () => {
    expect(adapt(input({ signal: { ...buyRow(), status: "active" } }))).toMatchObject({ state: "REJECTED", reason: "INVALID_SIGNAL_ROW" });
  });
  it.each([[null], [[]], ["x"], [{}]])("bad top-level input %#", (x) => {
    expect(adapt(x)).toMatchObject({ ...SAFETY, state: "REJECTED", reason: "INVALID_INPUT" });
  });
  it("non-array batches / observations", () => {
    expect(adapt(input({ batches: {} }))).toMatchObject({ reason: "INVALID_BATCH_ROWS" });
    expect(adapt(input({ observations: "x" }))).toMatchObject({ reason: "INVALID_OBSERVATION_ROWS" });
  });
});

describe("determinism, immutability and fail-closed", () => {
  it("same input → identical output", () => expect(adapt(input())).toEqual(adapt(input())));
  it("does not mutate inputs", () => {
    const x = input(); const copy = JSON.parse(JSON.stringify(x));
    adapt(x);
    expect(x).toEqual(copy);
  });
  it("getters are rejected without execution", () => {
    let called = false;
    const row = buyRow(); Object.defineProperty(row, "entry", { get: () => { called = true; return "2000"; }, enumerable: true });
    expect(adapt(input({ signal: row }))).toMatchObject({ state: "REJECTED", reason: "INVALID_SIGNAL_ROW" });
    const o = bgObs(); Object.defineProperty(o[0]!, "bid", { get: () => { called = true; return "2000"; }, enumerable: true });
    expect(adapt(input({ observations: o }))).toMatchObject({ state: "REJECTED", reason: "INVALID_OBSERVATION_ROW" });
    expect(called).toBe(false);
  });
  it("sparse observation array rejected", () => {
    const o = bgObs(); delete (o as unknown[])[1];
    expect(adapt(input({ observations: o }))).toMatchObject({ reason: "INVALID_OBSERVATION_ROWS" });
  });
  it("class instances rejected", () => {
    class R { constructor() { Object.assign(this, buyRow()); } }
    expect(adapt(input({ signal: new R() }))).toMatchObject({ reason: "INVALID_SIGNAL_ROW" });
  });
});

describe("no fabricated outcomes or eligibility promotion", () => {
  it("every result carries safety labels and no outcome fields", () => {
    for (const r of [adapt(null), adapt(input()), adapt(input({ observations: [] }))]) {
      expect(r).toMatchObject(SAFETY);
      expect(r.coverage).toBe("NOT_VERIFIED");
      expect(Object.values(r)).not.toContain("VERIFIED");
      for (const k of ["outcome", "resultR", "exitPrice", "status", "observation"]) expect(r).not.toHaveProperty(k);
    }
  });
  it("adapted result is not an evaluation", () => {
    expect(JSON.stringify(adapt(input()))).not.toMatch(/TP1_QUOTE|SL_QUOTE|NO_LEVEL|expired|win|loss|profit|fill/i);
  });
});
