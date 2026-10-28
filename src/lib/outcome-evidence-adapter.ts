/** Phase 3C: pure historical evidence adapter. Isolated research code — NO production caller.
 * Converts caller-supplied stored rows (one saved signal, batch header rows, observation rows) into the
 * exact inputs of the Phase 3A evaluateOutcomeContract(savedSignal, rawBatches, options).
 * No I/O, clock reads, storage, or input mutation; getters are never executed.
 *
 * It never invents sequence numbers or tick order: observation_ordinal is only a storage address.
 * Identical repeated and same-millisecond ticks are all preserved. Values that cannot be converted to
 * JS numbers exactly are rejected, never rounded. Nothing here is verified provenance, coverage or an outcome.
 */
import { mapSavedSignalToTickInput, type SignalOutcomeInputFailureReason } from "./signal-outcome-input";
import { TICK_HISTORY_MAX_BATCHES, TICK_HISTORY_MAX_TICKS, TICK_HISTORY_SOURCE, TICK_HISTORY_SYMBOL } from "./tick-history-contract";
import { CANONICAL_VERSION } from "./tick-evidence-manifest";

export const EVIDENCE_ADAPTER_VERSION = 1 as const;

type Common = {
  adapterVersion: typeof EVIDENCE_ADAPTER_VERSION;
  unvalidated: true;
  provenance: "NOT_ESTABLISHED";
  coverage: "NOT_VERIFIED";
  finalizationEligible: false;
  productionEligible: false;
};
const common: Common = {
  adapterVersion: EVIDENCE_ADAPTER_VERSION, unvalidated: true, provenance: "NOT_ESTABLISHED",
  coverage: "NOT_VERIFIED", finalizationEligible: false, productionEligible: false,
};

export type EvidenceAdapterRejectReason =
  | "INVALID_INPUT" | "INVALID_SIGNAL_ROW" | "INVALID_SIGNAL" | "INVALID_BATCH_ROWS" | "TOO_MANY_BATCHES"
  | "INVALID_BATCH_ROW" | "DUPLICATE_BATCH_PK" | "DUPLICATE_BATCH_ID" | "UNSUPPORTED_CANONICAL_VERSION"
  | "INVALID_OBSERVATION_ROWS" | "INVALID_OBSERVATION_ROW" | "UNKNOWN_BATCH" | "DUPLICATE_ORDINAL"
  | "MISSING_ORDINAL" | "TICK_COUNT_MISMATCH" | "TOO_MANY_TICKS" | "INVALID_PRICE" | "PRECISION_LOSS"
  | "INVALID_INTEGER" | "INVALID_BATCH_WINDOW" | "CROSSED_QUOTE" | "TICK_OUTSIDE_WINDOW";

/** Exactly the batch shape Phase 2B validateTickBatch accepts. */
export interface AdaptedRawBatch {
  batchId: string; source: typeof TICK_HISTORY_SOURCE; symbol: typeof TICK_HISTORY_SYMBOL;
  fromMsc: number; toMsc: number; fetchedAtMsc: number;
  coverageClaim: "complete_claimed" | "partial" | "unknown";
  ticks: { timeMsc: number; bid: number; ask: number }[];
}
export interface AdaptedSignalRow {
  id: string; symbol: string; side: string; timeframe: string; entry: number; stop_loss: number;
  take_profit_1: number; created_at: string; expires_at: string; entry_reference: string;
  strategy_version: string; source_candle_time: string; entry_low: number | null; entry_high: number | null;
}

export type EvidenceAdapterResult = Common & (
  | { state: "REJECTED"; reason: EvidenceAdapterRejectReason; signalReason?: SignalOutcomeInputFailureReason;
      field?: string; batchIndex?: number; observationIndex?: number }
  | { state: "ADAPTED"; savedSignal: AdaptedSignalRow; rawBatches: AdaptedRawBatch[]; batchCount: number; tickCount: number }
);

const SIGNAL_KEYS = ["id", "symbol", "side", "timeframe", "entry", "stop_loss", "take_profit_1", "created_at",
  "expires_at", "entry_reference", "strategy_version", "source_candle_time", "entry_low", "entry_high"] as const;
const SIGNAL_PRICES = new Set(["entry", "stop_loss", "take_profit_1", "entry_low", "entry_high"]);
const INPUT_KEYS = ["signal", "batches", "observations"] as const;
const BATCH_KEYS = ["batch_pk", "batch_id", "source", "symbol", "from_msc", "to_msc", "fetched_at_msc",
  "coverage_claim", "tick_count", "canonical_version"] as const;
const OBS_KEYS = ["batch_pk", "observation_ordinal", "time_msc", "bid", "ask"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Own enumerable data properties with exactly `keys`; null on getters, extras, missing keys or non-plain objects. */
function exact(v: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return null;
  const own = Reflect.ownKeys(v);
  if (own.length !== keys.length) return null;
  const out: Record<string, unknown> = Object.create(null);
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d || !("value" in d) || !d.enumerable) return null;
    out[k] = d.value;
  }
  return out;
}
/** Own data elements of a dense array; null on getters/holes/extra props. */
function items(v: unknown): unknown[] | null {
  if (!Array.isArray(v)) return null;
  const out: unknown[] = [];
  for (let i = 0; i < v.length; i++) {
    const d = Object.getOwnPropertyDescriptor(v, i);
    if (!d || !("value" in d)) return null;
    out.push(d.value);
  }
  return Reflect.ownKeys(v).length === v.length + 1 ? out : null;
}

type Conv = { ok: true; value: number } | { ok: false; reason: "INVALID_PRICE" | "PRECISION_LOSS" | "INVALID_INTEGER" };
/** Price as a finite positive JS number, or a plain decimal string equal to that number's shortest round-trip form. */
export function toExactPrice(v: unknown): Conv {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? { ok: true, value: v } : { ok: false, reason: "INVALID_PRICE" };
  if (typeof v !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(v)) return { ok: false, reason: "INVALID_PRICE" };
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: "INVALID_PRICE" };
  // Trailing zeros, excess digits or exponent forms are not exact-and-unique: fail closed.
  return String(n) === v ? { ok: true, value: n } : { ok: false, reason: "PRECISION_LOSS" };
}
/** Non-negative safe integer from a number or a canonical base-10 string (bigint columns). */
export function toExactInt(v: unknown): Conv {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? { ok: true, value: v } : { ok: false, reason: "INVALID_INTEGER" };
  if (typeof v !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(v)) return { ok: false, reason: "INVALID_INTEGER" };
  const n = Number(v);
  return Number.isSafeInteger(n) && String(n) === v ? { ok: true, value: n } : { ok: false, reason: "PRECISION_LOSS" };
}

/** Adapt stored rows into Phase 3A inputs. Deterministic and fail-closed; ADAPTED is not evaluation or verification. */
export function adaptStoredEvidence(input: unknown): EvidenceAdapterResult {
  const rej = (reason: EvidenceAdapterRejectReason, x: Record<string, unknown> = {}) =>
    ({ ...common, state: "REJECTED", reason, ...x }) as EvidenceAdapterResult;

  const top = exact(input, INPUT_KEYS);
  if (!top) return rej("INVALID_INPUT");

  // 1. Signal row: exact field set; prices converted exactly; timestamps passed through untouched.
  const sr = exact(top["signal"], SIGNAL_KEYS);
  if (!sr) return rej("INVALID_SIGNAL_ROW");
  const sig: Record<string, unknown> = {};
  for (const k of SIGNAL_KEYS) {
    const v = sr[k];
    if (SIGNAL_PRICES.has(k) && v !== null) {
      const c = toExactPrice(v);
      if (!c.ok) return rej(c.reason === "PRECISION_LOSS" ? "PRECISION_LOSS" : "INVALID_SIGNAL", { field: k });
      sig[k] = c.value;
    } else sig[k] = v;
  }
  const mapped = mapSavedSignalToTickInput(sig);
  if (mapped.state !== "MAPPED") return rej("INVALID_SIGNAL", { signalReason: mapped.reason });

  // 2. Batch header rows.
  const brs = items(top["batches"]);
  if (!brs) return rej("INVALID_BATCH_ROWS");
  if (brs.length > TICK_HISTORY_MAX_BATCHES) return rej("TOO_MANY_BATCHES");
  type B = { header: Omit<AdaptedRawBatch, "ticks">; count: number; slots: ({ timeMsc: number; bid: number; ask: number } | undefined)[] };
  const byPk = new Map<string, B>();
  const ids = new Set<string>();
  const order: B[] = [];
  for (let i = 0; i < brs.length; i++) {
    const b = exact(brs[i], BATCH_KEYS);
    if (!b) return rej("INVALID_BATCH_ROW", { batchIndex: i });
    const pk = b["batch_pk"], id = b["batch_id"];
    if (typeof pk !== "string" || !UUID.test(pk)) return rej("INVALID_BATCH_ROW", { batchIndex: i, field: "batch_pk" });
    if (typeof id !== "string" || !/^[A-Za-z0-9._:-]{1,128}$/.test(id)) return rej("INVALID_BATCH_ROW", { batchIndex: i, field: "batch_id" });
    if (b["source"] !== TICK_HISTORY_SOURCE) return rej("INVALID_BATCH_ROW", { batchIndex: i, field: "source" });
    if (b["symbol"] !== TICK_HISTORY_SYMBOL) return rej("INVALID_BATCH_ROW", { batchIndex: i, field: "symbol" });
    const claim = b["coverage_claim"];
    if (claim !== "complete_claimed" && claim !== "partial" && claim !== "unknown")
      return rej("INVALID_BATCH_ROW", { batchIndex: i, field: "coverage_claim" });
    const ver = toExactInt(b["canonical_version"]);
    if (!ver.ok || ver.value !== CANONICAL_VERSION) return rej("UNSUPPORTED_CANONICAL_VERSION", { batchIndex: i });
    const ints: number[] = [];
    for (const f of ["from_msc", "to_msc", "fetched_at_msc", "tick_count"] as const) {
      const c = toExactInt(b[f]);
      if (!c.ok) return rej(c.reason === "PRECISION_LOSS" ? "PRECISION_LOSS" : "INVALID_INTEGER", { batchIndex: i, field: f });
      ints.push(c.value);
    }
    const [fromMsc, toMsc, fetchedAtMsc, count] = ints as [number, number, number, number];
    if (toMsc < fromMsc) return rej("INVALID_BATCH_WINDOW", { batchIndex: i });
    if (count > TICK_HISTORY_MAX_TICKS) return rej("TOO_MANY_TICKS", { batchIndex: i });
    if (byPk.has(pk)) return rej("DUPLICATE_BATCH_PK", { batchIndex: i });
    // Same batch ID twice (even identical) is ambiguous without collector identity: fail closed.
    if (ids.has(id)) return rej("DUPLICATE_BATCH_ID", { batchIndex: i });
    ids.add(id);
    const entry: B = { header: { batchId: id, source: TICK_HISTORY_SOURCE, symbol: TICK_HISTORY_SYMBOL, fromMsc, toMsc,
      fetchedAtMsc, coverageClaim: claim }, count, slots: new Array(count).fill(undefined) };
    byPk.set(pk, entry);
    order.push(entry);
  }

  // 3. Observation rows: membership, ordinal uniqueness and completeness, exact prices.
  const ors = items(top["observations"]);
  if (!ors) return rej("INVALID_OBSERVATION_ROWS");
  for (let i = 0; i < ors.length; i++) {
    const o = exact(ors[i], OBS_KEYS);
    if (!o) return rej("INVALID_OBSERVATION_ROW", { observationIndex: i });
    const pk = o["batch_pk"];
    if (typeof pk !== "string") return rej("INVALID_OBSERVATION_ROW", { observationIndex: i, field: "batch_pk" });
    const b = byPk.get(pk);
    if (!b) return rej("UNKNOWN_BATCH", { observationIndex: i });
    const ord = toExactInt(o["observation_ordinal"]);
    if (!ord.ok) return rej("INVALID_OBSERVATION_ROW", { observationIndex: i, field: "observation_ordinal" });
    if (ord.value >= b.count) return rej("TICK_COUNT_MISMATCH", { observationIndex: i });
    if (b.slots[ord.value] !== undefined) return rej("DUPLICATE_ORDINAL", { observationIndex: i });
    const t = toExactInt(o["time_msc"]);
    if (!t.ok) return rej(t.reason === "PRECISION_LOSS" ? "PRECISION_LOSS" : "INVALID_INTEGER", { observationIndex: i, field: "time_msc" });
    const bid = toExactPrice(o["bid"]), ask = toExactPrice(o["ask"]);
    if (!bid.ok) return rej(bid.reason === "PRECISION_LOSS" ? "PRECISION_LOSS" : "INVALID_PRICE", { observationIndex: i, field: "bid" });
    if (!ask.ok) return rej(ask.reason === "PRECISION_LOSS" ? "PRECISION_LOSS" : "INVALID_PRICE", { observationIndex: i, field: "ask" });
    if (ask.value < bid.value) return rej("CROSSED_QUOTE", { observationIndex: i });
    if (t.value < b.header.fromMsc || t.value > b.header.toMsc) return rej("TICK_OUTSIDE_WINDOW", { observationIndex: i });
    b.slots[ord.value] = { timeMsc: t.value, bid: bid.value, ask: ask.value };
  }

  // 4. Rebuild batches; every ordinal 0..count-1 must be present. Full Phase 2B validation (with clock policy)
  //    and Phase 2D canonicalisation are re-run by evaluateOutcomeContract itself.
  const rawBatches: AdaptedRawBatch[] = [];
  let tickCount = 0;
  for (let i = 0; i < order.length; i++) {
    const b = order[i]!;
    const ticks: AdaptedRawBatch["ticks"] = [];
    for (const s of b.slots) { if (!s) return rej("MISSING_ORDINAL", { batchIndex: i }); ticks.push(s); }
    rawBatches.push({ ...b.header, ticks });
    tickCount += ticks.length;
  }

  return { ...common, state: "ADAPTED", savedSignal: sig as unknown as AdaptedSignalRow, rawBatches,
    batchCount: rawBatches.length, tickCount };
}
