-- Migration 0111 (owner: Bhushan, task P1-03 of the multi-lender plan): property collateral on a loan application.
-- Why: secured loans (home loan, loan against property, business loan against property) need the pledged property on the file, so a
-- lender can test the loan amount against value x LTV cap, and application_party already covers co-applicants. One table is added;
-- no existing table or row is changed.
--
--   application_collateral  one row per pledged property: type, address, estimated market value in whole paise (bigint, never a
--                           float; the API serves it as { amount, currency }), ownership, occupancy and appraisal date. Removal is a
--                           soft delete (removed_at, removed_by), because dsa_app has no DELETE grant.
--
-- tenant_id, row level security (app_tenant()) and lock_version for If-Match, as on every tenant table. The id is a prefixed ULID
-- (acol_…, ADR-013), not a UUID. No S3-class field (owner PAN, title-deed or registration numbers) exists here and none may be added.
-- Idempotent: the policy is created only when missing, so re-running it leaves the same definitions. Not applied to hosted.

SET search_path = app, extensions, public;

CREATE TABLE IF NOT EXISTS application_collateral (               -- ENT-046 extension (P1-03)
  id                            text PRIMARY KEY,
  tenant_id                     text NOT NULL REFERENCES tenant(id),
  application_id                text NOT NULL,
  property_type                 text NOT NULL CHECK (property_type IN ('RESIDENTIAL_FLAT','RESIDENTIAL_PLOT','COMMERCIAL','INDUSTRIAL')),
  address_line1                 text NOT NULL CHECK (char_length(address_line1) BETWEEN 3 AND 200),
  city                          text NOT NULL CHECK (char_length(city) BETWEEN 2 AND 80),
  state                         text NOT NULL CHECK (char_length(state) BETWEEN 2 AND 80),
  pincode                       text NOT NULL CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  estimated_market_value_paise  bigint NOT NULL CHECK (estimated_market_value_paise > 0),
  ownership_type                text NOT NULL CHECK (ownership_type IN ('FREEHOLD','LEASEHOLD')),
  occupancy_type                text CHECK (occupancy_type IS NULL OR occupancy_type IN ('SELF_OCCUPIED','TENANTED','VACANT')),
  appraisal_date                date,
  removed_at                    timestamptz,
  removed_by                    text,
  lock_version                  integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, application_id) REFERENCES loan_application (tenant_id, id),
  CONSTRAINT application_collateral_removed_check CHECK ((removed_at IS NULL) = (removed_by IS NULL))
);

CREATE INDEX IF NOT EXISTS application_collateral_app_idx
  ON application_collateral (tenant_id, application_id) WHERE removed_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'application_collateral'
                    AND policyname = 'tenant_isolation') THEN
    CALL enable_tenant_rls('application_collateral');
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON application_collateral TO dsa_app;
