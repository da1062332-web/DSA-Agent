# Hosted findings after the migration batch (2026-10-17)

Read-only investigation of the shared development project `mlpkwwhnagxzinaohdxg`. Nothing on hosted was changed by this work. Times are UTC unless marked IST (UTC+5:30). Every statement below comes from a query result or a file in the repository; where the data cannot answer, it says so.

## 1. The six `platform.*` grants on a customer-tenant role

**The exact rows.** Tenant `demo-alpha` (`ten_01M4SXZ9E66W8T6DNJYBVNS3FA`), role `ROLE-TENANT-ADMIN` (`role_01M4SXZCV20465ZCBDMYGM2410`), permissions `platform.console`, `platform.flags`, `platform.jobs`, `platform.master_data`, `platform.release`, `platform.support_access`. No other customer tenant has any (query over every customer-tenant role). The role is a template role created 2026-10-13 06:07:40 by `SYSTEM:platform`, `version` 1, 65 grants in total. Three active users hold it: two accounts assigned 2026-10-14 12:18:26 and one account whose name starts `piyus` assigned 2026-10-16 05:58:58.

**Why they are wrong.** Migration 0046 gave these six to `ROLE-ORG-OWNER` and `ROLE-TENANT-ADMIN` of every tenant; migration 0050 deleted them from every customer-tenant role, and its verification (check 16) passed 32 of 32 when it was applied. Something put six of them back afterwards. Both state backups taken before the batch today (04:32 and 07:17) already contained them, so migrations 0054 to 0065 did not add them.

**Who, when, through which operation: only partly answerable.**
- *Not through the API.* The audit trail has **0 events on that role**, and no role or permission audit action of any kind exists in the table (the only action matching "role/permission/grant" is one unrelated `consent.granted`). The role is still `version` 1; an edit through the role endpoint changes the version and, on the code that is not yet deployed, writes an audit event.
- *Not recorded in the table.* `role_permission` has only `tenant_id`, `role_id`, `permission_code`: no time and no grantor. `track_commit_timestamp` is off.
- *How: six separate single-row inserts, by a script or hand-run SQL.* The six rows carry transaction ids **8181 to 8186, consecutive**, i.e. six autocommitted statements one after another, in the order console, flags, master_data, jobs, support_access, release (the order of the list in migration 0046). A migration or a single multi-row insert would share one transaction id.
- *When: between 2026-10-16 06:57:56 and 08:23:59 UTC (12:27 to 13:54 IST).* Transaction 8162 is `lead.state_changed` at 06:57:56 and 8202 is `lead.converted` at 08:23:59; the grants lie between them. This agrees with the backups (present at 04:32 on 10-17).
- *Who: not determinable from the database.* There is no connection log in the read-only interface. Circumstantial only: in that window Piyush committed platform-console work (`54a6338` at 07:13 and `4000af4` at 07:36 UTC, the latter named "enable platform console"), and an account named like his (`piyus…`) was the third holder of this role. That fits "granted to see the console while testing" but proves nothing; the person to ask is Piyush, and the Supabase project's own API/database logs (dashboard) would show the connection.

**The platform realm refused them anyway.** The audit trail holds 33 `platform.access_denied` events for demo-alpha users (2026-10-15 17:36 to 2026-10-17 05:12), including a burst at 05:12:53 on 10-17, after the grants existed: a tenant account holding `platform.console` was still refused. So the stray grants were not an open door. One side effect: `platform.support_access_listed` events in demo-alpha name `platform.support_access` as the permission used, but that endpoint is allowed by `config.manage` for tenant users; the label only reflects that the role also held the stray permission.

**Impact of removing the six rows (prepared, not run).**
- *API access:* none lost. Platform routes refuse tenant principals whatever they hold.
- *Menu:* demo-alpha administrators currently see a "Platform Console" menu entry that leads to a refusal; after removal it disappears. The web code now also hides that entry from every customer-tenant role whatever it holds (`Sidebar.tsx`, tested), so this cannot recur by the same route.
- *MFA:* the role still holds `config.manage`, `user.manage` and others that already require a second factor; no change.
- *Audit label:* the support-access listing event will say `config.manage` (accurate) instead of `platform.support_access`.
- *Data and reversibility:* six rows, nothing references them, and they can be put back. `tools/sql/fixes/remove-operator-grants-from-customer-roles.sql` aborts unless it finds exactly these six rows on exactly this role; `.restore.sql` puts the same six back. Rehearsed on PostgreSQL 16 and 17 (`operator-grants-fix.int.spec.ts`, 3 tests): the 0050 check fails with the strays, passes after the fix, other grants and the platform tenant's own are untouched, and the fix refuses anything it was not shown.
- *Result:* `tools/sql/0050/verify.sql` returns to 32 of 32.

## 2. Role-less active users: 21 to 27

- All **27** are in `test-dsa-alpha`. Created by `tester` (24; names of the `rpt_…`, `importer_…`, `approver_…` kind) and by the fixture user `usr_01JTESTUSER…` (3). They are users made by test code that never assigns a role.
- The six new ones were created on 2026-10-17: two at 04:08:52, two at 04:09:10 and two at 04:47:46 to 04:47:50.
- Those times match two **complete test-suite bursts** against the hosted database: 04:07 to 04:09 and 04:47 to 04:48:32. Between 04:34 and 04:48:32 the stray test rows grew from 1,845 to 1,903 across 25 tables (activities, notifications, lender statements, payouts, reconciliation, imports, users, branches, organisations and more).
- **Nothing has written since 04:48:32** (checked at 10:28). The only new rows after that are 3 `rule_set` and 3 `rule_set_version` rows at 10:01, created by migration 0055 in the three test tenants. They are legitimate and are not in the cleanup list.
- *Who:* not determinable. The specs that create these rows are the live-database specs (activities, payouts, reconciliation, reporting, imports). In the current repository they cannot reach hosted (the guard refuses any non-local database), so the writer ran code **without the guard**: a checkout that has not pulled the guarded test configuration, or old specs run by hand. I cannot tell from the data which. Current database sessions show only Supabase's own services and one `dsa_api` connection through the pooler; past clients are not visible.

## 3. Credential rotation, test-data cleanup, point-in-time recovery

| Item | Status | Evidence |
|---|---|---|
| Credential rotation | **Not done.** I did not rotate (shared by every teammate's `.env` and unknown deployments), and I found nothing showing anyone else did. | The stray writes at 04:07 to 04:48 UTC on 10-17 prove a stored connection string still worked then. I did not test the exposed passwords: that would mean using leaked credentials. Rotating the database password is the one action that stops those writers. |
| Test-data cleanup | **Not run.** Ready and rehearsed (`tools/sql/cleanup`). | Inventory at 10:28 UTC: 1,909 rows in 32 tables, of which 6 are the legitimate 0055 rule rows, so **1,903 stray rows**. 1,030 of the earlier 1,845 sit in five delete-protected tables the procedure never forces. |
| Point-in-time recovery | **Not enabled.** | `supabase backups list --project-ref mlpkwwhnagxzinaohdxg` returns `pitr_enabled: false` and `backups: []`. Earlier reports of mine called PITR "the fallback"; that was wrong and is corrected. The only recovery for this project today is the tested per-migration rollbacks and the entity snapshot in `~/dsa-backups`. Logical daily backups, if the plan includes them, are not shown by this interface; check the dashboard. |

## 4. What I would do next (each needs your say-so)

1. **Rotate the database password and the Supabase keys** (`docs/CREDENTIAL_REMEDIATION.md`), tell the team first. It ends the stray writes and makes the cleanup worth running.
2. **Ask Piyush** whether he granted the six permissions, and look at the project's API and database logs in the dashboard for 2026-10-16 06:58 to 08:24 UTC.
3. **Run the prepared fix** (`tools/sql/fixes/remove-operator-grants-from-customer-roles.sql`) once you accept the reasoning above.
4. **Ask every teammate to pull `beta`** so the guarded test configuration is used.
5. **Enable point-in-time recovery** (or confirm daily backups) before the next hosted change; I believe it is a paid add-on on Supabase, so this is your decision; the dashboard shows what the plan includes.
6. **Run the cleanup** after step 1.
