import { useEffect, useState } from "react";

export type StrategySettings = {
  requireTrendAlignment: boolean;
  rsiBuyMin: number;
  rsiSellMax: number;
  requireMacdConfirm: boolean;
  requireCandleConfirm: boolean;
  maxSpread: number;
  demoSpread: number;
  minRR: number;
  slAtrMult: number;
};
export type NotificationSettings = { inApp: boolean; sound: boolean; buy: boolean; sell: boolean };

export const defaultStrategy: StrategySettings = {
  requireTrendAlignment: true, rsiBuyMin: 50, rsiSellMax: 50, requireMacdConfirm: true,
  requireCandleConfirm: true, maxSpread: 0.35, demoSpread: 0.25, minRR: 1.5, slAtrMult: 1.5,
};
export const defaultNotifications: NotificationSettings = { inApp: true, sound: false, buy: true, sell: true };

export function useStored<T extends object>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try { const s = localStorage.getItem(key); if (s) setValue({ ...initial, ...JSON.parse(s) }); } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const update = (v: T) => { setValue(v); localStorage.setItem(key, JSON.stringify(v)); };
  return [value, update] as const;
}
