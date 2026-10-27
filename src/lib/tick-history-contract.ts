/** Phase 2B: pure, deterministic historical bid/ask tick EVIDENCE CONTRACT. Not wired to any caller.
 * No I/O, no clock reads, no input mutation, no storage. Everything here is UNVALIDATED:
 * passing validation never establishes provenance, completeness or outcome eligibility.
 *
 * Identity rules (kept separate on purpose):
 * - Observation identity is content-based: (timeMsc, bid, ask). MT5 (timeMsc, seq) is NOT treated as stable
 *   across repeated downloads, so `seq` is not accepted at all.
 * - Within one millisecond no ordering is invented: observations are a multiset, canonically sorted only
 *   for determinism, and every multi-quote millisecond is reported as unordered.
 * - Upload identity is (batchId, contentDigest). The digest is a deterministic FNV-1a fingerprint for
 *   replay detection only; it is NOT cryptographic and NOT proof of origin.
 * - Coverage comes ONLY from the batch's explicit declared window + coverage claim; ticks never imply coverage.
 * - Outcome eligibility is always false in this phase.
 */

export const TICK_HISTORY_SOURCE = "mt5_tick_history" as const;
export const TICK_HISTORY_SYMBOL = "XAUUSD" as const;
export const TICK_HISTORY_MAX_TICKS = 50_000;
export const TICK_HISTORY_MAX_WINDOW_MS = 24 * 60 * 60_000;
export const TICK_HISTORY_MAX_CLOCK_MARGIN_MS = 60_000;
export const TICK_HISTORY_MAX_BATCHES = 500;
const MAX_ID_LEN = 128;
const MAX_TIME = 8.64e15;

const BATCH_KEYS = new Set(["batchId", "source", "symbol", "fromMsc", "toMsc", "fetchedAtMsc", "coverageClaim", "ticks"]);
const TICK_KEYS = new Set(["timeMsc", "bid", "ask"]);

export type CoverageClaim = "complete_claimed" | "partial" | "unknown";

export interface TickObservation { timeMsc: number; bid: number; ask: number }

/** Normalized batch, suitable as an immutable storage record in a future phase. */
export interface ValidatedTickBatch {
  batchId: string;
  contentDigest: string;
  source: typeof TICK_HISTORY_SOURCE;
  symbol: typeof TICK_HISTORY_SYMBOL;
  /** Inclusive declared window, UTC epoch ms (UTC alignment of MT5 time_msc is an unverified assumption). */
  fromMsc: number;
  toMsc: number;
  fetchedAtMsc: number;
  coverageClaim: CoverageClaim;
  /** Sorted by timeMsc, then canonically by bid/ask; order within a millisecond carries no meaning. */
  observations: readonly TickObservation[];
  /** Milliseconds holding more than one observation (true order unknown). */
  unorderedMilliseconds: readonly number[];
  /** Input was not already non-decreasing in time (accepted, re-sorted). */
  inputWasOutOfOrder: boolean;
  /** Observations within clockMargin of a window edge (attribution ambiguous). */
  boundaryAmbiguousCount: number;
}

export type BatchRejectReason =
  | "INVALID_OPTIONS" | "NOT_AN_OBJECT" | "UNSUPPORTED_METADATA" | "INVALID_BATCH_ID" | "UNSUPPORTED_SOURCE"
  | "UNSUPPORTED_SYMBOL" | "INVALID_TIMESTAMP" | "INVALID_WINDOW" | "WINDOW_TOO_LONG" | "INVALID_COVERAGE_CLAIM"
  | "FUTURE_EVIDENCE" | "FETCHED_BEFORE_WINDOW_END" | "INVALID_TICKS" | "TOO_MANY_TICKS" | "INVALID_TICK"
  | "INVALID_PRICE" | "CROSSED_QUOTE" | "TICK_OUTSIDE_WINDOW";

type Common = { unvalidated: true; provenance: "NOT_ESTABLISHED"; outcomeEligible: false };
const common: Common = { unvalidated: true, provenance: "NOT_ESTABLISHED", outcomeEligible: false };

export type BatchValidation =
  | (Common & { state: "VALID"; batch: ValidatedTickBatch })
  | (Common & { state: "REJECTED"; reasons: BatchRejectReason[]; tickIndex?: number });

export interface ContractOptions {
  /** Caller-supplied current time, UTC epoch ms. */
  nowMsc: number;
  /** Assumed server-vs-MT5 clock tolerance; NOT a verified broker offset. */
  clockMarginMs: number;
}

const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const time = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= MAX_TIME;
const price = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

function validOptions(o: unknown): o is ContractOptions {
  return rec(o) && time(o["nowMsc"]) && typeof o["clockMarginMs"] === "number" && Number.isSafeInteger(o["clockMarginMs"])
    && o["clockMarginMs"] >= 0 && o["clockMarginMs"] <= TICK_HISTORY_MAX_CLOCK_MARGIN_MS;
}

/** Deterministic, non-cryptographic FNV-1a (32-bit) hex fingerprint. */
export function fingerprint(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

const cmpObs = (a: TickObservation, b: TickObservation) => a.timeMsc - b.timeMsc || a.bid - b.bid || a.ask - b.ask;
const obsKey = (o: TickObservation) => `${o.timeMsc}|${o.bid}|${o.ask}`;

export function validateTickBatch(raw: unknown, options: unknown): BatchValidation {
  const reject = (reasons: BatchRejectReason[], tickIndex?: number): BatchValidation =>
    tickIndex === undefined ? { ...common, state: "REJECTED", reasons } : { ...common, state: "REJECTED", reasons, tickIndex };
  if (!validOptions(options)) return reject(["INVALID_OPTIONS"]);
  if (!rec(raw)) return reject(["NOT_AN_OBJECT"]);
  if (Object.keys(raw).some((k) => !BATCH_KEYS.has(k))) return reject(["UNSUPPORTED_METADATA"]);
  const id = raw["batchId"];
  if (typeof id !== "string" || id.length < 1 || id.length > MAX_ID_LEN || !/^[A-Za-z0-9._:-]+$/.test(id)) return reject(["INVALID_BATCH_ID"]);
  if (raw["source"] !== TICK_HISTORY_SOURCE) return reject(["UNSUPPORTED_SOURCE"]);
  if (raw["symbol"] !== TICK_HISTORY_SYMBOL) return reject(["UNSUPPORTED_SYMBOL"]);
  const from = raw["fromMsc"], to = raw["toMsc"], fetched = raw["fetchedAtMsc"];
  if (!time(from) || !time(to) || !time(fetched)) return reject(["INVALID_TIMESTAMP"]);
  if (to < from) return reject(["INVALID_WINDOW"]);
  if (to - from > TICK_HISTORY_MAX_WINDOW_MS) return reject(["WINDOW_TOO_LONG"]);
  const claim = raw["coverageClaim"];
  if (claim !== "complete_claimed" && claim !== "partial" && claim !== "unknown") return reject(["INVALID_COVERAGE_CLAIM"]);
  const { nowMsc, clockMarginMs: margin } = options;
  if (to > nowMsc + margin || fetched > nowMsc + margin) return reject(["FUTURE_EVIDENCE"]);
  // A history fetch made before the window ended cannot describe the whole window.
  if (fetched + margin < to) return reject(["FETCHED_BEFORE_WINDOW_END"]);
  const ticks = raw["ticks"];
  if (!Array.isArray(ticks)) return reject(["INVALID_TICKS"]);
  if (ticks.length > TICK_HISTORY_MAX_TICKS) return reject(["TOO_MANY_TICKS"]);

  const obs: TickObservation[] = [];
  let outOfOrder = false;
  for (let i = 0; i < ticks.length; i++) {
    const t: unknown = ticks[i];
    if (!rec(t) || Object.keys(t).some((k) => !TICK_KEYS.has(k))) return reject(["INVALID_TICK"], i);
    if (!time(t["timeMsc"])) return reject(["INVALID_TIMESTAMP"], i);
    if (!price(t["bid"]) || !price(t["ask"])) return reject(["INVALID_PRICE"], i);
    if (t["ask"] < t["bid"]) return reject(["CROSSED_QUOTE"], i);
    if (t["timeMsc"] < from || t["timeMsc"] > to) return reject(["TICK_OUTSIDE_WINDOW"], i);
    const o: TickObservation = { timeMsc: t["timeMsc"], bid: t["bid"], ask: t["ask"] };
    const prev = obs[obs.length - 1];
    if (prev && o.timeMsc < prev.timeMsc) outOfOrder = true;
    obs.push(o);
  }
  obs.sort(cmpObs);
  const counts = new Map<number, number>();
  for (const o of obs) counts.set(o.timeMsc, (counts.get(o.timeMsc) ?? 0) + 1);
  const unordered = [...counts].filter(([, n]) => n > 1).map(([ms]) => ms);
  const boundary = obs.filter((o) => o.timeMsc - from <= margin || to - o.timeMsc <= margin).length;
  const canonical = [TICK_HISTORY_SOURCE, TICK_HISTORY_SYMBOL, from, to, claim, ...obs.map(obsKey)].join(";");
  return {
    ...common, state: "VALID",
    batch: Object.freeze({
      batchId: id, contentDigest: fingerprint(canonical), source: TICK_HISTORY_SOURCE, symbol: TICK_HISTORY_SYMBOL,
      fromMsc: from, toMsc: to, fetchedAtMsc: fetched, coverageClaim: claim,
      observations: Object.freeze(obs.map((o) => Object.freeze(o))), unorderedMilliseconds: Object.freeze(unordered),
      inputWasOutOfOrder: outOfOrder, boundaryAmbiguousCount: boundary,
    }),
  };
}

export interface ConflictRange { fromMsc: number; toMsc: number; batchIds: [string, string] }
export interface CoverageSpanRecord { fromMsc: number; toMsc: number; status: "claimed_unverified" | "uncertain"; batchId: string }

export interface MergedTickEvidence extends Common {
  state: "MERGED" | "REJECTED";
  rejectReason?: "INVALID_INPUT" | "TOO_MANY_BATCHES" | "BATCH_ID_CONFLICT";
  /** Distinct uploads after replay de-duplication (by batchId + digest). */
  acceptedBatchIds: string[];
  /** Exact replays (same batchId, same digest) — idempotent, ignored. */
  replayedBatchIds: string[];
  /** Union of observations; at each ms the largest agreeing multiset is kept. Conflicting ms are excluded. */
  observations: TickObservation[];
  coverage: CoverageSpanRecord[];
  conflicts: ConflictRange[];
}

/** Merge already-validated batches deterministically. Order of input does not change the result. */
export function mergeTickBatches(batches: unknown): MergedTickEvidence {
  const empty = { ...common, acceptedBatchIds: [], replayedBatchIds: [], observations: [], coverage: [], conflicts: [] };
  if (!Array.isArray(batches) || batches.some((b) => !rec(b) || typeof b["batchId"] !== "string" || typeof b["contentDigest"] !== "string" || !Array.isArray(b["observations"])))
    return { ...empty, state: "REJECTED", rejectReason: "INVALID_INPUT" };
  if (batches.length > TICK_HISTORY_MAX_BATCHES) return { ...empty, state: "REJECTED", rejectReason: "TOO_MANY_BATCHES" };
  const list = (batches as ValidatedTickBatch[]).slice().sort((a, b) =>
    a.batchId < b.batchId ? -1 : a.batchId > b.batchId ? 1 : a.contentDigest < b.contentDigest ? -1 : a.contentDigest > b.contentDigest ? 1 : 0);
  const byId = new Map<string, ValidatedTickBatch>();
  const replayed: string[] = [];
  for (const b of list) {
    const prev = byId.get(b.batchId);
    if (!prev) { byId.set(b.batchId, b); continue; }
    if (prev.contentDigest !== b.contentDigest) return { ...empty, state: "REJECTED", rejectReason: "BATCH_ID_CONFLICT" };
    replayed.push(b.batchId);
  }
  const accepted = [...byId.values()];

  // Per-batch multiset per ms.
  const msets = accepted.map((b) => {
    const m = new Map<number, string[]>();
    for (const o of b.observations) { const k = `${o.bid}|${o.ask}`; const a = m.get(o.timeMsc); if (a) a.push(k); else m.set(o.timeMsc, [k]); }
    for (const a of m.values()) a.sort();
    return m;
  });
  const conflicts: ConflictRange[] = [];
  const conflictMs = new Set<number>();
  for (let i = 0; i < accepted.length; i++) for (let j = i + 1; j < accepted.length; j++) {
    const a = accepted[i]!, b = accepted[j]!;
    const lo = Math.max(a.fromMsc, b.fromMsc), hi = Math.min(a.toMsc, b.toMsc);
    if (lo > hi) continue;
    const ms = new Set<number>();
    for (const m of [msets[i]!, msets[j]!]) for (const k of m.keys()) if (k >= lo && k <= hi) ms.add(k);
    const bad = [...ms].filter((t) => (msets[i]!.get(t) ?? []).join(",") !== (msets[j]!.get(t) ?? []).join(",")).sort((x, y) => x - y);
    for (const t of bad) { conflictMs.add(t); conflicts.push({ fromMsc: t, toMsc: t, batchIds: [a.batchId, b.batchId] }); }
  }
  const merged = new Map<number, string[]>();
  for (const m of msets) for (const [t, arr] of m) {
    if (conflictMs.has(t)) continue;
    const prev = merged.get(t);
    if (!prev || arr.length > prev.length) merged.set(t, arr);
  }
  const observations: TickObservation[] = [];
  for (const [t, arr] of merged) for (const k of arr) { const [bid, ask] = k.split("|").map(Number); observations.push({ timeMsc: t, bid: bid!, ask: ask! }); }
  observations.sort(cmpObs);
  const coverage: CoverageSpanRecord[] = accepted
    .map((b): CoverageSpanRecord => ({ fromMsc: b.fromMsc, toMsc: b.toMsc, status: b.coverageClaim === "complete_claimed" ? "claimed_unverified" : "uncertain", batchId: b.batchId }))
    .sort((x, y) => x.fromMsc - y.fromMsc || x.toMsc - y.toMsc || (x.batchId < y.batchId ? -1 : 1));
  conflicts.sort((x, y) => x.fromMsc - y.fromMsc || (x.batchIds.join() < y.batchIds.join() ? -1 : 1));
  return { ...common, state: "MERGED", acceptedBatchIds: accepted.map((b) => b.batchId), replayedBatchIds: replayed, observations, coverage, conflicts };
}

export type CoverageAssessment = Common & (
  | { state: "REJECTED"; reason: "INVALID_INPUT" | "INVALID_WINDOW" }
  | { state: "INCOMPLETE"; reason: "WINDOW_NOT_CLOSED" | "COVERAGE_GAP"; firstGapMsc?: number }
  | { state: "UNCERTAIN"; reason: "UNCERTAIN_SPAN" | "CONFLICTING_EVIDENCE" | "BOUNDARY_CLOCK_AMBIGUITY" }
  | { state: "CLAIMED_UNVERIFIED" });

/** Assess declared coverage for inclusive [fromMsc, toMsc]. Never returns a verified/complete state. */
export function assessCoverage(merged: unknown, window: unknown, options: unknown): CoverageAssessment {
  if (!validOptions(options) || !rec(merged) || merged["state"] !== "MERGED" || !Array.isArray(merged["coverage"]) || !Array.isArray(merged["conflicts"]))
    return { ...common, state: "REJECTED", reason: "INVALID_INPUT" };
  if (!rec(window) || !time(window["fromMsc"]) || !time(window["toMsc"]) || window["toMsc"] < window["fromMsc"])
    return { ...common, state: "REJECTED", reason: "INVALID_WINDOW" };
  const from = window["fromMsc"], to = window["toMsc"];
  const { nowMsc, clockMarginMs: margin } = options;
  if (to + margin > nowMsc) return { ...common, state: "INCOMPLETE", reason: "WINDOW_NOT_CLOSED" };
  const m = merged as unknown as MergedTickEvidence;
  // Window plus clock margin on both sides must be covered by explicit claims.
  const need = { from: Math.max(0, from - margin), to: to + margin };
  const claimed = m.coverage.filter((s) => s.status === "claimed_unverified").sort((a, b) => a.fromMsc - b.fromMsc);
  let cursor = need.from;
  for (const s of claimed) { if (s.fromMsc > cursor) break; cursor = Math.max(cursor, s.toMsc + 1); if (cursor > need.to) break; }
  if (cursor <= need.to) return { ...common, state: "INCOMPLETE", reason: "COVERAGE_GAP", firstGapMsc: cursor };
  const overlaps = (a: number, b: number) => a <= need.to && b >= need.from;
  if (m.conflicts.some((c) => overlaps(c.fromMsc, c.toMsc))) return { ...common, state: "UNCERTAIN", reason: "CONFLICTING_EVIDENCE" };
  if (m.coverage.some((s) => s.status === "uncertain" && overlaps(s.fromMsc, s.toMsc))) return { ...common, state: "UNCERTAIN", reason: "UNCERTAIN_SPAN" };
  // A claimed span boundary that falls inside the window ± margin is a seam whose clock alignment is unknown.
  const inner = (t: number) => t > need.from && t < need.to;
  if (claimed.some((s) => overlaps(s.fromMsc, s.toMsc) && (inner(s.fromMsc) && s.fromMsc - margin <= from || inner(s.toMsc) && s.toMsc + margin >= to)))
    return { ...common, state: "UNCERTAIN", reason: "BOUNDARY_CLOCK_AMBIGUITY" };
  return { ...common, state: "CLAIMED_UNVERIFIED" };
}
