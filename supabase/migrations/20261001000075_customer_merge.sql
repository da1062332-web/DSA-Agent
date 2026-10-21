-- Migration: 20261001000075_customer_merge.sql
-- Owner: Dev 5 (MOD-CUST SUB-CUST.05, API-CUST-008)
-- A merged customer keeps its row (status MERGED) and points at the survivor through merged_into_id. Links are re-pointed on
-- leads and on applications still in progress ("links re-pointed on leads and applications"). Application parties are
-- append-only (M-021, M-072) and keep the merged id, which resolves to the survivor through merged_into_id.
-- The customers module must not write other modules' tables, so the re-pointing is this one function (SECURITY INVOKER:
-- row-level security keeps it inside the caller's tenant).

SET search_path = app, extensions, public;

ALTER TABLE customer ADD COLUMN IF NOT EXISTS merged_into_id text;
ALTER TABLE customer DROP CONSTRAINT IF EXISTS customer_merged_into_fk;
ALTER TABLE customer ADD CONSTRAINT customer_merged_into_fk FOREIGN KEY (tenant_id, merged_into_id) REFERENCES customer (tenant_id, id);
ALTER TABLE customer DROP CONSTRAINT IF EXISTS customer_merged_into_check;
-- One direction only: customers merged before this migration have no merged_into_id.
ALTER TABLE customer ADD CONSTRAINT customer_merged_into_check
  CHECK (merged_into_id IS NULL OR (status = 'MERGED' AND merged_into_id <> id));

CREATE OR REPLACE FUNCTION merge_customer_links(p_from text, p_into text, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  n_leads integer;
  n_apps integer;
BEGIN
  IF p_from IS NULL OR p_into IS NULL OR p_from = p_into THEN
    RAISE EXCEPTION 'a merge needs two different customers' USING ERRCODE = '22023';
  END IF;
  UPDATE lead SET customer_id = p_into, updated_by = p_actor WHERE customer_id = p_from;
  GET DIAGNOSTICS n_leads = ROW_COUNT;
  UPDATE loan_application SET customer_id = p_into, updated_by = p_actor
   WHERE customer_id = p_from AND status NOT IN ('DISBURSED', 'CLOSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED');
  GET DIAGNOSTICS n_apps = ROW_COUNT;
  RETURN jsonb_build_object('leads', n_leads, 'applications', n_apps);
END $$;

REVOKE ALL ON FUNCTION merge_customer_links(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merge_customer_links(text, text, text) TO dsa_app;

-- API-CUST-007: a new primary contact point takes the flag from the old one. Only that column may change.
GRANT UPDATE (is_primary) ON customer_contact_point TO dsa_app;
