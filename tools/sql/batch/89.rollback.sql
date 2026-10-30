-- Roll back migration 0089: restore the function body that migration 0088 created (no settings and no feature flags).
-- The body below is 0088's definition, copied as it is in supabase/migrations/20261001000088_support_tenant_view.sql.
BEGIN;
SET search_path = app, extensions, public;

CREATE OR REPLACE FUNCTION platform_support_view(p_tenant_id text, p_support_user_id text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS
$$
DECLARE
  v_grant_id text;
  v_ends_at  timestamptz;
  v_result   jsonb;
BEGIN
  IF NOT is_platform_realm() THEN
    RAISE EXCEPTION 'platform_support_view is for the platform realm only' USING ERRCODE = '42501';
  END IF;

  SELECT g.id, g.expires_at INTO v_grant_id, v_ends_at
    FROM support_access_grant g
   WHERE g.tenant_id = p_tenant_id
     AND g.support_user_id = p_support_user_id
     AND g.status = 'ACTIVE'
     AND g.scope = 'READ_METADATA_AND_CONFIG'
     AND g.revoked_at IS NULL
     AND g.starts_at <= now()
     AND g.expires_at > now()
   ORDER BY g.expires_at DESC, g.created_at DESC
   LIMIT 1;

  IF v_grant_id IS NULL THEN
    RAISE EXCEPTION 'no active support access window for this tenant' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'grantId', v_grant_id,
    'endsAt', v_ends_at,
    'tenant', (SELECT jsonb_build_object(
                 'id', t.id, 'slug', t.slug, 'legalName', t.legal_name, 'status', t.status,
                 'dataRegion', t.data_region, 'timezone', t.timezone)
                 FROM tenant t WHERE t.id = p_tenant_id),
    'organisations', coalesce((SELECT jsonb_agg(jsonb_build_object(
                 'id', o.id, 'legalName', o.legal_name, 'constitution', o.constitution, 'status', o.status)
                 ORDER BY o.id)
                 FROM organisation o WHERE o.tenant_id = p_tenant_id), '[]'::jsonb),
    'branches', coalesce((SELECT jsonb_agg(jsonb_build_object(
                 'id', b.id, 'code', b.code, 'name', b.name, 'status', b.status, 'timezone', b.timezone)
                 ORDER BY b.code)
                 FROM branch b WHERE b.tenant_id = p_tenant_id), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END
$$;

REVOKE ALL ON FUNCTION platform_support_view(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform_support_view(text, text) TO dsa_app;
COMMIT;
