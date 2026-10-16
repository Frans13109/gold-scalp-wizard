import { Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUser } from "@/lib/use-session";
import { useBridgeStatus, statusLabel } from "@/lib/use-bridge-status";

function StatusPill() {
  const { status } = useBridgeStatus();
  const cls = status === "CONNECTED" ? "border-bull/40 text-bull" : status === "ERROR" ? "border-warn/60 text-warn" : "border-bear/40 text-bear";
  return <span className={`rounded-full border px-3 py-1.5 text-xs font-bold sm:text-sm ${cls}`}>MT5 STATUS: {statusLabel(status)}</span>;
}

function AccountButton() {
  const user = useUser();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const cls = "rounded-md border px-3 py-1.5 text-xs font-semibold sm:text-sm";
  if (user === undefined) return null;
  if (!user) return <Link to="/auth" className={cls}>Sign in</Link>;
  return (
    <button
      className={cls}
      title={user.email ?? undefined}
      onClick={async () => {
        await qc.cancelQueries();
        qc.clear();
        await supabase.auth.signOut();
        navigate({ to: "/auth", replace: true });
      }}
    >
      Sign out
    </button>
  );
}

const nav = [
  { to: "/", label: "Dashboard" },
  { to: "/signals", label: "History" },
  { to: "/settings", label: "Settings" },
  { to: "/connection", label: "MT5" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen pb-20 md:pb-0">
      <div className="demo-stripes px-3 py-2 text-center text-sm font-bold tracking-wide">
        DEMO MODE — synthetic data only. Not live prices. Signals only, no trading.
      </div>
      <header className="sticky top-0 z-20 border-b bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-gold text-sm font-bold text-gold-foreground">Au</span>
            <span className="truncate text-lg font-bold">GoldScalp <span className="text-gold">AI</span></span>
          </Link>
          <nav className="hidden gap-1 md:flex">
            {nav.map((n) => (
              <Link key={n.to} to={n.to} activeOptions={{ exact: true }} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground" activeProps={{ className: "bg-secondary text-foreground" }}>
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <StatusPill />
            <AccountButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-4">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t bg-surface md:hidden">
        {nav.map((n) => (
          <Link key={n.to} to={n.to} activeOptions={{ exact: true }} className="py-4 text-center text-sm text-muted-foreground" activeProps={{ className: "text-gold font-semibold" }}>
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function Panel({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function DemoTag() {
  return <span className="rounded bg-warn px-2 py-0.5 text-xs font-bold text-warn-foreground">DEMO DATA</span>;
}
