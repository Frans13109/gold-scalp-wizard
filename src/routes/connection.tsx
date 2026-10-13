import { createFileRoute } from "@tanstack/react-router";
import { Panel } from "@/components/AppShell";
import { bridgeEndpoints, getBridgeStatus } from "@/lib/mt5-bridge";

export const Route = createFileRoute("/connection")({
  head: () => ({
    meta: [
      { title: "MT5 Connection Status — GoldScalp AI" },
      { name: "description", content: "Status of the future read-only MetaTrader 5 Python bridge." },
      { property: "og:title", content: "MT5 Connection — GoldScalp AI" },
      { property: "og:description", content: "Read-only MT5 bridge status. Currently not connected." },
    ],
  }),
  component: Connection,
});

function Connection() {
  const status = getBridgeStatus();
  return (
    <div className="space-y-4">
      <Panel title="MT5 connection status">
        <div className="flex items-center gap-3">
          <span className="h-3 w-3 shrink-0 rounded-full bg-bear" />
          <span className="text-2xl font-bold text-bear">{status.replace("_", " ")}</span>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">No MetaTrader 5 bridge has been configured or verified. All prices and signals in this app are demo data.</p>
      </Panel>
      <Panel title="Planned read-only bridge interface">
        <p className="mb-3 text-sm text-muted-foreground">A future Python service on Windows will read XAUUSD data from your locally logged-in Exness MT5 terminal and expose these endpoints. It will be market-data only.</p>
        <ul className="space-y-2">
          {bridgeEndpoints.map((e) => (
            <li key={e.path} className="rounded-md bg-secondary p-3 text-sm">
              <code className="num text-gold">{e.method} {e.path}</code>
              <div className="text-xs text-muted-foreground">{e.desc}</div>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Safety guarantees">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>No automatic trading and no order execution — ever.</li>
          <li>The app never asks for broker passwords.</li>
          <li>Status shows CONNECTED only after a real health check succeeds.</li>
        </ul>
      </Panel>
    </div>
  );
}
