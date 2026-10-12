# Architecture decision records

Decisions made for the 4-day plan are recorded in Shared Technical Contracts §15. Add one file per decision here as `ADR-4D-nn-<slug>.md` or `ADR-SB-nn-<slug>.md` when a decision needs more than the table row.

| ID        | Decision                                                                                                                                                                          |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-4D-01 | Routing, first-contact task and checklist generation run synchronously in domain services in the request transaction. Outbox rows are written but not relayed.                    |
| ADR-4D-02 | No Redis or queue. Compiled-IR cache in memory; active-version resolution reads PostgreSQL every evaluation.                                                                      |
| ADR-4D-03 | `audit_event`, `decision_record`, `activity`, `outbox_event` not partitioned yet; decision idempotency uses `dedupe_registry`.                                                    |
| ADR-4D-04 | No S3-class data stored in the MVP (PAN, Aadhaar reference, DOB, UTR, loan account, bank details); the API rejects such fields.                                                   |
| ADR-4D-06 | Rule-set scope is a single dimension: `scope_type` + `scope_ref`.                                                                                                                 |
| ADR-4D-07 | Response shape follows Doc 11: bare resource with `ETag`; lists `{ data, meta }`; error envelope.                                                                                 |
| ADR-4D-08 | `lead.application_id` has no DB FK; it is validated through ApplicationPort.                                                                                                      |
| ADR-SB-01 | All business tables in schema `app`, not exposed to the Data API; no privileges for `anon`, `authenticated`, `public`.                                                            |
| ADR-SB-02 | Supabase Auth issues tokens; `app_metadata.tenant_id` carries the tenant (written only by the provisioning CLI); step-up = `aal2` + recent TOTP `amr`; Express verifies via JWKS. |
| ADR-SB-03 | API connects as `dsa_api` (NOBYPASSRLS) through Supavisor transaction mode; tenant set with `SET LOCAL` per transaction; never `postgres` or `service_role`.                      |
| ADR-SB-04 | Express is the only business layer; no Edge Functions, Realtime or Storage in the MVP.                                                                                            |
| ADR-SB-05 | Full-journey React UI in the 4 days.                                                                                                                                              |
