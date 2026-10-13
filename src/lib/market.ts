// DEMO DATA ONLY — synthetic XAUUSD candles, never real market prices.
export type Candle = { t: number; o: number; h: number; l: number; c: number };
export type Timeframe = "M5" | "M15";

/** Safe array read for strict indexed access. */
export function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i < 0 ? arr.length + i : i];
  if (v === undefined) throw new RangeError(`Index ${i} out of range (length ${arr.length})`);
  return v;
}

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export function demoM5(count = 360, seed = 42): Candle[] {
  const r = rng(seed);
  const out: Candle[] = [];
  let price = 2400;
  const start = Date.UTC(2026, 0, 1, 0, 0);
  for (let i = 0; i < count; i++) {
    const drift = Math.sin(i / 45) * 0.35;
    const o = price;
    const c = o + drift + (r() - 0.5) * 3;
    const h = Math.max(o, c) + r() * 1.4;
    const l = Math.min(o, c) - r() * 1.4;
    out.push({ t: start + i * 300000, o, h, l, c });
    price = c;
  }
  return out;
}

export function toM15(m5: Candle[]): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i + 2 < m5.length; i += 3) {
    const g = m5.slice(i, i + 3);
    const first = at(g, 0), last = at(g, 2);
    out.push({ t: first.t, o: first.o, c: last.c, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)) });
  }
  return out;
}

export function ema(v: number[], p: number): number[] {
  const k = 2 / (p + 1);
  const out: number[] = [];
  let prev: number | undefined;
  for (const x of v) {
    prev = prev === undefined ? x : x * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(v: number[], p = 14): number[] {
  const out: number[] = [];
  let g = 0, l = 0;
  let prev: number | undefined;
  v.forEach((x, i) => {
    if (prev === undefined) { out.push(50); prev = x; return; }
    const d = x - prev;
    prev = x;
    const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= p) { g += up / p; l += dn / p; } else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; }
    out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
  });
  return out;
}

export function macd(v: number[]) {
  const e12 = ema(v, 12), e26 = ema(v, 26);
  const line = e12.map((x, i) => x - at(e26, i));
  const signal = ema(line, 9);
  return { line, signal, hist: line.map((x, i) => x - at(signal, i)) };
}

export function atr(c: Candle[], p = 14): number[] {
  const out: number[] = [];
  let prevClose: number | undefined;
  let prevAtr: number | undefined;
  for (const x of c) {
    const tr = prevClose === undefined ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - prevClose), Math.abs(x.l - prevClose));
    prevAtr = prevAtr === undefined ? tr : (prevAtr * (p - 1) + tr) / p;
    out.push(prevAtr);
    prevClose = x.c;
  }
  return out;
}

export function indicators(c: Candle[]) {
  const close = c.map((x) => x.c);
  return { ema9: ema(close, 9), ema21: ema(close, 21), ema50: ema(close, 50), rsi: rsi(close), macd: macd(close), atr: atr(c) };
}
