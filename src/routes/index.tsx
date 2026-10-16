import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Panel, DemoTag, LiveTag } from "@/components/AppShell";
import { CandleChart } from "@/components/CandleChart";
import { EnginePanel } from "@/components/EnginePanel";
import { evaluateSignal } from "@/lib/signal-engine";
import { trendStat } from "@/lib/trend-stat";
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
  const { m5, m15, trend, strategy } = useDemoMarket();
  const [tf, setTf] = useState<Timeframe>("M5");
  const live = useLiveCandles();
  const priceLive = live.M5.state === "LIVE";
  const last = at(priceLive ? live.M5.candles : m5, -1);
  const tick = useLiveTick();
  const formingRaw = useFormingCandle(tick);
  const series = (t: Timeframe) => (live[t].state === "LIVE" ? live[t].candles : t === "M5" ? m5 : m15);
  const spreadOk = strategy.demoSpread <= strategy.maxSpread;
  // Engine uses real data only; never demo candles. Re-evaluates as the live tick updates.
  const now = Date.now();
  const engineTick = tick.state === "LIVE" && tick.bid != null && tick.ask != null && tick.tickTime ? { bid: tick.bid, ask: tick.ask, tickTime: tick.tickTime } : null;
  const engine = useMemo(() => evaluateSignal(live.M5.candles, live.M15.candles, engineTick, now),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live.M5.candles, live.M15.candles, engineTick?.bid, engineTick?.ask, engineTick?.tickTime, Math.floor(now / 1000)]);

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
          {(() => { const s = trendStat(live.M5.state === "LIVE" && live.M15.state === "LIVE", trend, engine.bias);
            return <Stat k={s.label} v={s.value} cls={s.tone === "bull" ? "text-bull" : s.tone === "bear" ? "text-bear" : "text-muted-foreground"} />; })()}
          <Stat k="Spread" v={strategy.demoSpread.toFixed(2)} cls={spreadOk ? "text-bull" : "text-bear"} />
        </div>
      </section>

      <EnginePanel result={engine} now={now} />

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
