# Hosted status refresh, 2026-10-29 (read-only)

**Scope:** a read-only check of the linked hosted project. Only SELECT statements ran, through the verify files and the post-check file. Nothing was written, applied, granted, revoked, suspended, or removed. No migration was applied.

**How it was run:** `npx supabase db query --linked -f <file>` for each file below. Each file was first searched for write keywords, and none was found. The 0094 match was a description string, not a statement.

## Results

| File | What it checks | Result |
|---|---|---|
| `tools/sql/batch/94.verify.sql` | Migration 0094 (eligibility inputs) | 7 of 7 PASS |
| `tools/sql/batch/95.verify.sql` | Migration 0095 (routine execute hardening) | 3 PASS; INFO: 43 routines executable by `dsa_app` |
| `tools/sql/batch/96.verify.sql` | Migration 0096 (drop test-login lookups) | 2 of 2 PASS |
| `tools/sql/batch/97.verify.sql` | Migration 0097 (connector role guard) | Expected FAIL: the three guard triggers and their functions are absent. One open connector-login role assignment. Informational: 0 reserved roles. |
| `tools/sql/remediation/connector-containment.post-check.sql` | Partner login containment state | Not contained (see below) |

## Partner login state (containment not done)

- Login `usr_01M613P3AKR8Z5Q81E2F79GY60`: `user_type` CONNECTOR, `status` ACTIVE, linked to `con_001`, which is ACTIVE.
- Assignment `ura_01M613R78QEHGBZZKF8RZPYAV3`: ROLE-RM, TENANT scope, still open-ended.
- Open role assignments on connector logins across the platform: 1.
- Open reserved ROLE-CONNECTOR assignments on staff: 0.
- `role.assignment_ended` audit events for the assignment: 0.
- Migration 0097 installed: no.

## What this means

- Hosted matches the 2026-10-29 snapshot. No change has been made since then.
- Migration 0097 is not applied. Its precheck would refuse to run while the open assignment above exists, which is intended.
- The containment has not run. It still needs the approvals in `docs/CONNECTOR_CONTAINMENT_RUNBOOK.md` (C1, C2, C5, and C3 and C4 as applicable).
