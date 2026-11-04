# Connector invitation lifecycle fix

**Date:** 2026-11-03
**Scope:** Why an invited connector login could not use the connector portal, what each lifecycle step does, and what changed.
**Status:** Code and tests done. Committed to `beta` and pushed after owner review of the diff. Not deployed. No hosted database was read or changed.

## Verdict

**CONNECTOR ACTIVATION BLOCKED BY COMPLIANCE APPROVAL.**

The invitation flow works as designed. An invited login becomes ACTIVE on its first sign-in with the password it set. The portal stays closed for that login while its connector is not ACTIVE. Only a compliance-approved activation opens it, and this work does not change that rule. The portal now says which state applies, instead of a generic 403.

## What the user saw

On `/connector-portal`, an invited connector login received three 403 responses, all with the text "The portal is for active connector users." Nothing on the page said why, or what to do next.

## Root cause

The lifecycle, traced from invitation to the first portal request:

1. **Invitation created** (`apps/api/src/modules/origination/connectors/connector-service.ts`, `inviteConnectorUser`). The login is created as `user_type CONNECTOR`, `status INVITED`, with no role and a placeholder subject. A `staff_invitation` is queued. It cannot activate anyone until the provisioning worker marks it SENT.
2. **Worker delivers** (`apps/api/src/provisioning/invitation-delivery.ts`). The worker binds the real sign-in subject and marks the invitation SENT. The login stays INVITED.
3. **First password sign-in** (`packages/kernel/src/auth/resolve-principal.ts`). The login becomes ACTIVE and the invitation becomes ACCEPTED, in one transaction.
4. **First portal request** (`apps/api/src/modules/finance/connector-portal.ts`). The portal requires the login to be ACTIVE and its connector to be ACTIVE.

Step 4 is the designed block. A connector becomes ACTIVE only after verification (migration 0101 requires a VERIFIED record for that connector) and the consent decision, which is fail-closed and still pending (see `docs/CONNECTOR_VERIFICATION_DECISION.md`). The 403s are consistent with an invited account that passed step 3 and whose connector has not passed step 4. The account itself was not queried in this session (see the diagnostic below).

The fault was in what the user was told:

- One message covered every refusal. A pending connector, a suspended login, a suspended connector and an unlinked login looked the same.
- The page requested its three data sets before it knew whether the login was allowed, so one cause produced three console refusals.
- A sign-in that had not completed the invitation (no password yet) got the generic "Missing or invalid access token." instead of the invitation message.
- A suspended partner login got the same generic 401 as an unknown token.

No defect was found in the invitation lifecycle itself. The lifecycle tests below now pin its behaviour.

## Lifecycle, before and after

| Stage | Before | After | Test |
|---|---|---|---|
| Invitation created | INVITED login, no role, QUEUED invitation | Unchanged | TEST-CPU-01 |
| Worker delivers | Binds subject, invitation SENT, login stays INVITED | Unchanged | TEST-CPU-04 |
| First sign-in with the password | ACTIVE, invitation ACCEPTED | Unchanged | Lifecycle 1 |
| Later sign-in | Ordinary sign-in, invitation not accepted again | Unchanged | Lifecycle 1 |
| Sign-in without the password (state A) | 401 "Missing or invalid access token." | 401 "Your connector portal invitation is pending. Please complete the invitation process using the link sent to your registered email." | Lifecycle 2 |
| Invitation expired | 401 expiry message, invitation recorded EXPIRED | Unchanged | Lifecycle 3, TEST-CPU-10 |
| Login ACTIVE, connector not ACTIVE (state B) | 403 "The portal is for active connector users." on every request | Eligibility reports CONNECTOR_PENDING with its own text. Data is not requested. Notice shown as information | Portal 2 |
| Login suspended (state C) | 401 generic | 403 "Your portal access has been suspended. Please contact your DSA administrator." | Lifecycle 4 |
| Connector suspended or terminated (state C) | 403 generic | 403 suspension text, no connector data | Portal 3 |
| Login not linked to a connector (state E) | 403 generic | 403 "This portal login is not linked to an active connector. Please contact your DSA administrator." | Portal 5 |
| Login ACTIVE, connector ACTIVE (state D) | Data routes open | Unchanged. Eligibility reports ELIGIBLE | Portal 1 |
| Partner tries to activate its own connector | 403 CONNECTOR_IDENTITY_NOT_ALLOWED | Unchanged. Connector status unchanged | Portal 7 |

Lifecycle and portal tests are in `apps/api/test/connector-invitation-lifecycle.int.spec.ts`.

## What changed

### API

- **`packages/kernel/src/auth/resolve-principal.ts`.** A suspended partner login is refused with a 403 and the suspension text. The token has already proven who the caller is, and the text names no connector. An invitee who signs in without the password is refused with the invitation text for their account type. The expiry path is unchanged.
- **`apps/api/src/modules/partner-view/portal-standing.ts`** (new). Reads where a portal login stands, from its login and connector, in the caller's tenant only. The portal routes and the partner document routes both use it, so both refuse with the same state.
- **`apps/api/src/modules/finance/connector-portal.ts`.** Uses the shared check. Adds `GET /portal/v1/eligibility`.
- **`apps/api/src/modules/origination/applications/documents.ts`.** The partner document routes use the shared check. They previously returned the generic text.

`GET /portal/v1/eligibility` returns the state and its text:

```json
{ "state": "CONNECTOR_PENDING", "message": "Your portal account is active, but your connector onboarding is awaiting verification and activation." }
```

| State | Meaning | `message` |
|---|---|---|
| ELIGIBLE | Login ACTIVE, connector ACTIVE | `null` |
| CONNECTOR_PENDING | Login ACTIVE, connector DRAFT or PENDING_VERIFICATION | Onboarding awaiting verification and activation |
| ACCESS_SUSPENDED | Login SUSPENDED, or connector SUSPENDED or TERMINATED | Access suspended, contact the DSA administrator |
| NOT_LINKED | Not a partner login, login not ACTIVE, or no connector link | Not linked to an active connector |

The response names no connector, customer, mobile or ID. A refused data request carries a reason code in its error `details` (for example `CONNECTOR_PENDING_VERIFICATION`). It is an enum-like code from the database, never a name or contact detail. The eligibility response carries the state and the message only, so the reason code is not returned there.

### Web

- **`apps/web/src/features/connectors/portal-eligibility.ts`** (new). Maps the state to the notice and to whether the portal is open. `portalTableText` gives an empty table its reason: still checking, closed for this login, loading, or simply empty.
- **`apps/web/src/features/connectors/ConnectorPortalPage.tsx`.** Reads the state first. Referrals, statements and disputes are requested only when the state is ELIGIBLE. Request Payout and Submit Referral are disabled unless it is. A notice banner shows the state's text (information for a pending connector, warning otherwise).

### Database

None. No migration was added or changed, and nothing on the hosted database was touched.

## Security checks

- A partner login cannot activate its own connector. The internal activation route answers 403 `CONNECTOR_IDENTITY_NOT_ALLOWED`, and the connector stays PENDING_VERIFICATION (Portal 7).
- Nothing sets a connector ACTIVE, creates a VERIFIED record, or changes consent.
- The state is read from the database in the caller's tenant. The client's view is never trusted.
- The suspended-login refusal names no connector (Portal 3 checks the response body).
- Every refusal text is a fixed server string. No customer or connector data appears in any refusal.
- The eligibility route accepts any authenticated principal. A staff login gets NOT_LINKED and learns nothing else.

## Test results

| Check | Result |
|---|---|
| API typecheck | Pass |
| Kernel typecheck | Pass |
| Web typecheck | Pass |
| API production build | Pass |
| Web production build | Pass |
| ESLint, changed files | Pass |
| Prettier, changed files | Pass |
| Kernel unit tests | 31 of 31 pass |
| API unit tests | 1410 pass. TEST-GRV-005 timed out once while the connector suite ran alongside it, and passes alone (11 of 11) |
| Web unit tests, full suite | 747 of 747 pass (110 files) |
| Web unit tests, connector and partner-login specs | 57 of 57 pass |
| Connector integration tests, guarded config | 10 files, 104 of 104 pass, including the lifecycle file (12) |
| Tenant isolation sweep, `npm run test:isolation`, first run | 13 of 18 files pass, 548 tests pass. Five files failed: four at container setup (Docker HTTP 500) and `cases/ledger.spec.ts` with one test timed out at 120 s. The sweep ran for 22 minutes while other test runs shared the machine |
| Isolation files that failed, rerun alone | 5 of 5 files pass, 41 of 41 tests, including the ledger test that timed out. The Docker error did not recur |

Not run: browser verification of the portal page. No browser tool was available in this session.

## The invited account: diagnostic to run

This session did not query the hosted database. To confirm the state of the invited account, run these two read-only selects against the hosted database, for example in the Supabase SQL editor. Replace the placeholder with the login's e-mail address.

```sql
-- Login and connector state
select u.email, u.user_type, u.status as user_status, c.legal_name, c.status as connector_status
  from app.app_user u
  left join app.connector c on c.id = u.connector_id
 where u.email = '<login email>';

-- Latest invitation
select i.status, i.delivery_state, i.expires_at, i.accepted_at
  from app.staff_invitation i
  join app.app_user u on u.id = i.user_id
 where u.email = '<login email>'
 order by i.requested_at desc
 limit 1;
```

How to read the result:

- `user_status` ACTIVE and `connector_status` DRAFT or PENDING_VERIFICATION: state B. The portal stays closed until the connector is activated through compliance approval.
- `user_status` INVITED: the first password sign-in has not happened. Check the invitation status and expiry.
- `connector_status` SUSPENDED or TERMINATED: state C.
- `connector_status` null: state E, not linked.

Without SQL: sign in with the login and open the portal. The notice now states the state. `GET /portal/v1/eligibility` with the login's token returns the same state.

## End-to-end sequence

The owner asked for this sequence to be verified: invitation, password setup, active portal user, connector verification, approved activation, portal dashboard. The product cannot complete it yet. Activation was not forced, no verification row was inserted, and no consent rule was relaxed.

| Step | Result | Evidence |
|---|---|---|
| 1. Invitation | Verified through the product's routes and the provisioning worker | TEST-CPU-01, TEST-CPU-04 |
| 2. Password setup | Verified at the API boundary: the first password sign-in activates the login and accepts the invitation. The Supabase password screen is outside the API and was not exercised | Lifecycle 1, TEST-CPU-05 |
| 3. Active portal user | Verified: the login is ACTIVE, the portal state is CONNECTOR_PENDING, and the data routes stay closed | Portal 2 |
| 4. Connector verification | **Blocked.** No connector verification can be recorded: the consent table and the verification API both reject a connector subject, and every verification needs active consent. The activation route refuses a connector that is not ACTIVE, and the status route now refuses ACTIVE too, uncommitted (AUD-P0-01 in `docs/CONNECTOR_COMPREHENSIVE_AUDIT.md`) | `connector-verification.int.spec.ts`, `docs/CONNECTOR_VERIFICATION_DECISION.md` |
| 5. Approved activation | **Not reached.** It needs step 4. Not performed | None |
| 6. Portal dashboard | Verified only for a connector that is ACTIVE by fixture in the test database. This is not an approved activation, so it does not verify step 5 | Portal 1 |

## Remaining blockers

- **Connector verification** cannot be recorded yet, so no connector can be activated through the approved path. Compliance must choose an option in `docs/CONNECTOR_VERIFICATION_DECISION.md`: A (connector consent, recommended), B (verification without consent, needs a legal opinion), or C (manual approval with a reason and a second approver, weaker evidence). Option D, keeping the old rule, is refused. Until one is chosen and built, the invited account's portal stays closed after step 3, by design.
- **Consent decision** is still pending. Option A is recommended and the consent feature stays off (`docs/CONNECTOR_VERIFICATION_DECISION.md`).
- **Deployment.** The API (Render) and the web app (Vercel) must be redeployed before the eligibility route and the new page exist in production. The Vercel deployment was already behind, so check it after the push.
- **Git.** These changes are uncommitted. Commit and push need explicit approval.
