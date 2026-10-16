ALTER TABLE public.signals
  ADD COLUMN IF NOT EXISTS m15_bias text,
  ADD COLUMN IF NOT EXISTS indicators jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS spread numeric,
  ADD COLUMN IF NOT EXISTS strategy_version text,
  ADD COLUMN IF NOT EXISTS source_candle_time timestamptz,
  ADD COLUMN IF NOT EXISTS entry_reference text;
CREATE UNIQUE INDEX IF NOT EXISTS signals_setup_unique
  ON public.signals (symbol, side, timeframe, source_candle_time, strategy_version);