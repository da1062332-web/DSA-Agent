# Document upload controls

**Date:** 2026-11-04
**Status:** Implemented and verified locally. Not committed, not pushed, not deployed. No hosted data, schema, configuration or secret changed.
**Written for:** the security owner, the operations owner, and the developers who run and reopen the upload path.
**Relates to:** `docs/PRODUCTION_SECURITY_CONTAINMENT.md` (the closed `/public/v1/upload/:token` route).

## 1. Decisions applied

These were approved for this round. The public `/upload/:token` route stays closed.

1. `PUT /public/v1/document-uploads/:token` stays open, because internal and partner upload flows depend on it.
2. Uploaded bytes are held in a private quarantine store, and nothing can read them until a malware scan returns clean.
3. ClamAV that is unavailable, unhealthy or failed is fail closed.
4. The partner API issues upload URLs on `/public/v1/document-uploads/:token`, not on the closed route. Section 6 explains what is still missing for that link to work.

## 2. The lifecycle as built

| Step | Who | What is checked | What is stored | Failure |
|---|---|---|---|---|
| 1. Issue an intent | Staff `POST /v1/documents/upload-intents`, or partner `POST /portal/v1/referrals/:leadId/documents/upload-intents` | Permission and application scope. Item status. Type MIME and size. **Size ≤ 20 MB** (new). **Scanner ready** (new) | An `upload_intent` row. The token is stored only as its SHA-256 hash. Declared size, SHA-256, MIME, and expiry 15 minutes ahead | 422 for a file over the cap. **503 `DEPENDENCY_UNAVAILABLE` when the scanner is not ready** (new). No row, no URL |
| 2. Upload the bytes | Anyone holding the URL. `PUT /public/v1/document-uploads/:token` | Token resolves to one intent (server side). Status is `PENDING` (single use). Not expired. Length and SHA-256 match the declaration. **Scanner ready** (new). Rate limit 30 per minute per caller (new). Body cap 20 MB (new) | **The bytes go to the quarantine store** (new). Status becomes `UPLOADED` and the row keeps the quarantine key | 410 `LINK_EXPIRED`. 409 `INVALID_STATE` on replay. 422 on a mismatch. 400 over the body cap. **503 when the scanner is not ready; nothing is stored** (new) |
| 3. Complete | Staff `POST /v1/upload-intents/:id/completion`, or partner `POST /portal/v1/upload-intents/:id/completion` | Tenant scope through row-level security. The partner must be the connector user who started the intent and own the referral. **Scanner ready** (new). The stored bytes match the SHA-256 | A version is written. **Only a clean file is promoted** from quarantine to the store that serves files (new). An infected file stays in quarantine | **503 with no verdict. The intent stays `UPLOADED` and can be completed later** (fail closed). Infected: the version is `QUARANTINED`, the item is not submitted |
| 4. Serve | View link, download link, review, archive, signed file route | Every one requires a `CLEAN` version (already in place; confirmed in section 4) | Nothing new | 409 `DOCUMENT_QUARANTINED` |

### Where the bytes are

- **Quarantine store.** Written only by the PUT. Read only by completion. Never served. Local folder `DOCUMENT_QUARANTINE_DIR` (default `./uploads/documents-quarantine`), encrypted with the document key when a link secret is configured.
- **Clean store.** Written only when a file is promoted (completion, `CLEAN` verdict), and by the archive job. Read by the signed file route, the archive builder, and the link routes, each of which requires `CLEAN`.

The check that quarantine is isolated is structural, and the code was searched for it:

- `docs.quarantine` is used in two places: the PUT (`put`) and completion (`get`).
- `docs.store` is read in three places. The signed file route for a version requires `CLEAN` before it reads. The archive build selects `CLEAN` versions only. The signed file route for an archive reads an archive object, which is not a document.
- `docs.store.put` in completion runs only inside the `CLEAN` branch. The archive job writes its own archive object.

## 3. Verification

### 3.1 Regression and isolation tests

| Test | What it proves |
|---|---|
| TEST-LC-01 | Without a working scanner (the production default), no intent is issued and no row is written |
| TEST-LC-02 | A scanner that does not answer refuses a new intent |
| TEST-LC-03 | The PUT stores the bytes only in quarantine; the clean store is untouched; the row keeps a tenant-prefixed quarantine key |
| TEST-LC-04 | A clean verdict promotes the bytes; the version becomes available only then |
| TEST-LC-05 | An infected file stays in quarantine; the item is not submitted; the view link, the review and the signed route refuse it |
| TEST-LC-06 | A scanner that stops answering at completion leaves no version; a retry after recovery is accepted |
| TEST-LC-07 | A scanner that is down at the link stores nothing; the intent stays pending for a later upload |
| TEST-LC-08 | A replayed upload is refused and stores nothing more |
| TEST-LC-09 | An expired link is refused with 410 and stores nothing |
| TEST-LC-10 | Bytes that differ from the declared file are refused and not kept |
| TEST-LC-11 | A file over the cap is refused when the intent is issued |
| TEST-LC-12 | The link belongs to the issuing tenant; another tenant cannot complete the intent |
| TEST-LC-13 | The upload link is rate limited (30 per minute) |
| TEST-LC-14 | A body over the cap is refused by the parser and nothing is stored |
| TEST-LOG-01, TEST-LOG-02 | Upload, signed-file and public upload tokens are removed from logged paths; other paths are unchanged |
| TEST-DOC-INT-01 to 09 | The staff flow still works end to end, with a ready test double and in-memory stores |
| TEST-CPT-DOC-01 to 10, TEST-CPT-DOCL-01 to 03 | The partner flow still works against a real ClamAV client on a fake clamd; partner and tenant isolation hold |
| partner-api.spec assertion | The partner session URL uses `/public/v1/document-uploads/` and never the closed route |

The lifecycle spec is `apps/api/test/document-upload-lifecycle.int.spec.ts`. It runs against a real database, with the production routes. The scanner is the real ClamAV client, pointed at a fake clamd (`apps/api/test/support/fake-clamd.ts`), so the fail-closed cases exercise the real network path.

### 3.2 Results

Recorded in section 7.

## 4. Audit answers

### Token replay

- A token is 32 random bytes, base64url encoded. Only its SHA-256 hash is stored.
- The PUT locks the intent row and moves it from `PENDING` to `UPLOADED` in the same transaction. A second PUT is refused with 409 `INVALID_STATE` (TEST-LC-08). The bytes are not stored a second time.
- Completion is idempotent: a completed intent returns its existing version.
- **Remaining:** the URL is a bearer capability for the declared file, for 15 minutes. Anyone who holds it can upload that one file before the owner does. The URL is in the issuing response only; it is no longer written to request logs (TEST-LOG).

### Expiry

- An intent lives 15 minutes from issue. The PUT refuses an expired intent with 410 `LINK_EXPIRED` (TEST-LC-09), and stores nothing.
- Completion does not check expiry. Once the bytes are stored, completing an intent after its link has expired is allowed. This is deliberate: the scan is the gate, not the link.

### Tenant isolation

- The token resolves to its tenant on the server, and the PUT uses that tenant. The client cannot pick it.
- Quarantine and clean keys start with the tenant id (`<tenantId>/...`), and TEST-LC-03 and TEST-LC-12 check it.
- A caller from another tenant cannot complete the intent (404, TEST-LC-12). The existing isolation cases (TEST-DOC-INT-09, TEST-CPT-DOC-04 and 09) still pass.

### File-size limits

- Declared size is checked against the type's limit (default 10 MB) and against `MAX_UPLOAD_BYTES` = 20 MB (new). A declared file over either limit is refused with 422 (TEST-LC-11).
- The PUT body is capped at 20 MB by the parser (new), which returns 400 `MALFORMED_REQUEST` (TEST-LC-14).
- A body that differs from the declared size or hash is refused with 422 (TEST-LC-10).
- The cap is inside clamd's default stream limit of 25 MB, so a file in the allowed range can always get a verdict.
- **Before this change** the PUT accepted up to 52 MB. The declared size was checked only after the body was read.

### Rate limits

- Public API default: 600 requests per minute per caller (unchanged).
- The PUT: 30 requests per minute per caller (new, TEST-LC-13). Each PUT can carry up to 20 MB.
- **Remaining:** the limiter is in memory, per process, keyed by the caller (the client address, for an anonymous PUT). With several instances, the effective limit multiplies by the instance count.

### Scanner availability (fail closed)

- ClamAV unreachable, unhealthy or not answering at issue, PUT or completion: 503 `DEPENDENCY_UNAVAILABLE`. No intent, no bytes stored, no verdict, no version (TEST-LC-02, 06, 07).
- The file-signature check (`MagicByteFileScanner`) has no readiness method, so it is never ready. Without ClamAV configured, every upload is refused. It can no longer clear a file.
- A scanner check that throws counts as not ready.

## 5. Recommendations and remaining risks

1. **Quarantine copies of clean files are kept.** The stores have no delete operation. After a successful promotion the quarantine copy is unreferenced. Add a delete to the store interface, and purge after a retention decision.
2. **Quarantine is on the instance disk in production** unless `DOCUMENT_QUARANTINE_DIR` points at persistent storage. A redeploy loses in-flight `UPLOADED` intents. Their completion then fails with a "does not match" error, and the user uploads again. Recommend a private quarantine prefix in S3 (section 8.2 of the containment report).
3. **Intents issued before this change** stored their bytes in the clean store on PUT. Completion now reads from quarantine, so they fail and must be re-uploaded. Their bytes stay in the clean store, unreferenced. They expire within 15 minutes of issue, but a one-time sweep of `UPLOADED` rows and their objects needs approval and is not part of this change.
4. **`DOCUMENT_QUARANTINE_DIR` is read from the environment** and is not in the configuration schema (`apps/api/src/config.ts`). Add it to the schema, with the same validation as `DOCUMENT_STORAGE_DIR`.
5. **The PUT holds its row lock during the scanner check.** The check is a single PING with a 5-second timeout. Acceptable, and recorded here so a slow scanner is recognised as the cause of slow uploads.
6. **Scan timing.** A file is scanned at completion, not at the PUT. The bytes are in quarantine until then, so no route can serve them, but a scanned-on-PUT design would hold the link open for longer. Keep the current design unless the owner asks for scan-before-store.
7. **Partner API sessions do not persist** (section 6).

## 6. Partner API upload URL (decision 4)

`apps/api/src/modules/partner-api/service.ts` now returns `https://app.dsa-crm.com/public/v1/document-uploads/<token>`.

**This link does not work yet.** The partner-API service is an in-memory stub. It never stores its token, and no upload intent exists for it. A PUT to the link returns 404 `NOT_FOUND`. The stub also has no database access.

What it needs before the link can work:

- An upload intent for each requested document, which needs the file's size, SHA-256 and MIME type, and the checklist item. The current partner request carries none of them, so the contract (`PartnerUploadSessionRequestSchema`) must change.
- A database-backed partner session that resolves the application and checklist items for the caller's tenant.
- A decision on who owns the partner session: the partner integration or the connector portal flow.

This is a blocker for the partner API, and it needs the owner's decision on the contract change.

## 7. Results

| Check | Result |
|---|---|
| Typecheck, all workspaces (`npm run typecheck`) | Pass (exit 0) |
| Focused integration, guarded local Testcontainers config: the new lifecycle spec, the staff and partner document specs, and the payout, reconciliation, connector, sharing and MFA specs | 15 files, 115 tests passed |
| Full API unit suite (`npx vitest run` in `apps/api`) | 101 files, 1,488 tests passed |
| Isolation sweep (`npm run test:isolation`) | 18 files, 549 tests passed. The document cases now provide a ready test double, since the production default refuses uploads |
| API build (`npm run build -w @dsa/api`) | Pass |
| Web build (`npm run build:web`) | Pass |
| Lint, repository (`npx eslint .`) | 958 problems: 1 error, 957 warnings. The same total as before this change. The error is in `e2e/helpers/mock-session.ts` and predates this work |
| Formatting | New files formatted. `redact.ts` and `error-handler.ts` were already unformatted at HEAD and were left in their existing style |

Not run: the Playwright e2e suite (it needs a browser and the public URL). The e2e specs that use the closed `/upload/` route will fail by design.
