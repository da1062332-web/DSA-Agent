# Connector audit remediation plan

**Date:** 2026-11-03
**Source:** `docs/CONNECTOR_COMPREHENSIVE_AUDIT.md` (finding IDs refer to its section 13).
**Rule for every item:** a fix that changes business behaviour needs approval from the named owner before it is built. The approval column says which items need it. Nothing here has been built yet.

## How to use this checklist

- Work top to bottom. Each step lists what it depends on.
- A finding is closed only when its test is written and passing, and the `it.fails` marker in `apps/api/test/connector-audit-defects.int.spec.ts` has been removed for it.
- Read-only checks on the hosted database are run by the owner of that database, not by this plan. No step changes hosted data without a separate approval.

## Step 1: stop the two P0 routes (today)

- [x] **AUD-P0-01.** *(Done in the working tree, uncommitted; tests in `connector-audit-defects.int.spec.ts` and `connectors.spec.ts`.)* Remove `ACTIVE` from the target statuses accepted by `POST /v1/connectors/:id/status`. The schema is `UpdateConnectorStatusSchema` in `packages/contracts/src/connector.ts` (lines 154–156). Connector activation then goes only through `POST /v1/connectors/:id/activation`.
  - *Approval:* owner of the connector process. This changes which states can be set.
  - *Test:* remove the `it.fails` marker from AUD-P0-01. Add a test that the status route returns a validation error for `ACTIVE`, and that the connector stays `PENDING_VERIFICATION`.
  - *Also:* remove the ACTIVE option from the status dialog in `apps/web/src/features/connectors/ConnectorPage.tsx` (`targetStatus` type and the Select).
  - *Done when:* the test passes, and the dialog offers no ACTIVE target.
- [x] **AUD-P0-02.** *(Done in the working tree, uncommitted; tests in `connector-audit-defects.int.spec.ts` and `automated-payouts-and-reconciliation.spec.ts`.)* Disable `POST /v1/payout-requests/:id/disburse-gateway` (`finance/router.ts` around line 663). Simplest safe option: return 503 with a fixed message until a real integration is approved.
  - *Approval:* finance owner.
  - *Test:* remove the `it.fails` marker from AUD-P0-02. Add a test that the route refuses, and that no payout changes status.
  - *Done when:* the test passes and no code path records a payment from `payment-gateway.ts`.
- [~] **AUD-P0-03.** *(Partly done in the working tree: the literal is removed from the source. Rotation is still required, see below.)* Remove the literal signing key from `finance/payment-gateway.ts`. Load any key from an environment variable. Make the module refuse to start without it.
  - *Approval:* security owner.
  - *Test:* a test that the module fails closed when the variable is absent.
  - *Done when:* the source contains no key literal, and the test passes.

### AUD-P0-03 key rotation (required; not performed)

The gateway's acknowledgement key was written in the source and is in git history. The value must never be printed, pasted into a ticket, or reused. Rotation needs the security owner and a deployment window.

1. Security owner confirms whether the value was used outside this repository (any bank, gateway, partner or script that was given it). Record the answer.
2. If it was used anywhere, replace it at that external party first, using their own rotation process.
3. Set the replacement only in the deployment environment, under the name the code will read once a real integration exists. Nothing in the repository holds it.
4. Remove the old value from git history only with approval, because history rewriting changes every clone. Until then, treat the old value as compromised.
5. Record the rotation date and the people involved. Do not record the value.

## Step 2: read-only review of what the two routes already did (owners, on their own databases)

- [ ] **Connector status.** Owner runs, read-only: list `connector.status_changed` audit rows where the new status is `ACTIVE`. For each, confirm a VERIFIED connector verification exists. Any connector without one must be reviewed for suspension, under the compliance owner's direction.
- [ ] **Payouts.** Owner runs, read-only: list `payout_request` rows with status `PAYMENT_RECORDED` whose reference starts with `CMS`. Each is a payment that may not have happened. Match them to bank statements. Reverse any unmatched settlement journal only with finance approval.
- [ ] **Key rotation.** Security owner rotates the gateway key wherever it was used. Record the date in the release notes.

## Step 3: P1 defects, in this order

Each item needs the approval named, and cannot be built before the step above it is closed.

1. [ ] **AUD-P1-01 consent OTP delivery.** Add the consumer for `consent.otp_requested` that sends the code through the messaging channel. The code is never written to the event.
   - *Approval:* product owner (the channel and message text).
   - *Test:* an end-to-end test with a messaging double that receives the code and completes a referral. Keep the existing outbox test.
2. [x] **AUD-P1-04 lead attribution to inactive connectors.** *(Done, uncommitted; `connector-p1-remediation.int.spec.ts`.)* Refuse a connector that is not ACTIVE on lead creation and reassignment.
   - *Approval:* business owner (the policy).
   - *Test:* lead creation with a SUSPENDED, TERMINATED and PENDING_VERIFICATION connector is refused.
3. [x] **AUD-P1-05 dispute self-resolution.** *(Done, uncommitted; `connector-p1-remediation.int.spec.ts`.)* Refuse resolution by the person who raised the dispute.
   - *Approval:* none beyond the SOD policy already used for attribution.
   - *Test:* confirm first that the raiser is recorded in `created_by`. Then add the test that the raiser cannot resolve.
4. [ ] **AUD-P1-08 step-up on approvals.** Add `requireStepUp` to bank approval, attribution approval, dispute resolution and status changes.
   - *Approval:* security owner (the policy). Payouts already have it.
   - *Test:* each approval is refused without a recent step-up.
5. [ ] **AUD-P1-02 payouts and approved bank accounts.** Require an ACTIVE, approved bank account when a partner requests a payout. Store the account reference on the payout.
   - *Approval:* finance owner.
   - *Depends on:* AUD-P2-02 for the account lifecycle, and Step 2 for the payment decision.
   - *Test:* a request without an approved account is refused. The payout stores the reference.
6. [x] **AUD-P1-03 consent subject.** *(Done, uncommitted; `connector-p1-remediation.int.spec.ts`.)* Require the consent record's subject to equal the verified subject.
   - *Approval:* compliance owner.
   - *Test:* a verification citing another subject's consent is refused, for a customer and for a connector.
7. [ ] **AUD-P1-06 agreements and commission.** Decide the source of truth for a partner's rate. Then link agreements to rule-set versions, or make the rate card read the rule set.
   - *Approval:* finance owner and business owner. Blocks any change to the rate card display.
   - *Test:* the rate card matches the rate used for a sample commission.
8. [ ] **AUD-P1-07 connector verification (business blocker).** Compliance decides Option A, B, C or D in `docs/CONNECTOR_VERIFICATION_DECISION.md`. No code changes until then.
   - *Approval:* compliance owner.

## Step 4: P2 defects

- [x] **AUD-P2-01** *(Done, uncommitted; `connector-p2-remediation.int.spec.ts`.)* Duplicate mobile on connector creation. Add a check on the same basis as PAN. *Approval:* product owner. *Test:* a duplicate mobile is refused, with a message that does not reveal the other connector.
- [ ] **AUD-P2-02** Bank accounts: a rejection state that is audited, a primary-account rule, and change history. *Approval:* finance owner. *Test:* rejected accounts cannot be used for payout; change history is written.
- [ ] **AUD-P2-03** Agreement overlap guard for the same connector and product. *Approval:* finance owner. *Test:* an overlapping agreement is refused.
- [ ] **AUD-P2-04** Partner profile view and update. *Approval:* product owner (fields that partners may change). *Test:* partners cannot change fields outside the approved list.
- [ ] **AUD-P2-05** Connector-scoped database policy for partner sessions, as defence in depth. *Approval:* security owner. *Test:* a partner session cannot read another connector's rows even with a forged query.
- [ ] **AUD-P2-06** Review the signed document link lifetime and single use, and log access. *Approval:* security owner. *Test:* an expired link is refused; access is logged.
- [ ] **Migration 0102 backfill.** Decide the rule for historical partner disputes with no category, then run `VALIDATE CONSTRAINT` in a new migration. *Approval:* product owner and compliance. *Test:* the migration rehearsal on a disposable database.

## Step 5: P3 and documentation

- [x] **AUD-P3-01** *(Done, uncommitted.)* Add `GET /portal/v1/eligibility` to `openapi/openapi.yaml`. Describe the four states and the message field. No behaviour change.
- [x] **AUD-P3-02** *(Done, uncommitted; `connector-p2-remediation.int.spec.ts`.)* Audit consent-OTP sends, with no code in the event. *Approval:* none. *Test:* the audit row exists and contains no code.
- [ ] **AUD-P3-03** Partner recent-activity feed. *Approval:* product owner.
- [ ] **AUD-P3-04** Dispute evidence attachments. *Approval:* product and compliance owners. Needs a new subject type, scanning and access control before any build.
- [ ] **AUD-P3-05** Correct the two documents that say activation of a non-ACTIVE connector is refused. The decision document has a correction note already. Re-check after Step 1 and update the lifecycle fix document's end-to-end table.

## Step 6: verification before release

- [ ] Remove every `it.fails` marker in `connector-audit-defects.int.spec.ts` that has been fixed. Each removal must be in the same change as its fix.
- [ ] Run the focused integration suite, the isolation sweep, the API and web unit suites, typechecks, lint, and both builds. Record the counts in the audit's section 10.
- [ ] Run the manual browser checklist in the audit's section 10 in a real browser, once a browser is available.
- [ ] Owner of the hosted database runs the read-only checks in Step 2 and records the results.
- [ ] Only after all P0 items are closed, and the Step 2 review is signed off, consider a deployment to Render and Vercel. Migrations 0098–0102 on hosted are checked read-only first, and applied only with a separate approval.

## Ownership summary

| Area | Owner role |
|---|---|
| Connector status and activation policy | Connector process owner |
| Payments, payouts and bank accounts | Finance owner |
| Consent, verification and compliance decisions | Compliance owner |
| Step-up policy, keys and secrets | Security owner |
| Partner-facing text, channels and profile fields | Product owner |
| Hosted database reads | Owner of the hosted database |

Names for each role are not recorded here. Those are the owner's to assign.
