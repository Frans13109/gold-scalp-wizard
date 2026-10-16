import type { Candle } from "@/lib/market";
import { ema } from "@/lib/market";

/** Closed candles plus an optional live forming candle (drawn hollow/dashed; never fed into the EMAs). */
export function CandleChart({ candles, count = 80, live = false, forming = null }: { candles: Candle[]; count?: number; live?: boolean; forming?: Candle | null }) {
  const close = candles.map((c) => c.c);
  const lines = [{ v: ema(close, 9), cls: "stroke-gold" }, { v: ema(close, 21), cls: "stroke-bull" }, { v: ema(close, 50), cls: "stroke-bear" }];
  const slots = forming ? count - 1 : count;
  const start = Math.max(0, candles.length - slots);
  const data = candles.slice(start);
  const all = forming ? [...data, forming] : data;
  const W = 800, H = 340, pad = 8;
  const hi = Math.max(...all.map((c) => c.h)), lo = Math.min(...all.map((c) => c.l));
  const y = (p: number) => pad + ((hi - p) / (hi - lo || 1)) * (H - pad * 2);
  const step = W / all.length, bw = step * 0.6;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-64 w-full sm:h-80" preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} className="stroke-border" />)}
        {all.map((c, i) => {
          const x = i * step + step / 2, up = c.c >= c.o, isForming = forming != null && i === all.length - 1;
          return (
            <g key={c.t} data-testid={isForming ? "forming-candle" : undefined}
              className={`${up ? "stroke-bull" : "stroke-bear"} ${isForming ? "fill-none" : up ? "fill-bull" : "fill-bear"}`}>
              <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} strokeWidth={1} />
              <rect x={x - bw / 2} width={bw} y={y(Math.max(c.o, c.c))} height={Math.max(1, Math.abs(y(c.o) - y(c.c)))}
                strokeWidth={isForming ? 1.5 : undefined} strokeDasharray={isForming ? "3 2" : undefined} />
            </g>
          );
        })}
        {lines.map((l, k) => (
          <polyline key={k} fill="none" strokeWidth={1.5} className={l.cls} points={l.v.slice(start).map((p, i) => `${i * step + step / 2},${y(p)}`).join(" ")} />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-4xl font-bold text-foreground/5 sm:text-6xl">{live ? "LIVE MT5" : "DEMO DATA"}</div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="text-gold">— EMA 9</span><span className="text-bull">— EMA 21</span><span className="text-bear">— EMA 50</span>
        {forming && <span>Dashed = forming candle from live bid ticks (EMAs use closed candles only)</span>}
      </div>
    </div>
  );
}
