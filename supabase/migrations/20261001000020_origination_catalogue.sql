-- Gate 0 baseline (PRE-008): DDL below is copied verbatim from the Database Migration Plan §7.
-- Owner (v1.2 Assignment Matrix §3): Dev 3. The owner hardens this file until it merges;
-- after that it is never edited — corrections are new files in the owner's number range (MANIFEST.md).
-- Migration Plan §0: every migration file starts with this search_path.
SET search_path = app, extensions, public;

-- 0020_origination_catalogue.sql  (owner: Dev 3, TASK-301)
CREATE TABLE lender (                                            -- ENT-040
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenant(id),
  name           text NOT NULL,
  lender_type    text NOT NULL CHECK (lender_type IN ('BANK','NBFC','HFC','SFB','OTHER')),
  regulator_ref  text,
  status         text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','TERMINATED')),
  status_reason  text,
  lock_version   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

CREATE TABLE empanelment (                                       -- ENT-041
  id                    text PRIMARY KEY,
  tenant_id             text NOT NULL REFERENCES tenant(id),
  organisation_id       text NOT NULL,
  lender_id             text NOT NULL,
  dsa_code              text NOT NULL,
  valid_range           daterange NOT NULL,
  permitted_categories  text[] NOT NULL CHECK (cardinality(permitted_categories) > 0),
  status                text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','EXPIRED')),
  lock_version          integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, lender_id, dsa_code),
  FOREIGN KEY (tenant_id, organisation_id) REFERENCES organisation (tenant_id, id),
  FOREIGN KEY (tenant_id, lender_id) REFERENCES lender (tenant_id, id)
);

CREATE TABLE loan_product (                                      -- ENT-043
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  lender_id        text NOT NULL,
  name             text NOT NULL,
  category         text NOT NULL CHECK (category IN ('PL','BL','MSME','LAP','HL','VL','GL','EL','OTHER')),
  applicant_types  text[] NOT NULL CHECK (cardinality(applicant_types) > 0),
  secured          boolean NOT NULL,
  owner_user_id    text,
  next_review_at   date,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  lock_version     integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, lender_id, name),
  FOREIGN KEY (tenant_id, lender_id) REFERENCES lender (tenant_id, id),
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES app_user (tenant_id, id)
);

CREATE TABLE loan_product_version (                              -- ENT-044 (terms immutable: FR-PRD-003)
  id                      text PRIMARY KEY,
  tenant_id               text NOT NULL REFERENCES tenant(id),
  product_id              text NOT NULL,
  version_no              integer NOT NULL CHECK (version_no >= 1),
  effective_from          timestamptz NOT NULL,
  amount_min              numeric(18,2) NOT NULL CHECK (amount_min > 0),
  amount_max              numeric(18,2) NOT NULL,
  currency                char(3) NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  tenure_min_months       integer NOT NULL CHECK (tenure_min_months >= 1),
  tenure_max_months       integer NOT NULL,
  illustrative_rate_text  text,                                  -- always labelled "Illustrative — not an offer"
  status                  text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RETIRED')),
  created_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (product_id, version_no),
  CHECK (amount_max >= amount_min),
  CHECK (tenure_max_months >= tenure_min_months),
  FOREIGN KEY (tenant_id, product_id) REFERENCES loan_product (tenant_id, id)
);
CREATE FUNCTION product_version_terms_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'status') THEN
    RAISE EXCEPTION 'loan_product_version % terms are immutable; create a new version', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER loan_product_version_guard BEFORE UPDATE ON loan_product_version FOR EACH ROW EXECUTE FUNCTION product_version_terms_immutable();
CREATE TRIGGER lender_touch       BEFORE UPDATE ON lender       FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER empanelment_touch  BEFORE UPDATE ON empanelment  FOR EACH ROW EXECUTE FUNCTION touch_row();
CREATE TRIGGER loan_product_touch BEFORE UPDATE ON loan_product FOR EACH ROW EXECUTE FUNCTION touch_row();

CALL enable_tenant_rls('lender');        CALL enable_tenant_rls('empanelment');
CALL enable_tenant_rls('loan_product');  CALL enable_tenant_rls('loan_product_version');
GRANT SELECT, INSERT, UPDATE ON lender, empanelment, loan_product, loan_product_version TO dsa_app;
