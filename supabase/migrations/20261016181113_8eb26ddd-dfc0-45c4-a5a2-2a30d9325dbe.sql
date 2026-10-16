REVOKE ALL ON TABLE public.market_ticks_latest FROM anon;
REVOKE ALL ON TABLE public.market_ticks_latest FROM authenticated;
REVOKE ALL ON TABLE public.market_ticks_latest FROM PUBLIC;
GRANT SELECT ON TABLE public.market_ticks_latest TO authenticated;
GRANT ALL ON TABLE public.market_ticks_latest TO service_role;