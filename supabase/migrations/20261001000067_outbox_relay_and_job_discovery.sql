-- Migration: 20261001000067_outbox_relay_and_job_discovery.sql
-- Owner: Dev 1 (kernel infra, TASK-105; ENT-108 outbox_event, job_queue from M-033)
-- 1. Nothing ever read outbox_event, so events were written and never delivered (automation triggers never fired). The
--    relay in the API's background worker now publishes them. Like the data-correction executor (M-062), it finds work across
--    tenants through a SECURITY DEFINER function that returns ids only and answers only the worker's SYSTEM context, then
--    handles each event inside that event's own tenant, where row-level security applies.
-- 2. dsa_app could INSERT and SELECT outbox_event but not mark it published. It may now update only the delivery columns.
-- 3. A poison event must not block the queue: failed attempts are counted and, after the limit, the event is parked
--    (dead_lettered_at) with its last error for an operator to look at.
-- 4. The job worker polled job_queue as a single fixed tenant, so jobs of real tenants were never picked up. It now discovers
--    runnable jobs the same way.

SET search_path = app, extensions, public;

ALTER TABLE outbox_event ADD COLUMN IF NOT EXISTS publish_attempts smallint NOT NULL DEFAULT 0;
ALTER TABLE outbox_event ADD COLUMN IF NOT EXISTS last_publish_error text
  CHECK (last_publish_error IS NULL OR char_length(last_publish_error) <= 500);
ALTER TABLE outbox_event ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;
DROP INDEX IF EXISTS outbox_event_unpublished_idx;
CREATE INDEX IF NOT EXISTS outbox_event_unpublished_idx ON outbox_event (created_at)
  WHERE published_at IS NULL AND dead_lettered_at IS NULL;

GRANT UPDATE (published_at, publish_attempts, last_publish_error, dead_lettered_at) ON outbox_event TO dsa_app;

CREATE OR REPLACE FUNCTION app.pending_outbox_events(max_rows integer DEFAULT 50)
RETURNS TABLE (tenant_id text, id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS
$$
BEGIN
  IF app.app_tenant() IS DISTINCT FROM 'SYSTEM' THEN
    RAISE EXCEPTION 'pending_outbox_events is for the outbox relay only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT e.tenant_id, e.id
      FROM app.outbox_event e
     WHERE e.published_at IS NULL AND e.dead_lettered_at IS NULL
     ORDER BY e.created_at, e.id
     LIMIT least(greatest(max_rows, 1), 500);
END
$$;

CREATE OR REPLACE FUNCTION app.runnable_jobs(max_rows integer DEFAULT 20)
RETURNS TABLE (tenant_id text, id text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS
$$
BEGIN
  IF app.app_tenant() IS DISTINCT FROM 'SYSTEM' THEN
    RAISE EXCEPTION 'runnable_jobs is for the job worker only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT j.tenant_id, j.id
      FROM app.job_queue j
     WHERE j.status IN ('PENDING', 'FAILED') AND j.run_at <= now() AND j.attempts < j.max_attempts
     ORDER BY j.run_at, j.id
     LIMIT least(greatest(max_rows, 1), 100);
END
$$;

DO $$
DECLARE r text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['app.pending_outbox_events(integer)', 'app.runnable_jobs(integer)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', f, r);
      END IF;
    END LOOP;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO dsa_app', f);
  END LOOP;
END
$$;
