CREATE TABLE public.zz_rls_autotest_tmp (id int);
DO $$
DECLARE ok boolean;
BEGIN
  SELECT relrowsecurity INTO ok FROM pg_class WHERE oid = 'public.zz_rls_autotest_tmp'::regclass;
  IF NOT ok THEN RAISE EXCEPTION 'RLS was NOT auto-enabled'; END IF;
END $$;
DROP TABLE public.zz_rls_autotest_tmp;