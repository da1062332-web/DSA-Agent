# Connector Phase 1: business and security contract

Status key:

- **Existing**: already in the code. Nothing new is decided here.
- **Proposed**: taken from the Phase 1 brief and implemented. Confirm it before release.
- **Pending**: not implemented. Needs a business, compliance or infrastructure decision.

## A. Partner document uploads

| Rule                                                                                                                                                                          | Status                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| A partner may upload only a checklist item whose document type is approved for partners (`document_type.partner_upload = true`, default false). The approved list is pending. | Proposed (flag) / Pending (list)     |
| Ownership is checked on the server: referral (`lead.connector_id`) to application (`loan_application.lead_id`) to checklist item.                                             | Proposed                             |
| File type and size use the document type's existing rules (`allowed_mime`, `max_size_bytes`).                                                                                 | Existing                             |
| Bytes go to the existing token-scoped upload route. The checklist item changes only after a CLEAN scan.                                                                       | Existing                             |
| ClamAV is required. Uploads are refused when `CLAMAV_ADDRESS` is unset or a `PING` to clamd does not return `PONG`.                                                           | Proposed                             |
| Partners get no download route. Files stay unavailable until the scan is CLEAN.                                                                                               | Proposed                             |
| Upload, request and scan events are audited, with the connector as origin.                                                                                                    | Existing (events), Proposed (origin) |
| The hosted scanner configuration has not been verified. Hosted use stays off until it is.                                                                                     | Pending (infrastructure)             |

## B. Application and lender progress

Only the referral (lead) status has a partner mapping today. It is `COARSE` in [connector-portal.ts](apps/api/src/modules/finance/connector-portal.ts). The map covers all nine lead states, and any state not in it shows as `IN_PROGRESS`.

| Internal state                                               | Partner-facing state                   | Visible to connector                |
| ------------------------------------------------------------ | -------------------------------------- | ----------------------------------- |
| Lead `NEW`, `CONTACT_ATTEMPTED`, `IN_PROGRESS`, `QUALIFIED`  | RECEIVED or IN_PROGRESS (per `COARSE`) | Yes (Existing; approval to confirm) |
| Lead `CONVERTED`                                             | APPLICATION                            | Yes (Existing; approval to confirm) |
| Lead `DISQUALIFIED`, `NOT_CONTACTABLE`, `MERGED`, `ARCHIVED` | CLOSED                                 | Yes (Existing; approval to confirm) |
| Application states (12 in `loan_application.status`)         | Generic `IN_PROGRESS`                  | No, until approved (Pending)        |
| Lender case states (14 in `lender_case.status`)              | Generic `IN_PROGRESS`                  | No, until approved (Pending)        |

The 12 application states are `DRAFT`, `DOCUMENTS_PENDING`, `UNDER_REVIEW`, `READY_FOR_SUBMISSION`, `SUBMITTED`, `SANCTIONED`, `PARTIALLY_DISBURSED`, `DISBURSED`, `CLOSED`, `REJECTED`, `WITHDRAWN`, `CANCELLED`.

The 14 lender case states are `DRAFT`, `PACKAGE_READY`, `SUBMITTED`, `UNDER_PROCESSING`, `QUERY_RAISED`, `QUERY_RESPONDED`, `SANCTIONED`, `REJECTED`, `WITHDRAWN`, `SANCTION_EXPIRED`, `SANCTION_CANCELLED`, `PARTIALLY_DISBURSED`, `DISBURSED`, `CLOSED`.

Never shown to a partner: rejection reasons, sub-status detail, credit scores, risk classes, underwriting notes, lender communications, employee comments.

Pending decision: whether `REJECTED`, `WITHDRAWN` and `CANCELLED` should be shown as `CLOSED`. A generic `IN_PROGRESS` for a rejected application would mislead the partner.

## C. Duplicate referrals

The lead service already sets the flag (`duplicate_flag`) when it creates a lead. `EXACT` means a same-branch open match. `POSSIBLE` means an open match in another branch. The lead is created in both cases; nothing is refused today.

| Engine flag            | Staff path (existing)               | Partner portal (proposed)                                                                     |
| ---------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `NONE`                 | Create                              | Create                                                                                        |
| `POSSIBLE`             | Create, flagged for internal review | Create, flagged for internal review                                                           |
| `EXACT`                | Create, flagged for internal review | Refuse. Nothing is created. The response is generic and names no customer, lead or connector. |
| `ATTRIBUTION_CONFLICT` | Create, flagged                     | Refuse, as a conservative default (Pending: the brief does not cover this flag)               |

Known risk, to confirm: the refusal confirms that a matching open enquiry exists for that mobile. A connector reaches that check only after verifying a consent code sent to the customer's own phone, so the exposure is limited. Confirm that this is acceptable.

## D. Dispute categories (partner portal)

Dispute rows hold `subject_type` of `STATEMENT_LINE`, `PAYOUT` or `CALCULATION`. Referral subjects are not in that set, so referral-related categories cannot be attached to a dispute yet.

| Category                 | Subject allowed          | Status                                                                    |
| ------------------------ | ------------------------ | ------------------------------------------------------------------------- |
| `COMMISSION_CALCULATION` | Statement line           | Proposed                                                                  |
| `PAYOUT`                 | Payout                   | Proposed                                                                  |
| `OTHER`                  | Statement line or payout | Proposed                                                                  |
| `REFERRAL_ATTRIBUTION`   | None in this release     | Pending: route to the attribution dispute workflow, or add a subject type |
| `REFERRAL_STATUS`        | None in this release     | Pending: the same decision as above                                       |

Category is stored in a new `dispute.category` column (migration 0100, prepared, not applied to hosted). Evidence attachments are not part of this release. Adding them is pending, and would reuse the approved upload path.

## E. Internal staff access (existing permissions only)

No new permission codes. The rules below are what the code and the seeded grants already do.

| Action                                                    | Permission                                                                                                                     | Seeded roles                                                      | Scope rule (code)                                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| View connector directory                                  | `connector.manage` or `connector.bank_change_approve` at TENANT scope for all; `connector.manage` at BRANCH scope for a branch | ROLE-ORG-OWNER, ROLE-BRANCH-MGR, ROLE-LOAN-OPS, ROLE-TENANT-ADMIN | Connectors you own, plus your branches' connectors, plus all if tenant-wide (`visibility()` in connector-service) |
| Manage connectors (create, edit, lifecycle, owner change) | `connector.manage`                                                                                                             | ROLE-ORG-OWNER, ROLE-BRANCH-MGR, ROLE-LOAN-OPS, ROLE-TENANT-ADMIN | As above                                                                                                          |
| See bank account details                                  | `connector.bank_change_approve` at TENANT scope                                                                                | ROLE-ORG-OWNER, ROLE-FINANCE-APPROVER                             | Tenant-wide only                                                                                                  |
| Approve bank account changes (SOD)                        | `connector.bank_change_approve`                                                                                                | ROLE-ORG-OWNER, ROLE-FINANCE-APPROVER                             | Under SOD                                                                                                         |
| Request and approve attribution changes                   | `connector.attribution_change`                                                                                                 | ROLE-ORG-OWNER, ROLE-BRANCH-MGR, ROLE-LOAN-OPS, ROLE-TENANT-ADMIN | Lead reattribution, SOD-09                                                                                        |
| Resolve attribution disputes                              | `connector.dispute_resolve`                                                                                                    | ROLE-ORG-OWNER, ROLE-BRANCH-MGR, ROLE-LOAN-OPS, ROLE-TENANT-ADMIN | Attribution disputes                                                                                              |
| Raise and resolve financial disputes                      | `finance.dispute`                                                                                                              | ROLE-FINANCE-EXEC, ROLE-ORG-OWNER                                 | Statement lines and payouts                                                                                       |
| Upload, view and download connector documents             | `document.upload`, `document.view`, `document.download`                                                                        | Staff roles with document permissions                             | Application scope. Partners have no download.                                                                     |

Pending decision: whether a branch manager should see all of a connector's referrals, or only referrals in that branch. Referral visibility to staff is not implemented yet.

Connector logins hold no role (migration 0097). Nothing in this contract changes that.

## Implementation status

| Section                            | What is built                                                                                                                                                                                                                                                                                                                                              | What is not                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Partner uploads                 | `POST /portal/v1/referrals/:leadId/documents/upload-intents` and `POST /portal/v1/upload-intents/:id/completion`, sharing the staff pipeline (`issueUploadIntent`, `completeUploadIntent` in `documents.ts`). Refused unless the type is approved, the referral is the caller's, and clamd answers PING. The partner learns only ACCEPTED or NOT_ACCEPTED. | No type is approved yet, so no upload can happen. Hosted scanner configuration is unverified. The partner upload UI is built (`PartnerReferralDetail.tsx`) and shows "not currently available" until a type is approved.                                                           |
| B. Application and lender progress | Lead status mapping (`COARSE`) only.                                                                                                                                                                                                                                                                                                                       | Application and lender mapping, pending approval.                                                                                                                                                                                                                                  |
| C. Duplicates                      | EXACT and ATTRIBUTION_CONFLICT refuse with a generic message and create nothing. POSSIBLE is created and flagged.                                                                                                                                                                                                                                          | ATTRIBUTION_CONFLICT is a conservative default, pending a decision.                                                                                                                                                                                                                |
| D. Dispute categories              | `dispute.category` (migration 0100, recorded in the lock file, not applied) and `GET /portal/v1/disputes`. Categories are checked against the subject.                                                                                                                                                                                                     | Referral categories, pending. Evidence attachments, pending.                                                                                                                                                                                                                       |
| E. Staff access                    | Documented from existing permissions. No new permission codes.                                                                                                                                                                                                                                                                                             | Branch-level referral visibility for staff, pending.                                                                                                                                                                                                                               |
| Portal UI                          | Rewritten to the API's real shapes: referral fields, statement totals and lines, payout by line (`payableIds`). Consent is verified before a referral is sent. Disputes tab and dialog. Load errors shown, not hidden. The fabricated OTP fallback is removed.                                                                                             | Built since: the internal workspace (dashboard, overview, verification, referrals, earnings, activity), the partner referral detail with its timeline, and the partner document list and upload. Not built: dispute evidence attachments (see `docs/CONNECTOR_SECURITY_AUDIT.md`). |

The partner page previously read fields the API never sent. Its statements table and totals were always empty, referral names were blank, and a referral could not be sent because the consent code was never verified. Payout requests sent `amount`, which the API rejects.
