# Demo seeds

Synthetic data only (ASM-4D-06). CI fails if fixtures contain PAN-like strings that are not on the synthetic allow-list. One file per owner, so nobody edits another lane's file:

| File                                                                                                        | Owner                                                 |
| ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `platform.ts`: two tenants with identical natural keys (isolation scenario), branches, roles, users, queues | Dev 1                                                 |
| `rules-demo-pack.json`: DEMO platform-approved rule versions for the six MVP decision keys                  | Dev 2                                                 |
| `origination-demo.ts`: lenders, empanelments, products                                                      | Dev 3 (catalogue, applications), Dev 4 (lender cases) |
| `crm-demo.ts`                                                                                               | Dev 5                                                 |
| `tasks-demo.ts`                                                                                             | Dev 6                                                 |

The provisioning CLI (`tools/provision-tenant.ts`, TASK-103) loads them; `supabase/seed.sql` stays empty.

## Flow-wise local seed (`seeds/demo/flow/`)

A separate, local-only seed that fills every application table with a connected business flow: lead → qualification → customer → loan application → documents and verification → lender case → submission and query → sanction → disbursement tranches → commission → payout → ledger and reconciliation, plus operations, integrations, rules and privacy records. It runs against a database on this machine only and never touches hosted.

```
npm run seed:local-flow -w @dsa/tools      # DATABASE_URL must point at 127.0.0.1 / localhost
```

- Refuses any non-loopback host and refuses a database that already holds `ten_alpha` (reset the local database first).
- Runs in one transaction. Foreign-key triggers are off during the load, so every foreign key is checked afterwards; the ledger balance is checked by hand; any failure rolls back.
- Two demo tenants (`demo-alpha`, `demo-beta`) carry the full flow with identical natural keys. Eight pilot tenants exist as tenant rows only, so the tenant table has eight or more rows.
- Reuses people, roles, branches and queues from `platform.ts` and adds local-only branches, teams and queues.
- Reuses the migration-seeded catalogue (decision definitions, permissions, master data, worker queue state) and does not invent new decision keys.

Known limits, found while seeding (not patched here):

- `decision_definition` has seven rows: the migrations ship only the seven MVP keys.
- `worker_queue_state` accepts only `outbox-relay` and `job-queue`, so it has two rows.
- Migration `20261001000041_workflow_automation.sql` checks `automation_execution.idempotency_key` with a regex repetition of `{8,256}`. PostgreSQL rejects counts above 255, so the seed leaves that column null. A new migration is needed to fix it.
- `import_batch.target_entity` allows only `LEAD` or `CUSTOMER`, so lender statement imports are recorded with `CUSTOMER`.
- Audit rows are written unsealed (`hash` null); the sealing job fills them in production.
- `retention_policy` allows one policy per data class per tenant, and there are six classes, so each demo tenant has six rows.
- `tenant_offboarding` rows belong to the pilot tenants (the demo tenants are not offboarding), so each demo tenant has none; the table still has eight rows.
- Some flow-derived tables (for example `role_permission`, `checklist_item`, `customer_contact_point`) hold more than ten rows because each lead, application and document creates children.
