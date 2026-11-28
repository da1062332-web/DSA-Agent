-- Migration 0130 (owner: Prathamesh, task P1-05 of the multi-lender plan): credit-bureau soft pull. Not applied to hosted.
-- Why: a lender will not look at a loan application without a credit score. A customer's bureau summary (score, active accounts, monthly
-- EMIs, days past due, enquiries) can now be pulled with the customer's consent and stored. Only that summary is kept: never the PAN, date of
-- birth or name that were sent to the bureau, and never the raw report.
--
-- What it does:
--   1. credit_report: one immutable row per pull (append-only, like verification). SCORED rows carry the whole summary, NO_HISTORY rows carry
--      none of it (no history is a result, never an error and never score 0). Row-level security; dsa_app can SELECT and INSERT only.
--   2. consent_record gets the purpose BUREAU_PULL. Two CHECKs change: the list of purposes, and the rule that SHARE_WITH_LENDER and
--      VERIFICATION_CHECK need a purpose_target, which now also covers BUREAU_PULL (the target is the bureau, so consent is per bureau).
--      Both are found in the catalogue by their content and rebuilt from the list they hold, never retyped, so a database whose lists differ
--      from a fresh build keeps every value. The constraints keep their names. Existing rows are not read for any purpose but the CHECK.
--   3. Permissions credit_report.pull and credit_report.read, granted to the customer-tenant roles below.
--        pull  ROLE-LOAN-OPS, ROLE-ORG-OWNER
--        read  ROLE-LOAN-OPS, ROLE-ORG-OWNER, ROLE-RM, ROLE-BRANCH-MGR
--
-- Idempotent: a second run changes nothing (the table, indexes and trigger are created only when missing, the policy only when absent, the
-- CHECKs only when they do not yet list BUREAU_PULL, the grants are ON CONFLICT DO NOTHING). It refuses, changing nothing, when it does not
-- find exactly one CHECK of each kind on consent_record or does not understand the list it finds.
-- Apply it BEFORE the application code of P1-05 is deployed: the consent form accepts BUREAU_PULL as soon as the contracts change, and the
-- API reads and writes credit_report.

SET search_path = app, extensions, public;

-- 1. credit_report ---------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS credit_report (
  id                    text PRIMARY KEY,
  tenant_id             text NOT NULL REFERENCES tenant(id),
  customer_id           text NOT NULL,
  consent_record_id     text NOT NULL,
  bureau                text NOT NULL CHECK (bureau IN ('CIBIL','CRIF','EXPERIAN','EQUIFAX')),
  provider              text NOT NULL CHECK (provider ~ '^[A-Z0-9_]{2,40}$'),
  outcome               text NOT NULL CHECK (outcome IN ('SCORED','NO_HISTORY')),
  report_date           date NOT NULL,
  score                 smallint CHECK (score IS NULL OR score BETWEEN 300 AND 900),
  active_accounts       integer CHECK (active_accounts IS NULL OR active_accounts >= 0),
  monthly_emi_amount    numeric(18,2) CHECK (monthly_emi_amount IS NULL OR monthly_emi_amount >= 0),
  monthly_emi_currency  char(3) NOT NULL DEFAULT 'INR' CHECK (monthly_emi_currency = 'INR'),
  max_dpd_12m           integer CHECK (max_dpd_12m IS NULL OR max_dpd_12m >= 0),
  enquiries_6m          integer CHECK (enquiries_6m IS NULL OR enquiries_6m >= 0),
  vendor_ref            text CHECK (vendor_ref IS NULL OR char_length(vendor_ref) BETWEEN 1 AND 64),
  cost_amount           numeric(18,2) CHECK (cost_amount IS NULL OR cost_amount >= 0),
  cost_currency         char(3) CHECK (cost_currency IS NULL OR cost_currency ~ '^[A-Z]{3}$'),
  pulled_by             text NOT NULL,
  pulled_at             timestamptz NOT NULL,
  lock_version          integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customer (tenant_id, id),
  FOREIGN KEY (consent_record_id)      REFERENCES consent_record (id),
  FOREIGN KEY (tenant_id, pulled_by)   REFERENCES app_user (tenant_id, id),
  CHECK ((cost_amount IS NULL) = (cost_currency IS NULL)),
  -- A scored report carries the whole summary; a report of no history carries none of it. A missing figure is never replaced by a default.
  CHECK (
    (outcome = 'SCORED' AND score IS NOT NULL AND active_accounts IS NOT NULL AND monthly_emi_amount IS NOT NULL
       AND max_dpd_12m IS NOT NULL AND enquiries_6m IS NOT NULL)
    OR
    (outcome = 'NO_HISTORY' AND score IS NULL AND active_accounts IS NULL AND monthly_emi_amount IS NULL
       AND max_dpd_12m IS NULL AND enquiries_6m IS NULL)
  )
);

-- The cache lookup and "latest of one bureau" read this; the unfiltered history reads the second one.
CREATE INDEX IF NOT EXISTS credit_report_customer_bureau_idx ON credit_report (tenant_id, customer_id, bureau, pulled_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS credit_report_customer_idx ON credit_report (tenant_id, customer_id, pulled_at DESC, id DESC);

-- A report is history: it is never rewritten or removed.
CREATE OR REPLACE TRIGGER credit_report_no_mutation
  BEFORE UPDATE OR DELETE ON credit_report FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Row-level security (tenant_id = app_tenant()). enable_tenant_rls creates the policy, so skip a table that already has it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'credit_report' AND policyname = 'tenant_isolation') THEN
    EXECUTE format('CALL enable_tenant_rls(%L)', 'app.credit_report');
  END IF;
END $$;

GRANT SELECT, INSERT ON credit_report TO dsa_app;   -- history is never rewritten

-- 2. consent_record accepts BUREAU_PULL ------------------------------------------------------------------------------------------
DO $$
DECLARE
  v_n      integer;
  v_name   text;
  v_def    text;
  v_values text[];
BEGIN
  -- (a) The list of purposes: the CHECK that names CONTACT and MARKETING and says nothing about purpose_target.
  SELECT count(*), min(c.name), min(c.def) INTO v_n, v_name, v_def
    FROM (SELECT k.conname::text AS name, pg_get_constraintdef(k.oid) AS def
            FROM pg_constraint k
           WHERE k.conrelid = 'app.consent_record'::regclass AND k.contype = 'c') c
   WHERE c.def LIKE '%''CONTACT''%' AND c.def LIKE '%''MARKETING''%' AND c.def NOT LIKE '%purpose_target%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'migration 0130 refused: expected exactly one CHECK on app.consent_record.purpose, found %', v_n;
  END IF;
  IF v_def NOT LIKE '%''BUREAU_PULL''%' THEN
    SELECT array_agg(m[1] ORDER BY n) INTO v_values
      FROM regexp_matches(v_def, '''([^'']+)''', 'g') WITH ORDINALITY AS t(m, n);
    IF v_values IS NULL OR NOT (v_values @> ARRAY['CONTACT', 'MARKETING'])
       OR EXISTS (SELECT 1 FROM unnest(v_values) AS v WHERE v !~ '^[A-Z_]+$') THEN
      RAISE EXCEPTION 'migration 0130 refused: the purpose list of constraint % is not the expected list of quoted names', v_name;
    END IF;
    EXECUTE format('ALTER TABLE app.consent_record DROP CONSTRAINT %I', v_name);
    EXECUTE format(
      'ALTER TABLE app.consent_record ADD CONSTRAINT %I CHECK (purpose IN (%s))',
      v_name,
      (SELECT string_agg(quote_literal(u.v), ', ' ORDER BY u.ord) FROM unnest(v_values || 'BUREAU_PULL'::text) WITH ORDINALITY AS u(v, ord))
    );
  END IF;

  -- (b) The purposes that need a purpose_target: the CHECK that says so.
  SELECT count(*), min(c.name), min(c.def) INTO v_n, v_name, v_def
    FROM (SELECT k.conname::text AS name, pg_get_constraintdef(k.oid) AS def
            FROM pg_constraint k
           WHERE k.conrelid = 'app.consent_record'::regclass AND k.contype = 'c') c
   WHERE c.def LIKE '%purpose_target IS NOT NULL%' AND c.def LIKE '%''VERIFICATION_CHECK''%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'migration 0130 refused: expected exactly one CHECK that requires purpose_target, found %', v_n;
  END IF;
  IF v_def NOT LIKE '%''BUREAU_PULL''%' THEN
    SELECT array_agg(m[1] ORDER BY n) INTO v_values
      FROM regexp_matches(v_def, '''([^'']+)''', 'g') WITH ORDINALITY AS t(m, n);
    IF v_values IS NULL OR NOT (v_values @> ARRAY['SHARE_WITH_LENDER', 'VERIFICATION_CHECK'])
       OR EXISTS (SELECT 1 FROM unnest(v_values) AS v WHERE v !~ '^[A-Z_]+$')
       OR v_def NOT LIKE '%<> ALL%' THEN
      RAISE EXCEPTION 'migration 0130 refused: the purpose_target rule of constraint % is not the expected "purpose NOT IN (list) OR purpose_target IS NOT NULL"', v_name;
    END IF;
    EXECUTE format('ALTER TABLE app.consent_record DROP CONSTRAINT %I', v_name);
    EXECUTE format(
      'ALTER TABLE app.consent_record ADD CONSTRAINT %I CHECK (purpose NOT IN (%s) OR purpose_target IS NOT NULL)',
      v_name,
      (SELECT string_agg(quote_literal(u.v), ', ' ORDER BY u.ord) FROM unnest(v_values || 'BUREAU_PULL'::text) WITH ORDINALITY AS u(v, ord))
    );
  END IF;
END
$$;

-- 3. Permissions and role grants -------------------------------------------------------------------------------------------------
INSERT INTO app.permission (code, description, introduced_in) VALUES
  ('credit_report.pull', 'Pull a credit-bureau report for a customer who has given bureau consent', 'M-130'),
  ('credit_report.read', 'View the stored credit-bureau report summaries of a customer', 'M-130')
ON CONFLICT (code) DO NOTHING;

INSERT INTO app.role_permission (tenant_id, role_id, permission_code)
SELECT r.tenant_id, r.id, g.permission_code
  FROM (VALUES
    ('ROLE-LOAN-OPS',   'credit_report.pull'),
    ('ROLE-ORG-OWNER',  'credit_report.pull'),
    ('ROLE-LOAN-OPS',   'credit_report.read'),
    ('ROLE-ORG-OWNER',  'credit_report.read'),
    ('ROLE-RM',         'credit_report.read'),
    ('ROLE-BRANCH-MGR', 'credit_report.read')
  ) AS g(role_code, permission_code)
  JOIN app.role r ON r.code = g.role_code
  JOIN app.tenant t ON t.id = r.tenant_id AND t.tenant_type <> 'PLATFORM'
ON CONFLICT DO NOTHING;
