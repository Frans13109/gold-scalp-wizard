CREATE TABLE public.market_ticks_latest (
  symbol text PRIMARY KEY CHECK (symbol = 'XAUUSD'),
  bid numeric(12,3) NOT NULL CHECK (bid > 0),
  ask numeric(12,3) NOT NULL CHECK (ask >= bid),
  price numeric(12,3) NOT NULL CHECK (price > 0),
  tick_time timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.market_ticks_latest TO authenticated;
GRANT ALL ON public.market_ticks_latest TO service_role;
ALTER TABLE public.market_ticks_latest ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Subscribers read latest tick" ON public.market_ticks_latest FOR SELECT TO authenticated USING (public.has_active_subscription(auth.uid()));