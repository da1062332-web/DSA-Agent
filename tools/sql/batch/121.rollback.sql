-- Roll back migration 0121 (P2-04 lender document packs). Owner: Dipanshu.
-- Run as the migration owner. One transaction: everything goes or nothing does.
-- DATA LOSS: drops every lender pack profile (lenders fall back to the default profile). Before running it on hosted, snapshot it:
--   CREATE TABLE dsa_backup.lender_pack_profile_pre_rb121 AS TABLE app.lender_pack_profile;
-- Audit rows written by the P2-04 API stay (the audit log is append-only). No permission was added, so none is removed.
BEGIN;
SET search_path = app, extensions, public;

DROP TABLE IF EXISTS app.lender_pack_profile;

COMMIT;
