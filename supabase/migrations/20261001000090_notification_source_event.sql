-- Migration: 20261001000090_notification_source_event.sql
-- Module 40 / CMP-NTF.01.1. A notification can now say which domain event produced it. The outbox relay retries an event
-- that failed part-way, so the same event may reach the notification subscriber twice. The unique index makes the second
-- delivery a no-op for that user: one event, at most one notification per recipient.
SET search_path = app, extensions, public;

ALTER TABLE notification ADD COLUMN IF NOT EXISTS source_event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS notification_source_event_uq
  ON notification (tenant_id, user_id, source_event_id)
  WHERE source_event_id IS NOT NULL;
