import { describe, expect, it } from "vitest";
import {
  assessCoverage, fingerprint, mergeTickBatches, validateTickBatch,
  TICK_HISTORY_MAX_TICKS, TICK_HISTORY_MAX_WINDOW_MS, type ValidatedTickBatch,
} from "@/lib/tick-history-contract";

// Synthetic fixtures only — not market data.
const T0 = 1_800_000_000_000;
const OPT = { nowMsc: T0 + 3_600_000, clockMarginMs: 1_000 };
const tick = (dt: number, bid = 2000, ask = 2000.3) => ({ timeMsc: T0 + dt, bid, ask });
const raw = (over: Record<string, unknown> = {}) => ({
  batchId: "b1", source: "mt5_tick_history", symbol: "XAUUSD",
  fromMsc: T0, toMsc: T0 + 60_000, fetchedAtMsc: T0 + 120_000, coverageClaim: "complete_claimed",
  ticks: [tick(10_000), tick(20_000, 2001, 2001.2), tick(30_000)], ...over,
});
const ok = (r: Record<string, unknown> = {}, o = OPT): ValidatedTickBatch => {
  const v = validateTickBatch(raw(r), o);
  if (v.state !== "VALID") throw new Error(JSON.stringify(v));
  return v.batch;
};
const reasons = (r: unknown, o: unknown = OPT) => {
  const v = validateTickBatch(r, o);
  return v.state === "REJECTED" ? v.reasons[0] : "VALID";
};

describe("validateTickBatch — valid batches", () => {
  it("accepts a well-formed batch and stays UNVALIDATED / not eligible", () => {
    const v = validateTickBatch(raw(), OPT);
    expect(v.state).toBe("VALID");
    expect(v.unvalidated).toBe(true);
    expect(v.provenance).toBe("NOT_ESTABLISHED");
    expect(v.outcomeEligible).toBe(false);
  });
  it("preserves millisecond precision", () => {
    const b = ok({ ticks: [{ timeMsc: T0 + 12_345, bid: 2000, ask: 2000.1 }] });
    expect(b.observations[0]!.timeMsc).toBe(T0 + 12_345);
  });
  it("accepts an empty batch without implying coverage from ticks", () => {
    expect(ok({ ticks: [] }).observations).toHaveLength(0);
  });
  it("accepts ask == bid", () => expect(reasons(raw({ ticks: [tick(1, 2000, 2000)] }))).toBe("VALID"));
  it("does not mutate input", () => {
    const r = raw(); const copy = JSON.parse(JSON.stringify(r));
    validateTickBatch(r, OPT); expect(r).toEqual(copy);
  });
  it("returns frozen output", () => expect(Object.isFrozen(ok().observations)).toBe(true));
});

describe("validateTickBatch — invalid data", () => {
  it.each([
    ["non-object", null, "NOT_AN_OBJECT"],
    ["array", [], "NOT_AN_OBJECT"],
    ["unknown metadata", raw({ broker: "x" }), "UNSUPPORTED_METADATA"],
    ["seq not accepted", raw({ ticks: [{ ...tick(1), seq: 0 }] }), "INVALID_TICK"],
    ["flags not accepted", raw({ ticks: [{ ...tick(1), flags: 6 }] }), "INVALID_TICK"],
    ["empty id", raw({ batchId: "" }), "INVALID_BATCH_ID"],
    ["bad id chars", raw({ batchId: "a b" }), "INVALID_BATCH_ID"],
    ["long id", raw({ batchId: "a".repeat(129) }), "INVALID_BATCH_ID"],
    ["live source", raw({ source: "mt5_live" }), "UNSUPPORTED_SOURCE"],
    ["symbol", raw({ symbol: "EURUSD" }), "UNSUPPORTED_SYMBOL"],
    ["symbol case", raw({ symbol: "xauusd" }), "UNSUPPORTED_SYMBOL"],
    ["string time", raw({ fromMsc: String(T0) }), "INVALID_TIMESTAMP"],
    ["fractional time", raw({ fromMsc: T0 + 0.5 }), "INVALID_TIMESTAMP"],
    ["negative time", raw({ fromMsc: -1 }), "INVALID_TIMESTAMP"],
    ["NaN time", raw({ toMsc: NaN }), "INVALID_TIMESTAMP"],
    ["inverted window", raw({ fromMsc: T0 + 10, toMsc: T0 }), "INVALID_WINDOW"],
    ["too long", raw({ toMsc: T0 + TICK_HISTORY_MAX_WINDOW_MS + 1, fetchedAtMsc: T0 + TICK_HISTORY_MAX_WINDOW_MS + 1 }), "WINDOW_TOO_LONG"],
    ["bad claim", raw({ coverageClaim: "complete" }), "INVALID_COVERAGE_CLAIM"],
    ["ticks not array", raw({ ticks: {} }), "INVALID_TICKS"],
    ["zero bid", raw({ ticks: [tick(1, 0, 1)] }), "INVALID_PRICE"],
    ["negative ask", raw({ ticks: [tick(1, 1, -1)] }), "INVALID_PRICE"],
    ["infinite", raw({ ticks: [tick(1, Infinity, Infinity)] }), "INVALID_PRICE"],
    ["string price", raw({ ticks: [{ timeMsc: T0 + 1, bid: "2000", ask: 2001 }] }), "INVALID_PRICE"],
    ["crossed", raw({ ticks: [tick(1, 2001, 2000)] }), "CROSSED_QUOTE"],
    ["tick before window", raw({ ticks: [tick(-1)] }), "TICK_OUTSIDE_WINDOW"],
    ["tick after window", raw({ ticks: [tick(60_001)] }), "TICK_OUTSIDE_WINDOW"],
    ["bad tick time", raw({ ticks: [{ timeMsc: 1.5, bid: 1, ask: 1 }] }), "INVALID_TIMESTAMP"],
  ])("rejects %s", (_n, r, reason) => expect(reasons(r)).toBe(reason));
  it("reports index of offending tick", () => {
    const v = validateTickBatch(raw({ ticks: [tick(1), tick(2, 5, 4)] }), OPT);
    expect(v.state === "REJECTED" && v.tickIndex).toBe(1);
  });
  it("rejects too many ticks", () => {
    const t = Array.from({ length: TICK_HISTORY_MAX_TICKS + 1 }, () => tick(1));
    expect(reasons(raw({ ticks: t }))).toBe("TOO_MANY_TICKS");
  });
  it.each([[null], [{}], [{ nowMsc: T0, clockMarginMs: -1 }], [{ nowMsc: T0, clockMarginMs: 60_001 }], [{ nowMsc: 1.2, clockMarginMs: 0 }]])(
    "rejects invalid options %#", (o) => expect(reasons(raw(), o)).toBe("INVALID_OPTIONS"));
});

describe("future evidence and fetch timing", () => {
  it("rejects window ending beyond now + margin", () =>
    expect(reasons(raw({ toMsc: OPT.nowMsc + 1_001, fetchedAtMsc: OPT.nowMsc }))).toBe("FUTURE_EVIDENCE"));
  it("rejects fetchedAt in the future", () => expect(reasons(raw({ fetchedAtMsc: OPT.nowMsc + 1_001 }))).toBe("FUTURE_EVIDENCE"));
  it("allows exactly now + margin", () => expect(reasons(raw({ fetchedAtMsc: OPT.nowMsc + 1_000 }))).toBe("VALID"));
  it("rejects a fetch made before the window ended", () =>
    expect(reasons(raw({ fetchedAtMsc: T0 + 58_999 }))).toBe("FETCHED_BEFORE_WINDOW_END"));
  it("allows fetch within clock margin of window end", () => expect(reasons(raw({ fetchedAtMsc: T0 + 59_000 }))).toBe("VALID"));
});

describe("ordering and same-millisecond handling", () => {
  it("sorts out-of-order input and flags it", () => {
    const b = ok({ ticks: [tick(30_000), tick(10_000)] });
    expect(b.observations.map((o) => o.timeMsc)).toEqual([T0 + 10_000, T0 + 30_000]);
    expect(b.inputWasOutOfOrder).toBe(true);
  });
  it("does not flag ordered input", () => expect(ok().inputWasOutOfOrder).toBe(false));
  it("reports same-ms multiples as unordered and keeps all of them", () => {
    const b = ok({ ticks: [tick(5, 2001, 2002), tick(5, 2000, 2001)] });
    expect(b.observations).toHaveLength(2);
    expect(b.unorderedMilliseconds).toEqual([T0 + 5]);
  });
  it("same-ms permutation yields identical digest (no invented order)", () => {
    const a = ok({ ticks: [tick(5, 2001, 2002), tick(5, 2000, 2001)] });
    const b = ok({ ticks: [tick(5, 2000, 2001), tick(5, 2001, 2002)] });
    expect(a.contentDigest).toBe(b.contentDigest);
  });
  it("keeps identical in-batch repeats as multiplicity", () => {
    const b = ok({ ticks: [tick(5), tick(5)] });
    expect(b.observations).toHaveLength(2);
  });
  it("counts boundary-ambiguous observations", () => {
    expect(ok({ ticks: [tick(0), tick(1_000), tick(30_000), tick(59_000), tick(60_000)] }).boundaryAmbiguousCount).toBe(4);
  });
});

describe("digest / upload identity", () => {
  it("is deterministic", () => expect(ok().contentDigest).toBe(ok().contentDigest));
  it("differs on price change", () => expect(ok().contentDigest).not.toBe(ok({ ticks: [tick(10_000, 2000.01)] }).contentDigest));
  it("differs on window change", () => expect(ok().contentDigest).not.toBe(ok({ toMsc: T0 + 59_999, fetchedAtMsc: T0 + 120_000 }).contentDigest));
  it("differs on claim change", () => expect(ok().contentDigest).not.toBe(ok({ coverageClaim: "partial" }).contentDigest));
  it("ignores batchId and fetchedAt (content only)", () =>
    expect(ok({ batchId: "x", fetchedAtMsc: T0 + 200_000 }).contentDigest).toBe(ok().contentDigest));
  it("fingerprint is 8 hex chars", () => expect(fingerprint("abc")).toMatch(/^[0-9a-f]{8}$/));
});

describe("mergeTickBatches — duplicates, replays, conflicts", () => {
  it("rejects invalid input", () => {
    expect(mergeTickBatches(null).state).toBe("REJECTED");
    expect(mergeTickBatches([{}]).rejectReason).toBe("INVALID_INPUT");
  });
  it("treats exact replay as idempotent", () => {
    const m = mergeTickBatches([ok(), ok()]);
    expect(m.state).toBe("MERGED");
    expect(m.acceptedBatchIds).toEqual(["b1"]);
    expect(m.replayedBatchIds).toEqual(["b1"]);
    expect(m.observations).toHaveLength(3);
  });
  it("rejects same batchId with different content", () => {
    expect(mergeTickBatches([ok(), ok({ ticks: [tick(1)] })]).rejectReason).toBe("BATCH_ID_CONFLICT");
  });
  it("dedupes identical overlapping batches with different ids", () => {
    const m = mergeTickBatches([ok(), ok({ batchId: "b2" })]);
    expect(m.observations).toHaveLength(3);
    expect(m.conflicts).toHaveLength(0);
  });
  it("is input-order independent", () => {
    const a = ok(), b = ok({ batchId: "b2", fromMsc: T0 + 30_000, toMsc: T0 + 90_000, fetchedAtMsc: T0 + 120_000, ticks: [tick(30_000), tick(70_000)] });
    expect(mergeTickBatches([a, b])).toEqual(mergeTickBatches([b, a]));
  });
  it("flags conflicting prices at same ms and excludes them", () => {
    const m = mergeTickBatches([ok(), ok({ batchId: "b2", ticks: [tick(10_000, 1999, 2000), tick(20_000, 2001, 2001.2), tick(30_000)] })]);
    expect(m.conflicts).toEqual([{ fromMsc: T0 + 10_000, toMsc: T0 + 10_000, batchIds: ["b1", "b2"] }]);
    expect(m.observations.some((o) => o.timeMsc === T0 + 10_000)).toBe(false);
  });
  it("flags a tick present in one overlapping batch but missing in the other", () => {
    const m = mergeTickBatches([ok(), ok({ batchId: "b2", ticks: [tick(10_000), tick(30_000)] })]);
    expect(m.conflicts.map((c) => c.fromMsc)).toEqual([T0 + 20_000]);
  });
  it("flags differing same-ms multiplicity", () => {
    const m = mergeTickBatches([ok({ ticks: [tick(5), tick(5)] }), ok({ batchId: "b2", ticks: [tick(5)] })]);
    expect(m.conflicts).toHaveLength(1);
  });
  it("does not compare outside the overlap", () => {
    const b2 = ok({ batchId: "b2", fromMsc: T0 + 60_001, toMsc: T0 + 90_000, fetchedAtMsc: T0 + 120_000, ticks: [tick(70_000)] });
    const m = mergeTickBatches([ok(), b2]);
    expect(m.conflicts).toHaveLength(0);
    expect(m.observations).toHaveLength(4);
  });
  it("maps claims to coverage statuses, never verified", () => {
    const m = mergeTickBatches([ok(), ok({ batchId: "b2", coverageClaim: "partial" }), ok({ batchId: "b3", coverageClaim: "unknown" })]);
    expect(m.coverage.map((c) => c.status)).toEqual(["claimed_unverified", "uncertain", "uncertain"]);
    expect(m.outcomeEligible).toBe(false);
  });
});

describe("assessCoverage", () => {
  const W = { fromMsc: T0 + 5_000, toMsc: T0 + 50_000 };
  it("returns CLAIMED_UNVERIFIED (never verified) for full claimed coverage", () => {
    const a = assessCoverage(mergeTickBatches([ok()]), W, OPT);
    expect(a.state).toBe("CLAIMED_UNVERIFIED");
    expect(a.outcomeEligible).toBe(false);
    expect(a.unvalidated).toBe(true);
  });
  it("does not infer coverage from ticks at window start and end", () => {
    const b = ok({ coverageClaim: "unknown", ticks: [tick(5_000), tick(50_000)] });
    expect(assessCoverage(mergeTickBatches([b]), W, OPT).state).toBe("UNCERTAIN");
    expect(assessCoverage(mergeTickBatches([]), W, OPT)).toMatchObject({ state: "INCOMPLETE", reason: "COVERAGE_GAP" });
  });
  it("requires margin beyond window edges", () => {
    const edge = { fromMsc: T0 + 500, toMsc: T0 + 50_000 };
    expect(assessCoverage(mergeTickBatches([ok()]), edge, OPT)).toMatchObject({ state: "INCOMPLETE", reason: "COVERAGE_GAP", firstGapMsc: T0 - 500 });
  });
  it("detects a gap between adjacent claimed spans", () => {
    const a = ok({ toMsc: T0 + 20_000, ticks: [] });
    const b = ok({ batchId: "b2", fromMsc: T0 + 20_002, ticks: [] });
    expect(assessCoverage(mergeTickBatches([a, b]), W, OPT)).toMatchObject({ reason: "COVERAGE_GAP", firstGapMsc: T0 + 20_001 });
  });
  it("accepts contiguous (+1 ms) spans", () => {
    const a = ok({ toMsc: T0 + 20_000, ticks: [] });
    const b = ok({ batchId: "b2", fromMsc: T0 + 20_001, ticks: [] });
    expect(assessCoverage(mergeTickBatches([a, b]), W, OPT).state).toBe("CLAIMED_UNVERIFIED");
  });
  it("partial window is INCOMPLETE", () => {
    const a = ok({ toMsc: T0 + 30_000, ticks: [] });
    expect(assessCoverage(mergeTickBatches([a]), W, OPT).state).toBe("INCOMPLETE");
  });
  it("not-yet-closed window is INCOMPLETE", () => {
    expect(assessCoverage(mergeTickBatches([ok()]), W, { nowMsc: T0 + 50_500, clockMarginMs: 1_000 }))
      .toMatchObject({ state: "INCOMPLETE", reason: "WINDOW_NOT_CLOSED" });
  });
  it("conflicts make coverage UNCERTAIN", () => {
    const m = mergeTickBatches([ok(), ok({ batchId: "b2", ticks: [tick(10_000, 1999, 2000)] })]);
    expect(assessCoverage(m, W, OPT)).toMatchObject({ state: "UNCERTAIN", reason: "CONFLICTING_EVIDENCE" });
  });
  it("conflicts outside the window do not affect it", () => {
    const m = mergeTickBatches([ok(), ok({ batchId: "b2", ticks: [tick(58_000)] , fromMsc: T0 + 55_000 })]);
    expect(assessCoverage(m, W, OPT).state).toBe("CLAIMED_UNVERIFIED");
  });
  it("overlapping uncertain span downgrades to UNCERTAIN", () => {
    const m = mergeTickBatches([ok(), ok({ batchId: "b2", coverageClaim: "partial", ticks: [] , toMsc: T0 + 20_000 })]);
    expect(m.conflicts.length).toBeGreaterThan(0);
    const m2 = mergeTickBatches([ok({ ticks: [] }), ok({ batchId: "b2", coverageClaim: "partial", ticks: [], toMsc: T0 + 20_000 })]);
    expect(assessCoverage(m2, W, OPT)).toMatchObject({ state: "UNCERTAIN", reason: "UNCERTAIN_SPAN" });
  });
  it("rejects invalid inputs", () => {
    expect(assessCoverage(null, W, OPT).state).toBe("REJECTED");
    expect(assessCoverage(mergeTickBatches(null), W, OPT).state).toBe("REJECTED");
    expect(assessCoverage(mergeTickBatches([]), { fromMsc: 5, toMsc: 1 }, OPT)).toMatchObject({ reason: "INVALID_WINDOW" });
    expect(assessCoverage(mergeTickBatches([]), W, {})).toMatchObject({ reason: "INVALID_INPUT" });
  });
});
