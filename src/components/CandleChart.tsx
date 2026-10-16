import type { Candle } from "@/lib/market";
import { ema } from "@/lib/market";

export function CandleChart({ candles, count = 80, live = false }: { candles: Candle[]; count?: number; live?: boolean }) {
  const close = candles.map((c) => c.c);
  const lines = [{ v: ema(close, 9), cls: "stroke-gold" }, { v: ema(close, 21), cls: "stroke-bull" }, { v: ema(close, 50), cls: "stroke-bear" }];
  const start = Math.max(0, candles.length - count);
  const data = candles.slice(start);
  const W = 800, H = 340, pad = 8;
  const hi = Math.max(...data.map((c) => c.h)), lo = Math.min(...data.map((c) => c.l));
  const y = (p: number) => pad + ((hi - p) / (hi - lo)) * (H - pad * 2);
  const step = W / data.length, bw = step * 0.6;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-64 w-full sm:h-80" preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} className="stroke-border" />)}
        {data.map((c, i) => {
          const x = i * step + step / 2, up = c.c >= c.o;
          return (
            <g key={c.t} className={up ? "fill-bull stroke-bull" : "fill-bear stroke-bear"}>
              <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} strokeWidth={1} />
              <rect x={x - bw / 2} width={bw} y={y(Math.max(c.o, c.c))} height={Math.max(1, Math.abs(y(c.o) - y(c.c)))} />
            </g>
          );
        })}
        {lines.map((l, k) => (
          <polyline key={k} fill="none" strokeWidth={1.5} className={l.cls} points={l.v.slice(start).map((p, i) => `${i * step + step / 2},${y(p)}`).join(" ")} />
        ))}
      </svg>
      <div className="pointer-events-none absolute inset-0 grid place-items-center text-4xl font-bold text-foreground/5 sm:text-6xl">{live ? "LIVE MT5" : "DEMO DATA"}</div>
      <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
        <span className="text-gold">— EMA 9</span><span className="text-bull">— EMA 21</span><span className="text-bear">— EMA 50</span>
      </div>
    </div>
  );
}
