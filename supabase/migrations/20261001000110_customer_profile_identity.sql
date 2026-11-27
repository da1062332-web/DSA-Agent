-- Migration 0110 (owner: Bhushan, task P1-02 of the multi-lender plan): customer profile, encrypted identity and addresses.
-- Why: every lender login needs the borrower's employment, income, PAN, date of birth and addresses, and the customer record held only
-- a name, a party type and contact points. Three tables are added; no existing table or row is changed.
--
--   customer_profile   one row per customer: constitution, employment, employer or business, vintage, GSTIN, Udyam, monthly income
--                      and obligations (money as numeric with its currency, served as { amount, currency }).
--   customer_identity  one row per customer: PAN and date of birth, each encrypted by the API (AES-256-GCM, never in clear here),
--                      a keyed hash of the PAN for duplicate matching, the masked PAN and the birth year for age rules. No Aadhaar
--                      column exists and none may be added (decision on sensitive fields, plan section 12.6).
--   customer_address   CURRENT, PERMANENT and OFFICE addresses; at most one live address of each type. Removal is a soft delete
--                      (removed_at), because dsa_app has no DELETE grant.
--
-- Every table carries tenant_id, row level security (app_tenant()) and lock_version for If-Match. Loan operations also gets
-- customer.reveal_sensitive (the DSA owner and compliance already hold it, M-085): revealing still needs a reason and a fresh
-- step-up MFA code, and is refused while the project has no second factor.
-- Not applied to hosted. Idempotent: re-running it leaves the same definitions.

SET search_path = app, extensions, public;

CREATE TABLE IF NOT EXISTS customer_profile (                      -- ENT-025 extension (P1-02)
  tenant_id            text NOT NULL REFERENCES tenant(id),
  customer_id          text NOT NULL,
  constitution         text CHECK (constitution IS NULL OR constitution IN
                         ('INDIVIDUAL','PROPRIETORSHIP','PARTNERSHIP','LLP','PRIVATE_LIMITED','PUBLIC_LIMITED','TRUST','HUF')),
  employment_type      text CHECK (employment_type IS NULL OR employment_type IN
                         ('SALARIED','SELF_EMPLOYED_PROFESSIONAL','SELF_EMPLOYED_BUSINESS','RETIRED','HOMEMAKER','STUDENT','OTHER')),
  employer_name        text CHECK (employer_name IS NULL OR char_length(employer_name) BETWEEN 2 AND 200),
  business_name        text CHECK (business_name IS NULL OR char_length(business_name) BETWEEN 2 AND 200),
  vintage_months       integer CHECK (vintage_months IS NULL OR vintage_months BETWEEN 0 AND 1200),
  gstin                text CHECK (gstin IS NULL OR gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  udyam_number         text CHECK (udyam_number IS NULL OR udyam_number ~ '^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$'),
  monthly_income       numeric(18,2) CHECK (monthly_income IS NULL OR monthly_income >= 0),
  monthly_obligations  numeric(18,2) CHECK (monthly_obligations IS NULL OR monthly_obligations >= 0),
  currency             char(3) NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  lock_version         integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  PRIMARY KEY (tenant_id, customer_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS customer_identity (                     -- ENT-025 S3 fields (P1-02)
  tenant_id       text NOT NULL REFERENCES tenant(id),
  customer_id     text NOT NULL,
  pan_ciphertext  bytea,
  pan_hash        bytea,
  pan_masked      text CHECK (pan_masked IS NULL OR pan_masked ~ '^[A-Z]{5}\*{4}[A-Z]$'),
  dob_ciphertext  bytea,
  birth_year      smallint CHECK (birth_year IS NULL OR birth_year BETWEEN 1900 AND 2100),
  lock_version    integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  PRIMARY KEY (tenant_id, customer_id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer (tenant_id, id),
  -- PAN parts are stored together or not at all; the same for the date of birth.
  CONSTRAINT customer_identity_pan_complete CHECK (
    (pan_ciphertext IS NULL AND pan_hash IS NULL AND pan_masked IS NULL)
    OR (pan_ciphertext IS NOT NULL AND pan_hash IS NOT NULL AND pan_masked IS NOT NULL)),
  CONSTRAINT customer_identity_dob_complete CHECK ((dob_ciphertext IS NULL) = (birth_year IS NULL))
);

CREATE INDEX IF NOT EXISTS customer_identity_pan_hash_idx
  ON customer_identity (tenant_id, pan_hash) WHERE pan_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_address (                      -- ENT-025 addresses (P1-02)
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenant(id),
  customer_id       text NOT NULL,
  address_type      text NOT NULL CHECK (address_type IN ('CURRENT','PERMANENT','OFFICE')),
  line1             text NOT NULL CHECK (char_length(line1) BETWEEN 3 AND 200),
  line2             text CHECK (line2 IS NULL OR char_length(line2) <= 200),
  landmark          text CHECK (landmark IS NULL OR char_length(landmark) <= 120),
  city              text NOT NULL CHECK (char_length(city) BETWEEN 2 AND 80),
  state             text NOT NULL CHECK (char_length(state) BETWEEN 2 AND 80),
  pincode           text NOT NULL CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  ownership         text CHECK (ownership IS NULL OR ownership IN ('OWNED','RENTED','FAMILY_OWNED','COMPANY_PROVIDED','OTHER')),
  years_at_address  smallint CHECK (years_at_address IS NULL OR years_at_address BETWEEN 0 AND 100),
  removed_at        timestamptz,
  lock_version      integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer (tenant_id, id)
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_address_one_live_per_type
  ON customer_address (tenant_id, customer_id, address_type) WHERE removed_at IS NULL;

CALL enable_tenant_rls('customer_profile');
CALL enable_tenant_rls('customer_identity');
CALL enable_tenant_rls('customer_address');
GRANT SELECT, INSERT, UPDATE ON customer_profile, customer_identity, customer_address TO dsa_app;

-- Loan operations may reveal a masked PAN or date of birth (reason and step-up still required by the API).
INSERT INTO role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, 'customer.reveal_sensitive'
  FROM role r
  JOIN tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
 WHERE r.code = 'ROLE-LOAN-OPS'
ON CONFLICT DO NOTHING;
