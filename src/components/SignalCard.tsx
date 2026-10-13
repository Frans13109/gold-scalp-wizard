import type { Signal } from "@/lib/signals";
import { DemoTag } from "./AppShell";

const f = (n: number) => n.toFixed(2);

export function SignalCard({ side, signal }: { side: "BUY" | "SELL"; signal?: Signal }) {
  const bull = side === "BUY";
  return (
    <div className={`panel border-l-4 p-4 ${bull ? "border-l-bull" : "border-l-bear"}`}>
      <div className="mb-3 flex items-center justify-between">
        <span className={`text-xl font-bold ${bull ? "text-bull" : "text-bear"}`}>{side} signal</span>
        <DemoTag />
      </div>
      {signal ? (
        <>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Field k="Entry zone" v={`${f(signal.entryLow)} – ${f(signal.entryHigh)}`} />
            <Field k="Risk : Reward" v={`1 : ${signal.rr.toFixed(1)}`} />
            <Field k="Stop-loss" v={f(signal.sl)} cls="text-bear" />
            <Field k="Take-profit" v={f(signal.tp)} cls="text-bull" />
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">Demo candle {new Date(signal.time).toISOString().slice(5, 16).replace("T", " ")} UTC · {signal.reasons.join(" · ")}</p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No {side} setup matches the current strategy rules in the demo data.</p>
      )}
    </div>
  );
}

function Field({ k, v, cls = "" }: { k: string; v: string; cls?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className={`num font-semibold ${cls}`}>{v}</dd>
    </div>
  );
}
