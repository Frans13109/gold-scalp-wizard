import { REASON_TEXT, STRATEGY_VERSION, isExpired, type EngineResult } from "@/lib/signal-engine";

const t = (iso: string) => new Date(iso).toISOString().slice(11, 16) + " UTC";

export function EnginePanel({ result, now }: { result: EngineResult; now: number }) {
  const { ind } = result;
  const expired = result.state === "SIGNAL" && isExpired(result.signal, now);
  return (
    <section className="space-y-3 rounded-xl border-2 border-dashed border-warn/60 p-3" aria-label="Signal engine" data-testid="engine-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Signal engine</h2>
        <span className="rounded bg-warn px-2 py-0.5 text-xs font-bold text-warn-foreground">DEMO · TESTING — NOT VALIDATED</span>
      </div>
      <p className="text-sm text-muted-foreground">
        Calculated from real MT5 candles and the live bid/ask. These are testing signals: they are not proven profitable, and nothing is ever traded.
      </p>

      {result.state === "SIGNAL" && !expired ? (
        <div className={`rounded-lg border-l-4 bg-surface p-4 ${result.signal.side === "BUY" ? "border-l-bull" : "border-l-bear"}`} data-testid="engine-signal">
          <div className={`text-2xl font-bold ${result.signal.side === "BUY" ? "text-bull" : "text-bear"}`}>{result.signal.side} · DEMO SIGNAL</div>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <F k={`Entry (${result.signal.entryReference})`} v={result.signal.entry.toFixed(result.signal.digits)} />
            <F k="Expires" v={t(result.signal.expiresAt)} />
            <F k="Stop loss" v={result.signal.stopLoss.toFixed(result.signal.digits)} cls="text-bear" />
            <F k={`Take profit · 1:${result.signal.rr.toFixed(2)}`} v={result.signal.takeProfit.toFixed(result.signal.digits)} cls="text-bull" />
          </dl>
          <p className="mt-3 rounded-lg bg-secondary p-3 text-sm"><b>Invalid if: </b>{result.signal.invalidation}</p>
          <p className="mt-2 text-sm text-muted-foreground">{result.signal.reasons.join(" · ")}</p>
        </div>
      ) : (
        <div className="rounded-lg bg-secondary p-4" data-testid="engine-no-trade">
          <div className="text-xl font-bold">NO TRADE</div>
          <div className="text-base font-semibold text-warn">{expired ? REASON_TEXT.SIGNAL_EXPIRED : REASON_TEXT[result.state === "NO_TRADE" ? result.reason : "WAITING_FOR_DATA"]}</div>
          {result.details.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">{result.details.map((d) => <li key={d}>{d}</li>)}</ul>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 rounded-lg bg-secondary p-3 sm:grid-cols-4">
        <F k="M15 bias" v={result.bias} cls={result.bias === "BULLISH" ? "text-bull" : result.bias === "BEARISH" ? "text-bear" : ""} />
        <F k="M15 EMA20 / 50" v={ind.m15 ? `${ind.m15.ema20.toFixed(2)} / ${ind.m15.ema50.toFixed(2)}` : "—"} />
        <F k="M5 EMA9 / 20" v={ind.m5 ? `${ind.m5.ema9.toFixed(2)} / ${ind.m5.ema20.toFixed(2)}` : "—"} />
        <F k="M5 RSI / ATR" v={ind.m5 ? `${ind.m5.rsi14.toFixed(1)} / ${ind.m5.atr14.toFixed(2)}` : "—"} />
        <F k="Spread" v={ind.spread != null ? ind.spread.toFixed(3) : "—"} />
        <F k="M15 candle" v={ind.m15 ? t(ind.m15.candleTime) : "—"} />
        <F k="M5 candle" v={ind.m5 ? t(ind.m5.candleTime) : "—"} />
        <F k="Strategy" v={STRATEGY_VERSION} />
      </div>
    </section>
  );
}

function F({ k, v, cls = "" }: { k: string; v: string; cls?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-muted-foreground">{k}</dt>
      <dd className={`num truncate text-lg font-semibold ${cls}`}>{v}</dd>
    </div>
  );
}
