/** Pure, opt-in research calculator: tick-aware outcome observation. Phase 1a ONLY.
 * Not wired to ingestion, persistence, History or trading. No clock reads, I/O, or input mutation.
 * Results are UNVALIDATED hypothetical quote observations ("tick_quote_observation"), never broker fills.
 * BUY: entered on ask, observed on bid (TP1 bid >= TP1, SL bid <= SL).
 * SELL: entered on bid, observed on ask (TP1 ask <= TP1, SL ask >= SL).
 * A successful history fetch is NOT proof of complete coverage; the caller must supply coverage spans,
 * and any gap, uncertain span, quiet spell or clock ambiguity yields INCOMPLETE/UNCERTAIN, never a result.
 * Sampled live ticks are not evidence: only source "mt5_tick_history" ticks and spans are used.
 */
import { at } from "./market";

export const TICK_METHOD = "tick_quote_observation" as const;
export const TICK_EVIDENCE_SOURCE = "mt5_tick_history" as const;
export const TICK_MAX_WINDOW_MS = 24 * 60 * 60_000;
export const TICK_MAX_INPUT_TICKS = 50_000;
export const TICK_MAX_COVERAGE_SPANS = 1_000;
export const TICK_MAX_CLOCK_MARGIN_MS = 60_000;
export const TICK_MAX_QUIET_MS = 600_000;

export interface TickOutcomeSignal {
  side: "BUY" | "SELL";
  symbol: "XAUUSD";
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  /** UTC epoch ms, actual (unrounded) creation time. */
  createdAt: number;
  expiresAt: number;
  /** Caller assertion only (not proof). Legacy/unknown signals are rejected. */
  evidence: "tick_history" | "legacy" | "none";
}
export interface HistoryTick {
  source: string;
  /** MT5 time_msc as UTC epoch ms (UTC alignment is an unverified assumption). */
  timeMsc: number;
  /** Position within the same millisecond as returned by MT5 (0, 1, 2 …). */
  seq: number;
  bid: number;
  ask: number;
}
export interface CoverageSpan {
  source: string;
  /** Inclusive UTC epoch ms. */
  fromMsc: number;
  toMsc: number;
  status: "ok" | "uncertain" | "failed";
}
export interface TickOutcomeOptions {
  /** Caller-supplied evaluation time (UTC epoch ms). */
  nowMsc: number;
  /** Configurable assumption for server-vs-MT5 clock difference; NOT a verified Exness offset. */
  clockMarginMs: number;
  /** Longest tick-free spell still considered observed. */
  maxQuietMs: number;
}

type Base = { unvalidated: true; method: typeof TICK_METHOD };
export type TickOutcomeEvaluation =
  | (Base & { state: "REJECTED"; reason: "INVALID_SIGNAL" | "INVALID_OPTIONS" | "UNVERIFIED_EVIDENCE" | "INVALID_TICK" | "INVALID_COVERAGE" | "CONFLICTING_DUPLICATE" | "LIMIT_EXCEEDED" })
  | (Base & { state: "INCOMPLETE"; reason: "WINDOW_NOT_CLOSED" | "COVERAGE_GAP" })
  | (Base & { state: "UNCERTAIN"; reason: "CLOCK_AMBIGUITY" | "QUIET_GAP" | "COVERAGE_UNCERTAIN" })
  | (Base & { state: "RESOLVED"; outcome: "sl" | "tp1" | "expired"; exitPrice: number | null; resultR: number | null; observedAtMsc: number });

const base: Base = { unvalidated: true, method: TICK_METHOD };
const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const time = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 8.64e15;
const int = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= lo && v <= hi;

export function evaluateTickOutcome(signal: unknown, ticks: unknown, coverage: unknown, options: unknown): TickOutcomeEvaluation {
  const rejected = (reason: Extract<TickOutcomeEvaluation, { state: "REJECTED" }>["reason"]): TickOutcomeEvaluation => ({ ...base, state: "REJECTED", reason });
  const incomplete = (reason: Extract<TickOutcomeEvaluation, { state: "INCOMPLETE" }>["reason"]): TickOutcomeEvaluation => ({ ...base, state: "INCOMPLETE", reason });
  const uncertain = (reason: Extract<TickOutcomeEvaluation, { state: "UNCERTAIN" }>["reason"]): TickOutcomeEvaluation => ({ ...base, state: "UNCERTAIN", reason });

  if (!rec(options) || !time(options['nowMsc']) || !int(options['clockMarginMs'], 0, TICK_MAX_CLOCK_MARGIN_MS)
    || !int(options['maxQuietMs'], 1, TICK_MAX_QUIET_MS)) return rejected("INVALID_OPTIONS");
  const now = options['nowMsc'], margin = options['clockMarginMs'], maxQuiet = options['maxQuietMs'];

  if (!rec(signal) || (signal['side'] !== "BUY" && signal['side'] !== "SELL") || signal['symbol'] !== "XAUUSD"
    || !pos(signal['entry']) || !pos(signal['stopLoss']) || !pos(signal['takeProfit1'])
    || !time(signal['createdAt']) || !time(signal['expiresAt'])) return rejected("INVALID_SIGNAL");
  if (signal['evidence'] !== "tick_history") return rejected("UNVERIFIED_EVIDENCE");
  const buy = signal['side'] === "BUY";
  const entry = signal['entry'], sl = signal['stopLoss'], tp = signal['takeProfit1'];
  const created = signal['createdAt'], expires = signal['expiresAt'];
  if (!(buy ? sl < entry && entry < tp : tp < entry && entry < sl) || expires <= created || now < created) return rejected("INVALID_SIGNAL");
  const risk = Math.abs(entry - sl);
  if (!pos(risk) || !pos(Math.abs(tp - entry)) || !Number.isFinite(Math.abs(tp - entry) / risk)) return rejected("INVALID_SIGNAL");
  if (expires - created > TICK_MAX_WINDOW_MS) return rejected("LIMIT_EXCEEDED");

  if (!Array.isArray(ticks) || !Array.isArray(coverage)) return rejected(!Array.isArray(ticks) ? "INVALID_TICK" : "INVALID_COVERAGE");
  if (ticks.length > TICK_MAX_INPUT_TICKS || coverage.length > TICK_MAX_COVERAGE_SPANS) return rejected("LIMIT_EXCEEDED");

  // Observation window: [start, expires). Ticks at or before `start` (beyond clock margin) never count.
  const start = Math.max(0, created - margin);

  // Coverage: merge only evidence-source "ok" spans; any non-ok span is remembered for overlap checks.
  const ok: { from: number; to: number }[] = [];
  const bad: { from: number; to: number }[] = [];
  for (const s of coverage as unknown[]) {
    if (!rec(s) || typeof s['source'] !== "string" || !time(s['fromMsc']) || !time(s['toMsc']) || s['toMsc'] < s['fromMsc']
      || (s['status'] !== "ok" && s['status'] !== "uncertain" && s['status'] !== "failed")) return rejected("INVALID_COVERAGE");
    if (s['source'] !== TICK_EVIDENCE_SOURCE) continue;
    (s['status'] === "ok" ? ok : bad).push({ from: s['fromMsc'], to: s['toMsc'] });
  }
  ok.sort((a, b) => a.from - b.from);
  let coveredUntil = -1; // last ms continuously covered from `start`
  for (const s of ok) {
    if (coveredUntil < 0) { if (s.from <= start) coveredUntil = s.to; continue; }
    if (s.from <= coveredUntil + 1) coveredUntil = Math.max(coveredUntil, s.to); else break;
  }
  const badOverlap = (to: number) => bad.some((b) => b.from <= to && b.to >= start);

  // Ticks: validate all, dedupe identical (timeMsc, seq), reject conflicts.
  const byKey = new Map<string, HistoryTick>();
  for (const t of ticks as unknown[]) {
    if (!rec(t) || typeof t['source'] !== "string" || !time(t['timeMsc']) || !int(t['seq'], 0, 1_000_000)) return rejected("INVALID_TICK");
    if (t['source'] !== TICK_EVIDENCE_SOURCE) continue; // sampled live ticks are never evidence
    if (!pos(t['bid']) || !pos(t['ask']) || t['ask'] < t['bid']) return rejected("INVALID_TICK");
    const tick: HistoryTick = { source: t['source'], timeMsc: t['timeMsc'], seq: t['seq'], bid: t['bid'], ask: t['ask'] };
    const key = `${tick.timeMsc}:${tick.seq}`;
    const prev = byKey.get(key);
    if (prev && (prev.bid !== tick.bid || prev.ask !== tick.ask)) return rejected("CONFLICTING_DUPLICATE");
    byKey.set(key, tick);
  }
  const usable = Math.min(coveredUntil, expires - 1);
  const timeline = [...byKey.values()].filter((t) => t.timeMsc > start && t.timeMsc <= usable)
    .sort((a, b) => a.timeMsc - b.timeMsc || a.seq - b.seq);

  const quote = (t: HistoryTick) => (buy ? t.bid : t.ask);
  const stopHit = (t: HistoryTick) => (buy ? quote(t) <= sl : quote(t) >= sl);
  const targetHit = (t: HistoryTick) => (buy ? quote(t) >= tp : quote(t) <= tp);
  const nearBoundary = (ms: number) => Math.abs(ms - created) <= margin || Math.abs(ms - expires) <= margin;

  let last = start;
  let i = 0;
  while (i < timeline.length) {
    const ms = at(timeline, i).timeMsc;
    if (ms - last > maxQuiet) return uncertain("QUIET_GAP");
    const group: HistoryTick[] = [];
    while (i < timeline.length && at(timeline, i).timeMsc === ms) { group.push(at(timeline, i)); i++; }
    const stops = group.filter(stopHit), targets = group.filter(targetHit);
    if (stops.length || targets.length) {
      // A crossing that might belong before creation or after expiry cannot be attributed.
      if (nearBoundary(ms)) return uncertain("CLOCK_AMBIGUITY");
      if (badOverlap(ms)) return uncertain("COVERAGE_UNCERTAIN");
      // Same-millisecond TP1+SL: ordering unknowable, so SL first (conservative). Worst observed stop quote.
      if (stops.length) {
        const exit = stops.map(quote).reduce((a, b) => (buy ? Math.min(a, b) : Math.max(a, b)));
        return { ...base, state: "RESOLVED", outcome: "sl", exitPrice: exit, resultR: (buy ? exit - entry : entry - exit) / risk, observedAtMsc: ms };
      }
      return { ...base, state: "RESOLVED", outcome: "tp1", exitPrice: tp, resultR: (buy ? tp - entry : entry - tp) / risk, observedAtMsc: ms };
    }
    last = ms;
  }
  if (now < expires) return incomplete("WINDOW_NOT_CLOSED");
  if (coveredUntil < expires - 1) return incomplete("COVERAGE_GAP");
  if (expires - 1 - last > maxQuiet) return uncertain("QUIET_GAP");
  if (badOverlap(expires - 1)) return uncertain("COVERAGE_UNCERTAIN");
  return { ...base, state: "RESOLVED", outcome: "expired", exitPrice: null, resultR: null, observedAtMsc: expires };
}
