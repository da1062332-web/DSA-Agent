-- 20261001000029_reporting.sql (owner: Dev 5, TASK-414, MOD-RPT Reporting & Performance Engine, ENT-094)
-- Canonical reporting projections and metric definitions for DOM-L and DOM-I.
SET search_path = app, extensions, public;

-- ENT-094: metric_definition
CREATE TABLE metric_definition (
  tenant_id        text NOT NULL REFERENCES tenant(id),
  code             text NOT NULL CHECK (code ~ '^[A-Z0-9_]{3,50}$'),
  name             text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  description      text NOT NULL,
  category         text NOT NULL CHECK (category IN ('ACTIVITY','OUTCOME','EFFICIENCY')),
  unit             text NOT NULL CHECK (unit IN ('COUNT','INR','PERCENTAGE')),
  aggregation_type text NOT NULL CHECK (aggregation_type IN ('SUM','COUNT','AVG','RATIO')),
  source_domain    text NOT NULL CHECK (source_domain IN ('CRM','ORIGINATION','PLATFORM')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, code)
);

CREATE INDEX metric_definition_tenant_cat_idx ON metric_definition (tenant_id, category);

-- Reporting projection: daily operational summary for fast dashboard aggregations
CREATE TABLE rpt_daily_operational_summary (
  tenant_id             text NOT NULL REFERENCES tenant(id),
  summary_date          date NOT NULL,
  branch_id             text NOT NULL,
  user_id               text NOT NULL,
  lead_created_count    integer NOT NULL DEFAULT 0 CHECK (lead_created_count >= 0),
  lead_qualified_count  integer NOT NULL DEFAULT 0 CHECK (lead_qualified_count >= 0),
  lead_converted_count  integer NOT NULL DEFAULT 0 CHECK (lead_converted_count >= 0),
  activity_count        integer NOT NULL DEFAULT 0 CHECK (activity_count >= 0),
  sanction_count        integer NOT NULL DEFAULT 0 CHECK (sanction_count >= 0),
  sanction_amount       numeric(18,2) NOT NULL DEFAULT 0 CHECK (sanction_amount >= 0),
  disbursement_count    integer NOT NULL DEFAULT 0 CHECK (disbursement_count >= 0),
  disbursement_amount   numeric(18,2) NOT NULL DEFAULT 0 CHECK (disbursement_amount >= 0),
  refreshed_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, summary_date, branch_id, user_id)
);

CREATE INDEX rpt_summary_date_idx ON rpt_daily_operational_summary (tenant_id, summary_date);
CREATE INDEX rpt_summary_branch_idx ON rpt_daily_operational_summary (tenant_id, branch_id, summary_date);
CREATE INDEX rpt_summary_user_idx ON rpt_daily_operational_summary (tenant_id, user_id, summary_date);

-- Security: RLS policies
ALTER TABLE metric_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE metric_definition FORCE ROW LEVEL SECURITY;
CREATE POLICY metric_definition_tenant_isolation ON metric_definition
  FOR ALL TO dsa_app
  USING (tenant_id = app_tenant())
  WITH CHECK (tenant_id = app_tenant());

ALTER TABLE rpt_daily_operational_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE rpt_daily_operational_summary FORCE ROW LEVEL SECURITY;
CREATE POLICY rpt_summary_tenant_isolation ON rpt_daily_operational_summary
  FOR ALL TO dsa_app
  USING (tenant_id = app_tenant())
  WITH CHECK (tenant_id = app_tenant());

-- Grants for dsa_app runtime role
GRANT SELECT, INSERT, UPDATE ON metric_definition TO dsa_app;
GRANT SELECT, INSERT, UPDATE ON rpt_daily_operational_summary TO dsa_app;

-- Seed canonical metric definitions for all active tenants
INSERT INTO metric_definition (tenant_id, code, name, description, category, unit, aggregation_type, source_domain)
SELECT t.id, m.code, m.name, m.description, m.category, m.unit, m.aggregation_type, m.source_domain
FROM tenant t
CROSS JOIN (
  VALUES
    ('LEAD_COUNT', 'Lead Intake Count', 'Total new leads captured within period', 'ACTIVITY', 'COUNT', 'COUNT', 'CRM'),
    ('LEAD_QUALIFIED_COUNT', 'Qualified Leads', 'Total leads reaching QUALIFIED or CONVERTED status', 'ACTIVITY', 'COUNT', 'COUNT', 'CRM'),
    ('LEAD_CONVERTED_COUNT', 'Converted Leads', 'Total leads converted to loan application', 'OUTCOME', 'COUNT', 'COUNT', 'CRM'),
    ('ACTIVITY_COUNT', 'Operational Activities', 'Total calls, meetings, and customer interactions', 'ACTIVITY', 'COUNT', 'COUNT', 'CRM'),
    ('SANCTION_COUNT', 'Sanctions Approved', 'Total active loan sanctions issued', 'OUTCOME', 'COUNT', 'COUNT', 'ORIGINATION'),
    ('SANCTION_AMOUNT', 'Sanctioned Amount', 'Total rupee amount of approved sanctions', 'OUTCOME', 'INR', 'SUM', 'ORIGINATION'),
    ('DISBURSEMENT_COUNT', 'Disbursement Tranches', 'Total loan disbursement tranches released', 'OUTCOME', 'COUNT', 'COUNT', 'ORIGINATION'),
    ('DISBURSEMENT_AMOUNT', 'Disbursement Amount', 'Total rupee amount disbursed to borrowers', 'OUTCOME', 'INR', 'SUM', 'ORIGINATION'),
    ('LEAD_CONVERSION_RATE', 'Lead Conversion Rate', 'Ratio of converted leads to total leads created (%)', 'EFFICIENCY', 'PERCENTAGE', 'RATIO', 'CRM')
) AS m(code, name, description, category, unit, aggregation_type, source_domain)
ON CONFLICT (tenant_id, code) DO NOTHING;
