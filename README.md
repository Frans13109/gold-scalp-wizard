# Gold Scalp Wizard

Build a responsive web application called GoldScalp AI, designed for mobile and desktop.

PURPOSE:
Identify potential Gold (XAU/USD) scalping opportunities using M15 for trend direction and M5 for entry confirmation. The app must provide BUY and SELL signals and alerts only. It must never execute trades.

DESIGN:
Create a premium dark trading dashboard with green bullish indicators, red bearish indicators, and clean professional typography.

DASHBOARD:

XAU/USD market overview.

M5 and M15 timeframe selectors.

Large candlestick chart area.

BUY and SELL signal cards.

Entry zone, stop-loss, take-profit, and risk-to-reward fields.

Technical indicator panel showing EMA 9, EMA 21, EMA 50, RSI 14, MACD, and ATR 14.

Market trend and volatility indicators.

Signal history.

Strategy settings.

Notification settings.

MT5 connection status panel.

SIGNAL RULES:
Use M15 to determine the broader trend and M5 to identify potential entries. Support configurable trend, momentum, price-action, spread, and risk-to-reward conditions.

DATA SAFETY:
For now, use clearly labelled DEMO DATA only. Display a prominent DEMO MODE indicator. Never present invented prices or demo signals as live market information. Do not claim that MetaTrader 5 is connected.

MT5 INTEGRATION:
Prepare a clearly defined backend interface for a future read-only Python bridge running on Windows. Show the connection status as NOT CONNECTED until a real connection has been verified.

TECHNOLOGY:
Use React, TypeScript, Tailwind CSS, and shadcn/ui. Keep components organised and prepare for a future Supabase backend.

SAFETY:
No automatic trading, no broker order execution, and no requests for broker passwords. Do not claim that a feature works unless it has actually been implemented and tested.

Build the first functional version now. Prioritise the dashboard, navigation, responsive mobile layout, demo-mode labelling, and connection-status panel.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c844bde8-60a1-46c1-a958-97c917e1dd6a).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
