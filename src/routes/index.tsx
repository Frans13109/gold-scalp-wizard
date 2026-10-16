import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Panel, DemoTag, LiveTag } from "@/components/AppShell";
import { CandleChart } from "@/components/CandleChart";
import { SignalCard } from "@/components/SignalCard";
import { useDemoMarket } from "@/lib/use-demo";
import { useLiveCandles } from "@/lib/use-live-candles";
import { useLiveTick } from "@/lib/use-live-tick";
import type { LiveTick } from "@/lib/live-tick";
import { useFormingCandle } from "@/lib/use-forming-candle";
import { formingToShow, type FormingCandle } from "@/lib/forming-candle";
import { at, indicators, type Candle, type Timeframe } from "@/lib/market";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GoldScalp AI — XAUUSD Scalping Dashboard (Demo)" },
      { name: "description", content: "M15 trend + M5 entry signal dashboard for Gold (XAUUSD) scalping. Demo data, signals only." },
      { property: "og:title", content: "GoldScalp AI — XAUUSD Dashboard" },
      { property: "og:description", content: "Gold scalping signal dashboard with EMA, RSI, MACD and ATR. Demo mode." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { m5, m15, signals, trend, strategy } = useDemoMarket();
  const [tf, setTf] = useState<Timeframe>("M5");
  const live = useLiveCandles();
  const priceLive = live.M5.state === "LIVE";
  const last = at(priceLive ? live.M5.candles : m5, -1);
  const tick = useLiveTick();
  const formingRaw = useFormingCandle(tick);
  const series = (t: Timeframe) => (live[t].state === "LIVE" ? live[t].candles : t === "M5" ? m5 : m15);
  const lastBuy = signals.find((s) => s.side === "BUY");
  const lastSell = signals.find((s) => s.side === "SELL");
  const spreadOk = strategy.demoSpread <= strategy.maxSpread;

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        {tick.state !== "MISSING" && <TickPrice tick={tick} />}
        <div className={`flex items-center gap-2 text-base text-muted-foreground ${tick.state !== "MISSING" ? "mt-4 border-t pt-3" : ""}`}>
          {tick.state !== "MISSING" ? "Last closed M5 candle" : "XAUUSD · Gold"} {priceLive ? <LiveTag /> : <DemoTag />}
        </div>
        <div className={`num mt-1 font-bold ${tick.state !== "MISSING" ? "text-2xl" : "text-4xl"}`}>{last.c.toFixed(2)}</div>
        <p className="text-sm text-muted-foreground">
          {priceLive
            ? `Close of the M5 candle ${new Date(last.t).toUTCString().slice(17, 22)}–${new Date(last.t + 5 * 60_000).toUTCString().slice(17, 22)} UTC · updates once every 5 minutes when the next candle closes`
            : live.M5.state === "STALE" ? "Real candles are out of date — showing simulated price." : "Simulated price — not a live quote."}
        </p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat k="M15 trend (simulated)" v={trend} cls={trend === "UP" ? "text-bull" : trend === "DOWN" ? "text-bear" : "text-muted-foreground"} />
          <Stat k="Spread" v={strategy.demoSpread.toFixed(2)} cls={spreadOk ? "text-bull" : "text-bear"} />
          <Stat k="Simulated signals" v={String(signals.length)} />
        </div>
      </section>

      <section className="space-y-3 rounded-xl border-2 border-dashed border-warn/60 p-3" aria-label="Simulated signals">
        <div className="space-y-1">
          <h2 className="text-lg font-bold text-warn">Live BUY/SELL signals are not available yet</h2>
          <p className="text-sm text-muted-foreground">
            The cards below are SIMULATED examples built from synthetic demo candles. Their prices do not match the real market and must not be traded.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-secondary p-3" data-testid="live-price-beside-signals">
          <span className="text-sm font-semibold">
            {tick.state === "LIVE" ? "Real XAUUSD bid (live tick)" : priceLive ? "Real XAUUSD price (last closed M5)" : "XAUUSD price (simulated — no live data)"}
          </span>
          <span className="flex items-center gap-2">
            <span className="num text-xl font-bold">{(tick.state === "LIVE" && tick.price != null ? tick.price : last.c).toFixed(2)}</span>
            {tick.state === "LIVE" || priceLive ? <LiveTag /> : <DemoTag />}
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <SignalCard side="BUY" signal={lastBuy} />
          <SignalCard side="SELL" signal={lastSell} />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary p-1" role="tablist">
        {(["M5", "M15"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tf === t} onClick={() => setTf(t)}
            className={`min-h-12 rounded-lg text-base font-bold ${tf === t ? "bg-gold text-gold-foreground" : "text-muted-foreground"}`}>
            {t} {t === "M5" ? "· Entries" : "· Trend"}
          </button>
        ))}
      </div>
      <TimeframeView key={tf} tf={tf} candles={series(tf)} live={live[tf].state === "LIVE"}
        forming={tf === "M5" && live.M5.state === "LIVE" ? formingToShow(live.M5.candles, formingRaw, tick.state === "LIVE") : null}
        tickState={tf === "M5" && live.M5.state === "LIVE" ? tick.state : null} />
    </div>
  );
}

function TimeframeView({ tf, candles, live, forming, tickState }: { tf: Timeframe; candles: Candle[]; live: boolean; forming: FormingCandle | null; tickState: LiveTick["state"] | null }) {
  const ind = indicators(candles);
  const close = at(candles, -1).c;
  const r = at(ind.rsi, -1), h = at(ind.macd.hist, -1), a = at(ind.atr, -1);
  const atrPct = (a / close) * 100;
  const vol = atrPct > 0.08 ? "HIGH" : atrPct > 0.04 ? "NORMAL" : "LOW";
  return (
    <div className="space-y-4">
      <Panel title={`XAUUSD ${tf} chart`} right={live ? <LiveTag /> : <DemoTag />}>
        <CandleChart candles={candles} live={live} forming={forming} />
        {forming?.partial && <p className="mt-1 text-xs text-muted-foreground">Forming candle open is the first tick seen since this page opened; MT5's closed candle will replace it.</p>}
        {tickState && tickState !== "LIVE" && (
          <p className="mt-2 text-sm font-semibold text-bear">
            {tickState === "MISSING" ? "No live ticks received — chart shows closed candles only." : tickState === "STALE" ? "Live ticks have stopped — forming candle hidden; showing closed candles only." : "Live tick feed lost — forming candle hidden; showing closed candles only."}
          </p>
        )}
      </Panel>
      <Panel title={`${tf} indicators`} right={live ? <LiveTag /> : <DemoTag />}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat k="EMA 9" v={at(ind.ema9, -1).toFixed(2)} />
          <Stat k="EMA 21" v={at(ind.ema21, -1).toFixed(2)} />
          <Stat k="EMA 50" v={at(ind.ema50, -1).toFixed(2)} />
          <Stat k="RSI 14" v={r.toFixed(1)} cls={r > 70 ? "text-bear" : r < 30 ? "text-bull" : ""} />
          <Stat k="MACD hist" v={h.toFixed(3)} cls={h >= 0 ? "text-bull" : "text-bear"} />
          <Stat k={`ATR 14 · ${vol}`} v={a.toFixed(2)} />
        </div>
      </Panel>
    </div>
  );
}

function Stat({ k, v, cls = "" }: { k: string; v: string; cls?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-sm text-muted-foreground">{k}</div>
      <div className={`num truncate text-lg font-semibold ${cls}`}>{v}</div>
    </div>
  );
}

function TickPrice({ tick }: { tick: LiveTick }) {
  const live = tick.state === "LIVE";
  const badge = live
    ? <span className="rounded border border-bull/50 px-2 py-0.5 text-xs font-bold text-bull">LIVE TICK</span>
    : <span className="rounded border border-bear px-2 py-0.5 text-xs font-bold text-bear">{tick.state === "STALE" ? "STALE" : "CONNECTION LOST"}</span>;
  const secs = tick.ageMs == null ? "" : `${Math.round(tick.ageMs / 1000)}s ago`;
  return (
    <div data-testid="live-tick" data-state={tick.state}>
      <div className="flex items-center gap-2 text-base text-muted-foreground">XAUUSD · Gold · Bid {badge}</div>
      <div className={`num mt-1 text-5xl font-bold ${live ? "" : "text-muted-foreground line-through decoration-2"}`}>{tick.price?.toFixed(2)}</div>
      <p className="num text-sm text-muted-foreground">
        Bid {tick.bid?.toFixed(2)} · Ask {tick.ask?.toFixed(2)} · Spread {tick.bid != null && tick.ask != null ? (tick.ask - tick.bid).toFixed(2) : "—"}
      </p>
      <p className={`text-sm ${live ? "text-muted-foreground" : "font-semibold text-bear"}`}>
        Last tick {tick.tickTime ? new Date(tick.tickTime).toISOString().slice(11, 19) : "—"} UTC ({secs})
        {tick.state === "STALE" && " — no new ticks; price is NOT live (market may be quiet or closed)."}
        {tick.state === "CONNECTION_LOST" && " — MT5 bridge feed lost; this price is NOT live."}
      </p>
    </div>
  );
}
