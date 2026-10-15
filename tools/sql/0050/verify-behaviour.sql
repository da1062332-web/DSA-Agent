-- tools/sql/0050/verify-behaviour.sql  — NO PERMANENT WRITES. Run after migration 0050 (and after verify.sql).
-- Switches to the API's own database role (dsa_api, which row-level security applies to) and checks what each kind of session can
-- see: a platform session, a customer-tenant session, and a session with no tenant. It only reads.
-- The result comes back as the text of an ERROR beginning "VERIFY-BEHAVIOUR": the block always ends by raising on purpose, which
-- also rolls the transaction back. Read the PASS and FAIL lines in that message. A real failure of the script has a different message.
-- Needs: the executing role can SET ROLE dsa_api (true for the hosted postgres role: checked 2026-10-15).
DO $verify$
DECLARE
  platform constant text := 'ten_01M4ZG67WTS51Q0XN7F1Y9CCYG';
  other    text;
  grant_tenant text;
  lines    text := '';
  n        bigint;
  total    bigint;
  err      text;
  ok       boolean;
BEGIN
  SELECT id INTO other FROM app.tenant WHERE tenant_type <> 'PLATFORM' ORDER BY created_at, id LIMIT 1;
  SELECT tenant_id INTO grant_tenant FROM app.support_access_grant ORDER BY created_at LIMIT 1;
  SET LOCAL ROLE dsa_api;

  -- 1. who sees which tenants
  PERFORM set_config('app.tenant_id', platform, true);
  SELECT count(*) INTO n FROM app.tenant;
  RESET ROLE; SELECT count(*) INTO total FROM app.tenant; SET LOCAL ROLE dsa_api; PERFORM set_config('app.tenant_id', platform, true);
  lines := lines || format(E'%s | platform session reads every tenant row (%s of %s)\n', CASE WHEN n = total THEN 'PASS' ELSE 'FAIL' END, n, total);

  PERFORM set_config('app.tenant_id', other, true);
  SELECT count(*) INTO n FROM app.tenant;
  lines := lines || format(E'%s | a customer-tenant session reads only its own tenant row (%s)\n', CASE WHEN n = 1 THEN 'PASS' ELSE 'FAIL' END, n);

  PERFORM set_config('app.tenant_id', '', true);
  SELECT count(*) INTO n FROM app.tenant;
  lines := lines || format(E'%s | a session with no tenant reads no tenant row (%s)\n', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END, n);

  -- 2. the realm test itself
  PERFORM set_config('app.tenant_id', platform, true);
  lines := lines || format(E'%s | is_platform_realm() is true in the platform session\n', CASE WHEN app.is_platform_realm() THEN 'PASS' ELSE 'FAIL' END);
  PERFORM set_config('app.tenant_id', other, true);
  lines := lines || format(E'%s | is_platform_realm() is false in a customer session\n', CASE WHEN NOT app.is_platform_realm() THEN 'PASS' ELSE 'FAIL' END);
  PERFORM set_config('app.tenant_id', '', true);
  lines := lines || format(E'%s | is_platform_realm() is false with no tenant\n', CASE WHEN NOT app.is_platform_realm() THEN 'PASS' ELSE 'FAIL' END);

  -- 3. the cross-tenant aggregate
  PERFORM set_config('app.tenant_id', platform, true);
  BEGIN
    SELECT count(*) INTO n FROM app.platform_tenant_user_counts();
    lines := lines || format(E'PASS | platform session gets active-user counts (%s tenants have users)\n', n);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    lines := lines || format(E'FAIL | platform session could not read the counts: %s\n', err);
  END;
  FOREACH err IN ARRAY ARRAY[other, ''] LOOP
    PERFORM set_config('app.tenant_id', err, true);
    ok := false;
    BEGIN
      PERFORM * FROM app.platform_tenant_user_counts();
    EXCEPTION WHEN insufficient_privilege THEN
      ok := true;
    END;
    lines := lines || format(E'%s | the counts function is refused to a session of tenant "%s"\n', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, CASE WHEN err = '' THEN '(none)' ELSE 'customer' END);
  END LOOP;

  -- 4. flags and master data are readable by every tenant
  PERFORM set_config('app.tenant_id', other, true);
  SELECT count(*) INTO n FROM app.feature_flag;
  lines := lines || format(E'%s | a customer session can read feature flags (%s)\n', CASE WHEN n > 0 THEN 'PASS' ELSE 'FAIL' END, n);
  SELECT count(*) INTO n FROM app.master_data_item;
  lines := lines || format(E'%s | a customer session can read master data (%s)\n', CASE WHEN n > 0 THEN 'PASS' ELSE 'FAIL' END, n);

  -- 5. support access: the platform sees every request, the target tenant sees its own, another tenant sees none
  PERFORM set_config('app.tenant_id', platform, true);
  SELECT count(*) INTO n FROM app.support_access_grant;
  RESET ROLE; SELECT count(*) INTO total FROM app.support_access_grant; SET LOCAL ROLE dsa_api;
  lines := lines || format(E'%s | platform session reads every support-access request (%s of %s)\n', CASE WHEN n = total THEN 'PASS' ELSE 'FAIL' END, n, total);
  IF grant_tenant IS NOT NULL THEN
    PERFORM set_config('app.tenant_id', grant_tenant, true);
    SELECT count(*) INTO n FROM app.support_access_grant WHERE tenant_id = grant_tenant;
    lines := lines || format(E'%s | the target tenant reads its own support-access requests (%s)\n', CASE WHEN n >= 1 THEN 'PASS' ELSE 'FAIL' END, n);
    SELECT id INTO err FROM app.tenant WHERE id <> grant_tenant AND tenant_type <> 'PLATFORM' ORDER BY id LIMIT 1;
    PERFORM set_config('app.tenant_id', err, true);
    SELECT count(*) INTO n FROM app.support_access_grant WHERE tenant_id = grant_tenant;
    lines := lines || format(E'%s | another tenant reads none of them (%s)\n', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END, n);
  END IF;

  -- 6. data corrections hold business values: the platform session sees none of them
  PERFORM set_config('app.tenant_id', platform, true);
  SELECT count(*) INTO n FROM app.data_correction_request;
  lines := lines || format(E'%s | platform session reads NO data-correction rows (%s)\n', CASE WHEN n = 0 THEN 'PASS' ELSE 'FAIL' END, n);

  -- 7. the platform session reads no business table of a customer tenant
  FOREACH err IN ARRAY ARRAY['customer', 'lead', 'loan_application', 'app_user', 'role', 'role_permission', 'audit_event', 'complaint', 'message', 'task'] LOOP
    ok := true;
    BEGIN
      EXECUTE format('SELECT count(*) FROM app.%I WHERE tenant_id <> %L', err, platform) INTO n;
      ok := (n = 0);
    EXCEPTION WHEN undefined_table THEN
      n := NULL; ok := true;
    END;
    lines := lines || format(E'%s | platform session reads no rows of other tenants in %s (%s)\n', CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END, err, coalesce(n::text, 'table absent'));
  END LOOP;

  RESET ROLE;
  RAISE EXCEPTION 'VERIFY-BEHAVIOUR (rolled back on purpose): %', E'\n' || lines;
END
$verify$;
