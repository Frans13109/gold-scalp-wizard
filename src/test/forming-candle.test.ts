import { describe, expect, it } from "vitest";
import { applyTick, formingToShow, M5_MS, type FormingCandle } from "@/lib/forming-candle";

const base = Date.parse("2026-10-16T14:00:00Z");
const tk = (s: number, bid: number) => ({ bid, tickTime: new Date(base + s * 1000).toISOString() });
const run = (ticks: ReturnType<typeof tk>[]) => ticks.reduce<FormingCandle | null>(applyTick, null);

describe("forming M5 candle", () => {
  it("builds OHLC from bid ticks", () => {
    const c = run([tk(0, 4180), tk(1, 4182.5), tk(2, 4179.2), tk(3, 4181)])!;
    expect(c).toMatchObject({ t: base, o: 4180, h: 4182.5, l: 4179.2, c: 4181, partial: false });
  });
  it("rolls over at the M5 boundary", () => {
    const c = run([tk(0, 4180), tk(299, 4185), tk(300, 4186)])!;
    expect(c).toMatchObject({ t: base + M5_MS, o: 4186, h: 4186, l: 4186, c: 4186 });
  });
  it("ignores duplicate and out-of-order ticks", () => {
    const c = run([tk(0, 4180), tk(5, 4181), tk(5, 4199), tk(3, 4100)])!;
    expect(c).toMatchObject({ h: 4181, l: 4180, c: 4181 });
  });
  it("ignores invalid prices", () => expect(run([tk(0, NaN)])).toBeNull());
  it("flags a partial candle when joined mid-interval", () => expect(run([tk(90, 4180)])!.partial).toBe(true));
  it("hides the forming candle when ticks are stale", () => {
    const c = run([tk(10, 4180)]);
    expect(formingToShow([], c, false, base + 20_000)).toBeNull();
    expect(formingToShow([], c, true, base + 20_000)).not.toBeNull();
  });
  it("hides it once its interval has passed", () => expect(formingToShow([], run([tk(10, 4180)]), true, base + M5_MS + 1)).toBeNull());
  it("closed MT5 candle for the same interval wins", () => {
    const c = run([tk(10, 4180)]);
    const closed = [{ t: base, o: 4179, h: 4183, l: 4178, c: 4182 }];
    expect(formingToShow(closed, c, true, base + 20_000)).toBeNull();
    expect(closed[0]).toEqual({ t: base, o: 4179, h: 4183, l: 4178, c: 4182 });
  });
});
