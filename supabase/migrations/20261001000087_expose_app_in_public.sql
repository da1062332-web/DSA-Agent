-- Migration 0087: Expose all app tables into the public schema
-- Enables Supabase Studio Table Editor and Supabase Data API to view and query all business entities under 'public'.

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT tablename 
      FROM pg_tables 
     WHERE schemaname = 'app'
  LOOP
    EXECUTE format('CREATE OR REPLACE VIEW public.%I WITH (security_invoker = true) AS SELECT * FROM app.%I;', tbl, tbl);
  END LOOP;
END $$;

-- Grant access on public schema and all views to Supabase client roles
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, dsa_app;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role, dsa_app;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role, dsa_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role, dsa_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role, dsa_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role, dsa_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role, dsa_app;
