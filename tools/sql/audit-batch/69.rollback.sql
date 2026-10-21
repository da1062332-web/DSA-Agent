-- Roll back migration 0069. Refused while an event is discarded (that state would be lost); pending_outbox_events goes back to its 0067 body.
BEGIN;
SET search_path = app, extensions, public;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'outbox_event' AND column_name = 'discarded_at') THEN
    IF EXISTS (SELECT 1 FROM app.outbox_event WHERE discarded_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Rollback aborted: some outbox events are discarded. Manual review required.';
    END IF;
  END IF;
  IF to_regclass('app.worker_queue_state') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM app.worker_queue_state WHERE paused) THEN
      RAISE EXCEPTION 'Rollback aborted: a queue is paused; resume it first. Manual review required.';
    END IF;
  END IF;
END $$;
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
DROP FUNCTION IF EXISTS app.platform_dead_letter_action(text, text);
DROP FUNCTION IF EXISTS app.platform_dead_letters(integer);
DROP FUNCTION IF EXISTS app.platform_queue_stats();
ALTER TABLE app.outbox_event DROP COLUMN IF EXISTS discarded_at;
DROP TABLE IF EXISTS app.worker_queue_state;
COMMIT;
