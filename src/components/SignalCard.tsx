import type { Signal } from "@/lib/signals";
import { DemoTag } from "./AppShell";

const f = (n: number) => n.toFixed(2);
const time = (t: number) => new Date(t).toISOString().slice(11, 16) + " UTC";

export function SignalCard({ side, signal }: { side: "BUY" | "SELL"; signal?: Signal | undefined }) {
  const bull = side === "BUY";
  return (
    <div className={`panel border-l-4 p-4 ${bull ? "border-l-bull" : "border-l-bear"}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className={`text-2xl font-bold ${bull ? "text-bull" : "text-bear"}`}>{side}</span>
        <DemoTag />
      </div>
      {signal ? (
        <>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-3">
            <Field k="Entry" v={`${f(signal.entryLow)}–${f(signal.entryHigh)}`} wide />
            <Field k="Stop loss" v={f(signal.sl)} cls="text-bear" />
            <Field k="Risk : Reward" v={`1 : ${signal.rr.toFixed(1)}`} />
            <Field k="Take profit 1" v={f(signal.tp)} cls="text-bull" />
            <Field k="Take profit 2" v={f(signal.tp2)} cls="text-bull" />
            <Field k="Setup score" v={`${signal.score}/100`} cls="text-gold" />
            <Field k="Expires" v={time(signal.expiresAt)} />
          </dl>
          <div className="mt-3 rounded-lg bg-secondary p-3 text-sm">
            <span className="font-semibold">Invalid if: </span>{signal.invalidation}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{signal.reasons.join(" · ")}</p>
        </>
      ) : (
        <p className="text-base text-muted-foreground">No {side} setup right now under your strategy rules.</p>
      )}
    </div>
  );
}

function Field({ k, v, cls = "", wide = false }: { k: string; v: string; cls?: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <dt className="text-sm text-muted-foreground">{k}</dt>
      <dd className={`num text-lg font-semibold ${cls}`}>{v}</dd>
    </div>
  );
}
