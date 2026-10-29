/** Phase 3D tests for src/lib/tick-ingest-decision.ts. WRITTEN BUT NOT RUN (awaiting separate approval).
 * Pure deterministic fixtures only: no database, no network, no clock reads, no live data.
 */
import { describe, expect, it } from "vitest";
import { decideTickIngest, type StoredBatchRecord, type StoredRequestRecord } from "@/lib/tick-ingest-decision";
import { validateTickBatch, type ContractOptions, type ValidatedTickBatch } from "@/lib/tick-history-contract";
import { buildCanonicalManifest, type CanonicalManifest } from "@/lib/tick-evidence-manifest";

const OPT: ContractOptions = { nowMsc: 2_000_000, clockMarginMs: 60_000 };
const FROM = 1_000_000;
const TO = 1_100_000;
const FETCHED = 1_150_000;

interface TickSpec { timeMsc: number; bid: number; ask: number }
const baseTicks: TickSpec[] = [
  { timeMsc: 1_000_000, bid: 2000.1, ask: 2000.3 },
  { timeMsc: 1_000_500, bid: 2000.2, ask: 2000.4 },
  { timeMsc: 1_050_000, bid: 2001.0, ask: 2001.2 },
  { timeMsc: 1_100_000, bid: 2001.5, ask: 2001.7 },
];

function rawBatch(batchId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    batchId,
    source: "mt5_tick_history",
    symbol: "XAUUSD",
    fromMsc: FROM,
    toMsc: TO,
    fetchedAtMsc: FETCHED,
    coverageClaim: "complete_claimed",
    ticks: baseTicks.map((t) => ({ ...t })),
    ...overrides,
  };
}

function validated(raw: unknown): ValidatedTickBatch {
  const v = validateTickBatch(raw, OPT);
  if (v.state !== "VALID") throw new Error("fixture batch must validate");
  return v.batch;
}

function manifestOf(batch: ValidatedTickBatch): CanonicalManifest {
  const m = buildCanonicalManifest(batch);
  if (m.state !== "CANONICAL") throw new Error("fixture batch must canonicalise");
  return m.manifest;
}

function storedBatch(raw: unknown): StoredBatchRecord {
  const batch = validated(raw);
  return { manifest: manifestOf(batch), batch };
}

function storedRequest(requestId: string, raw: unknown): StoredRequestRecord {
  return { requestId, content: manifestOf(validated(raw)).content };
}

function decide(
  requestId: string,
  raw: unknown,
  stored: { requests?: StoredRequestRecord[]; batches?: StoredBatchRecord[] } = {},
  options: ContractOptions = OPT,
) {
  return decideTickIngest({
    upload: { requestId, batch: raw },
    stored: { requests: stored.requests ?? [], batches: stored.batches ?? [] },
    options,
  });
}

const SAFETY = {
  unvalidated: true,
  provenance: "NOT_ESTABLISHED",
  outcomeEligible: false,
  finalizationEligible: false,
  storageCommitted: false,
  acknowledged: false,
} as const;

describe("new batch candidate", () => {
  it("no stored records → NEW_BATCH_CANDIDATE with overlap NONE", () => {
    const r = decide("req-1", rawBatch("batch-1"));
    expect(r).toMatchObject({ ...SAFETY, state: "NEW_BATCH_CANDIDATE", requestId: "req-1", batchId: "batch-1", overlap: "NONE" });
  });
  it("non-overlapping stored batch → overlap NONE", () => {
    const other = rawBatch("batch-0", { fromMsc: 500_000, toMsc: 900_000, fetchedAtMsc: 950_000 });
    const r = decide("req-1", rawBatch("batch-1"), { batches: [storedBatch(other)] });
    expect(r).toMatchObject({ state: "NEW_BATCH_CANDIDATE", overlap: "NONE" });
  });
});

describe("retries and identity separation", () => {
  it("identical request retry: same requestId + same content", () => {
    const raw = rawBatch("batch-1");
    const r = decide("req-1", raw, { requests: [storedRequest("req-1", rawBatch("batch-1"))] });
    expect(r).toMatchObject({ ...SAFETY, state: "IDENTICAL_REQUEST_RETRY", requestId: "req-1", batchId: "batch-1" });
  });
  it("identical batch with a new request ID → IDENTICAL_BATCH_NEW_REQUEST", () => {
    const r = decide("req-2", rawBatch("batch-1"), { batches: [storedBatch(rawBatch("batch-1"))] });
    expect(r).toMatchObject({ ...SAFETY, state: "IDENTICAL_BATCH_NEW_REQUEST", requestId: "req-2", batchId: "batch-1" });
  });
  it("request identity is checked before batch identity", () => {
    const raw = rawBatch("batch-1");
    const r = decide("req-1", raw, {
      requests: [storedRequest("req-1", rawBatch("batch-1"))],
      batches: [storedBatch(rawBatch("batch-1"))],
    });
    expect(r.state).toBe("IDENTICAL_REQUEST_RETRY");
  });
});

describe("conflicts", () => {
  it("same request ID with changed body → REQUEST_ID_CONFLICT", () => {
    const changed = rawBatch("batch-1", { ticks: [{ timeMsc: 1_000_000, bid: 2000.9, ask: 2001.1 }] });
    const r = decide("req-1", changed, { requests: [storedRequest("req-1", rawBatch("batch-1"))] });
    expect(r).toMatchObject({ ...SAFETY, state: "REQUEST_ID_CONFLICT", requestId: "req-1" });
  });
  it("same batch ID with changed canonical content → BATCH_ID_CONFLICT", () => {
    const changed = rawBatch("batch-1", { ticks: [...baseTicks, { timeMsc: 1_060_000, bid: 2002.0, ask: 2002.2 }] });
    const r = decide("req-2", changed, { batches: [storedBatch(rawBatch("batch-1"))] });
    expect(r).toMatchObject({ ...SAFETY, state: "BATCH_ID_CONFLICT", requestId: "req-2", batchId: "batch-1" });
  });
  it("changed fetchedAtMsc with same batch ID → BATCH_ID_CONFLICT", () => {
    const changed = rawBatch("batch-1", { fetchedAtMsc: FETCHED + 1_000 });
    const r = decide("req-2", changed, { batches: [storedBatch(rawBatch("batch-1"))] });
    expect(r).toMatchObject({ state: "BATCH_ID_CONFLICT", batchId: "batch-1" });
  });
  it("exact float64 identity: a bid differing only in the last bits → BATCH_ID_CONFLICT", () => {
    const ticks = baseTicks.map((t) => ({ ...t }));
    ticks[0] = { timeMsc: 1_000_000, bid: 2000.1000000000004, ask: 2000.3 };
    const r = decide("req-2", rawBatch("batch-1", { ticks }), { batches: [storedBatch(rawBatch("batch-1"))] });
    expect(r).toMatchObject({ state: "BATCH_ID_CONFLICT", batchId: "batch-1" });
  });
});

describe("overlapping batches", () => {
  it("overlapping compatible batches (identical multisets) → NEW_BATCH_CANDIDATE overlap COMPATIBLE", () => {
    const other = rawBatch("batch-0", { fromMsc: 1_050_000, toMsc: 1_200_000, fetchedAtMsc: 1_250_000, ticks: baseTicks.filter((t) => t.timeMsc >= 1_050_000) });
    const mine = rawBatch("batch-1", { fromMsc: FROM, toMsc: 1_100_000, ticks: baseTicks });
    const r = decide("req-1", mine, { batches: [storedBatch(other)] });
    expect(r).toMatchObject({ ...SAFETY, state: "NEW_BATCH_CANDIDATE", overlap: "COMPATIBLE" });
  });
  it("overlapping conflicting batches → OVERLAP_REVIEW with conflict ranges", () => {
    const other = rawBatch("batch-0", {
      ticks: [
        { timeMsc: 1_000_000, bid: 2000.1, ask: 2000.3 },
        { timeMsc: 1_000_500, bid: 2999.9, ask: 3000.1 }, // disagrees at 1_000_500
        { timeMsc: 1_050_000, bid: 2001.0, ask: 2001.2 },
        { timeMsc: 1_100_000, bid: 2001.5, ask: 2001.7 },
      ],
    });
    const r = decide("req-1", rawBatch("batch-1"), { batches: [storedBatch(other)] });
    expect(r).toMatchObject({ ...SAFETY, state: "OVERLAP_REVIEW", requestId: "req-1", batchId: "batch-1" });
    if (r.state === "OVERLAP_REVIEW") {
      expect(r.conflictRanges).toEqual([{ fromMsc: 1_000_500, toMsc: 1_000_500, batchIds: ["batch-0", "batch-1"] }]);
    }
  });
  it("same-millisecond repeated observations with identical multiplicity stay COMPATIBLE", () => {
    const dupTicks = [
      { timeMsc: 1_000_000, bid: 2000.1, ask: 2000.3 },
      { timeMsc: 1_000_000, bid: 2000.1, ask: 2000.3 },
      { timeMsc: 1_100_000, bid: 2001.5, ask: 2001.7 },
    ];
    const a = rawBatch("batch-0", { ticks: dupTicks });
    const b = rawBatch("batch-1", { ticks: dupTicks.map((t) => ({ ...t })) });
    const r = decide("req-1", b, { batches: [storedBatch(a)] });
    expect(r).toMatchObject({ state: "NEW_BATCH_CANDIDATE", overlap: "COMPATIBLE" });
  });
  it("same-millisecond multiplicity mismatch in overlap → OVERLAP_REVIEW", () => {
    const a = rawBatch("batch-0", {
      ticks: [
        { timeMsc: 1_000_000, bid: 2000.1, ask: 2000.3 },
        { timeMsc: 1_000_000, bid: 2000.1, ask: 2000.3 },
      ],
    });
    const b = rawBatch("batch-1", { ticks: [{ timeMsc: 1_000_000, bid: 2000.1, ask: 2000.3 }] });
    const r = decide("req-1", b, { batches: [storedBatch(a)] });
    expect(r.state).toBe("OVERLAP_REVIEW");
  });
});

describe("rejection of malformed input", () => {
  it("non-object input → INVALID_INPUT", () => {
    expect(decideTickIngest(null)).toMatchObject({ ...SAFETY, state: "REJECTED", reason: "INVALID_INPUT" });
    expect(decideTickIngest("x")).toMatchObject({ state: "REJECTED", reason: "INVALID_INPUT" });
  });
  it("missing requestId → INVALID_REQUEST_ID", () => {
    const r = decideTickIngest({ upload: { batch: rawBatch("b") }, stored: { requests: [], batches: [] }, options: OPT });
    // upload lacks requestId → shape mismatch
    expect(r).toMatchObject({ state: "REJECTED", reason: "INVALID_INPUT" });
  });
  it("malformed requestId characters → INVALID_REQUEST_ID", () => {
    expect(decide("req 1!", rawBatch("batch-1"))).toMatchObject({ state: "REJECTED", reason: "INVALID_REQUEST_ID" });
    expect(decide("", rawBatch("batch-1"))).toMatchObject({ state: "REJECTED", reason: "INVALID_REQUEST_ID" });
  });
  it("invalid batch → INVALID_BATCH with contract reason codes only", () => {
    const r = decide("req-1", rawBatch("batch-1", { symbol: "EURUSD" }));
    expect(r).toMatchObject({ state: "REJECTED", reason: "INVALID_BATCH", detail: ["UNSUPPORTED_SYMBOL"] });
  });
  it("invalid options → INVALID_OPTIONS", () => {
    const r = decide("req-1", rawBatch("batch-1"), {}, { nowMsc: -1, clockMarginMs: 0 });
    expect(r).toMatchObject({ state: "REJECTED", reason: "INVALID_OPTIONS" });
  });
  it("malformed stored request record → INVALID_STORED_RECORD", () => {
    const r = decide("req-1", rawBatch("batch-1"), { requests: [{ requestId: "req-9", content: 42 } as unknown as StoredRequestRecord] });
    expect(r).toMatchObject({ state: "REJECTED", reason: "INVALID_STORED_RECORD" });
  });
  it("duplicate stored batch IDs → INVALID_STORED_RECORD (ambiguous evidence)", () => {
    const s = storedBatch(rawBatch("batch-0"));
    const r = decide("req-1", rawBatch("batch-1"), { batches: [s, s] });
    expect(r).toMatchObject({ state: "REJECTED", reason: "INVALID_STORED_RECORD" });
  });
  it("getter on a stored record is rejected without execution", () => {
    let called = false;
    const rec = { requestId: "req-9" };
    Object.defineProperty(rec, "content", { get: () => { called = true; return "x"; }, enumerable: true });
    const r = decide("req-1", rawBatch("batch-1"), { requests: [rec as unknown as StoredRequestRecord] });
    expect(r).toMatchObject({ state: "REJECTED", reason: "INVALID_STORED_RECORD" });
    expect(called).toBe(false);
  });
});

describe("determinism and immutability", () => {
  it("same input → identical decision", () => {
    const mk = () => ({
      upload: { requestId: "req-1", batch: rawBatch("batch-1") },
      stored: { requests: [storedRequest("req-0", rawBatch("batch-0"))], batches: [storedBatch(rawBatch("batch-0"))] },
      options: OPT,
    });
    expect(decideTickIngest(mk())).toEqual(decideTickIngest(mk()));
  });
  it("stored record order does not change the decision", () => {
    const a = storedBatch(rawBatch("batch-a", { fromMsc: 500_000, toMsc: 900_000, fetchedAtMsc: 950_000 }));
    const b = storedBatch(rawBatch("batch-b", { fromMsc: 1_300_000, toMsc: 1_400_000, fetchedAtMsc: 1_450_000 }));
    const r1 = decide("req-1", rawBatch("batch-1"), { batches: [a, b] });
    const r2 = decide("req-1", rawBatch("batch-1"), { batches: [b, a] });
    expect(r1).toEqual(r2);
  });
  it("does not mutate its input", () => {
    const input = {
      upload: { requestId: "req-1", batch: rawBatch("batch-1") },
      stored: { requests: [], batches: [storedBatch(rawBatch("batch-0"))] },
      options: OPT,
    };
    const copy = JSON.parse(JSON.stringify(input));
    decideTickIngest(input);
    expect(input.upload.batch).toEqual(copy.upload.batch);
    expect(input.stored.batches[0]!.manifest.content).toBe(copy.stored.batches[0]!.manifest.content);
  });
});

describe("no fabricated acknowledgements or eligibility promotion", () => {
  it("every decision state carries the full safety labels", () => {
    const results = [
      decide("req-1", rawBatch("batch-1")),
      decide("req-1", rawBatch("batch-1"), { requests: [storedRequest("req-1", rawBatch("batch-1"))] }),
      decide("req-2", rawBatch("batch-1"), { batches: [storedBatch(rawBatch("batch-1"))] }),
      decide("req-1", rawBatch("batch-1", { symbol: "EURUSD" })),
      decideTickIngest(null),
    ];
    for (const r of results) expect(r).toMatchObject(SAFETY);
  });
  it("no decision claims storage, acknowledgement or commitment", () => {
    const r = decide("req-1", rawBatch("batch-1"));
    expect(r.storageCommitted).toBe(false);
    expect(r.acknowledged).toBe(false);
    for (const k of ["stored", "committed", "ack", "acknowledgement", "transactionId"]) expect(r).not.toHaveProperty(k);
  });
  it("a candidate decision is not an evaluation and not outcome eligible", () => {
    const r = decide("req-1", rawBatch("batch-1"));
    expect(r.state).toBe("NEW_BATCH_CANDIDATE");
    expect(r.outcomeEligible).toBe(false);
    expect(r.finalizationEligible).toBe(false);
    for (const k of ["outcome", "exit_price", "result_r", "profit", "fill", "win", "loss", "finalizedAt"]) expect(r).not.toHaveProperty(k);
  });
  it("rejections carry reason codes only — no raw batch content", () => {
    const r = decide("req-1", rawBatch("batch-1", { symbol: "EURUSD" }));
    const s = JSON.stringify(r);
    expect(s).not.toContain("2000.1");
    expect(s).not.toContain("EURUSD");
  });
});
