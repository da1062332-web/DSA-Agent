-- Migration: 20261001000079_lender_reason_map.sql
-- Owner: Dev 3 (MOD-LCS SUB-LCS.05, API-LND-007)
-- How one lender's own decline wording maps to the normalised decline reason codes (lender_case.decline_reason_code).
-- Each entry is {"lenderReason": text, "reasonCode": code}; replaced as a whole by PUT /v1/lenders/{id}/reason-map (If-Match).

SET search_path = app, extensions, public;

ALTER TABLE lender ADD COLUMN IF NOT EXISTS reason_map jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE lender DROP CONSTRAINT IF EXISTS lender_reason_map_check;
ALTER TABLE lender ADD CONSTRAINT lender_reason_map_check
  CHECK (jsonb_typeof(reason_map) = 'array' AND jsonb_array_length(reason_map) <= 200);
