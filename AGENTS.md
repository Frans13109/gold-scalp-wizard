<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Index arrays via `at()` from src/lib/market.ts; strict noUncheckedIndexedAccess stays on — why: catches out-of-range reads in indicator math.
- Database tables are read-only for signed-in users; only server code with the service role writes (future MT5 bridge feed) — why: no client can forge prices, signals or connection status.
- Pages that need sign-in live under src/routes/_authenticated/ (client-only gate redirecting to /auth); Dashboard and Settings stay public — why: one consistent gate, demo dashboard viewable without an account.
