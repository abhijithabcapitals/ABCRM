BEGIN;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;
CREATE POLICY "Admins can update profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  ));

REVOKE ALL ON SCHEMA acct FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA acct TO authenticated;

REVOKE ALL ON ALL TABLES IN SCHEMA acct FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA acct FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA acct FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  accounting_table record;
  existing_policy record;
BEGIN
  FOR accounting_table IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'acct'
      AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE acct.%I ENABLE ROW LEVEL SECURITY', accounting_table.relname);
    EXECUTE format('ALTER TABLE acct.%I FORCE ROW LEVEL SECURITY', accounting_table.relname);
    FOR existing_policy IN
      SELECT pol.polname
      FROM pg_policy pol
      WHERE pol.polrelid = format('acct.%I', accounting_table.relname)::regclass
    LOOP
      EXECUTE format(
        'DROP POLICY %I ON acct.%I',
        existing_policy.polname,
        accounting_table.relname
      );
    END LOOP;
    EXECUTE format(
      'CREATE POLICY "Accounting admins can read" ON acct.%I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = ''admin''))',
      accounting_table.relname
    );
    EXECUTE format('GRANT SELECT ON TABLE acct.%I TO authenticated', accounting_table.relname);
  END LOOP;
END $$;

COMMIT;
