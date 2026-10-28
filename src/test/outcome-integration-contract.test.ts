import { describe, expect, it } from "vitest";
import { evaluateOutcomeContract } from "@/lib/outcome-integration-contract";

// Synthetic fixtures only — not market data. Everything UNVALIDATED.
const T0 = Date.UTC(2027, 0, 15, 10, 0, 0);
const WIN = 15 * 60_000;
const M = 1_000;
const OPT = { nowMsc: T0 + 3_600_000, clockMarginMs: M, maxQuietMs: 600_000 };
const iso = (ms: number) => new Date(ms).toISOString();

const buyRow = (over: Record<string, unknown> = {}) => ({
  id: "11111111-2222-4333-8444-555555555555", symbol: "XAUUSD", side: "BUY", timeframe: "M5",
  entry: 2000, stop_loss: 1995, take_profit_1: 2010, created_at: iso(T0), expires_at: iso(T0 + WIN),
  entry_reference: "ask", strategy_version: "v1", source_candle_time: iso(T0 - 300_000),
  entry_low: null, entry_high: null, ...over,
});
const sellRow = (over: Record<string, unknown> = {}) =>
  buyRow({ side: "SELL", stop_loss: 2005, take_profit_1: 1990, entry_reference: "bid", ...over });

const q = (dt: number, bid: number, ask = bid + 0.3) => ({ timeMsc: T0 + dt, bid, ask });
// Quiet-free background ticks every 5 minutes inside the window.
const bg = [q(60_000, 2000), q(360_000, 2000), q(660_000, 2000)];
const batch = (ticks: unknown[], over: Record<string, unknown> = {}) => ({
  batchId: "b1", source: "mt5_tick_history", symbol: "XAUUSD",
  fromMsc: T0 - M, toMsc: T0 + WIN - 1 + M, fetchedAtMsc: T0 + WIN + 5_000,
  coverageClaim: "complete_claimed", ticks, ...over,
});
const run = (row: unknown, batches: unknown, o: unknown = OPT) => evaluateOutcomeContract(row, batches, o);

const SAFETY = { unvalidated: true, provenance: "NOT_ESTABLISHED", coverage: "NOT_VERIFIED",
  finalizationEligible: false, productionEligible: false };

describe("valid BUY and SELL inputs", () => {
  it("BUY TP1 observed on bid", () => {
    expect(run(buyRow(), [batch([...bg, q(300_000, 2010)])])).toMatchObject({
      ...SAFETY, state: "CANDIDATE_OBSERVATION", observation: "TP1_QUOTE_OBSERVED", quoteSide: "bid", atMsc: T0 + 300_000 });
  });
  it("BUY ask reaching TP1 alone is not a hit (bid used)", () => {
    expect(run(buyRow(), [batch([...bg, q(300_000, 2009.8, 2010.1)])])).toMatchObject({ observation: "NO_LEVEL_OBSERVED" });
  });
  it("BUY SL observed on bid", () => {
    expect(run(buyRow(), [batch([...bg, q(300_000, 1995)])])).toMatchObject({ observation: "SL_QUOTE_OBSERVED", observedQuote: 1995 });
  });
  it("SELL TP1 observed on ask", () => {
    expect(run(sellRow(), [batch([...bg, q(300_000, 1989.5, 1990)])])).toMatchObject({
      state: "CANDIDATE_OBSERVATION", observation: "TP1_QUOTE_OBSERVED", quoteSide: "ask" });
  });
  it("SELL bid reaching TP1 alone is not a hit (ask used)", () => {
    expect(run(sellRow(), [batch([...bg, q(300_000, 1990, 1990.4)])])).toMatchObject({ observation: "NO_LEVEL_OBSERVED" });
  });
  it("SELL SL observed on ask", () => {
    expect(run(sellRow(), [batch([...bg, q(300_000, 2004.8, 2005)])])).toMatchObject({ observation: "SL_QUOTE_OBSERVED" });
  });
});

describe("missing or malformed signals", () => {
  it.each([
    ["null", null], ["array", []], ["missing field", (() => { const r: Record<string, unknown> = buyRow(); delete r["entry"]; return r; })()],
    ["bad side", buyRow({ side: "LONG" })], ["bad geometry", buyRow({ stop_loss: 2001 })],
    ["legacy metadata", buyRow({ strategy_version: null })], ["ranged entry", buyRow({ entry_low: 1999 })],
    ["wrong symbol", buyRow({ symbol: "EURUSD" })], ["entry reference mismatch", buyRow({ entry_reference: "bid" })],
  ])("%s → REJECTED INVALID_SIGNAL", (_n, row) => {
    expect(run(row, [batch(bg)])).toMatchObject({ ...SAFETY, state: "REJECTED", reason: "INVALID_SIGNAL" });
  });
  it("signal created after now is rejected", () => {
    expect(run(buyRow(), [batch(bg)], { ...OPT, nowMsc: T0 - 1 })).toMatchObject({ state: "REJECTED" });
  });
});

describe("missing bid or ask / malformed evidence", () => {
  it.each([
    ["missing bid", { timeMsc: T0 + 1, ask: 2000 }], ["missing ask", { timeMsc: T0 + 1, bid: 2000 }],
    ["crossed", { timeMsc: T0 + 1, bid: 2001, ask: 2000 }], ["NaN", { timeMsc: T0 + 1, bid: NaN, ask: 2000 }],
  ])("%s → INVALID_BATCH", (_n, t) => {
    expect(run(buyRow(), [batch([t])])).toMatchObject({ state: "REJECTED", reason: "INVALID_BATCH", batchIndex: 0 });
  });
  it("non-array evidence", () => expect(run(buyRow(), "x")).toMatchObject({ state: "REJECTED", reason: "INVALID_EVIDENCE_INPUT" }));
  it("no batches → INCOMPLETE", () => expect(run(buyRow(), [])).toMatchObject({ state: "INCOMPLETE", reason: "NO_EVIDENCE" }));
  it.each([[null], [{}], [{ ...OPT, extra: 1 }], [{ ...OPT, clockMarginMs: -1 }], [{ ...OPT, maxQuietMs: 0 }]])(
    "invalid options %#", (o) => expect(run(buyRow(), [batch(bg)], o)).toMatchObject({ state: "REJECTED", reason: "INVALID_OPTIONS" }));
});

describe("incomplete historical windows", () => {
  it("window not closed", () => {
    expect(run(buyRow(), [batch(bg, { toMsc: T0 + WIN - 1 + M, fetchedAtMsc: T0 + WIN + M })], { ...OPT, nowMsc: T0 + WIN + M - 2 }))
      .toMatchObject({ ...SAFETY, state: "INCOMPLETE", reason: "WINDOW_NOT_CLOSED" });
  });
  it("partial claim → COVERAGE_GAP", () => {
    expect(run(buyRow(), [batch(bg, { coverageClaim: "partial" })])).toMatchObject({ state: "INCOMPLETE", reason: "COVERAGE_GAP" });
  });
  it("batch ending before window end → COVERAGE_GAP even with a TP tick", () => {
    expect(run(buyRow(), [batch([q(300_000, 2010)], { toMsc: T0 + 400_000, fetchedAtMsc: T0 + 500_000 })]))
      .toMatchObject({ state: "INCOMPLETE", reason: "COVERAGE_GAP" });
  });
  it("missing clock margin at start → COVERAGE_GAP", () => {
    expect(run(buyRow(), [batch(bg, { fromMsc: T0 })])).toMatchObject({ state: "INCOMPLETE", reason: "COVERAGE_GAP" });
  });
  it("quiet spell → UNCERTAIN QUIET_GAP", () => {
    expect(run(buyRow(), [batch([q(60_000, 2000)])])).toMatchObject({ state: "UNCERTAIN", reason: "QUIET_GAP" });
  });
});

describe("same-millisecond observations", () => {
  it("identical duplicates are preserved and not treated as ambiguity", () => {
    expect(run(buyRow(), [batch([...bg, q(300_000, 2010), q(300_000, 2010)])])).toMatchObject({ observation: "TP1_QUOTE_OBSERVED" });
  });
  it("TP1 and SL in the same ms → AMBIGUOUS, never SL-first", () => {
    const res = run(buyRow(), [batch([...bg, q(300_000, 2010), q(300_000, 1995)])]);
    expect(res).toMatchObject({ ...SAFETY, state: "AMBIGUOUS", reason: "SAME_MS_TP1_SL", atMsc: T0 + 300_000 });
    expect(res).not.toHaveProperty("observation");
  });
  it("ambiguity is independent of input order", () => {
    const a = run(buyRow(), [batch([...bg, q(300_000, 1995), q(300_000, 2010)])]);
    const b = run(buyRow(), [batch([q(300_000, 2010), ...bg, q(300_000, 1995)])]);
    expect(a).toEqual(b);
  });
  it("sequence numbers are rejected, never required or fabricated", () => {
    expect(run(buyRow(), [batch([{ ...q(1, 2000), seq: 0 }])])).toMatchObject({ state: "REJECTED", reason: "INVALID_BATCH" });
    const res = run(buyRow(), [batch(bg)]);
    expect(JSON.stringify(res)).not.toMatch(/seq/);
  });
});

describe("creation and expiry boundary precision", () => {
  it("hit within clock margin of creation → CLOCK_AMBIGUITY", () => {
    expect(run(buyRow(), [batch([q(M, 2010), ...bg])])).toMatchObject({ state: "UNCERTAIN", reason: "CLOCK_AMBIGUITY" });
  });
  it("hit within clock margin of expiry → CLOCK_AMBIGUITY", () => {
    expect(run(buyRow(), [batch([...bg, q(WIN - M, 2010)])])).toMatchObject({ state: "UNCERTAIN", reason: "CLOCK_AMBIGUITY" });
  });
  it("hit just outside the margin is a candidate", () => {
    expect(run(buyRow(), [batch([q(M + 1, 2010), ...bg])])).toMatchObject({ observation: "TP1_QUOTE_OBSERVED", atMsc: T0 + M + 1 });
  });
  it("hits before creation or at/after expiry are ignored", () => {
    expect(run(buyRow(), [batch([q(-1, 2010), ...bg, q(WIN, 2010)])], { ...OPT, clockMarginMs: 1, maxQuietMs: 600_000 }))
      .toMatchObject({ ...SAFETY, state: "CANDIDATE_OBSERVATION", observation: "NO_LEVEL_OBSERVED", atMsc: null, observedQuote: null });
  });
  it("nonzero sub-ms creation precision rejected, not truncated", () => {
    expect(run(buyRow({ created_at: "2027-01-15T10:00:00.000500Z" }), [batch(bg)]))
      .toMatchObject({ state: "REJECTED", reason: "INVALID_SIGNAL", signalReason: "TIMESTAMP_PRECISION" });
  });
  it("microsecond zeros accepted and exact", () => {
    expect(run(buyRow({ created_at: "2027-01-15T10:00:00.000000Z" }), [batch([...bg, q(300_000, 2010)])]))
      .toMatchObject({ atMsc: T0 + 300_000 });
  });
});

describe("conflicting historical batches", () => {
  it("same batchId with different content → BATCH_ID_CONFLICT", () => {
    expect(run(buyRow(), [batch(bg), batch([...bg, q(300_000, 2001)])])).toMatchObject({ state: "REJECTED", reason: "BATCH_ID_CONFLICT" });
  });
  it("overlapping batches disagreeing at a ms → UNCERTAIN CONFLICTING_EVIDENCE", () => {
    expect(run(buyRow(), [batch([...bg, q(300_000, 2010)]), batch([...bg, q(300_000, 2001)], { batchId: "b2" })]))
      .toMatchObject({ state: "UNCERTAIN", reason: "CONFLICTING_EVIDENCE" });
  });
  it("exact replay is idempotent", () => {
    expect(run(buyRow(), [batch([...bg, q(300_000, 2010)]), batch([...bg, q(300_000, 2010)])])).toMatchObject({ observation: "TP1_QUOTE_OBSERVED" });
  });
});

describe("unverified provenance and no fabricated outcomes", () => {
  it("unknown claim never becomes coverage", () => {
    expect(run(buyRow(), [batch([...bg, q(300_000, 2010)], { coverageClaim: "unknown" })])).toMatchObject({ state: "INCOMPLETE" });
  });
  it("live-sampled source rejected", () => {
    expect(run(buyRow(), [batch(bg, { source: "mt5_live" })])).toMatchObject({ state: "REJECTED", reason: "INVALID_BATCH" });
  });
  it("no-hit window is NO_LEVEL_OBSERVED, not an expiry outcome", () => {
    const res = run(buyRow(), [batch(bg)]);
    expect(res).toMatchObject({ ...SAFETY, state: "CANDIDATE_OBSERVATION", observation: "NO_LEVEL_OBSERVED", atMsc: null, observedQuote: null });
    expect(JSON.stringify(res)).not.toMatch(/expired|win|loss|profit|fill|resultR/i);
    expect(res.coverage).toBe("NOT_VERIFIED");
    expect(Object.values(res)).not.toContain("VERIFIED");
  });
  it("results carry no R, profit or fill fields and never say VERIFIED", () => {
    for (const res of [run(buyRow(), [batch([...bg, q(300_000, 2010)])]), run(sellRow(), [batch([...bg, q(300_000, 2004.8, 2005)])])]) {
      expect(res).toMatchObject(SAFETY);
      expect(res).not.toHaveProperty("resultR");
      expect(res).not.toHaveProperty("exitPrice");
      expect(res).not.toHaveProperty("outcome");
    }
  });
});

describe("determinism and fail-closed behaviour", () => {
  it("same input → identical output", () => {
    const b = [batch([...bg, q(300_000, 2010)])];
    expect(run(buyRow(), b)).toEqual(run(buyRow(), b));
  });
  it("does not mutate inputs", () => {
    const row = buyRow(), b = [batch([...bg, q(300_000, 2010)])];
    const copy = JSON.parse(JSON.stringify({ row, b }));
    run(row, b);
    expect({ row, b }).toEqual(copy);
  });
  it("getter on signal is rejected without execution", () => {
    let called = false;
    const row = buyRow(); Object.defineProperty(row, "entry", { get: () => { called = true; return 2000; }, enumerable: true });
    expect(run(row, [batch(bg)])).toMatchObject({ state: "REJECTED" });
    expect(called).toBe(false);
  });
  it("every state carries the safety labels", () => {
    for (const res of [run(null, []), run(buyRow(), []), run(buyRow(), [batch([q(60_000, 2000)])]), run(buyRow(), [batch(bg)])])
      expect(res).toMatchObject(SAFETY);
  });
});
