-- tools/sql/0050/verify-behaviour.sql  — NO PERMANENT WRITES, and NO role switching. Run after migration 0050 and after verify.sql.
--
-- WHAT THIS PROVES, AND WHAT IT DOES NOT. It runs as the migration role (postgres), so the database does not apply row-level security to
-- it. It therefore cannot test that RLS is ENFORCED. It does two weaker things, and labels every line with which one:
--   [ENFORCEMENT-PRECONDITIONS]  the facts that must be true for PostgreSQL to apply the policies to the API role dsa_api: RLS is enabled
--                                and forced on each protected table, and dsa_api is neither a superuser nor able to bypass RLS.
--                                These are the CONDITIONS for enforcement, not a test of it.
--   [POLICY-LOGIC]               the real policy expressions, read from pg_policies, evaluated for a platform session, a customer-tenant
--                                session and a session with no tenant: which rows each would see, and which writes the policies would allow.
--                                This proves the policies say the right thing, not that they are applied.
-- Real role enforcement is proven by tools/sql/0050/enforcement-check.mjs, which connects AS dsa_api (no role switch, no new privilege).
-- Run both. A result is only "enforced" when this script's preconditions pass AND enforcement-check.mjs passes.
--
-- The answer comes back as the text of an ERROR beginning "VERIFY-BEHAVIOUR": the block ends by raising on purpose, because that rolls
-- everything back and is the only way to return text through the CLI. Nothing is written; afterwards the session is unchanged.
-- A different error message means the script itself failed, not that a check failed.
DO $verify$
DECLARE
  platform constant text := 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG';
  res      jsonb := '[]'::jsonb;
  vis      jsonb := '{}'::jsonb;   -- rows each session would see, by "table|session"
  tot      jsonb := '{}'::jsonb;   -- rows in each table
  other    text;                   -- a customer tenant
  other2   text;                   -- a second customer tenant
  gtenant  text;                   -- the tenant of an existing support request, if any
  s        record;
  c        record;
  t        text;
  q        text;
  qi       text;
  qu       text;
  qc       text;
  n        bigint;
  v        boolean;
  vold     boolean;
  err      text;
  fails    int := 0;
  passes   int := 0;
  lines    text := '';
  r        jsonb;
BEGIN
  IF NOT (SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'ABORT: run this as the migration role (postgres). It must be able to read every row to count what policies would show.';
  END IF;
  SET LOCAL search_path = app, extensions, public;
  SELECT id INTO other  FROM tenant WHERE tenant_type <> 'PLATFORM' ORDER BY created_at, id LIMIT 1;
  SELECT id INTO other2 FROM tenant WHERE tenant_type <> 'PLATFORM' AND id <> other ORDER BY created_at, id LIMIT 1;
  SELECT tenant_id INTO gtenant FROM support_access_grant ORDER BY created_at LIMIT 1;
  IF other IS NULL OR other2 IS NULL THEN
    RAISE EXCEPTION 'ABORT: needs at least two customer tenants to compare sessions.';
  END IF;

  -- ------------------------------------------------------------------------------------------------ ENFORCEMENT PRECONDITIONS
  FOR t IN SELECT unnest(ARRAY['tenant','feature_flag','master_data_item','support_access_grant','data_correction_request']) LOOP
    res := res || jsonb_build_object('tier', 'ENFORCEMENT-PRECONDITIONS', 'name', format('RLS is enabled and forced on %s', t),
      'ok', (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = format('app.%I', t)::regclass));
  END LOOP;
  res := res || jsonb_build_object('tier', 'ENFORCEMENT-PRECONDITIONS', 'name', 'dsa_api is not a superuser and cannot bypass row-level security',
    'ok', (SELECT NOT rolsuper AND NOT rolbypassrls FROM pg_roles WHERE rolname = 'dsa_api'));
  res := res || jsonb_build_object('tier', 'ENFORCEMENT-PRECONDITIONS', 'name', 'dsa_api owns none of the protected tables (the owner is the migration role)',
    'ok', NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'app'::regnamespace AND relname IN ('tenant','feature_flag','master_data_item','support_access_grant','data_correction_request') AND pg_get_userbyid(relowner) = 'dsa_api'));
  res := res || jsonb_build_object('tier', 'ENFORCEMENT-PRECONDITIONS', 'name', 'every policy on the protected tables is permissive (so the OR of their conditions is what a session sees)',
    'ok', NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename IN ('tenant','feature_flag','master_data_item','support_access_grant','data_correction_request') AND permissive <> 'PERMISSIVE'));

  -- ------------------------------------------------------------------------------------------------ POLICY LOGIC: what each session sees
  FOR t IN SELECT unnest(ARRAY['tenant','feature_flag','master_data_item','support_access_grant','data_correction_request']) LOOP
    SELECT string_agg('(' || qual || ')', ' OR ') INTO q FROM pg_policies WHERE schemaname = 'app' AND tablename = t AND cmd IN ('ALL', 'SELECT');
    EXECUTE format('SELECT count(*) FROM app.%I', t) INTO n;
    tot := jsonb_set(tot, ARRAY[t], to_jsonb(n));
    FOR s IN SELECT * FROM (VALUES ('platform', platform), ('customer', other), ('other', other2), ('none', '')) AS x(label, tid) LOOP
      PERFORM set_config('app.tenant_id', s.tid, true);
      IF q IS NULL THEN n := 0; ELSE EXECUTE format('SELECT count(*) FROM app.%I WHERE %s', t, q) INTO n; END IF;
      vis := jsonb_set(vis, ARRAY[t || '|' || s.label], to_jsonb(n));
    END LOOP;
  END LOOP;

  res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', 'a platform session would see every tenant row',
    'ok', (vis->>'tenant|platform')::bigint = (tot->>'tenant')::bigint AND (tot->>'tenant')::bigint >= 3);
  res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', 'a customer-tenant session would see only its own tenant row',
    'ok', (vis->>'tenant|customer')::bigint = 1 AND (vis->>'tenant|other')::bigint = 1);
  res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', 'a session with no tenant would see no tenant row',
    'ok', (vis->>'tenant|none')::bigint = 0);
  res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', 'every session would see all feature flags and all master data (they drive every tenant)',
    'ok', (SELECT bool_and((vis->>(tn.tbl || '|' || ln.lbl))::bigint = (tot->>tn.tbl)::bigint) FROM unnest(ARRAY['feature_flag','master_data_item']) AS tn(tbl), unnest(ARRAY['platform','customer','other','none']) AS ln(lbl))
          AND (tot->>'feature_flag')::bigint > 0 AND (tot->>'master_data_item')::bigint > 0);
  res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', 'a platform session would see every support-access request',
    'ok', (vis->>'support_access_grant|platform')::bigint = (tot->>'support_access_grant')::bigint);
  IF gtenant IS NOT NULL THEN
    SELECT string_agg('(' || qual || ')', ' OR ') INTO q FROM pg_policies WHERE schemaname = 'app' AND tablename = 'support_access_grant' AND cmd IN ('ALL', 'SELECT');
    PERFORM set_config('app.tenant_id', gtenant, true);
    EXECUTE format('SELECT count(*) FROM app.support_access_grant WHERE tenant_id = %L AND (%s)', gtenant, q) INTO n;
    res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', 'the target tenant would see its own support-access requests', 'ok', n >= 1);
    PERFORM set_config('app.tenant_id', CASE WHEN other = gtenant THEN other2 ELSE other END, true);
    EXECUTE format('SELECT count(*) FROM app.support_access_grant WHERE tenant_id = %L AND (%s)', gtenant, q) INTO n;
    res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', 'another tenant would see none of them', 'ok', n = 0);
  END IF;
  res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', 'a platform session would see NO data-correction rows (they hold business values)',
    'ok', (vis->>'data_correction_request|platform')::bigint = 0);
  res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', 'a customer session would see no more correction rows than exist, and a session with no tenant none',
    'ok', (vis->>'data_correction_request|none')::bigint = 0 AND (vis->>'data_correction_request|customer')::bigint <= (tot->>'data_correction_request')::bigint);

  -- A platform session must not see business rows of customer tenants, whatever the table.
  FOR t IN SELECT unnest(ARRAY['customer','lead','loan_application','app_user','role','role_permission','audit_event','complaint','message','task','lender','loan_product']) LOOP
    IF to_regclass('app.' || quote_ident(t)) IS NULL THEN CONTINUE; END IF;
    SELECT string_agg('(' || qual || ')', ' OR ') INTO q FROM pg_policies WHERE schemaname = 'app' AND tablename = t AND cmd IN ('ALL', 'SELECT');
    PERFORM set_config('app.tenant_id', platform, true);
    IF q IS NULL THEN n := 0; ELSE EXECUTE format('SELECT count(*) FROM app.%I WHERE tenant_id <> %L AND (%s)', t, platform, q) INTO n; END IF;
    res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', format('a platform session would see no rows of other tenants in %s', t), 'ok', n = 0);
  END LOOP;

  -- ------------------------------------------------------------------------------------------------ POLICY LOGIC: which writes the policies allow
  -- Each case evaluates the INSERT policies' WITH CHECK (and, for updates, USING on the old row and WITH CHECK on the new row)
  -- against a hypothetical row, under the stated session tenant. A table with no policy for that command allows nothing.
  FOR c IN SELECT * FROM (VALUES
    ('INSERT', 'a platform session may insert a feature flag',            'feature_flag', platform, NULL::jsonb, '{"key":"k","scope":"GLOBAL","value":true,"owner":"o","updated_by":"u"}'::jsonb, true),
    ('INSERT', 'a customer session may NOT insert a feature flag',        'feature_flag', other,    NULL, '{"key":"k","scope":"GLOBAL","value":true,"owner":"o","updated_by":"u"}', false),
    ('INSERT', 'a session with no tenant may NOT insert a feature flag',  'feature_flag', '',       NULL, '{"key":"k","scope":"GLOBAL","value":true,"owner":"o","updated_by":"u"}', false),
    ('UPDATE', 'a platform session may update a feature flag',            'feature_flag', platform, '{"key":"k","scope":"GLOBAL"}', '{"key":"k","scope":"GLOBAL"}', true),
    ('UPDATE', 'a customer session may NOT update a feature flag',        'feature_flag', other,    '{"key":"k","scope":"GLOBAL"}', '{"key":"k","scope":"GLOBAL"}', false),
    ('INSERT', 'a platform session may insert master data',               'master_data_item', platform, NULL, '{"dataset":"d","code":"c","label":"l","created_by":"u"}', true),
    ('INSERT', 'a customer session may NOT insert master data',           'master_data_item', other,    NULL, '{"dataset":"d","code":"c","label":"l","created_by":"u"}', false),
    ('UPDATE', 'a customer session may NOT update master data',           'master_data_item', other,    '{"dataset":"d","code":"c"}', '{"dataset":"d","code":"c"}', false),
    ('INSERT', 'a platform session may file a PENDING support request for a customer tenant', 'support_access_grant', platform, NULL,
       jsonb_build_object('tenant_id', other, 'status', 'PENDING', 'approved_by', NULL), true),
    ('INSERT', 'a platform session may NOT file a pre-approved (ACTIVE) request',            'support_access_grant', platform, NULL,
       jsonb_build_object('tenant_id', other, 'status', 'ACTIVE', 'approved_by', NULL), false),
    ('INSERT', 'a platform session may NOT file a request that already names an approver',  'support_access_grant', platform, NULL,
       jsonb_build_object('tenant_id', other, 'status', 'PENDING', 'approved_by', 'usr_x'), false),
    ('INSERT', 'a platform session may NOT file a request against the platform tenant',     'support_access_grant', platform, NULL,
       jsonb_build_object('tenant_id', platform, 'status', 'PENDING', 'approved_by', NULL), false),
    ('INSERT', 'a customer session may NOT file a support request, even for itself',        'support_access_grant', other, NULL,
       jsonb_build_object('tenant_id', other, 'status', 'PENDING', 'approved_by', NULL), false),
    ('UPDATE', 'a platform session may NOT approve a support request (no platform UPDATE policy)', 'support_access_grant', platform,
       jsonb_build_object('tenant_id', other, 'status', 'PENDING'), jsonb_build_object('tenant_id', other, 'status', 'ACTIVE'), false),
    ('UPDATE', 'the target tenant may approve its own PENDING request',                     'support_access_grant', other,
       jsonb_build_object('tenant_id', other, 'status', 'PENDING'), jsonb_build_object('tenant_id', other, 'status', 'ACTIVE'), true),
    ('UPDATE', 'the target tenant may revoke its own ACTIVE request',                        'support_access_grant', other,
       jsonb_build_object('tenant_id', other, 'status', 'ACTIVE'), jsonb_build_object('tenant_id', other, 'status', 'REVOKED'), true),
    ('UPDATE', 'the target tenant may NOT push a request back to PENDING',                   'support_access_grant', other,
       jsonb_build_object('tenant_id', other, 'status', 'ACTIVE'), jsonb_build_object('tenant_id', other, 'status', 'PENDING'), false),
    ('UPDATE', 'the target tenant may NOT change a request that is already DENIED',         'support_access_grant', other,
       jsonb_build_object('tenant_id', other, 'status', 'DENIED'), jsonb_build_object('tenant_id', other, 'status', 'ACTIVE'), false),
    ('UPDATE', 'another tenant may NOT touch someone else''s support request',               'support_access_grant', other2,
       jsonb_build_object('tenant_id', other, 'status', 'PENDING'), jsonb_build_object('tenant_id', other, 'status', 'ACTIVE'), false),
    ('INSERT', 'a customer session may insert a data correction for its own tenant',        'data_correction_request', other, NULL,
       jsonb_build_object('tenant_id', other), true),
    ('INSERT', 'a customer session may NOT insert a data correction for another tenant',    'data_correction_request', other, NULL,
       jsonb_build_object('tenant_id', other2), false),
    ('INSERT', 'a platform session may NOT insert a data correction for a customer tenant', 'data_correction_request', platform, NULL,
       jsonb_build_object('tenant_id', other), false)
  ) AS x(cmd, label, tbl, tid, oldrow, newrow, expected) LOOP
    PERFORM set_config('app.tenant_id', c.tid, true);
    SELECT string_agg('(' || coalesce(with_check, qual) || ')', ' OR ') INTO qc FROM pg_policies WHERE schemaname = 'app' AND tablename = c.tbl AND cmd IN ('ALL', c.cmd);
    SELECT string_agg('(' || qual || ')', ' OR ') INTO qu FROM pg_policies WHERE schemaname = 'app' AND tablename = c.tbl AND cmd IN ('ALL', c.cmd);
    v := false;
    IF c.cmd = 'INSERT' THEN
      IF qc IS NOT NULL THEN EXECUTE format('SELECT coalesce((%s), false) FROM jsonb_populate_record(NULL::app.%I, $1)', qc, c.tbl) INTO v USING c.newrow; END IF;
    ELSE
      IF qu IS NOT NULL AND qc IS NOT NULL THEN
        EXECUTE format('SELECT coalesce((%s), false) FROM jsonb_populate_record(NULL::app.%I, $1)', qu, c.tbl) INTO vold USING c.oldrow;
        EXECUTE format('SELECT coalesce((%s), false) FROM jsonb_populate_record(NULL::app.%I, $1)', qc, c.tbl) INTO v USING c.newrow;
        v := vold AND v;
      END IF;
    END IF;
    res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', c.label, 'ok', v = c.expected);
  END LOOP;

  -- ------------------------------------------------------------------------------------------------ the realm test and the aggregate
  PERFORM set_config('app.tenant_id', platform, true);
  res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', 'is_platform_realm() is true in the platform session', 'ok', is_platform_realm());
  PERFORM set_config('app.tenant_id', other, true);
  res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', 'is_platform_realm() is false in a customer session', 'ok', is_platform_realm() IS FALSE);
  PERFORM set_config('app.tenant_id', '', true);
  res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', 'is_platform_realm() is false (not NULL) with no tenant', 'ok', is_platform_realm() IS FALSE);

  PERFORM set_config('app.tenant_id', platform, true);
  BEGIN
    SELECT count(*) INTO n FROM platform_tenant_user_counts();
    res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', 'the user-count function answers in the platform realm', 'ok', n >= 0);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', 'the user-count function answers in the platform realm (error: ' || err || ')', 'ok', false);
  END;
  FOR s IN SELECT * FROM (VALUES ('a customer session', other), ('a session with no tenant', '')) AS x(label, tid) LOOP
    PERFORM set_config('app.tenant_id', s.tid, true);
    v := false;
    BEGIN
      PERFORM * FROM platform_tenant_user_counts();
    EXCEPTION WHEN insufficient_privilege THEN
      v := true;
    END;
    res := res || jsonb_build_object('tier', 'POLICY-LOGIC', 'name', format('the user-count function is refused to %s', s.label), 'ok', v);
  END LOOP;

  -- ------------------------------------------------------------------------------------------------ report
  PERFORM set_config('app.tenant_id', '', true);
  FOR r IN SELECT * FROM jsonb_array_elements(res) LOOP
    IF (r->>'ok')::boolean THEN passes := passes + 1; ELSE fails := fails + 1; END IF;
    lines := lines || format(E'%s | [%s] %s\n', CASE WHEN (r->>'ok')::boolean THEN 'PASS' ELSE 'FAIL' END, r->>'tier', r->>'name');
  END LOOP;
  RAISE EXCEPTION 'VERIFY-BEHAVIOUR (rolled back on purpose). RESULT: PASS=% FAIL=%. These are policy-logic checks and enforcement preconditions, NOT a test of enforcement: run enforcement-check.mjs too.%',
    passes, fails, E'\n' || lines;
END
$verify$;
