-- 20261001000005_messaging.sql (owner: Dev 1, TASK-415 / MOD-MSG)
-- Migration Plan §0: every migration starts with this search_path
SET search_path = app, extensions, public;

-- ENT-035: Message Template (Doc 11 §3)
CREATE TABLE message_template (
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenant(id),
  code                 text NOT NULL CHECK (code ~ '^[a-z0-9._-]{3,50}$'),
  channel              text NOT NULL CHECK (channel IN ('EMAIL','SMS','WHATSAPP')),
  language             text NOT NULL DEFAULT 'en' CHECK (char_length(language) BETWEEN 2 AND 10),
  category             text NOT NULL CHECK (category IN ('TRANSACTIONAL','MARKETING','OPERATIONAL','AUTHENTICATION')),
  body                 text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  variables            jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(variables) = 'array'),
  provider_template_id text,
  version              integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status               text NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('DRAFT','APPROVED','DEPRECATED','ARCHIVED')),
  lock_version         integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL,
  UNIQUE (tenant_id, code, version)
);

CREATE INDEX message_template_lookup_idx ON message_template (tenant_id, code, status);

-- Trigger: touch_row updates lock_version and updated_at
CREATE TRIGGER message_template_touch
  BEFORE UPDATE ON message_template
  FOR EACH ROW
  EXECUTE FUNCTION touch_row();

-- Immutability guard for approved templates: body & variables cannot be mutated; new version required
CREATE OR REPLACE FUNCTION message_template_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'APPROVED' THEN
    IF NEW.body IS DISTINCT FROM OLD.body OR NEW.variables IS DISTINCT FROM OLD.variables OR NEW.code IS DISTINCT FROM OLD.code THEN
      RAISE EXCEPTION 'Approved template % version % is immutable; create a new version to modify content', OLD.code, OLD.version USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER message_template_immutability
  BEFORE UPDATE ON message_template
  FOR EACH ROW
  EXECUTE FUNCTION message_template_guard();

CREATE TRIGGER message_template_no_delete
  BEFORE DELETE ON message_template
  FOR EACH ROW
  EXECUTE FUNCTION forbid_mutation();

-- ENT-036: Message Record (Doc 11 §4)
CREATE TABLE message (
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenant(id),
  direction            text NOT NULL CHECK (direction IN ('OUTBOUND','INBOUND')),
  channel              text NOT NULL CHECK (channel IN ('EMAIL','SMS','WHATSAPP')),
  subject_type         text NOT NULL CHECK (subject_type IN ('LEAD','CUSTOMER','LOAN_APPLICATION')),
  subject_id           text NOT NULL,
  template_version_id  text NOT NULL REFERENCES message_template(id),
  recipient_hash       text NOT NULL CHECK (char_length(recipient_hash) = 64),
  recipient_masked     text NOT NULL,
  variables_redacted   jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(variables_redacted) = 'object'),
  provider             text NOT NULL,
  provider_message_id  text,
  status               text NOT NULL CHECK (status IN ('BLOCKED','QUEUED','SENT','DELIVERED','FAILED','UNDELIVERED')),
  status_history       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(status_history) = 'array'),
  blocked_reason       text,
  lock_version         integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text NOT NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text NOT NULL
);

CREATE UNIQUE INDEX message_provider_msg_uq ON message (tenant_id, provider, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX message_subject_idx ON message (tenant_id, subject_type, subject_id, created_at DESC);
CREATE INDEX message_recipient_idx ON message (tenant_id, recipient_hash, created_at DESC);

CREATE TRIGGER message_touch
  BEFORE UPDATE ON message
  FOR EACH ROW
  EXECUTE FUNCTION touch_row();

CREATE TRIGGER message_no_delete
  BEFORE DELETE ON message
  FOR EACH ROW
  EXECUTE FUNCTION forbid_mutation();

-- Update ENT-116 dedupe_registry namespace check to support PROVIDER_MESSAGE and MESSAGE_FREQ
ALTER TABLE dedupe_registry DROP CONSTRAINT IF EXISTS dedupe_registry_namespace_check;
ALTER TABLE dedupe_registry ADD CONSTRAINT dedupe_registry_namespace_check CHECK (namespace IN ('DECISION', 'PROVIDER_MESSAGE', 'MESSAGE_FREQ'));

-- Enable RLS (tenant_isolation)
CALL enable_tenant_rls('message_template');
CALL enable_tenant_rls('message');

-- Grant permissions to dsa_app (no DELETE)
GRANT SELECT, INSERT, UPDATE ON message_template, message TO dsa_app;

-- Seed permission for message.send
INSERT INTO permission (code, description, introduced_in)
VALUES ('message.send', 'Send customer and lead outbound messages', 'MVP-4D')
ON CONFLICT DO NOTHING;

-- Grant message.send to tenant administrative and operational roles
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'message.send'
FROM role r
WHERE r.code IN ('ROLE-TENANT-ADMIN', 'ROLE-ORG-OWNER', 'ROLE-SUPERVISOR', 'ROLE-AGENT')
ON CONFLICT DO NOTHING;

-- ENT-115 public_entry_index: maps public webhook paths to tenants securely
CREATE TABLE IF NOT EXISTS public_entry_index (
  connection_path_id text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenant(id),
  provider           text NOT NULL,
  connection_id      text NOT NULL,
  signing_secret     text,
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CALL enable_tenant_rls('public_entry_index');
GRANT SELECT, INSERT, UPDATE ON public_entry_index TO dsa_app;

CREATE OR REPLACE FUNCTION resolve_public_entry(p_connection_path_id text)
RETURNS TABLE (
  tenant_id text,
  provider text,
  connection_id text,
  signing_secret text,
  status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT tenant_id, provider, connection_id, signing_secret, status
  FROM app.public_entry_index
  WHERE connection_path_id = p_connection_path_id
    AND status = 'ACTIVE'
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_public_entry(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_public_entry(text) TO dsa_app;
