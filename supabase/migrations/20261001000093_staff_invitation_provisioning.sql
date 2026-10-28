-- Migration: 20261001000093_staff_invitation_provisioning.sql
-- Owner: Dev 1 (platform; API-USR-001, Architecture B in docs/INVITATION_ARCHITECTURE_DECISION.md). To confirm in supabase/MANIFEST.md.
--   The API no longer talks to Supabase Auth. It records an invitation request (delivery_state QUEUED). The provisioning worker, a
--   separate process and the only holder of the service-role key, creates or reuses the Auth account, writes the tenant claim, binds
--   the user to the account and asks Supabase to send the e-mail.
--   delivery_state: QUEUED (waiting for the worker), SENDING (claimed by a worker), SENT (the e-mail was accepted by Supabase),
--   FAILED (the worker gave up; last_failure holds a short code), CANCELLED (the user stopped being INVITED before it was sent).
--   An invitation can activate a user only when status = 'PENDING' and delivery_state = 'SENT' (packages/kernel resolve-principal).
--   The worker finds work across tenants through app.pending_staff_invitation_deliveries, which returns ids only and answers only the
--   SYSTEM context, like app.runnable_jobs (M-067). It then claims and handles each row inside that row's own tenant, where row-level
--   security applies. A claim left in SENDING by a worker that stopped is offered again after stale_after_seconds.

SET search_path = app, extensions, public;

ALTER TABLE staff_invitation ADD COLUMN IF NOT EXISTS delivery_state text NOT NULL DEFAULT 'QUEUED'
  CHECK (delivery_state IN ('QUEUED','SENDING','SENT','FAILED','CANCELLED'));
ALTER TABLE staff_invitation ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0
  CHECK (delivery_attempts >= 0);
ALTER TABLE staff_invitation ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE staff_invitation ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE staff_invitation ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
ALTER TABLE staff_invitation ADD COLUMN IF NOT EXISTS claimed_by text
  CHECK (claimed_by IS NULL OR char_length(claimed_by) <= 64);
ALTER TABLE staff_invitation ADD CONSTRAINT staff_invitation_claim_held
  CHECK (delivery_state <> 'SENDING' OR (claimed_at IS NOT NULL AND claimed_by IS NOT NULL));

CREATE INDEX IF NOT EXISTS staff_invitation_delivery_due ON staff_invitation (next_attempt_at)
  WHERE delivery_state IN ('QUEUED','SENDING');

CREATE OR REPLACE FUNCTION app.pending_staff_invitation_deliveries(max_rows integer DEFAULT 20, stale_after_seconds integer DEFAULT 600)
RETURNS TABLE (tenant_id text, id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS
$$
BEGIN
  IF app.app_tenant() IS DISTINCT FROM 'SYSTEM' THEN
    RAISE EXCEPTION 'pending_staff_invitation_deliveries is for the provisioning worker only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT s.tenant_id, s.id
      FROM app.staff_invitation s
     WHERE (s.delivery_state = 'QUEUED' AND s.next_attempt_at <= now())
        OR (s.delivery_state = 'SENDING' AND s.claimed_at < now() - make_interval(secs => greatest(stale_after_seconds, 60)))
     ORDER BY s.next_attempt_at, s.id
     LIMIT least(greatest(max_rows, 1), 100);
END
$$;

DO $$
DECLARE r text;
BEGIN
  REVOKE ALL ON FUNCTION app.pending_staff_invitation_deliveries(integer, integer) FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION app.pending_staff_invitation_deliveries(integer, integer) FROM %I', r);
    END IF;
  END LOOP;
  GRANT EXECUTE ON FUNCTION app.pending_staff_invitation_deliveries(integer, integer) TO dsa_app;
END
$$;
