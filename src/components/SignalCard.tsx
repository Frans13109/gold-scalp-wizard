import type { Signal } from "@/lib/signals";

const f = (n: number) => n.toFixed(2);
const time = (t: number) => new Date(t).toISOString().slice(11, 16) + " UTC";

export function SignalCard({ side, signal }: { side: "BUY" | "SELL"; signal?: Signal | undefined }) {
  const bull = side === "BUY";
  return (
    <div className="demo-stripes rounded-xl p-1" data-testid={`signal-${side}`}>
      <div className={`rounded-lg border-l-4 bg-surface p-4 opacity-90 ${bull ? "border-l-bull/60" : "border-l-bear/60"}`}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className={`text-2xl font-bold ${bull ? "text-bull" : "text-bear"}`}>{side} · SIMULATED</span>
          <span className="rounded bg-warn px-2 py-0.5 text-xs font-bold text-warn-foreground">DEMO DATA</span>
        </div>
        <p className="mb-3 rounded-md border border-warn/60 px-3 py-2 text-sm font-semibold text-warn">
          Practice example from synthetic candles. Not a real trading level — do not trade it.
        </p>
        {signal ? (
          <>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-3">
              <Field k="Simulated entry" v={f(signal.entry)} />
              <Field k="Simulated expiry" v={time(signal.expiresAt)} />
              <Field k="Simulated entry zone" v={`${f(signal.entryLow)} – ${f(signal.entryHigh)}`} wide />
              <Field k="Simulated stop loss" v={f(signal.sl)} cls="text-bear" wide />
              <Field k={`Simulated TP1 · 1:${signal.rr.toFixed(2)}`} v={f(signal.tp)} cls="text-bull" />
              <Field k={`Simulated TP2 · 1:${signal.rr2.toFixed(2)}`} v={f(signal.tp2)} cls="text-bull" />
            </dl>
            <p className="mt-2 text-sm text-muted-foreground">Worst fill in zone: TP1 risk-to-reward 1:{signal.rrWorst.toFixed(2)}</p>
            <div className="mt-3 rounded-lg bg-secondary p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold">Confluence score (simulated)</span>
                <span className="num text-lg font-semibold text-gold">{signal.score}%</span>
              </div>
              <p className="text-xs text-muted-foreground">Share of strategy checks passed. Not a win probability.</p>
            </div>
            <div className="mt-3 rounded-lg bg-secondary p-3 text-sm">
              <span className="font-semibold">Invalid if (simulated): </span>{signal.invalidation}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{signal.reasons.join(" · ")}</p>
          </>
        ) : (
          <p className="text-base text-muted-foreground">No simulated {side} setup in the demo data.</p>
        )}
      </div>
    </div>
  );
}

function Field({ k, v, cls = "", wide = false }: { k: string; v: string; cls?: string; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
      <dt className="text-sm text-muted-foreground">{k}</dt>
      <dd className={`num truncate text-lg font-semibold ${cls}`}>{v}</dd>
    </div>
  );
}
