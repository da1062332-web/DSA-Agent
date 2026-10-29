# Connector: hosted deployment and containment checklist

**Nothing here has been run.** Each step needs explicit written approval before it starts. Stop at any failed check.

## 1. Account containment (partner login) — approvals C1, C2, C5 (C3 and C4 as decided)

Follow `docs/CONNECTOR_CONTAINMENT_RUNBOOK.md`.
- [ ] Preconditions (read-only): `tools/sql/remediation/connector-containment.post-check.sql` shows one open RM assignment on `usr_01M613P3AKR8Z5Q81E2F79GY60`.
- [ ] C5: evidence export (read-only), `tools/sql/remediation/connector-containment.evidence.sql`, saved outside the repository with its SHA-256.
- [ ] C2: suspend the login, or not.
- [ ] C1: end the RM assignment through `DELETE /v1/users/usr_01M613P3AKR8Z5Q81E2F79GY60/roles/role_01M5XZ57GD0HNT3C9DHESY5G5K`, called by the named operator.
- [ ] Post-check: open connector-login role assignments = 0; `role.assignment_ended` recorded = 1; the history row is kept.

## 2. Application deployment — approval required

- [ ] Deploy the API and web build containing the connector changes (commits `7b1e3ce` onward). The new routes need no new table, permission or grant.
- [ ] Smoke test: a staff manager lists connectors; a connector login gets 403 on `/v1/connectors` and 200 on `/portal/v1/referrals`.

## 3. Migration 0097 — approval required, only after step 1

- [ ] Read-only before: `tools/sql/batch/97.verify.sql` shows FAIL only for the missing guards, with 0 open connector-login assignments.
- [ ] Generate the wrapper: `node tools/sql/make-apply-run.mjs supabase/migrations/20261001000097_connector_role_guard.sql ~/dsa-backups/97/`.
- [ ] Apply (writes to hosted): `npx supabase db query --linked -f ~/dsa-backups/97/apply-run.sql`. The precheck refuses if an open connector-login role remains.

## 4. Post-migration verification — read-only

- [ ] `tools/sql/batch/97.verify.sql`: no FAIL row. The INFO row reports legacy reserved roles (0 expected).
- [ ] `tools/sql/remediation/connector-containment.post-check.sql`: `guard_trigger_installed` = true.
- [ ] Rollback, only if verify fails and the owner approves: `tools/sql/batch/97.rollback.sql`. It drops the guards and changes no data.
