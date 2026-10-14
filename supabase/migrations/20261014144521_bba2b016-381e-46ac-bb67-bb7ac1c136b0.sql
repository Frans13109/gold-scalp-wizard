CREATE TYPE public.timeframe AS ENUM ('M5','M15');
CREATE TYPE public.signal_side AS ENUM ('BUY','SELL');
CREATE TYPE public.signal_status AS ENUM ('active','expired','invalidated','hit_tp','hit_sl');
CREATE TYPE public.signal_outcome AS ENUM ('tp1','tp2','sl','expired','invalidated');
CREATE TYPE public.data_source AS ENUM ('mt5_bridge','demo');
CREATE TYPE public.bridge_status AS ENUM ('NOT_CONNECTED','CONNECTING','CONNECTED','ERROR');

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.market_candles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  symbol text NOT NULL DEFAULT 'XAUUSD' CHECK (symbol = 'XAUUSD'),
  timeframe public.timeframe NOT NULL,
  open_time timestamptz NOT NULL,
  open numeric(12,3) NOT NULL, high numeric(12,3) NOT NULL, low numeric(12,3) NOT NULL, close numeric(12,3) NOT NULL,
  tick_volume bigint, spread numeric(8,3),
  source public.data_source NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CHECK (high >= low AND high >= open AND high >= close AND low <= open AND low <= close),
  UNIQUE (symbol, timeframe, open_time)
);
GRANT SELECT ON public.market_candles TO authenticated;
GRANT ALL ON public.market_candles TO service_role;
ALTER TABLE public.market_candles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read candles" ON public.market_candles FOR SELECT TO authenticated USING (true);

CREATE TABLE public.signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL DEFAULT 'XAUUSD' CHECK (symbol = 'XAUUSD'),
  side public.signal_side NOT NULL,
  timeframe public.timeframe NOT NULL DEFAULT 'M5',
  entry numeric(12,3) NOT NULL, entry_low numeric(12,3), entry_high numeric(12,3),
  stop_loss numeric(12,3) NOT NULL, take_profit_1 numeric(12,3) NOT NULL, take_profit_2 numeric(12,3),
  rr_tp1 numeric(6,2) NOT NULL, rr_tp2 numeric(6,2), rr_worst numeric(6,2),
  confluence_score smallint NOT NULL CHECK (confluence_score BETWEEN 0 AND 100),
  reasons text[] NOT NULL DEFAULT '{}',
  invalidation_rule text,
  status public.signal_status NOT NULL DEFAULT 'active',
  is_demo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX signals_created_at_idx ON public.signals (created_at DESC);
CREATE INDEX signals_status_idx ON public.signals (status);
GRANT SELECT ON public.signals TO authenticated;
GRANT ALL ON public.signals TO service_role;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read signals" ON public.signals FOR SELECT TO authenticated USING (true);
CREATE TRIGGER signals_updated_at BEFORE UPDATE ON public.signals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.signal_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid NOT NULL UNIQUE REFERENCES public.signals(id) ON DELETE CASCADE,
  outcome public.signal_outcome NOT NULL,
  exit_price numeric(12,3),
  result_r numeric(6,2),
  max_favorable numeric(12,3), max_adverse numeric(12,3),
  closed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.signal_outcomes TO authenticated;
GRANT ALL ON public.signal_outcomes TO service_role;
ALTER TABLE public.signal_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read outcomes" ON public.signal_outcomes FOR SELECT TO authenticated USING (true);

CREATE TABLE public.connection_health (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status public.bridge_status NOT NULL DEFAULT 'NOT_CONNECTED',
  terminal_connected boolean NOT NULL DEFAULT false,
  last_market_data_at timestamptz,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  error_message text CHECK (error_message IS NULL OR length(error_message) <= 300),
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX connection_health_checked_idx ON public.connection_health (checked_at DESC);
GRANT SELECT ON public.connection_health TO authenticated;
GRANT ALL ON public.connection_health TO service_role;
ALTER TABLE public.connection_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users can read health" ON public.connection_health FOR SELECT TO authenticated USING (true);