-- 20261001000006_notifications.sql (owner: Dev 1 / Dev 5, TASK-405 / MOD-NTF)
-- Module 12: Notifications (MOD-NTF) & Notification Preferences
-- Canonical entities: ENT-033 (notification), ENT-005 (app_user preferences extension)

SET search_path = app, extensions, public;

-- SUB-NTF.02: Add notification_preferences to ENT-005 app_user
ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS notification_preferences jsonb NOT NULL
  DEFAULT '{"channels":{"inApp":true,"email":false,"sms":false,"whatsapp":false},"digestFrequency":"IMMEDIATE","mutedCategories":[]}'::jsonb;

-- SUB-NTF.01: Canonical ENT-033 notification
CREATE TABLE IF NOT EXISTS notification (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenant(id),
  user_id      text NOT NULL,
  category     text NOT NULL CHECK (category IN ('TASK','LEAD','APPLICATION','SYSTEM','ALERT')),
  title        text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 250),
  deep_link    text NOT NULL CHECK (deep_link ~ '^/[a-zA-Z0-9_.-]+(/.*)?$'),
  read_at      timestamptz,
  lock_version integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES app_user(tenant_id, id)
);

-- Indices for inbox retrieval, cursor pagination, and unread badges
CREATE INDEX IF NOT EXISTS notification_inbox_idx ON notification (tenant_id, user_id, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS notification_user_created_idx ON notification (tenant_id, user_id, created_at DESC);

-- Concurrency and append-only triggers
CREATE TRIGGER notification_touch
  BEFORE UPDATE ON notification
  FOR EACH ROW
  EXECUTE FUNCTION touch_row();

CREATE TRIGGER notification_no_delete
  BEFORE DELETE ON notification
  FOR EACH ROW
  EXECUTE FUNCTION forbid_mutation();

-- Enable Tenant RLS
CALL enable_tenant_rls('notification');

-- Grant permissions to dsa_app (NO DELETE privilege)
GRANT SELECT, INSERT, UPDATE ON notification TO dsa_app;
