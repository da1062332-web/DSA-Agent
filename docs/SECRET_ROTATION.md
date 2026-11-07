# Data-protection secrets: configuration and rotation

**Status (2026-11-07):** implemented in code (`apps/api/src/secrets.ts`, commit `c8a7835`). Nothing has been set or rotated on Render. No hosted data was changed.

Written for: the operations owner and the security owner.

## 1. What production requires

The API refuses to start in production (`NODE_ENV=production`) unless each variable below is set and is at least 32 characters. The error names the variable, never the value.

| Variable | Protects | Used by |
|---|---|---|
| `ENCRYPTION_KEY` | Connector PAN and bank account encryption; finance payment references when `FINANCE_ENCRYPTION_KEY` is unset | `connector-service.ts`, `finance/crypto.ts` |
| `HMAC_SECRET` | Connector blind indexes (PAN, mobile, e-mail, account) | `connector-service.ts` |
| `MOBILE_HMAC_SECRET` | Lead, customer and import blind indexes (mobile, e-mail) | `crm/*/normalizer.ts`, `platform/imports/service.ts` |
| `REC_HMAC_SALT` | Loan-account hashes used in reconciliation matching | `reconciliation/crypto.ts` |
| `DOCUMENT_UPLOAD_SESSION_SECRET` | Upload-session token signing (the public upload route is still closed) | `document-sharing-service.ts` |

`FINANCE_ENCRYPTION_KEY` is optional and, when set, takes precedence for finance payment references, as before. `APP_SIGNING_SECRET` was already required.

Development and test use labelled values in `secrets.ts`. Production never falls back to them.

## 2. Before the first deploy with this change (owner action, decision D-03)

1. Read the Render dashboard for **names only**: which of the five variables are set today.
2. For each variable that is **set**: nothing changes; existing data keeps working.
3. For each variable that is **not set**: production has been using the public development value, which is in git history and must be treated as exposed.
   - Encryption keys (`ENCRYPTION_KEY`): set a new random value. The application never decrypts these fields, so existing rows are unaffected. Old ciphertext stays readable only with the old value; re-encrypting it is a separate backfill.
   - Blind-index keys (`HMAC_SECRET`, `MOBILE_HMAC_SECRET`, `REC_HMAC_SALT`): set a new random value **and** set `<NAME>_PREVIOUS` to the old development value. Lookups match either hash, so existing rows stay findable. Without `_PREVIOUS`, duplicate checks and reconciliation matches miss every row written before the change.
   - `DOCUMENT_UPLOAD_SESSION_SECRET`: set a new random value. Sessions last 15 minutes and the route is closed, so nothing is lost.
4. Generate values with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Set them only in Render. Never commit, print or paste them into a ticket.

## 3. Rotating a blind-index key later

1. Set the current value as `<NAME>_PREVIOUS` and a new value as `<NAME>`.
2. Deploy. New rows use the new key; lookups accept both.
3. Run the re-hash backfill (SEC-03; design and dry run only so far, approval A-OPS and A-SEC for any hosted run).
4. When the backfill is verified, remove `<NAME>_PREVIOUS`.

## 4. Other changes in the same commit

- Imports used an unkeyed SHA-256 of mobile numbers and e-mails. They now use the keyed, tenant-scoped hash, so imported rows are found by duplicate checks. Rows imported before the change keep the old unkeyed hash; the SEC-03 backfill should re-hash them from the stored mobile number.
- `IDENTITY_EMAIL_FALLBACK` is off by default in production. Before turning it on, run `tools/identity-binding.ts` and confirm every account is bound by subject.
- The kernel step-up check no longer honours `DISABLE_MFA` in production.
