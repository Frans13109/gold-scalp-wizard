import { describe, expect, it } from "vitest";
import { validateTickBatch, type ValidatedTickBatch } from "@/lib/tick-history-contract";
import {
  buildCanonicalManifest, classifyBatchRetry, classifyRetry, encodeFloat64, encodeInt, CANONICAL_VERSION,
  type CanonicalManifest,
} from "@/lib/tick-evidence-manifest";

// Synthetic fixtures only.
const FROM = 1_700_000_000_000, TO = FROM + 60_000, FETCHED = TO + 1_000;
const OPT = { nowMsc: FETCHED + 10_000, clockMarginMs: 5_000 };
type T = { timeMsc: number; bid: number; ask: number };
const T1: T = { timeMsc: FROM + 10, bid: 2000.1, ask: 2000.3 };
const T2: T = { timeMsc: FROM + 20, bid: 2000.2, ask: 2000.4 };
const T3: T = { timeMsc: FROM + 20, bid: 2000.5, ask: 2000.6 };

function batch(over: Record<string, unknown> = {}, ticks: T[] = [T1, T2, T3]): ValidatedTickBatch {
  const r = validateTickBatch({ batchId: "b-1", source: "mt5_tick_history", symbol: "XAUUSD", fromMsc: FROM, toMsc: TO,
    fetchedAtMsc: FETCHED, coverageClaim: "complete_claimed", ticks, ...over }, OPT);
  if (r.state !== "VALID") throw new Error("fixture invalid: " + r.reasons.join());
  return r.batch;
}
function man(b: unknown): CanonicalManifest {
  const r = buildCanonicalManifest(b);
  if (r.state !== "CANONICAL") throw new Error("not canonical: " + r.reason);
  return r.manifest;
}
const tickLines = (m: CanonicalManifest) => m.content.split("\n").filter((l) => l.startsWith("tick="));

describe("canonical stability", () => {
  it("is independent of input tick order", () => {
    expect(man(batch({}, [T3, T1, T2])).content).toBe(man(batch({}, [T1, T2, T3])).content);
  });
  it("is stable across repeated builds", () => {
    const b = batch();
    expect(man(b).content).toBe(man(b).content);
  });
  it("does not mutate input", () => {
    const b = batch(); const before = JSON.stringify(b); man(b);
    expect(JSON.stringify(b)).toBe(before);
  });
  it("orders fields explicitly with header and version first", () => {
    const lines = man(batch()).content.split("\n");
    expect(lines.slice(0, 10)).toEqual([
      "GSW-TICK-EVIDENCE", "version=1", "source=16:mt5_tick_history", "symbol=6:XAUUSD", "batchId=3:b-1",
      `fromMsc=${FROM}`, `toMsc=${TO}`, `fetchedAtMsc=${FETCHED}`, "coverageClaim=16:complete_claimed", "tickCount=3",
    ]);
    expect(man(batch()).content.endsWith("\n")).toBe(true);
  });
});

describe("multiplicity and same-millisecond ambiguity", () => {
  it("preserves repeated identical observations", () => {
    const m = man(batch({}, [T1, T1, T1]));
    expect(m.tickCount).toBe(3);
    expect(tickLines(m)).toHaveLength(3);
    expect(new Set(tickLines(m)).size).toBe(1);
  });
  it("different multiplicity yields different content", () => {
    expect(man(batch({}, [T1, T1])).content).not.toBe(man(batch({}, [T1])).content);
  });
  it("keeps both same-ms observations with different prices, order-independent", () => {
    const a = man(batch({}, [T2, T3])), b = man(batch({}, [T3, T2]));
    expect(a.content).toBe(b.content);
    expect(tickLines(a)).toHaveLength(2);
    expect(tickLines(a).every((l) => l.startsWith(`tick=${FROM + 20},`))).toBe(true);
  });
});

describe("exact numeric encoding", () => {
  it("encodes prices as exact float64 bits", () => {
    expect(encodeFloat64(1)).toBe("3ff0000000000000");
    expect(encodeFloat64(0.1 + 0.2)).not.toBe(encodeFloat64(0.3));
    expect(encodeFloat64(2000.1)).toHaveLength(16);
  });
  it("encodes integers as plain decimal digits", () => {
    expect(encodeInt(1_700_000_000_000)).toBe("1700000000000");
    expect(encodeInt(0)).toBe("0");
    expect(() => encodeInt(-1)).toThrow();
    expect(() => encodeInt(1.5)).toThrow();
  });
  it("tick lines carry exact ms and bit-exact prices", () => {
    expect(tickLines(man(batch({}, [T1])))).toEqual([`tick=${FROM + 10},${encodeFloat64(2000.1)},${encodeFloat64(2000.3)}`]);
  });
  it("one-ulp price change changes content", () => {
    const bump = { ...T1, ask: 2000.3 + 2.2737367544323206e-13 };
    expect(bump.ask).not.toBe(T1.ask);
    expect(man(batch({}, [bump])).content).not.toBe(man(batch({}, [T1])).content);
  });
});

describe("fetchedAtMsc and immutable fields", () => {
  it("Phase 2B FNV digest ignores fetchedAtMsc but the manifest does not", () => {
    const a = batch(), b = batch({ fetchedAtMsc: FETCHED + 1 });
    expect(a.contentDigest).toBe(b.contentDigest);
    expect(man(a).content).not.toBe(man(b).content);
  });
  it("same batchId with changed fetchedAtMsc is CONFLICT, not retry", () => {
    expect(classifyBatchRetry(batch(), batch({ fetchedAtMsc: FETCHED + 1 })).state).toBe("CONFLICT");
  });
  it("new download with new batchId is DISTINCT_BATCH", () => {
    expect(classifyBatchRetry(batch(), batch({ batchId: "b-2", fetchedAtMsc: FETCHED + 1 })).state).toBe("DISTINCT_BATCH");
  });
  it.each([
    ["fromMsc", { fromMsc: FROM - 1 }],
    ["toMsc", { toMsc: TO + 1 }],
    ["coverageClaim", { coverageClaim: "partial" }],
  ])("changed %s → CONFLICT", (_n, over) => {
    expect(classifyBatchRetry(batch(), batch(over)).state).toBe("CONFLICT");
  });
  it("changed price → CONFLICT", () => {
    expect(classifyBatchRetry(batch(), batch({}, [T1, T2, { ...T3, bid: 2000.45 }])).state).toBe("CONFLICT");
  });
  it("missing tick → CONFLICT", () => {
    expect(classifyBatchRetry(batch(), batch({}, [T1, T2])).state).toBe("CONFLICT");
  });
});

describe("retry classification", () => {
  it("identical content, reordered ticks → IDENTICAL_RETRY", () => {
    expect(classifyBatchRetry(batch(), batch({}, [T3, T2, T1]))).toMatchObject({ state: "IDENTICAL_RETRY", batchId: "b-1" });
  });
  it("distinct batch IDs with identical observations → DISTINCT_BATCH (no merge, no coverage inference)", () => {
    const r = classifyBatchRetry(batch(), batch({ batchId: "b-2" }));
    expect(r).toMatchObject({ state: "DISTINCT_BATCH", batchIds: ["b-1", "b-2"] });
    expect(r).not.toHaveProperty("coverage");
  });
  it("classifyRetry on manifests matches", () => {
    expect(classifyRetry(man(batch()), man(batch())).state).toBe("IDENTICAL_RETRY");
  });
  it("tampered manifest content with same id → CONFLICT", () => {
    const m = man(batch());
    expect(classifyRetry(m, { ...m, content: m.content + "tick=1,0,0\n" }).state).toBe("CONFLICT");
  });
});

describe("invalid and unsupported inputs", () => {
  const base = () => ({ ...batch() }) as Record<string, unknown>;
  it.each([
    ["null", null, "NOT_AN_OBJECT"],
    ["array", [], "NOT_AN_OBJECT"],
    ["extra field", { ...batch(), seq: 1 }, "UNSUPPORTED_FIELDS"],
    ["bad source", { ...base(), source: "other" }, "UNSUPPORTED_SOURCE"],
    ["bad symbol", { ...base(), symbol: "EURUSD" }, "UNSUPPORTED_SYMBOL"],
    ["bad id", { ...base(), batchId: "a b" }, "INVALID_BATCH_ID"],
    ["fractional time", { ...base(), fromMsc: FROM + 0.5 }, "INVALID_TIMESTAMP"],
    ["reversed window", { ...base(), fromMsc: TO + 1 }, "INVALID_WINDOW"],
    ["bad claim", { ...base(), coverageClaim: "verified" }, "INVALID_COVERAGE_CLAIM"],
    ["ticks not array", { ...base(), observations: "x" }, "INVALID_OBSERVATIONS"],
  ])("%s → REJECTED", (_n, input, reason) => {
    expect(buildCanonicalManifest(input)).toMatchObject({ state: "REJECTED", reason });
  });
  it("rejects crossed, non-positive, NaN or extra-key ticks with index", () => {
    for (const t of [{ ...T1, ask: 1 }, { ...T1, bid: 0 }, { ...T1, bid: NaN }, { ...T1, seq: 5 }])
      expect(buildCanonicalManifest({ ...base(), observations: [T1, t] })).toMatchObject({ state: "REJECTED", tickIndex: 1 });
  });
  it("rejects ticks outside the window", () => {
    expect(buildCanonicalManifest({ ...base(), observations: [{ ...T1, timeMsc: TO + 1 }] })).toMatchObject({ reason: "TICK_OUTSIDE_WINDOW" });
  });
  it("rejects accessor fields without executing getters", () => {
    let called = false;
    const b = base(); delete b["symbol"];
    Object.defineProperty(b, "symbol", { enumerable: true, get() { called = true; return "XAUUSD"; } });
    expect(buildCanonicalManifest(b)).toMatchObject({ state: "REJECTED", reason: "ACCESSOR_FIELD" });
    expect(called).toBe(false);
  });
  it("classifyBatchRetry rejects when either side invalid", () => {
    expect(classifyBatchRetry(batch(), null)).toMatchObject({ state: "REJECTED", reason: "INVALID_MANIFEST" });
  });
  it("classifyRetry rejects malformed manifests", () => {
    const m = man(batch());
    expect(classifyRetry(m, { ...m, content: "garbage" })).toMatchObject({ state: "REJECTED", reason: "INVALID_MANIFEST" });
    expect(classifyRetry(m, { ...m, extra: 1 })).toMatchObject({ state: "REJECTED", reason: "INVALID_MANIFEST" });
  });
});

describe("version handling", () => {
  it("manifest carries version 1", () => {
    expect(CANONICAL_VERSION).toBe(1);
    expect(man(batch()).version).toBe(1);
  });
  it("unknown version → REJECTED UNSUPPORTED_VERSION", () => {
    const m = man(batch());
    expect(classifyRetry(m, { ...m, version: 2 })).toMatchObject({ state: "REJECTED", reason: "UNSUPPORTED_VERSION" });
    expect(classifyRetry({ ...m, version: 0 }, m)).toMatchObject({ state: "REJECTED", reason: "UNSUPPORTED_VERSION" });
  });
});

describe("no trust promotion", () => {
  it("every result is UNVALIDATED, provenance NOT_ESTABLISHED, not outcome-eligible", () => {
    const results = [buildCanonicalManifest(batch()), buildCanonicalManifest(null), classifyBatchRetry(batch(), batch()),
      classifyBatchRetry(batch(), batch({ batchId: "b-2" })), classifyBatchRetry(batch(), batch({ fetchedAtMsc: FETCHED + 1 }))];
    for (const r of results) expect(r).toMatchObject({ unvalidated: true, provenance: "NOT_ESTABLISHED", outcomeEligible: false });
  });
  it("coverage claim is recorded verbatim, never promoted to verified", () => {
    const c = man(batch()).content;
    expect(c).toContain("coverageClaim=16:complete_claimed");
    expect(c).not.toMatch(/verified/);
  });
});
