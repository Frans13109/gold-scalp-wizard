/** Phase 3D: pure, deterministic HISTORICAL TICK INGEST DECISION module. Not wired to any caller.
 * No I/O, no clock reads, no input mutation, no storage, no crypto service.
 *
 * What this module is: an advisory classifier. Given an explicit caller-provided upload
 * (requestId + raw historical tick batch) and explicit caller-provided stored records, it decides
 * whether the upload is a new batch candidate, an identical retry, a conflict, or needs review.
 *
 * What this module is NOT:
 * - A decision is NOT proof of a committed database transaction; `storageCommitted` is always false.
 * - No durable acknowledgement is created; `acknowledged` is always false.
 * - Existing evidence is never overwritten and conflicting observations are never silently merged.
 * - Request ID and batch ID are SEPARATE identities: a request retry and a batch retry are distinct cases.
 * - Canonical identity comes from Phase 2D (includes fetchedAtMsc and exact float64 bits); Phase 2B's
 *   FNV-1a contentDigest is diagnostic only and is never used as the identity here.
 * - Nothing here infers MT5 provenance, completeness or clock accuracy.
 * - Everything stays UNVALIDATED, provenance NOT_ESTABLISHED, outcomeEligible false,
 *   finalizationEligible false. Errors carry reason codes only — never credentials, secrets or raw data.
 */
import {
  assessCoverage as _unusedAssessCoverage, // eslint-disable-line @typescript-eslint/no-unused-vars
  mergeTickBatches,
  validateTickBatch,
  type BatchRejectReason,
  type ConflictRange,
  type ContractOptions,
  type ValidatedTickBatch,
  TICK_HISTORY_MAX_BATCHES,
} from "./tick-history-contract";
import {
  buildCanonicalManifest,
  classifyRetry,
  type CanonicalManifest,
} from "./tick-evidence-manifest";

const MAX_ID_LEN = 128;
const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

type Common = {
  unvalidated: true;
  provenance: "NOT_ESTABLISHED";
  outcomeEligible: false;
  finalizationEligible: false;
  /** A decision never means anything was stored. */
  storageCommitted: false;
  /** No durable acknowledgement is created by this module. */
  acknowledged: false;
};
const common: Common = {
  unvalidated: true,
  provenance: "NOT_ESTABLISHED",
  outcomeEligible: false,
  finalizationEligible: false,
  storageCommitted: false,
  acknowledged: false,
};

export type IngestRejectReason =
  | "INVALID_OPTIONS"
  | "INVALID_INPUT"
  | "INVALID_STORED_RECORD"
  | "TOO_MANY_STORED"
  | "INVALID_REQUEST_ID"
  | "INVALID_BATCH";

export type IngestDecision = Common &
  (
    | { state: "NEW_BATCH_CANDIDATE"; requestId: string; batchId: string; overlap: "NONE" | "COMPATIBLE" }
    | { state: "IDENTICAL_REQUEST_RETRY"; requestId: string; batchId: string }
    | { state: "IDENTICAL_BATCH_NEW_REQUEST"; requestId: string; batchId: string }
    | { state: "REQUEST_ID_CONFLICT"; requestId: string }
    | { state: "BATCH_ID_CONFLICT"; requestId: string; batchId: string }
    | { state: "OVERLAP_REVIEW"; requestId: string; batchId: string; conflictRanges: ConflictRange[] }
    | { state: "REJECTED"; reason: IngestRejectReason; detail?: BatchRejectReason[] }
  );

/** Stored request record: the canonical content previously uploaded under a request ID. */
export interface StoredRequestRecord {
  requestId: string;
  /** Phase 2D canonical content string of the batch that request carried. */
  content: string;
}
/** Stored batch record: its Phase 2D manifest plus the Phase 2B validated batch (for overlap checks). */
export interface StoredBatchRecord {
  manifest: CanonicalManifest;
  batch: ValidatedTickBatch;
}
export interface IngestDecisionInput {
  upload: { requestId: string; batch: unknown };
  stored: { requests: StoredRequestRecord[]; batches: StoredBatchRecord[] };
  options: ContractOptions;
}

/** Own enumerable data properties with exactly `keys`; rejects getters without executing them. */
function ownData(v: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const own = Reflect.ownKeys(v);
  if (own.length !== keys.length || own.some((k) => typeof k !== "string" || !keys.includes(k))) return null;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !("value" in d)) return null;
    out[k] = d.value;
  }
  return out;
}

const validId = (v: unknown): v is string =>
  typeof v === "string" && v.length >= 1 && v.length <= MAX_ID_LEN && ID_PATTERN.test(v);

function readStoredRequest(v: unknown): StoredRequestRecord | null {
  const r = ownData(v, ["requestId", "content"]);
  if (!r || !validId(r["requestId"]) || typeof r["content"] !== "string") return null;
  return { requestId: r["requestId"], content: r["content"] };
}

function readStoredBatch(v: unknown): StoredBatchRecord | null {
  const r = ownData(v, ["manifest", "batch"]);
  if (!r) return null;
  const m = ownData(r["manifest"], ["version", "batchId", "content", "tickCount"]);
  if (!m || typeof m["batchId"] !== "string" || typeof m["content"] !== "string") return null;
  const b = r["batch"];
  if (typeof b !== "object" || b === null || Array.isArray(b)) return null;
  const obs = (b as Record<string, unknown>)["observations"];
  if (!Array.isArray(obs)) return null;
  return { manifest: r["manifest"] as CanonicalManifest, batch: b as ValidatedTickBatch };
}

/**
 * Classify one upload against stored records. Deterministic: the order of stored records
 * does not change the result. Never mutates input, never stores anything.
 */
export function decideTickIngest(input: unknown): IngestDecision {
  const reject = (reason: IngestRejectReason, detail?: BatchRejectReason[]): IngestDecision =>
    detail === undefined
      ? { ...common, state: "REJECTED", reason }
      : { ...common, state: "REJECTED", reason, detail };

  const top = ownData(input, ["upload", "stored", "options"]);
  if (!top) return reject("INVALID_INPUT");
  const upload = ownData(top["upload"], ["requestId", "batch"]);
  const stored = ownData(top["stored"], ["requests", "batches"]);
  if (!upload || !stored) return reject("INVALID_INPUT");
  if (!Array.isArray(stored["requests"]) || !Array.isArray(stored["batches"])) return reject("INVALID_INPUT");

  const requests: StoredRequestRecord[] = [];
  for (const r of stored["requests"]) {
    const rec = readStoredRequest(r);
    if (!rec) return reject("INVALID_STORED_RECORD");
    requests.push(rec);
  }
  const batches: StoredBatchRecord[] = [];
  for (const b of stored["batches"]) {
    const rec = readStoredBatch(b);
    if (!rec) return reject("INVALID_STORED_RECORD");
    batches.push(rec);
  }
  if (requests.length > TICK_HISTORY_MAX_BATCHES || batches.length > TICK_HISTORY_MAX_BATCHES)
    return reject("TOO_MANY_STORED");
  // Stored records must not contain duplicate identities; that would be ambiguous evidence.
  if (new Set(requests.map((r) => r.requestId)).size !== requests.length) return reject("INVALID_STORED_RECORD");
  if (new Set(batches.map((b) => b.manifest.batchId)).size !== batches.length) return reject("INVALID_STORED_RECORD");

  const requestId = upload["requestId"];
  if (!validId(requestId)) return reject("INVALID_REQUEST_ID");

  const validation = validateTickBatch(upload["batch"], top["options"]);
  if (validation.state !== "VALID") {
    if (validation.reasons.includes("INVALID_OPTIONS")) return reject("INVALID_OPTIONS");
    return reject("INVALID_BATCH", validation.reasons);
  }
  const manifestResult = buildCanonicalManifest(validation.batch);
  if (manifestResult.state !== "CANONICAL") return reject("INVALID_BATCH");
  const incoming = manifestResult.manifest;
  const batchId = incoming.batchId;

  // 1. Request identity: same request ID must carry the same canonical content.
  const priorRequest = requests.find((r) => r.requestId === requestId);
  if (priorRequest) {
    if (priorRequest.content === incoming.content)
      return { ...common, state: "IDENTICAL_REQUEST_RETRY", requestId, batchId };
    return { ...common, state: "REQUEST_ID_CONFLICT", requestId };
  }

  // 2. Batch identity: same batch ID must have identical canonical content (Phase 2D rules).
  const priorBatch = batches.find((b) => b.manifest.batchId === batchId);
  if (priorBatch) {
    const cls = classifyRetry(priorBatch.manifest, incoming);
    if (cls.state === "IDENTICAL_RETRY")
      return { ...common, state: "IDENTICAL_BATCH_NEW_REQUEST", requestId, batchId };
    // CONFLICT (or any non-identical classification) means the batch ID was re-used with changed content.
    return { ...common, state: "BATCH_ID_CONFLICT", requestId, batchId };
  }

  // 3. New batch ID: check window overlap against stored batches for conflicting observations.
  const overlapping = batches.filter(
    (b) => Math.max(b.batch.fromMsc, validation.batch.fromMsc) <= Math.min(b.batch.toMsc, validation.batch.toMsc),
  );
  if (overlapping.length === 0)
    return { ...common, state: "NEW_BATCH_CANDIDATE", requestId, batchId, overlap: "NONE" };

  const merged = mergeTickBatches([...overlapping.map((b) => b.batch), validation.batch]);
  if (merged.state === "REJECTED") return reject("INVALID_STORED_RECORD");
  if (merged.conflicts.length > 0)
    return { ...common, state: "OVERLAP_REVIEW", requestId, batchId, conflictRanges: merged.conflicts };
  return { ...common, state: "NEW_BATCH_CANDIDATE", requestId, batchId, overlap: "COMPATIBLE" };
}
