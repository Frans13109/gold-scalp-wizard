-- Roles
CREATE TYPE public.app_role AS ENUM ('admin','subscriber');
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Subscriptions (granted manually)
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT false,
  granted_by uuid,
  note text,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own subscription" ON public.subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helpers
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
CREATE OR REPLACE FUNCTION public.has_active_subscription(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'admin') OR EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = _user_id AND active AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()))
$$;
CREATE OR REPLACE FUNCTION public.public_bridge_status()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT status::text FROM public.connection_health ORDER BY checked_at DESC LIMIT 1), 'NOT_CONNECTED')
$$;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_active_subscription(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.public_bridge_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_bridge_status() TO anon, authenticated, service_role;

-- Replace open read policies with subscriber-only
DROP POLICY "Signed-in users can read candles" ON public.market_candles;
DROP POLICY "Signed-in users can read signals" ON public.signals;
DROP POLICY "Signed-in users can read outcomes" ON public.signal_outcomes;
DROP POLICY "Signed-in users can read health" ON public.connection_health;
CREATE POLICY "Subscribers read candles" ON public.market_candles FOR SELECT TO authenticated USING (public.has_active_subscription(auth.uid()));
CREATE POLICY "Subscribers read signals" ON public.signals FOR SELECT TO authenticated USING (public.has_active_subscription(auth.uid()));
CREATE POLICY "Subscribers read outcomes" ON public.signal_outcomes FOR SELECT TO authenticated USING (public.has_active_subscription(auth.uid()));
CREATE POLICY "Subscribers read health" ON public.connection_health FOR SELECT TO authenticated USING (public.has_active_subscription(auth.uid()));

-- Keep outcome history: block deleting a signal that has an outcome (was CASCADE)
ALTER TABLE public.signal_outcomes DROP CONSTRAINT signal_outcomes_signal_id_fkey;
ALTER TABLE public.signal_outcomes ADD CONSTRAINT signal_outcomes_signal_id_fkey FOREIGN KEY (signal_id) REFERENCES public.signals(id) ON DELETE RESTRICT;

-- Replay protection for bridge requests (server only)
CREATE TABLE public.bridge_request_log (
  request_id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.bridge_request_log TO service_role;
ALTER TABLE public.bridge_request_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX bridge_request_log_received_idx ON public.bridge_request_log (received_at);