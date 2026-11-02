-- Migration 0099: a verification record can be about a connector, and a connector activation may use only a verification about that connector.
-- Why: connector activation accepted any VERIFIED record in the tenant. A verification about a customer, or about another connector,
-- therefore activated a connector. A verification now names its connector (connector_id). A CONNECTOR subject must name the connector it is
-- about, and a connector_id may appear only on a CONNECTOR subject. Existing records keep their subject and connector_id NULL, so they are
-- not changed and their meaning does not change.
--
-- Consent is not changed here. A verification still needs an ACTIVE consent record, and consent_record accepts only LEAD and CUSTOMER
-- subjects. Until connector consent is decided, no connector verification can be recorded, so no connector can be activated. This is a
-- compliance decision (docs/CONNECTOR_VERIFICATION_DECISION.md), not something a migration should settle.
--
-- The verification table is append-only (verification_no_mutation) and stays so: this migration adds a column and a constraint only.
-- Not applied to hosted. Idempotent: re-running it leaves the same definitions.

SET search_path = app, extensions, public;

ALTER TABLE verification ADD COLUMN IF NOT EXISTS connector_id text;

ALTER TABLE verification DROP CONSTRAINT IF EXISTS verification_subject_type_check;
ALTER TABLE verification ADD CONSTRAINT verification_subject_type_check
  CHECK (subject_type IN ('CUSTOMER', 'LOAN_APPLICATION', 'LEAD', 'CONNECTOR'));

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'verification_connector_fk' AND conrelid = 'app.verification'::regclass) THEN
    ALTER TABLE verification ADD CONSTRAINT verification_connector_fk
      FOREIGN KEY (tenant_id, connector_id) REFERENCES connector (tenant_id, id);
  END IF;
END $$;

ALTER TABLE verification DROP CONSTRAINT IF EXISTS verification_connector_subject_check;
ALTER TABLE verification ADD CONSTRAINT verification_connector_subject_check CHECK (
  (subject_type = 'CONNECTOR') = (connector_id IS NOT NULL)
  AND (subject_type <> 'CONNECTOR' OR subject_id = connector_id)
);

CREATE INDEX IF NOT EXISTS verification_connector_idx
  ON verification (tenant_id, connector_id, performed_at DESC)
  WHERE connector_id IS NOT NULL;
