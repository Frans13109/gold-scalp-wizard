import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Panel, DemoTag } from "@/components/AppShell";
import { CandleChart } from "@/components/CandleChart";
import { SignalCard } from "@/components/SignalCard";
import { useDemoMarket } from "@/lib/use-demo";
import { indicators, type Timeframe } from "@/lib/market";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GoldScalp AI — XAU/USD Scalping Dashboard (Demo)" },
      { name: "description", content: "M15 trend + M5 entry signal dashboard for Gold scalping. Demo data, signals only." },
      { property: "og:title", content: "GoldScalp AI — XAU/USD Dashboard" },
      { property: "og:description", content: "Gold scalping signal dashboard with EMA, RSI, MACD and ATR. Demo mode." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { m5, m15, signals, trend, strategy } = useDemoMarket();
  const [tf, setTf] = useState<Timeframe>("M5");
  const candles = tf === "M5" ? m5 : m15;
  const ind = indicators(candles);
  const n = candles.length - 1, last = candles[n], prev = candles[n - 1];
  const chg = last.c - prev.c;
  const atrPct = (ind.atr[n] / last.c) * 100;
  const vol = atrPct > 0.08 ? "HIGH" : atrPct > 0.04 ? "NORMAL" : "LOW";
  const lastBuy = signals.find((s) => s.side === "BUY");
  const lastSell = signals.find((s) => s.side === "SELL");

  return (
    <div className="space-y-4">
      <section className="panel flex flex-wrap items-end justify-between gap-4 p-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">XAU/USD <DemoTag /></div>
          <div className="num text-3xl font-bold sm:text-4xl">{last.c.toFixed(2)}</div>
          <div className={`num text-sm ${chg >= 0 ? "text-bull" : "text-bear"}`}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)} vs prior {tf} candle</div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <Stat k="M15 trend" v={trend} cls={trend === "UP" ? "text-bull" : trend === "DOWN" ? "text-bear" : "text-muted-foreground"} />
          <Stat k="Volatility" v={vol} cls="text-gold" />
          <Stat k="Spread" v={strategy.demoSpread.toFixed(2)} cls={strategy.demoSpread <= strategy.maxSpread ? "text-bull" : "text-bear"} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title={`XAU/USD ${tf} chart`} right={
            <div className="flex rounded-md bg-secondary p-0.5">
              {(["M5", "M15"] as const).map((t) => (
                <button key={t} onClick={() => setTf(t)} className={`rounded px-3 py-1 text-xs font-semibold ${tf === t ? "bg-gold text-gold-foreground" : "text-muted-foreground"}`}>{t}</button>
              ))}
            </div>
          }>
            <CandleChart candles={candles} />
          </Panel>
        </div>
        <div className="space-y-4">
          <SignalCard side="BUY" signal={lastBuy} />
          <SignalCard side="SELL" signal={lastSell} />
        </div>
      </div>

      <Panel title={`Indicators (${tf})`} right={<DemoTag />}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat k="EMA 9" v={ind.ema9[n].toFixed(2)} />
          <Stat k="EMA 21" v={ind.ema21[n].toFixed(2)} />
          <Stat k="EMA 50" v={ind.ema50[n].toFixed(2)} />
          <Stat k="RSI 14" v={ind.rsi[n].toFixed(1)} cls={ind.rsi[n] > 70 ? "text-bear" : ind.rsi[n] < 30 ? "text-bull" : ""} />
          <Stat k="MACD hist" v={ind.macd.hist[n].toFixed(3)} cls={ind.macd.hist[n] >= 0 ? "text-bull" : "text-bear"} />
          <Stat k="ATR 14" v={ind.atr[n].toFixed(2)} />
        </div>
      </Panel>
    </div>
  );
}

function Stat({ k, v, cls = "" }: { k: string; v: string; cls?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{k}</div>
      <div className={`num truncate font-semibold ${cls}`}>{v}</div>
    </div>
  );
}
