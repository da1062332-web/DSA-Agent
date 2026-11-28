-- Migration 0140 (owner: Devyani, task P1-07 of the multi-lender plan): lender MIS status import.
-- Why: most Indian banks send a daily status spreadsheet rather than offering an API, and operations currently moves
-- cases by hand, one row at a time. The import framework (migration 0033) already carries batches, column mappings,
-- checksums and idempotency keys, but import_batch.target_entity admits only LEAD and CUSTOMER. Two changes:
--
--   import_batch.target_entity  widened with LENDER_CASE_STATUS. The existing CHECK is replaced by a superset, so every
--                               row that satisfied the old constraint still satisfies the new one and no data moves.
--                               Unlike LEAD and CUSTOMER this target inserts nothing: its rows match lender cases that
--                               already exist, by the bank's own reference number, and move them.
--   lender_mis_mapping          one saved mapping per lender: which column holds what, how that bank words each stage,
--                               and how it writes dates. Set up once and reused every morning.
--
-- No existing column is altered and no row is rewritten. Re-runnable: every statement is guarded, so an interrupted
-- hosted apply can be run again.

SET search_path = app, extensions, public;

-- ============================================================================
-- 1. import_batch.target_entity: add LENDER_CASE_STATUS
-- ============================================================================
-- The constraint is unnamed in migration 0033, so Postgres named it. It is found by what it constrains rather than by a
-- guessed name: a later migration may have recreated it under a different one, and dropping the wrong constraint here
-- would silently remove a different rule.
DO $$
DECLARE
  con_name text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = rel.relnamespace
    WHERE ns.nspname = 'app' AND rel.relname = 'import_batch' AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%LENDER_CASE_STATUS%'
  ) THEN
    RETURN;  -- already widened by an earlier run of this migration
  END IF;

  SELECT con.conname INTO con_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace ns ON ns.oid = rel.relnamespace
  WHERE ns.nspname = 'app' AND rel.relname = 'import_batch' AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%target_entity%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE import_batch DROP CONSTRAINT %I', con_name);
  END IF;

  ALTER TABLE import_batch
    ADD CONSTRAINT import_batch_target_entity_check
    CHECK (target_entity IN ('LEAD', 'CUSTOMER', 'LENDER_CASE_STATUS'));
END $$;

-- ============================================================================
-- 2. lender_mis_mapping: how one bank's sheet is read
-- ============================================================================
CREATE TABLE IF NOT EXISTS lender_mis_mapping (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenant(id),
  lender_id       text NOT NULL,
  -- Column heading in the bank's sheet -> the field it holds (lenderReference, status, reasonText,
  -- disbursedAmount, disbursedOn). Validated in the service against MIS_TARGET_FIELDS.
  column_map      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The bank's own word for a stage -> our lender_case status. Compared case-insensitively by the service, because one
  -- file holds "Disbursed", "DISBURSED" and "Disbursed " for the same stage.
  status_map      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Stated per lender, never guessed per row: a day-first date read as month-first is a valid but wrong date on the
  -- twelve days of each month where both readings parse, and nothing downstream would flag it.
  date_format     text NOT NULL DEFAULT 'DD-MM-YYYY'
                  CHECK (date_format IN ('DD-MM-YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY')),
  -- Bumped on every save, so a batch can record which version of the mapping read it.
  version         integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  last_import_at  timestamptz,
  lock_version    integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  -- One mapping per lender per tenant: the morning import must not have to choose between two.
  UNIQUE (tenant_id, lender_id),
  FOREIGN KEY (tenant_id, lender_id) REFERENCES lender (tenant_id, id)
);

-- enable_tenant_rls (migration 0000) runs a bare CREATE POLICY with no IF NOT EXISTS, so calling it twice fails with
-- "policy tenant_isolation already exists" and, this being one transaction, rolls the whole migration back. Guarded so
-- 0140 stays safe to retry after an interrupted hosted apply.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'app' AND tablename = 'lender_mis_mapping' AND policyname = 'tenant_isolation'
  ) THEN
    CALL enable_tenant_rls('app.lender_mis_mapping');
  END IF;
END $$;

-- No DELETE: a mapping is replaced, never removed, so a past batch's recorded version still resolves.
GRANT SELECT, INSERT, UPDATE ON lender_mis_mapping TO dsa_app;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'lender_mis_mapping_touch') THEN
    CREATE TRIGGER lender_mis_mapping_touch BEFORE UPDATE ON lender_mis_mapping
      FOR EACH ROW EXECUTE FUNCTION touch_row();
  END IF;
END $$;
