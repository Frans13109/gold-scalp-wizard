/** Phase 2D: pure, deterministic, VERSIONED canonical identity for historical XAUUSD bid/ask evidence batches.
 * Not wired to any caller. No I/O, no clock reads, no crypto service, no input mutation.
 *
 * - Input is a Phase 2B ValidatedTickBatch (src/lib/tick-history-contract.ts); it is re-checked structurally here.
 * - Output `content` is a canonical byte-stable string intended for a FUTURE SHA-256 digest. No digest is computed
 *   here; canonical content and any future digest are kept separate. A checksum never proves broker provenance.
 * - Phase 2B's `contentDigest` (FNV-1a) is diagnostic only, is NOT a secure identity, and EXCLUDES fetchedAtMsc.
 *   This manifest INCLUDES fetchedAtMsc: a changed fetch time is a different immutable download, so re-using a
 *   batchId with a different fetchedAtMsc is a CONFLICT. A genuinely new download needs a new batchId.
 * - Collector identity is not part of this content; future ingestion must assign it server-side and never trust a
 *   caller-provided collector label.
 * - Same-millisecond order is unknown: ticks form a multiset (multiplicity preserved), canonically sorted only.
 * - Everything stays UNVALIDATED, provenance NOT_ESTABLISHED, outcomeEligible false. Coverage is never promoted.
 */
import { TICK_HISTORY_MAX_TICKS, TICK_HISTORY_MAX_WINDOW_MS, TICK_HISTORY_SOURCE, TICK_HISTORY_SYMBOL } from "./tick-history-contract";

export const CANONICAL_VERSION = 1 as const;
export const CANONICAL_HEADER = "GSW-TICK-EVIDENCE";
const MAX_TIME = 8.64e15;
const BATCH_KEYS = ["batchId", "contentDigest", "source", "symbol", "fromMsc", "toMsc", "fetchedAtMsc", "coverageClaim",
  "observations", "unorderedMilliseconds", "inputWasOutOfOrder", "boundaryAmbiguousCount"];
const OBS_KEYS = ["timeMsc", "bid", "ask"];

type Common = { unvalidated: true; provenance: "NOT_ESTABLISHED"; outcomeEligible: false };
const common: Common = { unvalidated: true, provenance: "NOT_ESTABLISHED", outcomeEligible: false };

export interface CanonicalManifest {
  version: typeof CANONICAL_VERSION;
  batchId: string;
  /** Canonical text for a future SHA-256; not itself a digest and not proof of origin. */
  content: string;
  tickCount: number;
}

export type ManifestRejectReason =
  | "NOT_AN_OBJECT" | "UNSUPPORTED_FIELDS" | "ACCESSOR_FIELD" | "INVALID_BATCH_ID" | "UNSUPPORTED_SOURCE"
  | "UNSUPPORTED_SYMBOL" | "INVALID_TIMESTAMP" | "INVALID_WINDOW" | "INVALID_COVERAGE_CLAIM" | "INVALID_OBSERVATIONS"
  | "TOO_MANY_TICKS" | "INVALID_TICK" | "TICK_OUTSIDE_WINDOW" | "FETCHED_BEFORE_WINDOW_END" | "UNSUPPORTED_VERSION";

export type ManifestResult =
  | (Common & { state: "CANONICAL"; manifest: CanonicalManifest })
  | (Common & { state: "REJECTED"; reason: ManifestRejectReason; tickIndex?: number });

/** Read own enumerable data properties only; getters/inherited/extra keys are rejected (no getter execution). */
function ownData(v: unknown, keys: string[]): Record<string, unknown> | "NOT_AN_OBJECT" | "UNSUPPORTED_FIELDS" | "ACCESSOR_FIELD" {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "NOT_AN_OBJECT";
  const own = Reflect.ownKeys(v);
  if (own.length !== keys.length || own.some((k) => typeof k !== "string" || !keys.includes(k))) return "UNSUPPORTED_FIELDS";
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !("value" in d)) return "ACCESSOR_FIELD";
    out[k] = d.value;
  }
  return out;
}

const isTime = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX_TIME;
const isPrice = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Exact IEEE-754 binary64 big-endian bits as 16 lowercase hex chars — no locale, no rounding, no toString. */
export function encodeFloat64(n: number): string {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, n, false);
  let s = "";
  for (let i = 0; i < 8; i++) s += dv.getUint8(i).toString(16).padStart(2, "0");
  return s;
}
/** Safe non-negative integer as plain base-10 digits (no sign, no exponent, no separators). */
export function encodeInt(n: number): string {
  if (!isTime(n)) throw new RangeError("encodeInt: not a safe non-negative integer");
  return n.toFixed(0);
}
/** Length-prefixed ASCII string: `<len>:<value>`; prevents delimiter ambiguity. */
const encodeStr = (s: string) => `${s.length}:${s}`;

export function buildCanonicalManifest(batch: unknown): ManifestResult {
  const reject = (reason: ManifestRejectReason, tickIndex?: number): ManifestResult =>
    tickIndex === undefined ? { ...common, state: "REJECTED", reason } : { ...common, state: "REJECTED", reason, tickIndex };
  const b = ownData(batch, BATCH_KEYS);
  if (typeof b === "string") return reject(b);
  const id = b["batchId"];
  if (typeof id !== "string" || id.length < 1 || id.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(id)) return reject("INVALID_BATCH_ID");
  if (b["source"] !== TICK_HISTORY_SOURCE) return reject("UNSUPPORTED_SOURCE");
  if (b["symbol"] !== TICK_HISTORY_SYMBOL) return reject("UNSUPPORTED_SYMBOL");
  const from = b["fromMsc"], to = b["toMsc"], fetched = b["fetchedAtMsc"];
  if (!isTime(from) || !isTime(to) || !isTime(fetched)) return reject("INVALID_TIMESTAMP");
  if (to < from || to - from > TICK_HISTORY_MAX_WINDOW_MS) return reject("INVALID_WINDOW");
  // Without the original clock margin, only the strict ordering is re-checkable; Phase 2B enforced the margin.
  const claim = b["coverageClaim"];
  if (claim !== "complete_claimed" && claim !== "partial" && claim !== "unknown") return reject("INVALID_COVERAGE_CLAIM");
  const obs = b["observations"];
  if (!Array.isArray(obs)) return reject("INVALID_OBSERVATIONS");
  if (obs.length > TICK_HISTORY_MAX_TICKS) return reject("TOO_MANY_TICKS");
  const rows: { t: number; b: string; a: string }[] = [];
  for (let i = 0; i < obs.length; i++) {
    const d = Object.getOwnPropertyDescriptor(obs, i);
    if (!d || !("value" in d)) return reject("INVALID_TICK", i);
    const o = ownData(d.value, OBS_KEYS);
    if (typeof o === "string") return reject("INVALID_TICK", i);
    const t = o["timeMsc"], bid = o["bid"], ask = o["ask"];
    if (!isTime(t)) return reject("INVALID_TIMESTAMP", i);
    if (!isPrice(bid) || !isPrice(ask) || ask < bid) return reject("INVALID_TICK", i);
    if (t < from || t > to) return reject("TICK_OUTSIDE_WINDOW", i);
    rows.push({ t, b: encodeFloat64(bid), a: encodeFloat64(ask) });
  }
  // Canonical order only (time, then bid bits, then ask bits); carries no meaning within a millisecond.
  rows.sort((x, y) => x.t - y.t || (x.b < y.b ? -1 : x.b > y.b ? 1 : x.a < y.a ? -1 : x.a > y.a ? 1 : 0));
  const lines = [
    CANONICAL_HEADER,
    `version=${encodeInt(CANONICAL_VERSION)}`,
    `source=${encodeStr(TICK_HISTORY_SOURCE)}`,
    `symbol=${encodeStr(TICK_HISTORY_SYMBOL)}`,
    `batchId=${encodeStr(id)}`,
    `fromMsc=${encodeInt(from)}`,
    `toMsc=${encodeInt(to)}`,
    `fetchedAtMsc=${encodeInt(fetched)}`,
    `coverageClaim=${encodeStr(claim)}`,
    `tickCount=${encodeInt(rows.length)}`,
    ...rows.map((r) => `tick=${encodeInt(r.t)},${r.b},${r.a}`),
  ];
  const manifest: CanonicalManifest = Object.freeze({ version: CANONICAL_VERSION, batchId: id, content: lines.join("\n") + "\n", tickCount: rows.length });
  return { ...common, state: "CANONICAL", manifest };
}

export type RetryClassification = Common & (
  | { state: "IDENTICAL_RETRY"; batchId: string }
  | { state: "CONFLICT"; batchId: string }
  | { state: "DISTINCT_BATCH"; batchIds: [string, string] }
  | { state: "REJECTED"; reason: "INVALID_MANIFEST" | "UNSUPPORTED_VERSION" | "VERSION_MISMATCH" });

function readManifest(v: unknown): CanonicalManifest | "INVALID_MANIFEST" | "UNSUPPORTED_VERSION" {
  const m = ownData(v, ["version", "batchId", "content", "tickCount"]);
  if (typeof m === "string") return "INVALID_MANIFEST";
  if (typeof m["version"] !== "number" || !Number.isSafeInteger(m["version"])) return "INVALID_MANIFEST";
  if (m["version"] !== CANONICAL_VERSION) return "UNSUPPORTED_VERSION";
  const id = m["batchId"], c = m["content"], n = m["tickCount"];
  if (typeof id !== "string" || id.length < 1 || typeof c !== "string" || !isTime(n)) return "INVALID_MANIFEST";
  const head = `${CANONICAL_HEADER}\nversion=1\nsource=${encodeStr(TICK_HISTORY_SOURCE)}\nsymbol=${encodeStr(TICK_HISTORY_SYMBOL)}\nbatchId=${encodeStr(id)}\n`;
  if (!c.startsWith(head)) return "INVALID_MANIFEST";
  return { version: CANONICAL_VERSION, batchId: id, content: c, tickCount: n };
}

/** Classify a stored manifest vs an incoming one. Never merges, overwrites, or infers coverage continuity. */
export function classifyRetry(stored: unknown, incoming: unknown): RetryClassification {
  const a = readManifest(stored), b = readManifest(incoming);
  if (typeof a === "string" || typeof b === "string") {
    const r = a === "UNSUPPORTED_VERSION" || b === "UNSUPPORTED_VERSION" ? "UNSUPPORTED_VERSION" : "INVALID_MANIFEST";
    return { ...common, state: "REJECTED", reason: r };
  }
  if (a.version !== b.version) return { ...common, state: "REJECTED", reason: "VERSION_MISMATCH" };
  if (a.batchId !== b.batchId) return { ...common, state: "DISTINCT_BATCH", batchIds: [a.batchId, b.batchId] };
  if (a.content === b.content && a.tickCount === b.tickCount) return { ...common, state: "IDENTICAL_RETRY", batchId: a.batchId };
  return { ...common, state: "CONFLICT", batchId: a.batchId };
}

/** Convenience: canonicalise two validated batches and classify. Rejection of either input → REJECTED. */
export function classifyBatchRetry(stored: unknown, incoming: unknown): RetryClassification {
  const a = buildCanonicalManifest(stored), b = buildCanonicalManifest(incoming);
  if (a.state !== "CANONICAL" || b.state !== "CANONICAL") return { ...common, state: "REJECTED", reason: "INVALID_MANIFEST" };
  return classifyRetry(a.manifest, b.manifest);
}
