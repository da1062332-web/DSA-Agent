-- Migration: 20261001000084_connector_portal.sql
-- Owner: Dev 5 (MOD-CPT; API-CPT-001..007)
-- The connector portal (/portal/v1) works on existing tables (lead.connector_id, commission_payable, payout_request/line,
-- dispute, connector_agreement). The one new table is the customer consent OTP for a referral (API-CPT-003): only a hash of
-- the code is kept, it expires after 10 minutes, allows 5 attempts and is used by at most one referral.

SET search_path = app, extensions, public;

CREATE TABLE IF NOT EXISTS referral_consent_otp (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  connector_id  text NOT NULL,
  mobile_hash   bytea NOT NULL,
  code_hash     text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at    timestamptz NOT NULL,
  attempts      integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  verified_at   timestamptz,
  used_by_lead  text,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, connector_id) REFERENCES connector (tenant_id, id),
  CHECK (used_by_lead IS NULL OR verified_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS referral_consent_otp_connector_idx ON referral_consent_otp (tenant_id, connector_id, created_at DESC);
CALL enable_tenant_rls('referral_consent_otp');
GRANT SELECT, INSERT ON referral_consent_otp TO dsa_app;
GRANT UPDATE (attempts, verified_at, used_by_lead) ON referral_consent_otp TO dsa_app;
