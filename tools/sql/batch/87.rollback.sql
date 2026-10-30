-- Roll back migration 0087: drop the public views that 0087 made over app tables.
-- Grants on schema public are NOT changed here: their state before 0087 is not recorded, and 0091 changes them too.
-- Refuses, and changes nothing, if any other object depends on one of these views.
BEGIN;
DO $$
DECLARE
  r record;
  v_oid oid;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT c.oid, c.relname
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'v'
       AND c.reloptions @> ARRAY['security_invoker=true']
       AND EXISTS (SELECT 1 FROM pg_tables t WHERE t.schemaname = 'app' AND t.tablename = c.relname)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_depend d
                 JOIN pg_rewrite rw ON rw.oid = d.objid
                WHERE d.refobjid = r.oid AND rw.ev_class <> r.oid) THEN
      RAISE EXCEPTION 'view public.% has dependent objects; nothing was dropped', r.relname;
    END IF;
    v_oid := r.oid;
    EXECUTE format('DROP VIEW public.%I', r.relname);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'dropped % public views over app tables', n;
END $$;
COMMIT;
