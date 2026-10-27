import { describe, expect, it } from "vitest";
import {
  evaluateTickOutcome, TICK_MAX_INPUT_TICKS, TICK_MAX_WINDOW_MS,
  type CoverageSpan, type HistoryTick, type TickOutcomeSignal,
} from "@/lib/signal-outcomes-tick";

// Synthetic unit-test data only. Never imported into the dashboard or database.
const T0 = Date.UTC(2026, 9, 27, 10, 5, 3, 250); // deliberately between M5 boundaries
const EXP = Date.UTC(2026, 9, 27, 10, 20, 0, 0);
const SRC = "mt5_tick_history";
const sig = (side: "BUY" | "SELL" = "BUY", o: Partial<TickOutcomeSignal> = {}): TickOutcomeSignal => ({
  side, symbol: "XAUUSD", entry: 4000, stopLoss: side === "BUY" ? 3995 : 4005, takeProfit1: side === "BUY" ? 4010 : 3990,
  createdAt: T0, expiresAt: EXP, evidence: "tick_history", ...o });
const tk = (t: number, bid: number, ask: number, seq = 0, source = SRC): HistoryTick => ({ source, timeMsc: t, seq, bid, ask });
/** Quiet, non-touching background ticks every 10 s across the window. */
const background = (from = T0 - 1000, to = EXP - 1) => {
  const out: HistoryTick[] = [];
  for (let t = from; t <= to; t += 10_000) out.push(tk(t, 4000, 4000.2));
  return out;
};
const fullCov = (o: Partial<CoverageSpan> = {}): CoverageSpan[] => [{ source: SRC, fromMsc: T0 - 5000, toMsc: EXP + 5000, status: "ok", ...o }];
const opts = (o = {}) => ({ nowMsc: EXP + 1000, clockMarginMs: 2000, maxQuietMs: 30_000, ...o });
const run = (s: unknown = sig(), ticks: unknown = background(), cov: unknown = fullCov(), o: unknown = opts()) =>
  evaluateTickOutcome(s, ticks, cov, o);
const at = (dt: number) => T0 + dt;

describe("tick-aware outcome calculator (Phase 1a, isolated)", () => {
  // BUY observed on bid, SELL observed on ask.
  it("BUY TP1 on bid exact touch", () => {
    expect(run(sig("BUY"), [...background(), tk(at(60_005), 4010, 4010.3)])).toMatchObject({
      state: "RESOLVED", outcome: "tp1", exitPrice: 4010, resultR: 2, observedAtMsc: at(60_005), unvalidated: true, method: "tick_quote_observation" });
  });
  it("BUY SL on bid exact touch", () => {
    expect(run(sig("BUY"), [...background(), tk(at(60_005), 3995, 3995.2)])).toMatchObject({ state: "RESOLVED", outcome: "sl", exitPrice: 3995, resultR: -1 });
  });
  it("BUY ignores ask reaching TP1 when bid does not", () => {
    expect(run(sig("BUY"), [...background(), tk(at(60_005), 4009.9, 4010.1)])).toMatchObject({ state: "RESOLVED", outcome: "expired" });
  });
  it("SELL TP1 on ask exact touch", () => {
    expect(run(sig("SELL"), [...background(), tk(at(60_005), 3989.8, 3990)])).toMatchObject({ state: "RESOLVED", outcome: "tp1", exitPrice: 3990, resultR: 2 });
  });
  it("SELL SL on ask exact touch (spread can trigger SL while bid is below)", () => {
    expect(run(sig("SELL"), [...background(), tk(at(60_005), 4004.7, 4005)])).toMatchObject({ state: "RESOLVED", outcome: "sl", exitPrice: 4005, resultR: -1 });
  });
  it("SELL ignores bid reaching TP1 when ask does not", () => {
    expect(run(sig("SELL"), [...background(), tk(at(60_005), 3990, 3990.2)])).toMatchObject({ state: "RESOLVED", outcome: "expired" });
  });
  it.each(["BUY", "SELL"] as const)("%s SL gap-through uses worse observed quote", (side) => {
    const t = side === "BUY" ? tk(at(60_005), 3990, 3990.2) : tk(at(60_005), 4009.8, 4010);
    expect(run(sig(side), [...background(), t])).toMatchObject({ outcome: "sl", exitPrice: side === "BUY" ? 3990 : 4010, resultR: -2 });
  });
  it.each(["BUY", "SELL"] as const)("%s TP1 gap-through is capped at TP1 (no favourable fill claimed)", (side) => {
    const t = side === "BUY" ? tk(at(60_005), 4020, 4020.2) : tk(at(60_005), 3979.8, 3980);
    expect(run(sig(side), [...background(), t])).toMatchObject({ outcome: "tp1", exitPrice: side === "BUY" ? 4010 : 3990, resultR: 2 });
  });
  it("first crossing in time wins", () => {
    expect(run(sig("BUY"), [...background(), tk(at(70_000), 3990, 3990.2), tk(at(60_000), 4011, 4011.2)])).toMatchObject({ outcome: "tp1", observedAtMsc: at(60_000) });
  });
  it("same-millisecond TP1 and SL resolves SL first", () => {
    expect(run(sig("BUY"), [...background(), tk(at(60_000), 4011, 4011.2, 0), tk(at(60_000), 3994, 3994.2, 1)]))
      .toMatchObject({ outcome: "sl", exitPrice: 3994 });
  });
  it("same-millisecond ticks with SL listed first and TP second still SL", () => {
    expect(run(sig("SELL"), [...background(), tk(at(60_000), 3989, 3989.2, 1), tk(at(60_000), 4005, 4005.4, 0)]))
      .toMatchObject({ outcome: "sl", exitPrice: 4005.4 });
  });

  // Creation timing and clock uncertainty.
  it("ticks before creation (beyond margin) never count", () => {
    expect(run(sig("BUY"), [...background(), tk(T0 - 3000, 3990, 3990.2)])).toMatchObject({ outcome: "expired" });
  });
  it("crossing within clock margin of creation is UNCERTAIN", () => {
    expect(run(sig("BUY"), [...background(), tk(T0 + 1500, 3990, 3990.2)])).toMatchObject({ state: "UNCERTAIN", reason: "CLOCK_AMBIGUITY" });
    expect(run(sig("BUY"), [...background(), tk(T0 - 1500, 4011, 4011.2)])).toMatchObject({ state: "UNCERTAIN", reason: "CLOCK_AMBIGUITY" });
  });
  it("crossing within clock margin of expiry is UNCERTAIN", () => {
    expect(run(sig("BUY"), [...background(), tk(EXP - 1000, 4011, 4011.2)])).toMatchObject({ state: "UNCERTAIN", reason: "CLOCK_AMBIGUITY" });
  });
  it("first eligible crossing just outside the margin resolves", () => {
    expect(run(sig("BUY"), [...background(), tk(T0 + 2001, 4011, 4011.2)])).toMatchObject({ outcome: "tp1", observedAtMsc: T0 + 2001 });
  });
  it("ticks at or after expiry never count", () => {
    expect(run(sig("BUY"), [...background(), tk(EXP + 3000, 3990, 3990.2)])).toMatchObject({ outcome: "expired" });
  });
  it("zero margin is allowed but still excludes the creation millisecond", () => {
    expect(run(sig("BUY"), [...background(), tk(T0, 3990, 3990.2)], fullCov(), opts({ clockMarginMs: 0 }))).toMatchObject({ outcome: "expired" });
  });

  // Coverage.
  it("open window without a hit is INCOMPLETE", () => {
    expect(run(sig(), background(T0 - 1000, at(60_000)), fullCov(), opts({ nowMsc: at(60_000) }))).toMatchObject({ state: "INCOMPLETE", reason: "WINDOW_NOT_CLOSED" });
  });
  it("hit before expiry resolves early when covered up to the hit", () => {
    expect(run(sig(), [...background(T0 - 1000, at(60_000)), tk(at(65_000), 4011, 4011.2)],
      [{ source: SRC, fromMsc: T0 - 5000, toMsc: at(66_000), status: "ok" }], opts({ nowMsc: at(70_000) }))).toMatchObject({ outcome: "tp1" });
  });
  it("coverage not starting before creation margin is INCOMPLETE", () => {
    expect(run(sig(), background(), fullCov({ fromMsc: T0 }))).toMatchObject({ state: "INCOMPLETE", reason: "COVERAGE_GAP" });
  });
  it("coverage ending before expiry is INCOMPLETE, never expired", () => {
    expect(run(sig(), background(), fullCov({ toMsc: EXP - 60_000 }))).toMatchObject({ state: "INCOMPLETE", reason: "COVERAGE_GAP" });
  });
  it("hit after a coverage gap is not used", () => {
    const cov: CoverageSpan[] = [{ source: SRC, fromMsc: T0 - 5000, toMsc: at(100_000), status: "ok" }, { source: SRC, fromMsc: at(200_000), toMsc: EXP + 5000, status: "ok" }];
    expect(run(sig(), [...background(), tk(at(300_000), 4011, 4011.2)], cov)).toMatchObject({ state: "INCOMPLETE", reason: "COVERAGE_GAP" });
  });
  it("adjacent ok spans merge into full coverage", () => {
    const cov: CoverageSpan[] = [{ source: SRC, fromMsc: at(100_001), toMsc: EXP + 5000, status: "ok" }, { source: SRC, fromMsc: T0 - 5000, toMsc: at(100_000), status: "ok" }];
    expect(run(sig(), background(), cov)).toMatchObject({ outcome: "expired" });
  });
  it("failed or uncertain span overlapping the window is UNCERTAIN", () => {
    for (const status of ["uncertain", "failed"] as const) {
      const cov = [...fullCov(), { source: SRC, fromMsc: at(100_000), toMsc: at(110_000), status }];
      expect(run(sig(), background(), cov)).toMatchObject({ state: "UNCERTAIN", reason: "COVERAGE_UNCERTAIN" });
      expect(run(sig(), [...background(), tk(at(200_000), 4011, 4011.2)], cov)).toMatchObject({ state: "UNCERTAIN", reason: "COVERAGE_UNCERTAIN" });
    }
  });
  it("quiet spell longer than limit is UNCERTAIN (disconnection)", () => {
    const ticks = background().filter((t) => t.timeMsc < at(100_000) || t.timeMsc > at(200_000));
    expect(run(sig(), ticks)).toMatchObject({ state: "UNCERTAIN", reason: "QUIET_GAP" });
    expect(run(sig(), [...ticks, tk(at(205_000), 4011, 4011.2)])).toMatchObject({ state: "UNCERTAIN", reason: "QUIET_GAP" });
  });
  it("no ticks at all with ok coverage is UNCERTAIN, not expired", () => {
    expect(run(sig(), [])).toMatchObject({ state: "UNCERTAIN", reason: "QUIET_GAP" });
  });
  it("live sampled ticks and spans are not evidence", () => {
    const live = background().map((t) => ({ ...t, source: "live_sample" }));
    expect(run(sig(), live)).toMatchObject({ state: "UNCERTAIN", reason: "QUIET_GAP" });
    expect(run(sig(), [...background(), tk(at(60_000), 3990, 3990.2, 0, "live_sample")])).toMatchObject({ outcome: "expired" });
    expect(run(sig(), background(), fullCov({ source: "live_sample" }))).toMatchObject({ state: "INCOMPLETE", reason: "COVERAGE_GAP" });
  });

  // Ordering, duplicates, malformed data.
  it("late / out-of-order delivery gives identical results", () => {
    const ticks = [...background(), tk(at(60_000), 4011, 4011.2)];
    expect(run(sig(), [...ticks].reverse())).toEqual(run(sig(), ticks));
  });
  it("identical duplicates are ignored", () => {
    const ticks = [...background(), tk(at(60_000), 4011, 4011.2)];
    expect(run(sig(), [...ticks, ...ticks])).toEqual(run(sig(), ticks));
  });
  it("conflicting duplicate (same time and seq) is rejected", () => {
    expect(run(sig(), [...background(), tk(at(60_000), 4001, 4001.2), tk(at(60_000), 4002, 4002.2)])).toMatchObject({ state: "REJECTED", reason: "CONFLICTING_DUPLICATE" });
  });
  it("distinct ticks sharing a millisecond are kept via seq", () => {
    expect(run(sig("BUY"), [...background(), tk(at(60_000), 4001, 4001.2, 0), tk(at(60_000), 3994, 3994.2, 1)])).toMatchObject({ outcome: "sl" });
  });
  it.each([
    ["missing bid", { source: SRC, timeMsc: at(5000), seq: 0, ask: 4000 }],
    ["missing ask", { source: SRC, timeMsc: at(5000), seq: 0, bid: 4000 }],
    ["zero bid", tk(at(5000), 0, 4000)],
    ["NaN ask", tk(at(5000), 4000, NaN)],
    ["ask below bid", tk(at(5000), 4000.5, 4000)],
    ["fractional time", { ...tk(at(5000), 4000, 4000.2), timeMsc: 1.5 }],
    ["negative seq", tk(at(5000), 4000, 4000.2, -1)],
    ["null", null],
  ])("malformed tick: %s is rejected", (_n, bad) => {
    expect(run(sig(), [...background(), bad])).toMatchObject({ state: "REJECTED", reason: "INVALID_TICK" });
  });
  it("malformed coverage is rejected", () => {
    expect(run(sig(), background(), [{ source: SRC, fromMsc: 10, toMsc: 5, status: "ok" }])).toMatchObject({ reason: "INVALID_COVERAGE" });
    expect(run(sig(), background(), [{ source: SRC, fromMsc: 1, toMsc: 5, status: "maybe" }])).toMatchObject({ reason: "INVALID_COVERAGE" });
    expect(run(sig(), background(), "nope")).toMatchObject({ reason: "INVALID_COVERAGE" });
  });

  // Signal / options validation, legacy, limits.
  it.each(["legacy", "none", undefined] as const)("signal with evidence=%s is rejected (legacy untouched)", (ev) => {
    expect(run({ ...sig(), evidence: ev })).toMatchObject({ state: "REJECTED", reason: "UNVERIFIED_EVIDENCE" });
  });
  it.each([
    ["BUY SL above entry", sig("BUY", { stopLoss: 4001 })],
    ["SELL TP above entry", sig("SELL", { takeProfit1: 4001 })],
    ["expiry before creation", sig("BUY", { expiresAt: T0 - 1 })],
    ["infinite entry", sig("BUY", { entry: Infinity })],
    ["wrong symbol", { ...sig(), symbol: "EURUSD" }],
    ["array", []],
  ])("invalid signal: %s", (_n, s) => {
    expect(run(s)).toMatchObject({ state: "REJECTED", reason: "INVALID_SIGNAL" });
  });
  it("evaluation time before creation is invalid", () => {
    expect(run(sig(), background(), fullCov(), opts({ nowMsc: T0 - 1 }))).toMatchObject({ reason: "INVALID_SIGNAL" });
  });
  it.each([{ clockMarginMs: -1 }, { clockMarginMs: 60_001 }, { maxQuietMs: 0 }, { nowMsc: NaN }, { clockMarginMs: 1.5 }])(
    "invalid options %o rejected", (o) => {
      expect(run(sig(), background(), fullCov(), opts(o))).toMatchObject({ state: "REJECTED", reason: "INVALID_OPTIONS" });
    });
  it("window over 24 h and oversized inputs hit limits", () => {
    expect(run(sig("BUY", { expiresAt: T0 + TICK_MAX_WINDOW_MS + 1 }), background(), fullCov(), opts({ nowMsc: T0 + TICK_MAX_WINDOW_MS + 2 })))
      .toMatchObject({ reason: "LIMIT_EXCEEDED" });
    expect(run(sig(), new Array(TICK_MAX_INPUT_TICKS + 1).fill(tk(at(1), 4000, 4000.2)))).toMatchObject({ reason: "LIMIT_EXCEEDED" });
  });

  // Purity and labels.
  it("does not mutate inputs and is deterministic", () => {
    const s = sig(), ticks = [...background(), tk(at(60_000), 4011, 4011.2)].reverse(), cov = fullCov(), o = opts();
    const snap = JSON.stringify([s, ticks, cov, o]);
    const a = evaluateTickOutcome(s, ticks, cov, o), b = evaluateTickOutcome(s, ticks, cov, o);
    expect(a).toEqual(b);
    expect(JSON.stringify([s, ticks, cov, o])).toBe(snap);
  });
  it("every state carries UNVALIDATED + tick_quote_observation", () => {
    const results = [run(), run({ ...sig(), evidence: "legacy" }), run(sig(), []), run(sig(), background(), fullCov({ toMsc: T0 }))];
    for (const r of results) expect(r).toMatchObject({ unvalidated: true, method: "tick_quote_observation" });
  });

  describe("Phase 1c safety regressions", () => {
    const NOW = at(60_005);
    const hit = (side: "BUY" | "SELL", outcome: "tp1" | "sl", ms: number) =>
      side === "BUY"
        ? tk(ms, outcome === "tp1" ? 4010 : 3995, outcome === "tp1" ? 4010.2 : 3995.2)
        : tk(ms, outcome === "tp1" ? 3989.8 : 4004.8, outcome === "tp1" ? 3990 : 4005);

    it.each([
      ["BUY", "tp1"], ["BUY", "sl"], ["SELL", "tp1"], ["SELL", "sl"],
    ] as const)("future %s %s cannot resolve, but exact-now hit can", (side, outcome) => {
      const ticks = background(T0 - 1000, NOW);
      expect(run(sig(side), [...ticks, hit(side, outcome, NOW + 1)], fullCov(), opts({ nowMsc: NOW })))
        .toMatchObject({ state: "INCOMPLETE", reason: "WINDOW_NOT_CLOSED" });
      expect(run(sig(side), [...ticks, hit(side, outcome, NOW)], fullCov(), opts({ nowMsc: NOW })))
        .toMatchObject({ state: "RESOLVED", outcome, observedAtMsc: NOW, resultR: outcome === "tp1" ? 2 : -1 });
    });
    it("future stop cannot override a same-millisecond-now target", () => {
      expect(run(sig(), [...background(T0 - 1000, NOW), hit("BUY", "tp1", NOW), hit("BUY", "sl", NOW + 1)],
        fullCov(), opts({ nowMsc: NOW }))).toMatchObject({ outcome: "tp1", observedAtMsc: NOW });
    });
    it("future ticks cannot fill quiet evidence before an unobserved hit", () => {
      expect(run(sig(), [tk(NOW + 1, 4000, 4000.2), hit("BUY", "tp1", NOW + 2)], fullCov(), opts({ nowMsc: NOW })))
        .toMatchObject({ state: "INCOMPLETE", reason: "WINDOW_NOT_CLOSED" });
    });
    it("future clock-ambiguous hit cannot influence the current result", () => {
      expect(run(sig(), [...background(T0 - 1000, EXP - 3000), hit("BUY", "tp1", EXP - 1000)],
        fullCov(), opts({ nowMsc: EXP - 3000 }))).toMatchObject({ state: "INCOMPLETE", reason: "WINDOW_NOT_CLOSED" });
    });
    it.each([NaN, Infinity, -Infinity, -1, 1.5, 8.64e15 + 1, "1793095503250", null, undefined])(
      "invalid now timestamp %s is rejected", (nowMsc) => {
        expect(run(sig(), background(), fullCov(), opts({ nowMsc })))
          .toMatchObject({ state: "REJECTED", reason: "INVALID_OPTIONS" });
      });
    it("expiry cannot resolve one millisecond early even with future evidence", () => {
      expect(run(sig(), background(), fullCov(), opts({ nowMsc: EXP - 1 })))
        .toMatchObject({ state: "INCOMPLETE", reason: "WINDOW_NOT_CLOSED" });
      expect(run(sig(), background(), fullCov(), opts({ nowMsc: EXP })))
        .toMatchObject({ state: "RESOLVED", outcome: "expired", observedAtMsc: EXP });
    });
    it("future coverage alone cannot cover the eligible prefix", () => {
      expect(run(sig(), [hit("BUY", "tp1", NOW + 1)], fullCov({ fromMsc: NOW + 1 }), opts({ nowMsc: NOW })))
        .toMatchObject({ state: "INCOMPLETE", reason: "WINDOW_NOT_CLOSED" });
    });
    it("future uncertain coverage cannot invalidate an observed early hit", () => {
      const cov: CoverageSpan[] = [...fullCov(), { source: SRC, fromMsc: NOW + 1, toMsc: EXP, status: "uncertain" }];
      expect(run(sig(), [...background(T0 - 1000, NOW), hit("BUY", "tp1", NOW)], cov, opts({ nowMsc: NOW })))
        .toMatchObject({ state: "RESOLVED", outcome: "tp1" });
    });
    it("BUY extreme adverse gap with tiny relative risk stays finite without clamping", () => {
      // With positive quotes, BUY loss is bounded by entry/risk.
      const s = sig("BUY", { entry: 1e100, stopLoss: 1e100 - 2e84, takeProfit1: 1e100 + 2e84 });
      const result = run(s, [tk(NOW, 1, 1)], fullCov(), opts({ maxQuietMs: 100_000 }));
      expect(result).toMatchObject({ state: "RESOLVED", outcome: "sl", exitPrice: 1, resultR: (1 - s.entry) / (s.entry - s.stopLoss) });
      if (result.state !== "RESOLVED") throw new Error("Expected finite BUY gap result");
      expect(Number.isFinite(result.resultR)).toBe(true);
    });
    it("SELL extreme adverse gap rejects non-finite R", () => {
      const s = sig("SELL", { entry: 1e-300, stopLoss: 1.5e-300, takeProfit1: 5e-301 });
      expect(run(s, [tk(NOW, 1e308, Number.MAX_VALUE)], fullCov(), opts({ maxQuietMs: 100_000 })))
        .toMatchObject({ state: "REJECTED", reason: "INVALID_TICK" });
    });
    it.each(["BUY", "SELL"] as const)("%s subnormal positive risk yields finite exact-level R", (side) => {
      const unit = Number.MIN_VALUE;
      const s = sig(side, { entry: 2 * unit, stopLoss: side === "BUY" ? unit : 3 * unit, takeProfit1: side === "BUY" ? 3 * unit : unit });
      for (const outcome of ["sl", "tp1"] as const) {
        const price = outcome === "sl" ? s.stopLoss : s.takeProfit1;
        expect(run(s, [tk(NOW, price, price)], fullCov(), opts({ maxQuietMs: 100_000 })))
          .toMatchObject({ state: "RESOLVED", outcome, resultR: outcome === "sl" ? -1 : 1 });
      }
    });
    it("BUY non-finite target R is rejected before resolution", () => {
      const s = sig("BUY", { entry: 1e-300, stopLoss: 5e-301, takeProfit1: Number.MAX_VALUE });
      expect(run(s, [], fullCov())).toMatchObject({ state: "REJECTED", reason: "INVALID_SIGNAL" });
    });
    it("SELL extreme positive target distance retains finite R", () => {
      const s = sig("SELL", { entry: 1e100, stopLoss: 1e100 + 2e84, takeProfit1: Number.MIN_VALUE });
      const result = run(s, [tk(NOW, Number.MIN_VALUE, Number.MIN_VALUE)], fullCov(), opts({ maxQuietMs: 100_000 }));
      expect(result).toMatchObject({ state: "RESOLVED", outcome: "tp1", resultR: (s.entry - s.takeProfit1) / (s.stopLoss - s.entry) });
      if (result.state !== "RESOLVED") throw new Error("Expected finite SELL target result");
      expect(Number.isFinite(result.resultR)).toBe(true);
    });
    it.each([NaN, Infinity, -Infinity, 0, -1, "4000", null])("malformed gap quote %s never yields a result", (price) => {
      expect(run(sig(), [{ ...tk(NOW, 4000, 4000.2), bid: price }]))
        .toMatchObject({ state: "REJECTED", reason: "INVALID_TICK" });
    });
    it.each(["entry", "stopLoss", "takeProfit1"] as const)("non-finite signal %s is rejected", (field) => {
      expect(run({ ...sig(), [field]: Infinity })).toMatchObject({ state: "REJECTED", reason: "INVALID_SIGNAL" });
    });
    it.each(["BUY", "SELL"] as const)("%s early hit requires coverage through its exact millisecond", (side) => {
      const ticks = [...background(T0 - 1000, NOW), hit(side, "sl", NOW)];
      expect(run(sig(side), ticks, fullCov({ toMsc: NOW }), opts({ nowMsc: NOW })))
        .toMatchObject({ state: "RESOLVED", outcome: "sl", observedAtMsc: NOW });
      expect(run(sig(side), ticks, fullCov({ toMsc: NOW - 1 }), opts({ nowMsc: NOW })))
        .toMatchObject({ state: "INCOMPLETE", reason: "WINDOW_NOT_CLOSED" });
    });
    it("one millisecond of missing prefix coverage blocks a later hit", () => {
      const cov: CoverageSpan[] = [
        { source: SRC, fromMsc: T0 - 5000, toMsc: at(30_000), status: "ok" },
        { source: SRC, fromMsc: at(30_002), toMsc: NOW, status: "ok" },
      ];
      expect(run(sig(), [...background(T0 - 1000, NOW), hit("BUY", "tp1", NOW)], cov))
        .toMatchObject({ state: "INCOMPLETE", reason: "COVERAGE_GAP" });
    });
    it.each(["failed", "uncertain"] as const)("%s coverage at/before hit blocks it; after hit does not", (status) => {
      const ticks = [...background(T0 - 1000, NOW), hit("BUY", "tp1", NOW)];
      for (const ms of [at(30_000), NOW]) {
        expect(run(sig(), ticks, [...fullCov(), { source: SRC, fromMsc: ms, toMsc: ms, status }]))
          .toMatchObject({ state: "UNCERTAIN", reason: "COVERAGE_UNCERTAIN" });
      }
      expect(run(sig(), ticks, [...fullCov(), { source: SRC, fromMsc: NOW + 1, toMsc: EXP - 1, status }]))
        .toMatchObject({ state: "RESOLVED", outcome: "tp1" });
    });
    it("quiet gap before a hit blocks it; missing ticks after hit do not", () => {
      expect(run(sig(), [hit("BUY", "tp1", NOW)], fullCov()))
        .toMatchObject({ state: "UNCERTAIN", reason: "QUIET_GAP" });
      expect(run(sig(), [...background(T0 - 1000, NOW), hit("BUY", "tp1", NOW)], fullCov({ toMsc: NOW })))
        .toMatchObject({ state: "RESOLVED", outcome: "tp1" });
    });
    it.each([EXP, EXP + 1])("hit at expiry boundary %s is ineligible", (ms) => {
      expect(run(sig(), [...background(), hit("BUY", "sl", ms)]))
        .toMatchObject({ state: "RESOLVED", outcome: "expired", exitPrice: null, resultR: null });
    });
    it("early same-ms ambiguity stays SL-first and repeated evaluations stay identical", () => {
      const ticks = [...background(T0 - 1000, NOW), hit("BUY", "tp1", NOW), { ...hit("BUY", "sl", NOW), seq: 1 }];
      const cov = fullCov({ toMsc: NOW });
      const result = run(sig(), ticks, cov, opts({ nowMsc: NOW }));
      expect(result).toMatchObject({ state: "RESOLVED", outcome: "sl", unvalidated: true, method: "tick_quote_observation" });
      expect(run(sig(), [...ticks, ...ticks].reverse(), cov, opts({ nowMsc: NOW }))).toEqual(result);
      expect(run(sig(), [...ticks, { ...hit("BUY", "tp1", NOW), bid: 4010.1 }], cov, opts({ nowMsc: NOW })))
        .toMatchObject({ state: "REJECTED", reason: "CONFLICTING_DUPLICATE" });
    });
    it("malformed or conflicting evidence after an early hit remains rejected", () => {
      const ticks = [...background(T0 - 1000, NOW), hit("BUY", "tp1", NOW)];
      expect(run(sig(), [...ticks, tk(NOW + 10, NaN, 4000)], fullCov({ toMsc: NOW })))
        .toMatchObject({ state: "REJECTED", reason: "INVALID_TICK" });
      expect(run(sig(), [...ticks, tk(NOW + 10, 4000, 4000.2), tk(NOW + 10, 4001, 4001.2)], fullCov({ toMsc: NOW })))
        .toMatchObject({ state: "REJECTED", reason: "CONFLICTING_DUPLICATE" });
    });
  });
});
