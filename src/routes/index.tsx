import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Panel, DemoTag } from "@/components/AppShell";
import { CandleChart } from "@/components/CandleChart";
import { SignalCard } from "@/components/SignalCard";
import { useDemoMarket } from "@/lib/use-demo";
import { at, indicators, type Candle, type Timeframe } from "@/lib/market";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "GoldScalp AI — XAUUSD Scalping Dashboard (Demo)" },
      { name: "description", content: "M15 trend + M5 entry signal dashboard for Gold (XAUUSD) scalping. Demo data, signals only." },
      { property: "og:title", content: "GoldScalp AI — XAUUSD Dashboard" },
      { property: "og:description", content: "Gold scalping signal dashboard with EMA, RSI, MACD and ATR. Demo mode." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { m5, m15, signals, trend, strategy } = useDemoMarket();
  const [tf, setTf] = useState<Timeframe>("M5");
  const last = at(m5, -1);
  const lastBuy = signals.find((s) => s.side === "BUY");
  const lastSell = signals.find((s) => s.side === "SELL");
  const spreadOk = strategy.demoSpread <= strategy.maxSpread;

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex items-center gap-2 text-base text-muted-foreground">XAUUSD · Gold <DemoTag /></div>
        <div className="num mt-1 text-4xl font-bold">{last.c.toFixed(2)}</div>
        <p className="text-sm text-muted-foreground">Simulated price — not a live quote.</p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat k="M15 trend" v={trend} cls={trend === "UP" ? "text-bull" : trend === "DOWN" ? "text-bear" : "text-muted-foreground"} />
          <Stat k="Spread" v={strategy.demoSpread.toFixed(2)} cls={spreadOk ? "text-bull" : "text-bear"} />
          <Stat k="Signals" v={String(signals.length)} />
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <SignalCard side="BUY" signal={lastBuy} />
        <SignalCard side="SELL" signal={lastSell} />
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-secondary p-1" role="tablist">
        {(["M5", "M15"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tf === t} onClick={() => setTf(t)}
            className={`min-h-12 rounded-lg text-base font-bold ${tf === t ? "bg-gold text-gold-foreground" : "text-muted-foreground"}`}>
            {t} {t === "M5" ? "· Entries" : "· Trend"}
          </button>
        ))}
      </div>
      <TimeframeView key={tf} tf={tf} candles={tf === "M5" ? m5 : m15} />
    </div>
  );
}

function TimeframeView({ tf, candles }: { tf: Timeframe; candles: Candle[] }) {
  const ind = indicators(candles);
  const close = at(candles, -1).c;
  const r = at(ind.rsi, -1), h = at(ind.macd.hist, -1), a = at(ind.atr, -1);
  const atrPct = (a / close) * 100;
  const vol = atrPct > 0.08 ? "HIGH" : atrPct > 0.04 ? "NORMAL" : "LOW";
  return (
    <div className="space-y-4">
      <Panel title={`XAUUSD ${tf} chart`} right={<DemoTag />}>
        <CandleChart candles={candles} />
      </Panel>
      <Panel title={`${tf} indicators`} right={<DemoTag />}>
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
