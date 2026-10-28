/** Phase 3A: pure outcome integration contract. Isolated research code — NO production caller.
 * No I/O, clock reads, storage or input mutation. Reuses Phase 2A (mapper), 2B (batch contract)
 * and 2D (canonical manifest) unchanged.
 *
 * The Phase 1 tick evaluator is deliberately NOT called: it needs MT5 `seq` values and "ok" coverage,
 * and feeding it would require fabricating sequence numbers and upgrading CLAIMED_UNVERIFIED coverage.
 * Instead this contract scans the merged multiset itself, never orders same-millisecond ticks,
 * and reports simultaneous TP1+SL as AMBIGUOUS (not SL-first).
 *
 * Results are observations of historical quotes only: BUY observed on bid, SELL observed on ask.
 * Never broker fills, executions, profits, R values, win rates or verified outcomes.
 * A signal reaching its expiry time is NOT an observed outcome; "NO_LEVEL_OBSERVED" only says
 * no TP1/SL quote was seen in claimed-unverified coverage.
 */
import { mapSavedSignalToTickInput, type SignalOutcomeInputFailureReason } from "./signal-outcome-input";
import {
  assessCoverage, mergeTickBatches, validateTickBatch, TICK_HISTORY_MAX_BATCHES, TICK_HISTORY_MAX_CLOCK_MARGIN_MS,
  type BatchRejectReason, type TickObservation,
} from "./tick-history-contract";
import { buildCanonicalManifest } from "./tick-evidence-manifest";
import { TICK_MAX_QUIET_MS } from "./signal-outcomes-tick";

export const OUTCOME_CONTRACT_VERSION = 1 as const;

type Common = {
  contractVersion: typeof OUTCOME_CONTRACT_VERSION;
  unvalidated: true;
  provenance: "NOT_ESTABLISHED";
  coverage: "NOT_VERIFIED";
  finalizationEligible: false;
  productionEligible: false;
};
const common: Common = {
  contractVersion: OUTCOME_CONTRACT_VERSION, unvalidated: true, provenance: "NOT_ESTABLISHED",
  coverage: "NOT_VERIFIED", finalizationEligible: false, productionEligible: false,
};

export type OutcomeContractRejectReason =
  | "INVALID_OPTIONS" | "INVALID_SIGNAL" | "INVALID_EVIDENCE_INPUT" | "TOO_MANY_BATCHES"
  | "INVALID_BATCH" | "NON_CANONICAL_BATCH" | "BATCH_ID_CONFLICT" | "INVALID_COVERAGE_WINDOW";
export type OutcomeContractIncompleteReason = "WINDOW_NOT_CLOSED" | "COVERAGE_GAP" | "NO_EVIDENCE";
export type OutcomeContractUncertainReason = "CONFLICTING_EVIDENCE" | "UNCERTAIN_SPAN" | "CLOCK_AMBIGUITY" | "QUIET_GAP";
export type QuoteObservation = "TP1_QUOTE_OBSERVED" | "SL_QUOTE_OBSERVED" | "NO_LEVEL_OBSERVED";

export type OutcomeContractResult = Common & (
  | { state: "REJECTED"; reason: OutcomeContractRejectReason; signalReason?: SignalOutcomeInputFailureReason;
      batchReason?: BatchRejectReason; batchIndex?: number }
  | { state: "INCOMPLETE"; reason: OutcomeContractIncompleteReason }
  | { state: "UNCERTAIN"; reason: OutcomeContractUncertainReason; atMsc?: number }
  | { state: "AMBIGUOUS"; reason: "SAME_MS_TP1_SL"; atMsc: number }
  | { state: "CANDIDATE_OBSERVATION"; observation: QuoteObservation; quoteSide: "bid" | "ask";
      atMsc: number | null; observedQuote: number | null; signalId: string }
);

export interface OutcomeContractOptions {
  /** Caller-supplied evaluation time (UTC epoch ms). */
  nowMsc: number;
  /** Assumed clock tolerance — not a measured broker offset. */
  clockMarginMs: number;
  /** Longest tick-free spell still treated as observed. */
  maxQuietMs: number;
}

const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= lo && v <= hi;

/** Evaluate one saved signal against caller-provided raw historical batches. Deterministic, fail-closed. */
export function evaluateOutcomeContract(savedSignal: unknown, rawBatches: unknown, options: unknown): OutcomeContractResult {
  const r = (x: Record<string, unknown>) => ({ ...common, ...x }) as OutcomeContractResult;

  if (!rec(options) || Object.keys(options).length !== 3 || !int(options["nowMsc"], 0, 8.64e15)
    || !int(options["clockMarginMs"], 0, TICK_HISTORY_MAX_CLOCK_MARGIN_MS)
    || !int(options["maxQuietMs"], 1, TICK_MAX_QUIET_MS)) return r({ state: "REJECTED", reason: "INVALID_OPTIONS" });
  const now = options["nowMsc"], margin = options["clockMarginMs"], maxQuiet = options["maxQuietMs"];

  // 1. Saved signal → exact representable input (Phase 2A). Precision is never truncated.
  const mapped = mapSavedSignalToTickInput(savedSignal);
  if (mapped.state !== "MAPPED") return r({ state: "REJECTED", reason: "INVALID_SIGNAL", signalReason: mapped.reason });
  const s = mapped.signal;
  if (now < s.createdAt) return r({ state: "REJECTED", reason: "INVALID_SIGNAL" });

  // 2. Each batch validated (Phase 2B) and canonicalisable (Phase 2D).
  if (!Array.isArray(rawBatches)) return r({ state: "REJECTED", reason: "INVALID_EVIDENCE_INPUT" });
  if (rawBatches.length > TICK_HISTORY_MAX_BATCHES) return r({ state: "REJECTED", reason: "TOO_MANY_BATCHES" });
  if (rawBatches.length === 0) return r({ state: "INCOMPLETE", reason: "NO_EVIDENCE" });
  const batches = [];
  for (let i = 0; i < rawBatches.length; i++) {
    const v = validateTickBatch(rawBatches[i], { nowMsc: now, clockMarginMs: margin });
    if (v.state !== "VALID") return r({ state: "REJECTED", reason: "INVALID_BATCH", batchReason: v.reasons[0], batchIndex: i });
    if (buildCanonicalManifest(v.batch).state !== "CANONICAL")
      return r({ state: "REJECTED", reason: "NON_CANONICAL_BATCH", batchIndex: i });
    batches.push(v.batch);
  }

  // 3. Merge (conflicting ms excluded, recorded) and assess claimed coverage over [createdAt, expiresAt - 1].
  const merged = mergeTickBatches(batches);
  if (merged.state !== "MERGED")
    return r({ state: "REJECTED", reason: merged.rejectReason === "BATCH_ID_CONFLICT" ? "BATCH_ID_CONFLICT" : "INVALID_EVIDENCE_INPUT" });
  const lastMs = s.expiresAt - 1;
  const cov = assessCoverage(merged, { fromMsc: s.createdAt, toMsc: lastMs }, { nowMsc: now, clockMarginMs: margin });
  if (cov.state === "REJECTED") return r({ state: "REJECTED", reason: "INVALID_COVERAGE_WINDOW" });
  if (cov.state === "INCOMPLETE") return r({ state: "INCOMPLETE", reason: cov.reason });
  if (cov.state === "UNCERTAIN") return r({ state: "UNCERTAIN", reason: cov.reason });
  // cov.state === "CLAIMED_UNVERIFIED": still never VERIFIED.

  // 4. Scan the multiset grouped by millisecond. No order is inferred within a millisecond.
  const buy = s.side === "BUY";
  const quoteSide = buy ? "bid" : "ask";
  const quote = (t: TickObservation) => (buy ? t.bid : t.ask);
  const stopHit = (t: TickObservation) => (buy ? quote(t) <= s.stopLoss : quote(t) >= s.stopLoss);
  const targetHit = (t: TickObservation) => (buy ? quote(t) >= s.takeProfit1 : quote(t) <= s.takeProfit1);
  const nearEdge = (ms: number) => Math.abs(ms - s.createdAt) <= margin || Math.abs(ms - s.expiresAt) <= margin;
  const inWindow = merged.observations.filter((t) => t.timeMsc >= s.createdAt && t.timeMsc <= lastMs)
    .slice().sort((a, b) => a.timeMsc - b.timeMsc);

  let last = s.createdAt;
  let i = 0;
  while (i < inWindow.length) {
    const ms = inWindow[i]!.timeMsc;
    if (ms - last > maxQuiet) return r({ state: "UNCERTAIN", reason: "QUIET_GAP", atMsc: ms });
    const group: TickObservation[] = [];
    while (i < inWindow.length && inWindow[i]!.timeMsc === ms) { group.push(inWindow[i]!); i++; }
    const stops = group.filter(stopHit), targets = group.filter(targetHit);
    if (stops.length || targets.length) {
      if (nearEdge(ms)) return r({ state: "UNCERTAIN", reason: "CLOCK_AMBIGUITY", atMsc: ms });
      if (stops.length && targets.length) return r({ state: "AMBIGUOUS", reason: "SAME_MS_TP1_SL", atMsc: ms });
      const hits = stops.length ? stops : targets;
      // Report the first-listed level quote observed; no fill price is implied.
      const observedQuote = quote(hits[0]!);
      return r({ state: "CANDIDATE_OBSERVATION", observation: stops.length ? "SL_QUOTE_OBSERVED" : "TP1_QUOTE_OBSERVED",
        quoteSide, atMsc: ms, observedQuote, signalId: mapped.signalId });
    }
    last = ms;
  }
  if (lastMs - last > maxQuiet) return r({ state: "UNCERTAIN", reason: "QUIET_GAP" });
  return r({ state: "CANDIDATE_OBSERVATION", observation: "NO_LEVEL_OBSERVED", quoteSide, atMsc: null,
    observedQuote: null, signalId: mapped.signalId });
}
