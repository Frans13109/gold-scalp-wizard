import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Panel } from "@/components/AppShell";

type Search = { redirect?: string };

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    redirect: typeof s.redirect === "string" && s.redirect.startsWith("/") && !s.redirect.startsWith("//") ? s.redirect : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in or Register — GoldScalp AI" },
      { name: "description", content: "Sign in or create a GoldScalp AI account with your email and password." },
      { property: "og:title", content: "Sign in — GoldScalp AI" },
      { property: "og:description", content: "Access your GoldScalp AI signal history and MT5 status." },
    ],
  }),
  component: AuthPage,
});

function friendly(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "Email or password is incorrect.";
  if (m.includes("email not confirmed")) return "Please confirm your email first — check your inbox for the link.";
  if (m.includes("already registered")) return "An account with this email already exists. Try signing in.";
  if (m.includes("rate limit")) return "Too many attempts. Please wait a few minutes and try again.";
  if (m.includes("password")) return msg;
  return msg || "Something went wrong. Please try again.";
}

function AuthPage() {
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "register">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null);
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) { setError(friendly(error.message)); return; }
        navigate({ to: redirect ?? "/", replace: true });
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + "/auth" } });
        if (error) { setError(friendly(error.message)); return; }
        if (data.user && data.user.identities?.length === 0) { setError("An account with this email already exists. Try signing in."); return; }
        setInfo("Account created. Check your email and click the confirmation link, then sign in here.");
        setMode("signin"); setPassword("");
      }
    } catch {
      setError("Could not reach the sign-in service. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  const input = "w-full rounded-md border bg-input/30 px-3 py-3 text-base";
  return (
    <div className="mx-auto max-w-md">
      <Panel title={mode === "signin" ? "Sign in" : "Create account"}>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {(["signin", "register"] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMode(m); setError(null); setInfo(null); }}
              className={`rounded-md py-3 text-base font-semibold ${mode === m ? "bg-gold text-gold-foreground" : "bg-secondary text-muted-foreground"}`}>
              {m === "signin" ? "Sign in" : "Register"}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm">Email
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
          </label>
          <label className="block text-sm">Password
            <input type="password" required minLength={8} autoComplete={mode === "signin" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} className={input} />
          </label>
          {error && <p role="alert" className="rounded-md border border-bear/40 p-3 text-sm text-bear">{error}</p>}
          {info && <p role="status" className="rounded-md border border-bull/40 p-3 text-sm text-bull">{info}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-md bg-gold py-3 text-base font-bold text-gold-foreground disabled:opacity-60">
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        <p className="mt-4 text-xs text-muted-foreground">This is your GoldScalp AI account only. Never enter your Exness or MT5 login details here.</p>
      </Panel>
    </div>
  );
}
