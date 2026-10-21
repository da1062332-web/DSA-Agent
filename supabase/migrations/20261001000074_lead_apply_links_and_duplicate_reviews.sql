-- Migration: 20261001000074_lead_apply_links_and_duplicate_reviews.sql
-- Owner: Dev 5 (MOD-LEAD SUB-LEAD.01, .04, .10)
--   ENT-024 apply_link: a public enquiry form link (API-LEAD-010, API-LEAD-011). Only the sha256 of the token is stored;
--           resolve_public_apply_link() finds the tenant for the unauthenticated form, like resolve_public_upload_link().
--   ENT-023 duplicate_review: a pair of leads queued for a merge-or-dismiss decision (API-LEAD-008, API-LEAD-009). One open
--           review per pair (pair_hash), kept as history once resolved.
--   lead.merged_into_id (a merged lead points at the survivor) and lead.archived_at (SUB-LEAD.10, API-LEAD-014 restore).

SET search_path = app, extensions, public;

ALTER TABLE lead ADD COLUMN IF NOT EXISTS merged_into_id text;
ALTER TABLE lead ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE lead DROP CONSTRAINT IF EXISTS lead_merged_into_fk;
ALTER TABLE lead ADD CONSTRAINT lead_merged_into_fk FOREIGN KEY (tenant_id, merged_into_id) REFERENCES lead (tenant_id, id);
ALTER TABLE lead DROP CONSTRAINT IF EXISTS lead_merged_into_check;
ALTER TABLE lead ADD CONSTRAINT lead_merged_into_check
  CHECK (merged_into_id IS NULL OR (state = 'MERGED' AND merged_into_id <> id));
ALTER TABLE lead DROP CONSTRAINT IF EXISTS lead_archived_at_check;
-- One direction only: leads archived before this migration have no archived_at.
ALTER TABLE lead ADD CONSTRAINT lead_archived_at_check CHECK (archived_at IS NULL OR state = 'ARCHIVED');

CREATE TABLE IF NOT EXISTS apply_link (                          -- ENT-024
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenant(id),
  token_hash        text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  branch_id         text NOT NULL,
  product_category  text CHECK (product_category IS NULL OR product_category IN ('PL','BL','MSME','LAP','HL','VL','GL','EL','OTHER')),
  campaign          text CHECK (campaign IS NULL OR char_length(campaign) <= 100),
  employee_id       text,
  connector_id      text,
  notice_version    text NOT NULL CHECK (notice_version ~ '^[A-Za-z0-9._-]{2,40}$'),
  expires_at        timestamptz NOT NULL,
  active            boolean NOT NULL DEFAULT true,
  submissions       integer NOT NULL DEFAULT 0,
  lock_version      integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id)   REFERENCES branch (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES app_user (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS apply_link_tenant_idx ON apply_link (tenant_id, created_at DESC);
CREATE TRIGGER apply_link_touch BEFORE UPDATE ON apply_link FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('apply_link');
GRANT SELECT, INSERT, UPDATE ON apply_link TO dsa_app;

CREATE TABLE IF NOT EXISTS duplicate_review (                    -- ENT-023
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenant(id),
  left_type       text NOT NULL DEFAULT 'LEAD' CHECK (left_type IN ('LEAD')),
  left_id         text NOT NULL,
  right_type      text NOT NULL DEFAULT 'LEAD' CHECK (right_type IN ('LEAD')),
  right_id        text NOT NULL,
  classification  text NOT NULL CHECK (classification IN ('POSSIBLE','EXACT','ATTRIBUTION_CONFLICT')),
  pair_hash       text NOT NULL,
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','MERGED','DISMISSED')),
  resolution      text CHECK (resolution IS NULL OR resolution IN ('MERGE','DISMISS')),
  survivor_id     text,
  reason          text CHECK (reason IS NULL OR char_length(reason) <= 200),
  decision_record_id text,
  resolved_by     text,
  resolved_at     timestamptz,
  lock_version    integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, left_id)  REFERENCES lead (tenant_id, id),
  FOREIGN KEY (tenant_id, right_id) REFERENCES lead (tenant_id, id),
  CHECK (left_id <> right_id),
  CHECK ((status = 'OPEN') = (resolved_at IS NULL)),
  CHECK (status = 'OPEN' OR (resolution IS NOT NULL AND resolved_by IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS duplicate_review_open_pair_uq ON duplicate_review (tenant_id, pair_hash) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS duplicate_review_queue_idx ON duplicate_review (tenant_id, status, created_at, id);
CREATE TRIGGER duplicate_review_touch BEFORE UPDATE ON duplicate_review FOR EACH ROW EXECUTE FUNCTION touch_row();
CALL enable_tenant_rls('duplicate_review');
GRANT SELECT, INSERT, UPDATE ON duplicate_review TO dsa_app;

-- The unauthenticated form knows only its token. This returns the link's tenant and settings for an active, unexpired link,
-- so the API can open a tenant transaction; it never returns another link's data.
CREATE OR REPLACE FUNCTION resolve_public_apply_link(p_token_hash text)
RETURNS TABLE (
  tenant_id text,
  apply_link_id text,
  branch_id text,
  product_category text,
  campaign text,
  employee_id text,
  notice_version text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = app, pg_temp
AS $$
  SELECT tenant_id, id, branch_id, product_category, campaign, employee_id, notice_version
    FROM app.apply_link
   WHERE token_hash = p_token_hash AND active AND expires_at > now()
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_public_apply_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_public_apply_link(text) TO dsa_app;
