-- Migration: 20261001000066_lender_query.sql
-- Owner: Dev 4 (MOD-LCS, SUB-LCS lender queries; TASK-402)
-- ENT-053 lender_query was never created, so POST /v1/lender-cases/{id}/queries failed inside its transaction and
-- POST /v1/lender-queries/{id}/responses could never find a query. Columns follow the DSA module page (MOD-LCS, ENT-053):
-- lender_case_id, text, requested_items jsonb, lender_due_date, task_id, response_manifest_id (a QUERY_RESPONSE
-- submission_package, ENT-054), responded_at. Sensitivity S2; retention R-LOAN.

SET search_path = app, extensions, public;

CREATE TABLE lender_query (                                      -- ENT-053
  id                    text PRIMARY KEY,
  tenant_id             text NOT NULL REFERENCES tenant(id),
  lender_case_id        text NOT NULL,
  text                  text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  requested_items       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(requested_items) = 'array'),
  lender_due_date       date,
  task_id               text,
  response_manifest_id  text,
  responded_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, lender_case_id)       REFERENCES lender_case (tenant_id, id),
  FOREIGN KEY (tenant_id, response_manifest_id) REFERENCES submission_package (tenant_id, id),
  CHECK ((responded_at IS NULL) = (response_manifest_id IS NULL))
);
CREATE INDEX lender_query_case_idx ON lender_query (tenant_id, lender_case_id, created_at);
CREATE INDEX lender_query_open_idx ON lender_query (tenant_id, lender_due_date) WHERE responded_at IS NULL;

-- A query is answered once: after responded_at is set the row never changes again.
CREATE OR REPLACE FUNCTION lender_query_answer_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.responded_at IS NOT NULL THEN
    RAISE EXCEPTION 'lender_query % is already answered', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lender_query_answer_once_guard ON lender_query;
CREATE TRIGGER lender_query_answer_once_guard BEFORE UPDATE ON lender_query FOR EACH ROW EXECUTE FUNCTION lender_query_answer_once();

CALL enable_tenant_rls('lender_query');
GRANT SELECT, INSERT, UPDATE ON lender_query TO dsa_app;
