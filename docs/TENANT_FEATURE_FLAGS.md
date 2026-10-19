# Per-tenant feature flags in the platform console

Status: **implemented and tested locally; migration 0068 NOT applied to hosted; nothing pushed.** Owner: Platform squad (Module 1 / MOD-ADM, SUB-ADM.02).

## What was missing

The Tenants tab listed tenants but a row led nowhere, and the Feature Flags tab showed every flag in one list. A platform operator could not pick a tenant and manage that tenant's flags.

Reading the code turned up three more things:

1. **The database could not hold a per-tenant flag.** `app.feature_flag` is keyed by `(key, scope)` with no tenant column. A `TENANT`-scope flag (today only `crm.lead_auto_qualify`) was ONE shared row; "on for Alpha, off for Beta" had nowhere to live. This is a schema gap, so closing it needs a migration.
2. **The existing console toggle was unsafe.** `PlatformConsolePage` sent `scope: 'GLOBAL'` for every row and no `If-Match`, so flipping the `TENANT` row wrote a **new GLOBAL row** with the same key. Fixed: it now sends the row's own scope and version.
3. **No code reads a flag.** `feature_flag` is referenced only by the platform store. The flags are stored, versioned and audited, but no feature checks them yet. This work gives the operator the correct place to set them; making a feature obey them is separate work for each feature owner.

## Design

- **migration 0068** adds `app.tenant_feature_flag (tenant_id, key, scope='TENANT', value, lock_version, updated_at, updated_by)`. Primary key `(tenant_id, key)`; foreign key `(key, scope)` → `feature_flag`, so only a flag that is *defined* with scope TENANT can be overridden (a GLOBAL flag or a typo is refused by the database).
- `feature_flag` itself is **unchanged** (no column, key, policy or grant). The `TENANT` row there is the platform-wide default; a tenant's row in the new table overrides it. GLOBAL flags have no override.
- Row-level security (forced): the platform realm reads and writes everything; a customer tenant reads **its own rows only** and can never write. `dsa_app` has no DELETE (NFR-SEC-003), so "back to default" means setting the override equal to the default.
- The tenant is in the **URL path** and the body may contain only `value` (strict schema), so a call made for one tenant cannot name a scope or another tenant, and cannot reach a GLOBAL flag or the default. The tenant routes write the new table only.

## APIs

| Endpoint | Status | Permission and realm |
|---|---|---|
| `GET /platform/v1/tenants` | reused (the directory) | `platform.console`, platform realm |
| `GET /platform/v1/tenants/:tenantId` | **new**, tenant overview (metadata only); audited as `platform.tenant_viewed` | `platform.console`, platform realm |
| `GET /platform/v1/flags` | reused, to show the GLOBAL flags read-only on the tenant page | `platform.flags`, platform realm |
| `GET /platform/v1/tenants/:tenantId/flags` | **new**, TENANT-scope flags as that tenant sees them (default + override) | `platform.flags`, platform realm |
| `PUT /platform/v1/tenants/:tenantId/flags/:key` | **new**, sets that tenant's override; body `{ "value": boolean }`; **`If-Match` required** (the version read, `0` when no override yet); `ETag` returned; audited as `platform.tenant_flag_set` in the same transaction | `platform.flags`, platform realm |
| `PUT /platform/v1/flags/:key` | reused unchanged (GLOBAL flags and the TENANT default) | `platform.flags`, platform realm |

Errors: unknown tenant or the platform tenant → 404; GLOBAL or unknown flag on the tenant route → 404; non-boolean, extra body field or missing/invalid `If-Match` → 422; stale version → 409 `VERSION_CONFLICT`; tenant users, tenant admins holding platform codes, service identities, and operators lacking the permission → 403 (and the refusal is audited). Each route is also mounted under `/v1`, like the rest of this module.

## UI

`/platform-admin/tenants/:tenantId` (also under `/platform-console`), reached from the slug or the **Manage** button on each directory row. Tabs: **Overview** and **Feature Flags** (`?tab=flags` opens it directly). The flags tab shows platform default, this tenant's value, state (default or overridden), version and last change; a switch opens a confirmation that names the tenant and states that the default, the global flags and other tenants are not changed. GLOBAL flags appear as read-only chips. A stale save (409) closes the dialog and reloads the real value.

## Deploy order (this matters)

**Apply 0068 before the API code is deployed.** Until it is applied on a database:

- `GET /platform/v1/tenants/:tenantId`, the directory and every GLOBAL flag route keep working (they do not read the new table);
- the two tenant **flag** routes fail with a server error (missing table), and the tenant page's Feature Flags tab shows "The tenant flags could not be loaded".

Hosted does not have 0068. The prepared steps, **all yours to run after you approve** (nothing here has been run against hosted):

```
node tools/sql/make-apply-run.mjs supabase/migrations/20261001000068_tenant_feature_flag_overrides.sql ~/dsa-backups/68/
npx supabase db query --linked -f ~/dsa-backups/68/apply-run.sql      # WRITES TO HOSTED
npx supabase db query --linked -f tools/sql/0068/verify.sql           # read-only; every row PASS
npx supabase db query --linked -f tools/sql/0068/rollback.sql         # only to back out; refuses while overrides exist
```

0068 creates one new table and touches no existing one; it is idempotent. Rollback drops the table and refuses while any override exists (those rows are operator decisions). It was not added to the hosted batch runbook (`tools/sql/batch`), which describes a batch that is already applied.

## Tests

| Spec | Covers |
|---|---|
| `apps/api/test/platform-tenant-flags.spec.ts` (7) | tenant selection and 404, TENANT-only listing, update changes that tenant only, global-vs-tenant separation, body cannot choose scope/tenant, If-Match required / stale 409 / current wins, refusals (tenant admin with platform codes, tenant user, support-only, anonymous) |
| `apps/api/test/platform-tenant-flags.int.spec.ts` (5, real PostgreSQL) | the same on real tables, `feature_flag` byte-for-byte unchanged, survives a restart, foreign key and check refuse a GLOBAL flag, customer tenant sees only its rows and cannot write or delete as the API role, verify/rollback scripts |
| `apps/web/src/features/platform-admin/TenantDetailPage.spec.tsx` (10) | routes, a link per directory row, overview and flags rendering, every call carries the tenant id in the path with only `{value}` and `If-Match`, empty tenant id refused before sending, API refusals reach the screen |
| `platform-realm-ops.int.spec.ts` | its pre-0050 base now also leaves out 0068 (it needs the platform realm), as it already did for 0061 |

## Known limits

- Overrides are not yet read by any feature (see finding 3). A tenant-side read path would use the `tenant_flag_read` policy already in place.
- No bulk "reset to default" and no delete; set the override to the default value.
- Only on/off flags exist, as before.
