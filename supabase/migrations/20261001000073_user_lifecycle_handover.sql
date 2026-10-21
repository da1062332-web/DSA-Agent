-- Migration: 20261001000073_user_lifecycle_handover.sql
-- Owner: Dev 1 (MOD-USR SUB-USR.02, API-USR-004)
-- Deactivating a user hands over what they own, atomically: open leads, live applications (sales and ops owner) and open
-- tasks move to the hand-over user (MOD-USR: "Hand-over rewrites owner columns on lead, loan_application and task").
-- The platform module must not write other modules' tables, so the hand-over is this one function, a shared contract like
-- any migration. It runs as the caller (SECURITY INVOKER), so row-level security keeps it inside the caller's tenant.
-- Each moved lead gets a lead_assignment row with reason OWNER_INACTIVE, as the lead history requires.

SET search_path = app, extensions, public;

-- A ULID (26 characters, Crockford base32: 48-bit millisecond time, 80 random bits) for ids minted inside the database.
CREATE OR REPLACE FUNCTION new_ulid() RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  ts bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  rnd bytea := uuid_send(gen_random_uuid());
  out text := '';
BEGIN
  FOR i IN REVERSE 9..0 LOOP
    out := out || substr(alphabet, ((ts >> (5 * i)) & 31)::int + 1, 1);
  END LOOP;
  FOR i IN 0..15 LOOP
    out := out || substr(alphabet, (get_byte(rnd, i) & 31) + 1, 1);
  END LOOP;
  RETURN out;
END $$;

CREATE OR REPLACE FUNCTION handover_owned_records(p_from text, p_to text, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  n_leads integer;
  n_sales integer;
  n_ops integer;
  n_tasks integer;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from = p_to THEN
    RAISE EXCEPTION 'hand-over needs two different users' USING ERRCODE = '22023';
  END IF;

  WITH moved AS (
    UPDATE lead SET owner_user_id = p_to, owner_queue_id = NULL, updated_by = p_actor
     WHERE owner_user_id = p_from
       AND state NOT IN ('CONVERTED', 'DISQUALIFIED', 'MERGED', 'ARCHIVED')
    RETURNING id, tenant_id
  ), logged AS (
    INSERT INTO lead_assignment (id, tenant_id, lead_id, from_user_id, to_user_id, reason_code, actor)
    SELECT 'asg_' || new_ulid(), tenant_id, id, p_from, p_to, 'OWNER_INACTIVE', p_actor FROM moved
    RETURNING 1
  )
  SELECT count(*) INTO n_leads FROM logged;

  UPDATE loan_application SET sales_owner_id = p_to, updated_by = p_actor
   WHERE sales_owner_id = p_from
     AND status NOT IN ('DISBURSED', 'CLOSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED');
  GET DIAGNOSTICS n_sales = ROW_COUNT;

  UPDATE loan_application SET ops_owner_id = p_to, updated_by = p_actor
   WHERE ops_owner_id = p_from
     AND status NOT IN ('DISBURSED', 'CLOSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED');
  GET DIAGNOSTICS n_ops = ROW_COUNT;

  UPDATE task SET owner_user_id = p_to, owner_queue_id = NULL, updated_by = p_actor
   WHERE owner_user_id = p_from AND status IN ('OPEN', 'IN_PROGRESS', 'SNOOZED');
  GET DIAGNOSTICS n_tasks = ROW_COUNT;

  RETURN jsonb_build_object('leads', n_leads, 'applicationsAsSales', n_sales, 'applicationsAsOps', n_ops, 'tasks', n_tasks);
END $$;

REVOKE ALL ON FUNCTION handover_owned_records(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION handover_owned_records(text, text, text) TO dsa_app;
GRANT EXECUTE ON FUNCTION new_ulid() TO dsa_app;
