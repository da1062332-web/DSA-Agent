# ADR-4D-10 — Which sensitive identity fields the product stores

**Status:** accepted, 2026-11-28 (checklist 4.6.1). Recorded in the repo; the Contracts §15 change-log line is still to be added (see below).

**Context.** The guard for PAN, Aadhaar and account numbers in free text (`freeTextNoS3`, task P1-01) was written before the owner decided which sensitive fields the product stores. Until now CLAUDE.md said no S3-class data is stored at all, while the customer profile already stores PAN and date of birth, encrypted (task P1-02).

**Decision.**

| Field | Stored | Rule |
|---|---|---|
| PAN | Yes, only where the loan or customer workflow needs it | Structured field only. Encrypted (customer identity fields). Masked everywhere it is shown or logged (`ABCDE****F`). |
| Date of birth | Yes, only where eligibility or loan processing needs it | Structured field only. Protected as sensitive data (encrypted). Masked in logs, error responses and audit payloads. |
| Full Aadhaar number | No | Refused in identity fields with 422. Only a masked or reference form may be stored. |
| UTR, loan account, bank details | No, in the MVP | Rejected, as before. Not covered by this decision. |

Sensitive values are not permitted in free text. `freeTextNoS3` refuses a PAN, an Aadhaar-shaped number, a 9 to 18 digit account-like number, and a date of birth written after its key (`dob`, `date of birth`, and so on). A bare date with no key is not refused, because on its own it is not identity data.

Logs, error responses and audit payloads never carry a raw PAN, Aadhaar or date of birth.

**Consequences.**
- CLAUDE.md, the data-protection rules, are amended to match. TEST-SECRETS-06 keeps the single definition of the free-text patterns in `packages/contracts/src/s3-text.ts`.
- The free-text guard is stricter now: it also refuses a keyed date of birth. Existing stored text is not changed, and no backfill has been run on hosted data.

**Known gaps, still open.**
1. **Audit payloads.** `redactSensitivePayload` (packages/kernel/src/audit/audit.ts) replaces a whole value that is exactly a PAN or a 12-digit number with `[REDACTED]`. A PAN or date of birth inside a longer string in an audit payload is stored unmasked. This must be fixed before the decision is fully met.
2. **Bare dates of birth.** A date with no key is not detected in free text, logs or audit payloads.
3. **Aadhaar reference form.** Only the full-number refusal exists. No masked Aadhaar reference field is implemented yet.

**Contracts §15 change log (to be added by the owner in Notion).** The shared Notion page could not be reached from the workspace integration, so this line still needs adding there:

> 2026-11-28 · P1-01 · Sensitive identity fields: PAN and date of birth stored as protected structured fields; full Aadhaar not stored; sensitive values refused in free text (`freeTextNoS3` now also refuses a keyed date of birth); masked in logs, errors and audit. See ADR-4D-10 and CLAUDE.md, Data protection.
