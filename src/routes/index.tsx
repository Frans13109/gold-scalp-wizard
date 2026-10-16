import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Panel, DemoTag, LiveTag } from "@/components/AppShell";
import { CandleChart } from "@/components/CandleChart";
import { SignalCard } from "@/components/SignalCard";
import { useDemoMarket } from "@/lib/use-demo";
import { useLiveCandles } from "@/lib/use-live-candles";
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
  const series = (t: Timeframe) => (live[t].state === "LIVE" ? live[t].candles : t === "M5" ? m5 : m15);
  const lastBuy = signals.find((s) => s.side === "BUY");
  const lastSell = signals.find((s) => s.side === "SELL");
  const spreadOk = strategy.demoSpread <= strategy.maxSpread;

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex items-center gap-2 text-base text-muted-foreground">XAUUSD · Gold {priceLive ? <LiveTag /> : <DemoTag />}</div>
        <div className="num mt-1 text-4xl font-bold">{last.c.toFixed(2)}</div>
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
            {priceLive ? "Real XAUUSD price (last closed M5)" : "XAUUSD price (simulated — no live data)"}
          </span>
          <span className="flex items-center gap-2">
            <span className="num text-xl font-bold">{last.c.toFixed(2)}</span>
            {priceLive ? <LiveTag /> : <DemoTag />}
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
      <TimeframeView key={tf} tf={tf} candles={series(tf)} live={live[tf].state === "LIVE"} />
    </div>
  );
}

function TimeframeView({ tf, candles, live }: { tf: Timeframe; candles: Candle[]; live: boolean }) {
  const ind = indicators(candles);
  const close = at(candles, -1).c;
  const r = at(ind.rsi, -1), h = at(ind.macd.hist, -1), a = at(ind.atr, -1);
  const atrPct = (a / close) * 100;
  const vol = atrPct > 0.08 ? "HIGH" : atrPct > 0.04 ? "NORMAL" : "LOW";
  return (
    <div className="space-y-4">
      <Panel title={`XAUUSD ${tf} chart`} right={live ? <LiveTag /> : <DemoTag />}>
        <CandleChart candles={candles} live={live} />
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
