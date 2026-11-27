-- Rollback migration 0110 (customer profile, encrypted identity and addresses, task P1-02).
-- Refuses while any profile, identity or address row exists: dropping them would destroy customer data, which needs a decision, not a
-- script. Otherwise it removes the Loan operations grant of customer.reveal_sensitive added by 0110 and drops the three empty tables.
-- One transaction; run the verify script afterwards (its structure rows then FAIL, as before the apply).
BEGIN;
SET search_path = app, extensions, public;

DO $$
DECLARE v_rows bigint;
BEGIN
  SELECT (SELECT count(*) FROM customer_profile) + (SELECT count(*) FROM customer_identity) + (SELECT count(*) FROM customer_address)
    INTO v_rows;
  IF v_rows > 0 THEN
    RAISE EXCEPTION 'Rollback 0110 refused: % customer profile, identity or address rows exist', v_rows;
  END IF;
END $$;

DELETE FROM role_permission rp
 USING role r
 WHERE rp.tenant_id = r.tenant_id AND rp.role_id = r.id
   AND r.code = 'ROLE-LOAN-OPS' AND rp.permission_code = 'customer.reveal_sensitive';

DROP TABLE IF EXISTS customer_address;
DROP TABLE IF EXISTS customer_identity;
DROP TABLE IF EXISTS customer_profile;

COMMIT;
