# Hosted migration runbook: 0098 to 0102

Status: **prepared and rehearsed locally. Nothing in this document has been run against hosted Supabase.** Every command that writes to
hosted needs an explicit approval from the project owner, recorded in the checklist at the end.

## 1. Scope

| Migration | File                                                     | Owner                    | What it does                                                                  | Verify           | Rollback           | Local rehearsal                                                         |
| --------- | -------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------- | ---------------- | ------------------ | ----------------------------------------------------------------------- |
| 0098      | `20261001000098_permission_sub_permissions_expand.sql`   | Dev 1 (owner to confirm) | Adds 32 sub-permissions and grants them to roles that hold their parent codes | `98.verify.sql`  | `98.rollback.sql`  | `migration-0098-0099.int.spec.ts`                                       |
| 0099      | `20261001000099_role_grants_per_roles_page.sql`          | Dev 1 (owner to confirm) | Adds 18 template grants checked against the Notion Roles page                 | `99.verify.sql`  | `99.rollback.sql`  | `migration-0098-0099.int.spec.ts`                                       |
| 0100      | `20261001000100_connector_portal_dispute_and_upload.sql` | pending approval         | Partner dispute category; partner-upload flag on document types               | `100.verify.sql` | `100.rollback.sql` | `migration-0100.int.spec.ts`, `migration-upgrade-0100-0102.int.spec.ts` |
| 0101      | `20261001000101_verification_connector_subject.sql`      | pending approval         | A verification record may be about a connector                                | `101.verify.sql` | `101.rollback.sql` | as above                                                                |
| 0102      | `20261001000102_partner_dispute_category_required.sql`   | pending approval         | A partner dispute must have a category (`NOT VALID`)                          | `102.verify.sql` | `102.rollback.sql` | as above                                                                |

Order: 0098, 0099, 0100, 0101, 0102. Rollback in the reverse order. The local rehearsals check the order: a fresh database built from all the
migrations passes the isolation sweep, and the upgrade rehearsal applies 0100 to 0102 on top of the earlier ones.

## 2. Confirm the target before anything else

1. Run `npx supabase projects list` and confirm which project is linked. Write down its reference and name. Do not write to any project that
   is not the one the owner named.
2. Do not choose the target from `apps/api/.env`. That file can hold the hosted pooler URL and a superuser URL. `npm run verify:migrations`
   reads that file, so **do not run it** until its database target has been checked by hand. Use the batch scripts with
   `--linked` instead, as in `tools/sql/batch/README.md`.
3. The runtime API must not connect as `postgres`, `supabase_admin` or `service_role`. Check the role in the connection string without printing it.

## 3. Read-only state checks (safe; still a hosted connection, so run only when approved)

- Migration history. Expect versions up to 0097, and say whether 0098 and 0099 are present:
  `select version, name from supabase_migrations.schema_migrations order by version;`
- Catalogue. Expect 0 before 0098 and 32 after:
  `select count(*) from app.permission where introduced_in = 'M-098';`
- Run `tools/sql/batch/preflight.sql` as the batch README describes. Every prerequisite row must pass.
- Record the results in the checklist. They decide whether section 6 is already a live problem.

## 4. Backup

- A backup that can be restored: a Supabase backup or a logical dump, taken immediately before the first write, with its timestamp recorded.
- Restore it once into a scratch project before relying on it. Record the scratch project's reference.

## 5. Snapshots (a write, in a backup schema; approval needed)

Snapshots are what let the rollbacks tell a migration's own rows from rows that were already there. The rollbacks refuse without them.

Before 0098 (after 0097):

```sql
CREATE SCHEMA IF NOT EXISTS dsa_backup;
CREATE TABLE dsa_backup.permission_pre_m098 AS SELECT * FROM app.permission;
CREATE TABLE dsa_backup.role_permission_pre_m098 AS SELECT * FROM app.role_permission;
```

Before 0099 (after 0098 has been applied, and before 0099):

```sql
CREATE TABLE dsa_backup.role_permission_pre_m099 AS SELECT * FROM app.role_permission;
```

A fresh snapshot is needed before every new apply. An old snapshot cannot describe a later state.

## 6. Application compatibility and deploy order (read this first)

- Origin's access-control code (TASK-412) checks sub-permission codes. `BROAD_PARENTS` such as `application.read` no longer authorise
  sub-permissions. A database without 0098 and 0099 therefore refuses those routes to users who hold only the parent codes.
- The connector code expects 0100 to 0102. Its partner routes read the new columns and rules.
- **Risk to check now:** the API on Render runs code from `beta`, which needs 0098 and 0099. `supabase/MANIFEST.md` says they are not
  applied to hosted. If that is still true, users holding only parent codes are refused on the sub-permission routes. Run section 3 first.
- Deploy order for any future release: apply the migrations, then deploy the API and web built from the same commit. Never the other way round.

## 7. Apply, one migration at a time

For each migration, use the wrapper that `tools/sql/batch/README.md` describes (`tools/sql/make-apply-run.mjs`, outside the repository). It
prints the source and wrapper SHA-256 and runs the migration in one transaction. Then:

1. Snapshot before 0098 (section 5).
2. Apply 0098. Verify: `npx supabase db query --linked -f tools/sql/batch/98.verify.sql`. Expect no FAIL row.
3. Snapshot before 0099.
4. Apply 0099. Verify with `99.verify.sql`. Expect no FAIL row.
5. Apply 0100, verify with `100.verify.sql`. Expect no FAIL row.
6. Apply 0101, verify with `101.verify.sql`.
7. Apply 0102, verify with `102.verify.sql`.

A verify run that reports FAIL is a stop. Do not apply the next migration.

## 8. Rollback (only if a verify fails or the owner decides to back out)

Roll back in reverse order, and roll back the application release that uses the codes first.

- `102.rollback.sql`: drops the partner dispute rule only.
- `101.rollback.sql`: refuses while any CONNECTOR verification exists.
- `100.rollback.sql`: refuses while any dispute has a category or any document type is approved for partners.
- `99.rollback.sql`: refuses without `dsa_backup.role_permission_pre_m099`. Before running it, a person checks by hand that no listed grant was
  made outside 0099, then runs in the same session:
  `SET dsa.rollback_m099_confirmed = 'no-human-grants';`
  It removes only the listed grants that the snapshot did not have. A grant the role held before 0099 is never touched.
- `98.rollback.sql`: refuses without both 0098 snapshots. It also needs the same kind of human check and
  `SET dsa.rollback_m098_confirmed = 'no-human-grants';` It refuses if it finds a sub-permission granted without its parent code on the same
  role, which would mean a grant made by hand. It keeps `attendance.read`, because it is a screen gate, and it keeps `lender.read` and
  `product.read`, which predate 0098.

No rollback touches an audit row or a historical record. The grant table keeps no record of who added a row, which is why the human check
is a step and not a query.

## 9. Known limits

- The grant checks cannot prove a grant was not made by hand. They refuse what they can see, and the human check covers the rest.
- A role created after the snapshot has no snapshot rows. Its grants are treated as added by the migration. The human check must cover that.
- Re-running 0098 or 0099 is idempotent. It repairs missing backfill grants, but it does not undo a rollback.

## 10. Approval checklist (record each item with the name and date)

- [ ] Target project confirmed by the owner (section 2), with its reference recorded.
- [ ] Section 3 checks run and their results recorded. The risk in section 6 is resolved or accepted.
- [ ] Backup taken, its timestamp recorded, and a restore tested into a scratch project.
- [ ] Snapshot before 0098 approved and taken. Snapshot before 0099 approved and taken.
- [ ] Human check for 0098 and 0099 completed: nobody granted a sub-permission or a template grant by hand.
- [ ] Application release built from the same commit as the migrations, and ready to deploy after them.
- [ ] Dev 1 (owner of 0098 and 0099) has agreed their verify and rollback scripts.
- [ ] Business decisions recorded for the connector migrations: partner dispute backfill (0102 keeps historical rows NULL), partner document
      types (`partner_upload` defaults to false), and the verification consent rule (0101 changes no consent).
- [ ] Owner's written approval to run each write in section 7.
