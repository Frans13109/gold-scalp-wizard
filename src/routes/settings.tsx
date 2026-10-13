import { createFileRoute } from "@tanstack/react-router";
import { Panel } from "@/components/AppShell";
import { defaultNotifications, defaultStrategy, useStored, type NotificationSettings, type StrategySettings } from "@/lib/settings";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Strategy & Notification Settings — GoldScalp AI" },
      { name: "description", content: "Configure trend, momentum, price-action, spread and risk-to-reward rules." },
      { property: "og:title", content: "Settings — GoldScalp AI" },
      { property: "og:description", content: "Configure GoldScalp AI signal rules and alerts." },
    ],
  }),
  component: Settings,
});

function Settings() {
  const [s, setS] = useStored<StrategySettings>("gs-strategy", defaultStrategy);
  const [n, setN] = useStored<NotificationSettings>("gs-notify", defaultNotifications);
  const num = (k: keyof StrategySettings, label: string, step = 0.05) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <input type="number" step={step} value={s[k] as number} onChange={(e) => setS({ ...s, [k]: Number(e.target.value) })} className="num w-24 rounded-md border bg-input/30 px-2 py-1 text-right" />
    </label>
  );
  const tog = <T extends object>(obj: T, set: (v: T) => void, k: keyof T, label: string) => (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <input type="checkbox" checked={obj[k] as boolean} onChange={(e) => set({ ...obj, [k]: e.target.checked })} className="h-4 w-4 accent-gold" />
    </label>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Panel title="Strategy settings">
        <div className="space-y-3">
          {tog(s, setS, "requireTrendAlignment", "Trend: require M15 EMA21/50 alignment")}
          {num("rsiBuyMin", "Momentum: min RSI for BUY", 1)}
          {num("rsiSellMax", "Momentum: max RSI for SELL", 1)}
          {tog(s, setS, "requireMacdConfirm", "Momentum: MACD histogram confirm")}
          {tog(s, setS, "requireCandleConfirm", "Price action: confirmation candle")}
          {num("maxSpread", "Max spread allowed")}
          {num("demoSpread", "Demo spread (simulated)")}
          {num("minRR", "Risk : Reward target", 0.1)}
          {num("slAtrMult", "Stop-loss (× ATR 14)", 0.1)}
          <button onClick={() => setS(defaultStrategy)} className="text-xs text-gold underline">Reset to defaults</button>
        </div>
      </Panel>
      <Panel title="Notification settings">
        <div className="space-y-3">
          {tog(n, setN, "inApp", "In-app alerts")}
          {tog(n, setN, "sound", "Sound")}
          {tog(n, setN, "buy", "Alert on BUY signals")}
          {tog(n, setN, "sell", "Alert on SELL signals")}
          <p className="text-xs text-muted-foreground">Preferences are saved on this device. Alert delivery will activate once live data is connected — no alerts fire on demo data.</p>
        </div>
      </Panel>
    </div>
  );
}
