-- 20261001000121_lender_pack_profile.sql  (owner: Dipanshu — lenders, matching, reporting; task P2-04)
-- Lender document packs. Additive, forward-only and idempotent: applying it twice changes nothing.
-- Not applied to the hosted project by this file: the owner applies it through the one-transaction wrapper, with
-- tools/sql/batch/121.verify.sql passing before (expect FAIL rows) and after (expect none). Rollback: tools/sql/batch/121.rollback.sql.
--   lender_pack_profile: how one lender wants a submission pack. document_order lists document type codes in the lender's order
--   (types not listed follow, in the frozen manifest's order); filename_pattern names each file from tokens ({seq} is required, so
--   names never collide). merge_pdf is kept for the single-PDF follow-up; the MVP always streams a ZIP (owner decision, 28 Nov
--   2026: no new PDF dependency). At most one profile per lender; a lender without one uses the API's default profile.
-- No new permission: reading a profile uses the lender read permissions, editing uses lender.manage or config.manage, and the pack
-- download uses lender_case.submit (the permission that builds and submits the case).
SET search_path = app, extensions, public;

CREATE TABLE IF NOT EXISTS lender_pack_profile (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenant(id),
  lender_id         text NOT NULL,
  -- Document type codes, each at most once (the API rejects duplicates).
  document_order    jsonb NOT NULL DEFAULT '[]'::jsonb
                    CHECK (jsonb_typeof(document_order) = 'array' AND jsonb_array_length(document_order) <= 60),
  filename_pattern  text NOT NULL DEFAULT '{seq}_{docType}'
                    CHECK (char_length(filename_pattern) BETWEEN 5 AND 120 AND position('{seq}' IN filename_pattern) > 0),
  merge_pdf         boolean NOT NULL DEFAULT false,
  lock_version      integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, lender_id),
  FOREIGN KEY (tenant_id, lender_id) REFERENCES lender (tenant_id, id)
);
CREATE OR REPLACE TRIGGER lender_pack_profile_touch BEFORE UPDATE ON lender_pack_profile
  FOR EACH ROW EXECUTE FUNCTION touch_row();

-- Row-level security (tenant_id = app_tenant()). enable_tenant_rls creates the policy, so skip it when the policy exists.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'app' AND tablename = 'lender_pack_profile' AND policyname = 'tenant_isolation') THEN
    CALL enable_tenant_rls('app.lender_pack_profile');
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON lender_pack_profile TO dsa_app;   -- a profile is edited, never deleted
