# GoldScalp AI — proposed database structure (not applied yet)

## What I found
- The database is empty (no tables). The app runs entirely on demo candles generated in the browser.
- There is no sign-in yet. Settings and history are kept on the device only.
- The MT5 bridge is a read-only description; status is hard-coded to NOT CONNECTED.

## Tables to create (4)

1. **market_candles** — XAUUSD price bars
   - symbol (fixed to XAUUSD), timeframe (M5 or M15), candle open time, open, high, low, close, tick volume, spread, source (`mt5_bridge` or `demo`), received time
   - One row per symbol + timeframe + open time (no duplicates)

2. **signals** — every BUY/SELL signal (current and past)
   - side (BUY/SELL), timeframe, entry, entry zone low/high, stop loss, take profit 1 and 2, risk-to-reward (TP1, TP2, worst fill), confluence score (0–100, labelled as checks passed, not win chance), reasons, invalidation rule text, status (active / expired / invalidated / hit TP / hit SL), created time, expiry time, invalidated time, is_demo flag

3. **signal_outcomes** — results for later performance analysis
   - linked signal, outcome (TP1 / TP2 / SL / expired / invalidated), exit price, result in R, max favourable / adverse move, closed time

4. **connection_health** — bridge heartbeat log
   - status (NOT_CONNECTED / CONNECTING / CONNECTED / ERROR), terminal reported connected (yes/no), last successful market-data time, latency, short error message, checked time
   - No IP addresses, tokens, account numbers or passwords are stored here.

All prices use exact decimal numbers; all times are stored with time zone.

## Access rules
- Row Level Security switched on for all four tables.
- **Reading:** only signed-in users can read candles, signals, outcomes and health. Nobody can read without signing in.
- **Writing:** no write rules for website visitors or signed-in users at all. Only the server (using the private key that never reaches the browser) can add or change rows — this is where the future MT5 bridge feed will write.
- No public write policies, no anonymous access.

## Labelling and safety
- No data is inserted. No fake prices, no "connected" health rows.
- Dashboard stays on demo data and keeps its DEMO DATA labels; it only switches once verified rows with source `mt5_bridge` and a passing health check exist (future step).
- No trading or order tables or functions.

## Approval needed
- Applying this needs your approval of one database change (shown as a card when I run it).
- Because reading requires sign-in, the app will need a sign-in page before it can show stored data. I'll add that as a separate step if you want it.

## Technical details
- `numeric(12,3)` prices, `timestamptz` times, enum types for timeframe/side/status/outcome.
- Unique index (symbol, timeframe, open_time); indexes on signals(created_at), signals(status).
- GRANT SELECT to authenticated, ALL to service_role; no anon grants. updated_at trigger on signals.
- Check constraints for static rules only (e.g. high >= low, score 0–100); expiry vs time handled in code.
