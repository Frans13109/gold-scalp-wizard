// DEMO DATA ONLY — synthetic candles, never real market prices.
export type Candle = { t: number; o: number; h: number; l: number; c: number };
export type Timeframe = "M5" | "M15";

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
    out.push({ t: g[0].t, o: g[0].o, c: g[2].c, h: Math.max(...g.map((x) => x.h)), l: Math.min(...g.map((x) => x.l)) });
  }
  return out;
}

export function ema(v: number[], p: number): number[] {
  const k = 2 / (p + 1);
  const out: number[] = [];
  v.forEach((x, i) => out.push(i === 0 ? x : x * k + out[i - 1] * (1 - k)));
  return out;
}

export function rsi(v: number[], p = 14): number[] {
  const out: number[] = [50];
  let g = 0, l = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= p) { g += up / p; l += dn / p; } else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; }
    out.push(l === 0 ? 100 : 100 - 100 / (1 + g / l));
  }
  return out;
}

export function macd(v: number[]) {
  const e12 = ema(v, 12), e26 = ema(v, 26);
  const line = v.map((_, i) => e12[i] - e26[i]);
  const signal = ema(line, 9);
  return { line, signal, hist: line.map((x, i) => x - signal[i]) };
}

export function atr(c: Candle[], p = 14): number[] {
  const tr = c.map((x, i) => (i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1].c), Math.abs(x.l - c[i - 1].c))));
  const out: number[] = [];
  tr.forEach((x, i) => out.push(i === 0 ? x : (out[i - 1] * (p - 1) + x) / p));
  return out;
}

export function indicators(c: Candle[]) {
  const close = c.map((x) => x.c);
  return { ema9: ema(close, 9), ema21: ema(close, 21), ema50: ema(close, 50), rsi: rsi(close), macd: macd(close), atr: atr(c) };
}
