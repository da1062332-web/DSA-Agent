# Connector verification: the decision needed before connectors can be activated

Status: **open. Compliance and product decision required.** Migrations 0101 and the application code are prepared and tested locally. Nothing is applied to hosted.

## The defect

Connector activation (`POST /v1/connectors/:id/activation`) accepted any VERIFIED record in the tenant. The record was never checked to be about the connector being activated. The same was true for a bank account's `verificationId`. A customer's verification could therefore activate any connector in the tenant.

## What is changed now

- Migration `20261001000101_verification_connector_subject.sql` lets a verification record name the connector it is about. A CONNECTOR subject must name its own connector, and only a CONNECTOR subject may carry a connector. The link is a composite foreign key, so a record cannot point at another tenant's connector. Existing records are unchanged.
- Activation now requires a VERIFIED record whose subject is that connector. A customer's record, another connector's record, and a REJECTED record each refuse the activation with a specific issue (`NOT_THIS_CONNECTOR`, `NOT_VERIFIED`). A missing record is refused as before.
- A bank account given a `verificationId` must be a VERIFIED record of that connector. A bank account given no `verificationId` is unchanged.

## The consequence that needs a decision

**No connector can be activated until connector verifications can be recorded.** That is the fail-closed outcome, and it is intended. The alternative was to keep the defect.

Connector verifications cannot be recorded today, for two reasons that the code confirms:

1. `consent_record.subject_type` accepts only `LEAD` and `CUSTOMER` (`consent_record_subject_type_check`). Every verification row needs an active consent record (`verification.consent_record_id` is NOT NULL, and the service requires `ACTIVE` consent with purpose `VERIFICATION_CHECK`). A connector has no consent record that can be written.
2. The verification API accepts only `CUSTOMER`, `LOAN_APPLICATION` and `LEAD` as subjects (`VERIFICATION_SUBJECT_TYPES`).

Effects of the current state:

- Connectors already `ACTIVE` are unaffected: activation returns them unchanged.
- Connectors in `DRAFT` or `PENDING_VERIFICATION` cannot be activated.
- Bank accounts can still be created without a verification.

## Options

| Option                                 | What it means                                                                                                                                                                     | What it needs                                                                                                                                                | Notes                                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **A. Connector consent** (recommended) | Add `CONNECTOR` to `consent_record.subject_type` and to the verification subjects, capture connector consent through an API, and require the consent subject to be the connector. | Compliance: a lawful basis and notice for checking a connector. A migration to extend the consent subject (`0101`, not drafted). An API for consent capture. | The verification then follows the existing model. The DPDP position for business partners needs confirming. |
| **B. Verification without consent**    | Make `consent_record_id` optional for CONNECTOR subjects, on the basis that the check is not personal-data processing about an individual.                                        | A written compliance opinion. Relaxing the NOT NULL rule on an append-only table, with a CHECK that makes consent mandatory for every other subject.         | Smaller change, but it relies on a legal position not yet taken.                                            |
| **C. Manual activation with approval** | Activate a connector by a recorded decision, with a reason and a second approver, and no verification record.                                                                     | Business: who approves, and what it replaces. A new approval record, or reuse of the SOD approval pattern used for bank accounts.                            | Does not verify the connector; it records that someone decided. Weaker evidence than a check.               |
| **D. Keep the old rule**               | Any VERIFIED record in the tenant activates a connector.                                                                                                                          | Nothing.                                                                                                                                                     | **Not acceptable.** This is the defect.                                                                     |

## Recommendation

Option A, after a compliance review of connector consent. Until that decision, activation stays blocked. That needs an explicit operational decision, because pending connectors cannot be activated in the meantime.

## Related finding, not changed here

The verification service checks that the consent record exists, is active and has the right purpose. It does not check that the consent is for the subject being verified. This applies to customers as well as connectors. It is an existing behaviour, so changing it needs its own decision, and it belongs in the same compliance review.
