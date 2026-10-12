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
