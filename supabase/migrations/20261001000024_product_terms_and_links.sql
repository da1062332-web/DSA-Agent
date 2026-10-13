-- 0024_product_terms_and_links.sql  (owner: Dev 3, MOD-PRD, DSA Notion MODULE 15, ENT-044)
-- Additive. Adds the product-version fields in the spec that 0020 does not have. Terms stay immutable: the guard in
-- 0020 blocks any change to a version except its status, and the new columns are covered by that guard too.
-- The document profile and workflow profile are stored as data here. Their behaviour belongs to MOD-DOC and MOD-WFA,
-- which are not built yet.
SET search_path = app, extensions, public;

ALTER TABLE loan_product_version ADD COLUMN fee_text             text;
ALTER TABLE loan_product_version ADD COLUMN geo_rules            jsonb NOT NULL DEFAULT '[]'::jsonb
                                                                 CHECK (jsonb_typeof(geo_rules) = 'array');
ALTER TABLE loan_product_version ADD COLUMN document_profile_id  text;
ALTER TABLE loan_product_version ADD COLUMN workflow_profile     jsonb NOT NULL DEFAULT '{}'::jsonb
                                                                 CHECK (jsonb_typeof(workflow_profile) = 'object');
ALTER TABLE loan_product_version ADD COLUMN eligibility_scope    jsonb NOT NULL DEFAULT '{}'::jsonb
                                                                 CHECK (jsonb_typeof(eligibility_scope) = 'object');
