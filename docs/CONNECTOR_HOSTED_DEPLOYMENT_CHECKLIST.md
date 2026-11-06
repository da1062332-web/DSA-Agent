# Connector: hosted deployment and containment checklist

**Status 2026-10-29 (owner-approved):** steps 1, 3 and 4 are done. Step 2 (application deployment) is not done here.

- **Containment (step 1):** the evidence was exported read-only to `~/dsa-backups/containment-20261029/evidence.json` (SHA-256 `9a3e5c70…beac`). The RM assignment `ura_01M613R78QEHGBZZKF8RZPYAV3` was ended in one checked transaction (`end-rm-assignment.sql` in the same folder): the history row is kept, and `role.assignment_ended` is audited as `SYSTEM:containment` with approval reference `owner-approval-2026-10-29`. By the owner's decision, the login was **not** suspended and keeps portal access. Post-check: 0 open connector-login roles.
- **Migration 0097 (steps 3 and 4):** applied through `~/dsa-backups/97/apply-run.sql`, whose body equals the migration (source hash `927c9b2a…0718`). `97.verify.sql`: 6 PASS, INFO 0 reserved roles.

Each step needs explicit written approval before it starts. Stop at any failed check.

## 0. Containment status, 2026-11-06

Nothing here is marked complete unless its evidence is recorded. Root cause and code changes: `docs/CONNECTOR_CONTAINMENT_ROOT_CAUSE_2026-11-06.md`.

| Item | Status on 2026-11-06 |
|---|---|
| Application: connector logins get no grants and no role codes (`/v1/me`) | Done locally, commit `682d581` on `beta`. Not pushed, not deployed |
| Hosted C1: RM assignment ended through the API, named operator | Recorded as done 2026-10-29 in the header above. Not re-verified. Owner to confirm with the post-check |
| Hosted C2: suspend the login | Recorded as not suspended (header). Owner decision, unchanged |
| Hosted C3: keep portal access | Recorded as kept (header). Owner decision, unchanged |
| Hosted C4: identity question (`Farhan Finance` and `Farhan Finance (Partner)`) | Not recorded in the repository. Open |
| Hosted C5: evidence export with SHA-256 | Recorded as exported (header). Not re-verified |
| Post-check, read-only: open connector-login roles 0; history 1; event 1; guard installed | Not run in this session. Owner to run and record the output |
| Migration 0097 applied to hosted | Conflicting records (header says applied; runbook and remediation record say not). Owner to confirm with `97.verify.sql` |
| Deployment of the application change (step 2) | Open. Smoke test should also check that `GET /v1/me` shows no roles for a connector login |

Section 1 boxes stay unticked until the owner records the post-check output.

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
