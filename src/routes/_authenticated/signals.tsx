import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Panel } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";

// Reads run in the browser as the signed-in user, so RLS applies (SELECT only).
const historyQuery = queryOptions({
  queryKey: ["signal-history"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("signals")
      .select(
        "id, side, timeframe, entry, entry_low, entry_high, stop_loss, take_profit_1, take_profit_2, rr_tp1, confluence_score, status, is_demo, created_at, expires_at, signal_outcomes(outcome, exit_price, result_r, closed_at)",
      )
      .eq("symbol", "XAUUSD")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data;
  },
});

export const Route = createFileRoute("/_authenticated/signals")({
  head: () => ({
    meta: [
      { title: "Signal History — GoldScalp AI" },
      { name: "description", content: "Stored XAUUSD BUY and SELL signal history and outcomes." },
      { property: "og:title", content: "Signal History — GoldScalp AI" },
      { property: "og:description", content: "Stored XAU/USD scalping signal history and outcomes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(historyQuery),
  errorComponent: ({ error }) => (
    <Panel title="Signal history">
      <p className="text-sm text-bear">Could not load signal history: {error.message}</p>
    </Panel>
  ),
  component: History,
});

const fmt = (n: number | null) => (n == null ? "—" : Number(n).toFixed(2));
const when = (t: string) => new Date(t).toISOString().slice(5, 16).replace("T", " ");

function History() {
  const { data: signals } = useSuspenseQuery(historyQuery);
  return (
    <Panel title={`Signal history (${signals.length})`}>
      {signals.length === 0 && (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p className="text-base font-semibold text-foreground">No stored signals yet.</p>
          <p>Signals will appear here once the server records them. MT5 is NOT CONNECTED, so nothing is being recorded right now.</p>
          <p>The demo signals on the Dashboard are simulated and are not saved.</p>
        </div>
      )}
      <ul className="divide-y">
        {signals.map((s) => {
          const o = Array.isArray(s.signal_outcomes) ? s.signal_outcomes[0] : s.signal_outcomes;
          return (
            <li key={s.id} className="space-y-1 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`w-14 rounded px-2 py-1 text-center text-xs font-bold ${s.side === "BUY" ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>{s.side}</span>
                <span className="num text-muted-foreground">{when(s.created_at)} · {s.timeframe}</span>
                <span className="rounded border px-2 py-0.5 text-xs uppercase">{s.status.replace("_", " ")}</span>
                {s.is_demo && <span className="rounded bg-muted px-2 py-0.5 text-xs font-bold">DEMO DATA</span>}
              </div>
              <div className="num grid grid-cols-2 gap-x-3 sm:grid-cols-4">
                <span>Entry {s.entry_low != null && s.entry_high != null ? `${fmt(s.entry_low)}–${fmt(s.entry_high)}` : fmt(s.entry)}</span>
                <span className="text-bear">SL {fmt(s.stop_loss)}</span>
                <span className="text-bull">TP1 {fmt(s.take_profit_1)} · 1:{Number(s.rr_tp1).toFixed(1)}</span>
                <span>Confluence {s.confluence_score}/100</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {o ? `Outcome: ${o.outcome.toUpperCase()} · exit ${fmt(o.exit_price)} · ${o.result_r == null ? "—" : `${Number(o.result_r).toFixed(2)}R`}` : "Outcome: not recorded"}
              </p>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
