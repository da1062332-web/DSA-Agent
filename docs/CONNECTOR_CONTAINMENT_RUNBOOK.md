# Connector partner login: containment runbook

**Status: prepared, not executed.** Nothing in this file has been run: no evidence has been exported, no role has been removed, no account has been suspended, and nothing has been written to the hosted database. Each step that changes state needs the approval named in its checkpoint. Read-only checks may be run at any time. The commands in section 5 are prepared with placeholders.

Written for: the tenant owner (who approves) and the staff operator (who runs the audited API calls).

## 1. What is known, and what is not

Verified by read-only queries on the hosted project on 2026-10-29 (metadata only; no free text, IP addresses or user-agent strings were read into this document).

| Fact | Evidence |
|---|---|
| Partner login `usr_01M613P3AKR8Z5Q81E2F79GY60` is a `CONNECTOR` user, `ACTIVE`, linked to connector `con_001` (`ACTIVE`), tenant `adity-finserv`. | `app.app_user`, `app.connector` |
| It holds one open role assignment `ura_01M613R78QEHGBZZKF8RZPYAV3`: role `ROLE-RM`, scope `TENANT`, open-ended, created by `SYSTEM`. The role gives it the internal permissions of a relationship manager. | `app.user_role_assignment`, `app.role_permission` |
| Its audit trail records lead creation and a task (2026-10-28 11:36), a lead state change (11:40), a lead conversion and an application (11:54), and an eligibility assessment on a loan application (2026-10-29 05:54). The task is open and has no owner. | `app.audit_event`, `app.task` |
| The login has three sign-in sessions; the first is 2026-10-28 11:19 UTC, about 33 seconds after the role was granted. Last sign-in: 2026-10-29 05:54 UTC. | `auth.sessions`, `auth.users` |

**Not established, and this runbook does not establish it:**

- Who used the credentials. The requests come from a non-loopback address with a Windows Chrome client; that does not identify a person.
- Whether the business actions were authorized. The role allowed them, so the audit cannot say whether they should have been allowed.
- Whether any record was read. Reads are not audited (decision L), so the absence of a read event proves nothing.
- Whether the account was created by the tenant or by someone else. The grant is `SYSTEM`, so the operator records that have to answer this are outside the database.
- Whether the staff account `Farhan Finance` (owner of `con_001`) and `Farhan Finance (Partner)` are one person. They are not assumed to be.

## 2. What the two actions do, separately

### 2a. End the RM role assignment (required by the incident fix)

- **How:** `DELETE /v1/users/usr_01M613P3AKR8Z5Q81E2F79GY60/roles/role_01M5XZ57GD0HNT3C9DHESY5G5K`, called by a staff operator with `role.manage` or `user.manage`. The route refuses a call by the target on themselves.
- **Effect:** the assignment's range is closed at now. The row stays as history. The route writes `role.assignment_ended` to the audit trail with the acting user, the assignment id and the user and role ids. Grants are read per request, so the RM permissions stop applying to the next request.
- **Does not:** delete the assignment, the connector, the login, the task, the lead, the application, the eligibility record or any audit row. It does not change the connector link or the login status.
- **Cannot be undone by reopening:** migration 0057 allows an ended assignment to be closed but never reopened. Giving the login a role again is refused by the database (migration 0097, once applied). This is intended.
- **Portal effect:** none directly. The portal decides access from the login's identity and its linked connector, not from a role. The login keeps portal access while it stays `ACTIVE`. That is the intended model; whether the partner should keep portal access is decision C3.

### 2b. Suspend the login (optional, decision C2)

- **How:** `POST /v1/users/usr_01M613P3AKR8Z5Q81E2F79GY60/suspension` with body `{ "action": "SUSPEND", "reason": "<short reason>" }` and an `If-Match` header holding the user's current version (read it from `GET /v1/users/usr_01M613P3AKR8Z5Q81E2F79GY60`).
- **Effect:** the status becomes `SUSPENDED`. The principal resolver checks the status on every request, so the next call from this login is refused on `/v1`, `/platform/v1` and `/portal/v1`. The route writes `user.suspended` to the audit trail.
- **Does not revoke Supabase sessions.** The API does not end the sign-in sessions held by the identity provider. A suspended login's sessions still exist but cannot pass the API. Revoking them is a separate action in the Supabase dashboard and is not part of this runbook.
- **Reversible:** `{ "action": "REACTIVATE", ... }` restores `ACTIVE`, if the user is still `SUSPENDED` and the tenant allows it.
- **Business effect:** the partner loses portal access while suspended. This is the cost of the option.

Suspension and role removal address different risks. Role removal stops the internal access. Suspension stops every access. The incident fix needs the first; the second is a judgement about the investigation and the partner relationship.

## 3. Preconditions (read-only; all must hold before any step in section 5)

Run these first, and stop if any value differs. The post-action file `tools/sql/remediation/connector-containment.post-check.sql` gives the same values after the action.

| Check | Expected |
|---|---|
| Login `usr_01M613P3AKR8Z5Q81E2F79GY60` exists, `user_type` = `CONNECTOR`, `status` = `ACTIVE`, `connector_id` = `con_001` | yes |
| Connector `con_001` exists, `status` = `ACTIVE`, tenant `adity-finserv` | yes |
| Assignment `ura_01M613R78QEHGBZZKF8RZPYAV3` exists, role `ROLE-RM`, scope `TENANT`, open-ended (`upper_inf` = true) | yes |
| Open role assignments held by the login (all of them) | 1 |
| Open role assignments on all connector logins | 1 |
| Open reserved (`ROLE-CONNECTOR%`) assignments on staff accounts | 0 |
| `role.assignment_ended` audit rows for this assignment before the action | 0 |
| Role rows held by the login (history) | 1 |
| Migration 0097 installed on hosted | no (until the approved apply) |

If the open-assignment count is more than one, or any other value differs, stop and report it. Do not act on a different assignment without a new approval.

## 4. Preserve the evidence before any state change

Checkpoint **C5** approves this step.

1. Export, read-only, the audit rows whose actor or entity is the login, its assignment or its connector, with the action, entity type and id, the time, and the client family (Windows, Chrome, loopback yes or no). Do not export titles, completion notes, IP addresses or user-agent strings. The prepared query is `tools/sql/remediation/connector-containment.evidence.sql`. It is read-only and returns metadata only; run it after C5 and save the output outside the repository.
2. Export the sign-in history from the identity provider: session creation times and the last sign-in time. Do not export tokens.
3. Keep both exports in a location the owner controls, record the SHA-256 of each file, and note who made them and when.
4. Record the baseline counts in section 3, so the post-action check can show that nothing else changed.

## 5. Steps, in order (each needs its checkpoint)

**Step 1. Preconditions.** Run section 3. Checkpoint: none (read-only).

**Step 2. Evidence.** Section 4. Checkpoint **C5**.

**Step 3. Suspension (only if decided).** Section 2b. Checkpoint **C2** (yes or no, and the reason text, which goes into the audit trail).

**Step 4. End the RM assignment.** Section 2a, through the API. The call is made by the named operator, so the audit records that person. Expected response: `{ "status": "ok" }`. Checkpoint **C1**, which names the operator.

**Step 5. Post-action check.** Run `tools/sql/remediation/connector-containment.post-check.sql`. Expected: the assignment shows `ended` = true and `upper_inf` = false; open roles on the login = 0; history rows = 1; open connector-login assignments = 0; open reserved assignments = 0; the `role.assignment_ended` event recorded = 1.

**Step 6. Effective permissions.** As the owner, check `GET /v1/users/usr_01M613P3AKR8Z5Q81E2F79GY60/permissions` returns no permission. Check `GET /v1/users/usr_01M613P3AKR8Z5Q81E2F79GY60/roles` returns no active role.

**Step 7. Portal check (only if C3 keeps portal access).** Ask the partner, through the owner, to sign in and open the portal; they should see their own referrals and statements only. Do not sign in as the partner, and do not use the partner's credentials from this environment.

**Step 8. Record.** Note the completion, the operator, the checkpoint approvals and the hash of the evidence files in `docs/PENDING_APPROVALS.md`.

### Exact commands (prepared, not run)

Stop at each approval gate above. Set the variables in the operator's own shell. Never paste a token into a file, a ticket or this document.

```
export API="<API base URL>"
export OPERATOR_TOKEN="<bearer token of the named operator, from their own session>"
```

Read the current version of the login (read-only; the ETag response header is the version for step 3):

```
curl -sS -D - -o /dev/null -H "Authorization: Bearer $OPERATOR_TOKEN" "$API/v1/users/usr_01M613P3AKR8Z5Q81E2F79GY60"
```

Steps 1 and 5, read-only, before and after the action (the same file; before the action the assignment shows `ended` = false and one open role):

```
npx supabase db query --linked -f tools/sql/remediation/connector-containment.post-check.sql
```

Step 2, read-only export (after C5), saved outside the repository:

```
npx supabase db query --linked -f tools/sql/remediation/connector-containment.evidence.sql > "<evidence directory>/evidence.json"
```

Step 3, only if C2 decides to suspend:

```
curl -sS -X POST "$API/v1/users/usr_01M613P3AKR8Z5Q81E2F79GY60/suspension" -H "Authorization: Bearer $OPERATOR_TOKEN" -H 'If-Match: "<version from the read above>"' -H "Content-Type: application/json" -d '{"action":"SUSPEND","reason":"<reason approved under C2>"}'
```

Step 4, after C1, ends the RM assignment through the audited route:

```
curl -sS -X DELETE "$API/v1/users/usr_01M613P3AKR8Z5Q81E2F79GY60/roles/role_01M5XZ57GD0HNT3C9DHESY5G5K" -H "Authorization: Bearer $OPERATOR_TOKEN"
```

## 6. Checkpoints

| # | Decision | Owner of the decision |
|---|---|---|
| C1 | Approve ending the RM assignment through the API, and name the operator who will make the call. | Tenant owner |
| C2 | Suspend the login now (yes or no); if yes, the reason text for the audit trail. | Tenant owner |
| C3 | Keep the partner's portal access (`ACTIVE`) after the RM role is removed, or suspend it (see C2). | Tenant owner with the partnerships lead |
| C4 | Confirm the identity question (`Farhan Finance` and `Farhan Finance (Partner)`), and who is accountable for the partner's activity. | Tenant owner, with HR records |
| C5 | Approve the evidence export in section 4. | Tenant owner |

No step runs until the checkpoint it names is approved in writing.

## 7. Rollback

- Ending the RM assignment cannot be reversed by reopening it (migration 0057). A new assignment for this login would be refused by the database. Restoring internal access for this partner is therefore a business decision that needs a different approach, not a rollback.
- Suspension can be reversed with `REACTIVATE`.
- No SQL rollback exists or is needed; this runbook contains no SQL that writes.

## 8. Out of scope

- Deleting or editing any record, the connector, the login, the task, the lead, the application or the eligibility assessment.
- Reassigning `con_001` to another relationship manager. That is a separate, reasoned change (`ownerChangeReason`, `connector.owner_changed`) with its own approval.
- Revoking sessions, resetting credentials, or contacting the partner about the activity. These are for the owner to decide.
- Investigating the people behind the activity. This runbook records what the data shows and what it does not.
