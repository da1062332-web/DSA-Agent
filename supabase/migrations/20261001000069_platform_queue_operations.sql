-- Migration: 20261001000069_platform_queue_operations.sql
-- Owner: Dev 1 (MOD-ADM SUB-ADM.04 background jobs; MOD-INT SUB-INT dead letters API-INT-003..005)
-- The platform console showed sample queues and dead letters. The API now has two real background queues: the outbox relay
-- (outbox_event, M-067) and the job queue (job_queue, M-033). This gives the console their real state:
--  1. worker_queue_state: a pause flag per queue, honoured by the API's background worker;
--  2. platform functions (platform realm only, SECURITY DEFINER) that report queue counts and list the parked items (ids, type,
--     error and timing only, never the event payload) and replay or discard one;
--  3. outbox_event.discarded_at, so a discarded event is kept for audit but never delivered.

SET search_path = app, extensions, public;

CREATE TABLE IF NOT EXISTS worker_queue_state (
  queue          text PRIMARY KEY CHECK (queue IN ('outbox-relay', 'job-queue')),
  paused         boolean NOT NULL DEFAULT false,
  paused_reason  text CHECK (paused_reason IS NULL OR char_length(paused_reason) BETWEEN 5 AND 500),
  paused_at      timestamptz,
  paused_by      text,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (paused = (paused_at IS NOT NULL))
);
INSERT INTO worker_queue_state (queue) VALUES ('outbox-relay'), ('job-queue') ON CONFLICT (queue) DO NOTHING;
ALTER TABLE worker_queue_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_queue_state FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS worker_queue_state_platform ON worker_queue_state;
-- The platform realm reads and changes the flags; the worker (SYSTEM context) only reads them.
CREATE POLICY worker_queue_state_platform ON worker_queue_state
  USING (is_platform_realm() OR app_tenant() = 'SYSTEM')
  WITH CHECK (is_platform_realm());
GRANT SELECT, UPDATE ON worker_queue_state TO dsa_app;

ALTER TABLE outbox_event ADD COLUMN IF NOT EXISTS discarded_at timestamptz;
GRANT UPDATE (discarded_at) ON outbox_event TO dsa_app;

-- Discovery skips discarded events too.
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
     WHERE e.published_at IS NULL AND e.dead_lettered_at IS NULL AND e.discarded_at IS NULL
     ORDER BY e.created_at, e.id
     LIMIT least(greatest(max_rows, 1), 500);
END
$$;

CREATE OR REPLACE FUNCTION app.platform_queue_stats()
RETURNS TABLE (queue text, active_jobs bigint, failed_jobs bigint, delayed_jobs bigint, completed_jobs bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS
$$
BEGIN
  IF NOT is_platform_realm() THEN
    RAISE EXCEPTION 'platform_queue_stats is for the platform realm only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT 'outbox-relay'::text,
           count(*) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL AND discarded_at IS NULL AND publish_attempts = 0),
           count(*) FILTER (WHERE dead_lettered_at IS NOT NULL AND discarded_at IS NULL),
           count(*) FILTER (WHERE published_at IS NULL AND dead_lettered_at IS NULL AND discarded_at IS NULL AND publish_attempts > 0),
           count(*) FILTER (WHERE published_at > now() - interval '24 hours')
      FROM app.outbox_event
    UNION ALL
    SELECT 'job-queue'::text,
           count(*) FILTER (WHERE status IN ('PENDING', 'RUNNING') AND run_at <= now()),
           count(*) FILTER (WHERE status = 'FAILED' AND attempts >= max_attempts),
           count(*) FILTER (WHERE (status = 'PENDING' AND run_at > now()) OR (status = 'FAILED' AND attempts < max_attempts)),
           count(*) FILTER (WHERE status = 'COMPLETED' AND completed_at > now() - interval '24 hours')
      FROM app.job_queue;
END
$$;

CREATE OR REPLACE FUNCTION app.platform_dead_letters(max_rows integer DEFAULT 100)
RETURNS TABLE (id text, tenant_id text, queue text, item_type text, error_reason text, failed_at timestamptz,
               retry_count integer, status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS
$$
BEGIN
  IF NOT is_platform_realm() THEN
    RAISE EXCEPTION 'platform_dead_letters is for the platform realm only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT * FROM (
      SELECT e.id, e.tenant_id, 'outbox-relay'::text, e.event_type, coalesce(e.last_publish_error, 'unknown'),
             e.dead_lettered_at, e.publish_attempts::integer,
             CASE WHEN e.discarded_at IS NULL THEN 'UNRESOLVED' ELSE 'DISCARDED' END
        FROM app.outbox_event e
       WHERE e.dead_lettered_at IS NOT NULL
      UNION ALL
      SELECT j.id, j.tenant_id, 'job-queue'::text, j.job_type, coalesce(j.last_error, 'unknown'),
             coalesce(j.completed_at, j.started_at, j.created_at), j.attempts,
             CASE WHEN j.status = 'CANCELLED' THEN 'DISCARDED' ELSE 'UNRESOLVED' END
        FROM app.job_queue j
       WHERE (j.status = 'FAILED' AND j.attempts >= j.max_attempts) OR (j.status = 'CANCELLED' AND j.last_error IS NOT NULL)
    ) d
    ORDER BY 6 DESC
    LIMIT least(greatest(max_rows, 1), 500);
END
$$;

-- REPLAY puts the item back in its queue for another set of attempts; DISCARD keeps it, never to be delivered.
CREATE OR REPLACE FUNCTION app.platform_dead_letter_action(item_id text, action text)
RETURNS TABLE (id text, tenant_id text, queue text, status text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = app, pg_temp AS
$$
BEGIN
  IF NOT is_platform_realm() THEN
    RAISE EXCEPTION 'platform_dead_letter_action is for the platform realm only' USING ERRCODE = '42501';
  END IF;
  IF action NOT IN ('REPLAY', 'DISCARD') THEN
    RAISE EXCEPTION 'unknown action %', action USING ERRCODE = '22023';
  END IF;
  IF action = 'REPLAY' THEN
    RETURN QUERY UPDATE app.outbox_event e
       SET dead_lettered_at = NULL, publish_attempts = 0, last_publish_error = NULL
     WHERE e.id = item_id AND e.dead_lettered_at IS NOT NULL AND e.discarded_at IS NULL
     RETURNING e.id, e.tenant_id, 'outbox-relay'::text, 'REPLAYED'::text;
    IF FOUND THEN RETURN; END IF;
    RETURN QUERY UPDATE app.job_queue j
       SET status = 'PENDING', attempts = 0, run_at = now()
     WHERE j.id = item_id AND j.status = 'FAILED' AND j.attempts >= j.max_attempts
     RETURNING j.id, j.tenant_id, 'job-queue'::text, 'REPLAYED'::text;
  ELSE
    RETURN QUERY UPDATE app.outbox_event e
       SET discarded_at = now()
     WHERE e.id = item_id AND e.dead_lettered_at IS NOT NULL AND e.discarded_at IS NULL
     RETURNING e.id, e.tenant_id, 'outbox-relay'::text, 'DISCARDED'::text;
    IF FOUND THEN RETURN; END IF;
    RETURN QUERY UPDATE app.job_queue j
       SET status = 'CANCELLED'
     WHERE j.id = item_id AND j.status = 'FAILED' AND j.attempts >= j.max_attempts
     RETURNING j.id, j.tenant_id, 'job-queue'::text, 'DISCARDED'::text;
  END IF;
END
$$;

DO $$
DECLARE r text; f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['app.platform_queue_stats()', 'app.platform_dead_letters(integer)',
                           'app.platform_dead_letter_action(text, text)', 'app.pending_outbox_events(integer)'] LOOP
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
