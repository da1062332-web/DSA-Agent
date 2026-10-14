-- 0023_lender_contacts_and_fields.sql  (owner: Dev 3, MOD-LND, DSA Notion MODULE 14)
-- Additive. Completes the Module 14 data model: the spec fields missing from 0020 and the lender contact list
-- (SUB-LND.03, ENT-042). Contacts are never deleted: replacing the list sets removed_at, so history stays
-- (same rule as team and queue memberships).
SET search_path = app, extensions, public;

ALTER TABLE lender      ADD COLUMN global_lender_ref     text;
ALTER TABLE empanelment ADD COLUMN permitted_geos        jsonb NOT NULL DEFAULT '[]'::jsonb
                                                         CHECK (jsonb_typeof(permitted_geos) = 'array');
ALTER TABLE empanelment ADD COLUMN agreement_document_id text;

CREATE TABLE lender_contact (                                      -- ENT-042
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenant(id),
  lender_id          text NOT NULL,
  name               text NOT NULL,
  role               text,
  email              text,
  phone              text,
  channel            text,
  escalation_level   smallint NOT NULL DEFAULT 1 CHECK (escalation_level BETWEEN 1 AND 3),
  removed_at         timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  FOREIGN KEY (tenant_id, lender_id) REFERENCES lender (tenant_id, id)
);
CREATE INDEX lender_contact_lender_idx ON lender_contact (tenant_id, lender_id) WHERE removed_at IS NULL;

CALL enable_tenant_rls('lender_contact');
GRANT SELECT, INSERT ON lender_contact TO dsa_app;
GRANT UPDATE (removed_at) ON lender_contact TO dsa_app;
