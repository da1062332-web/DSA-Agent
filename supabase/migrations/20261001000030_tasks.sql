-- Gate 0 baseline (PRE-008): DDL below is copied verbatim from the Database Migration Plan §7.
-- Owner (v1.2 Assignment Matrix §3): Dev 6. The owner hardens this file until it merges;
-- after that it is never edited — corrections are new files in the owner's number range (MANIFEST.md).
-- Migration Plan §0: every migration file starts with this search_path.
SET search_path = app, extensions, public;

-- 0030_tasks.sql  (owner: Dev 3, TASK-302)
CREATE TABLE task (                                              -- ENT-030 (SLA instance table deferred to TASK-404)
  id                      text PRIMARY KEY,
  tenant_id               text NOT NULL REFERENCES tenant(id),
  type                    text NOT NULL CHECK (type IN ('FOLLOW_UP','CALL','MEETING','DOCUMENT_COLLECTION','LENDER_QUERY','REVIEW','GENERAL')),
  title                   text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  owner_user_id           text,
  owner_queue_id          text,
  linked_type             text NOT NULL CHECK (linked_type IN ('LEAD','LOAN_APPLICATION','LENDER_CASE')),
  linked_id               text NOT NULL,
  branch_id               text NOT NULL,                         -- denormalised from linked record for scope filtering
  priority                text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('HIGH','MEDIUM','LOW')),
  status                  text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','SNOOZED','COMPLETED','CANCELLED')),
  due_at                  timestamptz NOT NULL,
  sla_class               text CHECK (sla_class IS NULL OR sla_class IN ('CUSTOMER_FIRST_CONTACT','CUSTOMER_FOLLOW_UP','LENDER_QUERY','LENDER_PROCESSING','INTERNAL_REVIEW','DOCUMENT_REVIEW')),
  sla_decision_record_id  text,
  sla_rule_version_id     text,                                  -- PIN binding for DK-sla.target
  outcome_code            text CHECK (outcome_code IS NULL OR outcome_code IN ('CONNECTED','NO_ANSWER','BUSY','SWITCHED_OFF','WRONG_NUMBER','CALLBACK_REQUESTED','NOT_INTERESTED','DONE','NOT_REQUIRED','OTHER')),
  completion_note         text CHECK (completion_note IS NULL OR char_length(completion_note) <= 2000),
  completed_at            timestamptz,
  completed_by            text,
  follow_up_task_id       text,
  idempotency_key         text NOT NULL,
  created_by_source       text NOT NULL CHECK (created_by_source IN ('USER','SYSTEM')),
  tags                    text[] NOT NULL DEFAULT '{}',
  lock_version            integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, owner_user_id)  REFERENCES app_user (tenant_id, id),
  FOREIGN KEY (tenant_id, owner_queue_id) REFERENCES work_queue (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id)      REFERENCES branch (tenant_id, id),
  CHECK ((owner_user_id IS NULL) <> (owner_queue_id IS NULL)),
  CHECK (status <> 'COMPLETED' OR (completed_at IS NOT NULL AND completed_by IS NOT NULL)),
  CHECK (status <> 'COMPLETED' OR type NOT IN ('FOLLOW_UP','CALL') OR outcome_code IS NOT NULL)
);
CREATE INDEX task_owner_open_idx  ON task (tenant_id, owner_user_id, due_at) WHERE status IN ('OPEN','IN_PROGRESS','SNOOZED');
CREATE INDEX task_queue_open_idx  ON task (tenant_id, owner_queue_id, due_at) WHERE owner_queue_id IS NOT NULL AND status IN ('OPEN','IN_PROGRESS');
CREATE INDEX task_linked_idx      ON task (tenant_id, linked_type, linked_id);
CREATE INDEX task_branch_due_idx  ON task (tenant_id, branch_id, due_at);
CREATE TRIGGER task_touch BEFORE UPDATE ON task FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('task');
GRANT SELECT, INSERT, UPDATE ON task TO dsa_app;
