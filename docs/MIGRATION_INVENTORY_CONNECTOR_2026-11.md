# Migration inventory and dependencies: connector migrations (November 2026)

Scope: migrations 0097 to 0100, and the existing objects they depend on. Built from the migration files, the catalog of a freshly migrated local container, and the code that reads and writes these objects. Nothing was read from hosted.

## Migration history

- 88 migration files existed before this work (0001 to 0098 with the numbering as recorded). This work adds 0099 and 0100.
- Version numbers are unique. The known-duplicates list in `migration-versions.spec.ts` is empty.
- `supabase/migrations.lock.json` records the SHA-256 of every migration file. `npm run check:migrations` passes with 90 files.

## Dependency table

| Object                                                                                                            | Created by | Altered by                                | Used by (code)                                            |
| ----------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------- | --------------------------------------------------------- |
| `connector`, `connector_bank_account`, `connector_agreement`, `attribution_dispute`, `attribution_change_request` | 0027       | none                                      | connector module                                          |
| `lead`                                                                                                            | 0003       | 0027 (connector link), 0033, 0074         | leads, connector portal                                   |
| `loan_application`                                                                                                | 0021       | 0035 (hold)                               | applications, documents                                   |
| `consent_record`                                                                                                  | 0003       | none (subject CHECK: LEAD, CUSTOMER only) | verification, messaging                                   |
| `verification` (decision record, append-only)                                                                     | 0026       | **0099** (connector link)                 | verification service, connector activation, bank accounts |
| `verification_request` (workflow)                                                                                 | 0019       | 0021                                      | verification workflow (not used by connector activation)  |
| `document_type`                                                                                                   | 0071       | **0098** (`partner_upload`)               | documents API, partner upload                             |
| `dispute`                                                                                                         | 0049       | **0098** (`category`), **0100** (rule)    | finance disputes, partner portal                          |
| `role`, `user_role_assignment`, `app_user` (guards)                                                               | 0097       | none                                      | role-less connector enforcement                           |

## Schema state of the affected objects

- `verification`: RLS enabled and forced. Trigger `verification_no_mutation` (UPDATE and DELETE forbidden). Grants: `dsa_app` SELECT and INSERT only. `verification_subject_type_check`, `verification_consent_record_id_fkey`, `verification_tenant_id_performed_by_fkey`, indexes `verification_subject_idx`, `verification_consent_idx`, `verification_cursor_idx`.
- `dispute`: RLS enabled and forced. `dispute_category_check` (0098, NULL allowed). `dispute_party_type_check` (LENDER, CONNECTOR). `dispute_partner_category_required` (0100, NOT VALID).
- `document_type`: RLS enabled and forced. `partner_upload` boolean NOT NULL default false (0098). No PUBLIC privilege.
- `connector`: RLS enabled and forced. UNIQUE (tenant_id, id), so the composite foreign keys in 0099 resolve.

## What each migration changes

| Migration | Adds                                                                        | Changes existing rows | Constraints                                                                     | Indexes                                |
| --------- | --------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------- | -------------------------------------- |
| 0098      | `dispute.category`, `document_type.partner_upload`                          | none                  | `dispute_category_check`                                                        | none                                   |
| 0099      | `verification.connector_id`; CONNECTOR in `verification_subject_type_check` | none                  | `verification_connector_fk` (composite), `verification_connector_subject_check` | `verification_connector_idx` (partial) |
| 0100      | rule on partner disputes                                                    | none (NOT VALID)      | `dispute_partner_category_required`                                             | none                                   |

Re-running any of the three leaves the same definitions (checked by TEST-UPG-05).

## Order

Apply in order: 0098, 0099, 0100. Each depends only on objects in the earlier migrations, so the order is forced by the numbering, not by a runtime dependency between them. 0100 depends on 0098's column.

## Rollback order

Roll back in reverse: 0100, then 0099, then 0098. Each rollback refuses while data would be lost:

- `100.rollback.sql` drops a rule; no data changes.
- `99.rollback.sql` refuses while any verification is about a connector, because verification records are immutable.
- `98.rollback.sql` refuses while any dispute has a category or any document type is approved for partners.

The application code reads `verification.connector_id`, so rolling back 0099 while the new code runs breaks activation. Roll back the code first.

## Verification scripts

`tools/sql/batch/98.verify.sql`, `99.verify.sql`, `100.verify.sql`. Catalog checks only. A missing object is a FAIL row, not an error. Run with `npx supabase db query --linked -f <file>` against the target database, or against a local container.

## Local rehearsal results

- Fresh schema: all migrations applied by the harness; the three verify scripts report no FAIL.
- Upgrade: a database built from the migrations before 0098, with historical data, upgraded by 0098 to 0100. The data survived, the new rules held, and the verify scripts report no FAIL (`migration-upgrade-0098-0100.int.spec.ts`, 9 tests).

## Not applied anywhere except local containers

Nothing in this document has been applied to hosted Supabase. No hosted credential was used.
