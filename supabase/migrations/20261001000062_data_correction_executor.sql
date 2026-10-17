-- Migration: 20261001000062_data_correction_executor.sql
-- Owner: Dev 1 (Modules 1 and 40: data corrections, SUB-ADM.07; Release 2)
-- A data correction that is APPROVED had no way to be carried out: the endpoint that marks it executed can only be called by a service
-- identity, and no HTTP token can be one. The executor is therefore an in-process worker (apps/api/src/modules/platform-admin/
-- data-correction-executor.ts), switched off unless DATA_CORRECTION_EXECUTOR=true. It needs two things from the database:
--  1. somewhere to say WHY a correction failed (failure_reason), because FAILED existed as a status but nothing explained it;
--  2. a way to find approved corrections across tenants WITHOUT being able to read them: ids only, no justification and no values,
--     and only for the executor's own system context. A customer session can never call it (tenant ids in tokens look like ten_...,
--     the system context is the word SYSTEM), and it is granted to dsa_app only.

SET search_path = app, extensions, public;

ALTER TABLE app.data_correction_request ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE app.data_correction_request DROP CONSTRAINT IF EXISTS data_correction_failed_has_reason;
ALTER TABLE app.data_correction_request ADD CONSTRAINT data_correction_failed_has_reason
  CHECK (status <> 'FAILED' OR failure_reason IS NOT NULL) NOT VALID; -- enforced for every new or changed row; no existing row can be FAILED without a reason column

CREATE OR REPLACE FUNCTION app.approved_data_corrections(max_rows integer DEFAULT 20)
RETURNS TABLE (tenant_id text, id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS
$$
BEGIN
  IF app.app_tenant() IS DISTINCT FROM 'SYSTEM' THEN
    RAISE EXCEPTION 'approved_data_corrections is for the correction executor only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT d.tenant_id, d.id
      FROM app.data_correction_request d
     WHERE d.status = 'APPROVED'
     ORDER BY d.approved_at NULLS LAST, d.created_at
     LIMIT least(greatest(max_rows, 1), 100);
END
$$;

REVOKE ALL ON FUNCTION app.approved_data_corrections(integer) FROM PUBLIC;
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION app.approved_data_corrections(integer) FROM %I', r);
    END IF;
  END LOOP;
END
$$;
GRANT EXECUTE ON FUNCTION app.approved_data_corrections(integer) TO dsa_app;
