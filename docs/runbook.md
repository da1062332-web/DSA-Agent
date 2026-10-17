# Runbook

Owner: **Dev 4**. Other lanes add content under their pre-created heading only.

## Local development

See the root `README.md`.

## Platform, auth and staging (Dev 1)

<!-- REL-001: dsa_api role creation, staging `supabase link` + `supabase db push`, Auth settings evidence
     (sign-ups off, TOTP on, password policy), smoke test, rollback rehearsal. -->

## Business Rule Engine (Dev 2)

## Applications and catalogue (Dev 3)

## Lender cases and E2E (Dev 4)

## Leads, customers and consent (Dev 5)

## Tasks, rule governance and audit search (Dev 6)

## Release v0.1.0-rc.1

<!-- Gate 4: cut release/0.1, tag v0.1.0-rc.1. Internal pilot candidate, synthetic data only — not production-ready. -->

Owner: **Dev 1** (release notes and tagging only). Full release notes: [`RELEASE_NOTES_v0.1.0-rc.1.md`](../RELEASE_NOTES_v0.1.0-rc.1.md).

### Scope and Operating Boundaries

- **Candidate:** `v0.1.0-rc.1` (Workflow A walking skeleton).
- **Target:** Internal pilot candidate on synthetic data only — **not production-ready**.
- **Data Protection:** No S3-class data (PAN, Aadhaar reference, DOB, UTR, bank details); synthetic data only (ADR-4D-04).
- **Deferred Submodules:** Under TASK-420, submodules `SUB-ADM.01` through `SUB-ADM.07` (Platform Console, Feature Flags, Master Data, Background Jobs, Health Dashboard, Support Access, Data Correction) remain deferred and inactive.

### REL-003: Pre-Release Quality Gate Checklist

Before cutting the release branch or applying the tag:

- [x] Monorepo TypeScript typecheck clean across all 6 workspaces (`npm run typecheck`).
- [x] 444 unit/API tests passing (`npm test`).
- [x] Database migrations and RLS verification passing (`npm run db:verify`).
- [x] OpenAPI schema generation up-to-date and diff-free (`npm run gen:openapi`, REL-002).
- [x] Production web and API bundles build cleanly (`npm run build`).
- [ ] Codebase passes linting without errors (`npm run lint` — outstanding: 149 errors, 2 warnings).
- [ ] Isolation test suite passes in Docker environment (`npm run test:isolation`).
- [ ] Dev 1 formal sign-off recorded.

### REL-004: Tagging and Branch Procedure

Once all Gate 4 requirements are satisfied and approval is granted:

```bash
# 1. Ensure working directory is clean and on approved commit
git status

# 2. (Optional, if branching) Cut release/0.1 branch
git checkout -b release/0.1

# 3. Create annotated release tag
git tag -a v0.1.0-rc.1 -m "Release v0.1.0-rc.1: Internal pilot candidate (Workflow A walking skeleton)"

# 4. Push tag to remote (only upon explicit authorization)
git push origin v0.1.0-rc.1
```
