# Fix plan: day-by-day schedule

**Source:** `docs/FIX_PLAN_2026-11-06.md`. Items, owners, approvals and done-when come from the plan. This page adds the calendar, the order, and the checks that the order passes.
**Day 0:** Fri 6 Nov 2026 (today). **Day 1:** Mon 9 Nov 2026. Working days are Monday to Friday.
**Status:** Draft. Nothing has started. Tick a box when its done-when is met and its approval is recorded.

## 1. Calendar

| Week | Days | Dates | Focus |
|---|---|---|---|
| Week 1 | 0 to 5 | Fri 6 Nov to Fri 13 Nov 2026 | Decisions, containment (C-01), P0 security (SEC-01, SEC-02, SEC-04), stash backups |
| Week 2 | 6 to 10 | Mon 16 Nov to Fri 20 Nov 2026 | Key rotations (SEC-06), backups (OPS-06), CI-03 and CI-04, PR A, SEC-03 starts |
| Week 3 | 11 to 15 | Mon 23 Nov to Fri 27 Nov 2026 | PR C, SEC-05, SEC-08, CI-05, OPS-04 step 1, C-03 complete, format freeze (CI-01) |
| Week 4 | 16 to 20 | Mon 30 Nov to Fri 4 Dec 2026 | Financial controls FIN-01 to FIN-05, SEC-07 closes, OPS-03 starts |
| Week 5 | 21 to 25 | Mon 7 Dec to Fri 11 Dec 2026 | Messaging adapters start (FEAT-01), CI-07 and CI-08, TST-01, FIN-06 to FIN-11 |
| Week 6 | 26 to 30 | Mon 14 Dec to Fri 18 Dec 2026 | Partner sessions, storage and ClamAV, consent OTP (FEAT-02), OPS-05 done |
| Week 7 | 31 to 35 | Mon 21 Dec to Fri 25 Dec 2026 | Public route decision (D-12), FEAT-07 to FEAT-10, OPS-01 step 1; 25 Dec is a buffer |
| Week 8 | 36 to 40 | Mon 28 Dec to Fri 1 Jan 2027 | OPS-03 done and MFA flag, retention, browser checks, gate review; 1 Jan is a buffer |
| Week 9 | 41 | Mon 4 Jan 2027 | OPS-10: redeploy Render and Vercel, smoke tests |

## 2. Read first: risks and gaps found while scheduling

1. **Keep deploys off until OPS-10.** SEC-02 and SEC-05 make the API refuse to start without their new variables. If the release branch deploys before OPS-01 is complete, production stops at startup. Render auto-deploy was paused earlier in this project; confirm it is still paused before the first merge on day 3.
2. **D-03 can move SEC-02.** If any of the five secret variables is unset in Render, the plan requires SEC-03 first. SEC-03 is scheduled for days 10 to 14, so SEC-02 would move to after it, and every later date moves with it. Ops answers on day 1.
3. **OPS-04 is P0 but the plan puts it before go-live.** VITE_TEST_BYPASS_OTP is an access risk in production. The schedule runs the variable removal and bundle check on day 14, after SEC-08. The production-branch switch and rebuild stay at OPS-10. A-OPS should confirm this split.
4. **OPS-01 needs OPS-03 for the MFA flag.** Section 11 of the plan says SUPABASE_MFA_ENABLED is set after OPS-03, but OPS-01 does not list OPS-03 as a dependency. The schedule splits OPS-01: day 33 for the other variables, day 36 for the MFA flag. Add OPS-03 to the plan's dependency column.
5. **D-01 and C-03.** The recommended D-01 option makes `main` the release branch after `beta` is merged into it. That merge is not an item in the plan, and the C-03 PRs merge to the release branch. Decide on day 1 which branch PR B targets. If `main`, add the merge as a Phase 0 step before PR B merges on day 3.
6. **Gate condition 11 needs D-09.** D-09 is the decision to defer the session endpoints. It is recorded on day 38, so every decision D-01 to D-16 is recorded before the go-live review on day 39.
7. **Four FIN-12 decisions and the FIN-10 verification are not in the D list.** They are scheduled on days 25 and 26 as decisions. Add them to plan section 3.
8. **PR C has two working days of review.** It is opened on day 11 and merged on day 14, with PR D. The plan expects it to exceed 400 lines. The A-DEV exception should name a second reviewer.
9. **Phase windows.** The plan puts Phase 1 in week 1. SEC-02 and SEC-01 finish in week 1. SEC-06 rotations run to day 8 because they depend on external holders. Phase 0 says days 1 and 2, but C-03 runs to day 14.
10. **Densest days.** Day 2 starts six items and finishes two, and days 2 to 5 need the security owner, the developer lead and the finance developer in parallel. If one person covers all the security work, keep this order: C-01, PR B, SEC-01, SEC-02, SEC-04, then SEC-06 (inventory first; rotations run alongside).
11. **FEAT-01 needs sandbox accounts** for the chosen providers. They are not an item in the plan. The owner confirms them on day 20.
12. **Calendar.** Days 36 to 41 fall between 28 Dec and 4 Jan. The go-live gate (day 39) and the redeploy (day 41) land in the holiday period. Local public holidays move dates; keep the order.
13. **HK-02 says "after Phases 1 to 4".** FEAT-04, FEAT-12 and FEAT-13 finish after go-live, so the known-gaps refresh lists them as open.

## 3. Decision gates

| Day | Date | Decision | Owner | Recommended (from plan) | Needed for |
|---|---|---|---|---|---|
| 1 | 2026-11-09 | D-01: Release branch and Vercel production branch | Developer lead, with Ops | Match `CLAUDE.md`: `main` as the release branch, after `beta` is merged into it | OPS-04, OPS-10 |
| 1 | 2026-11-09 | D-02: How to commit the 2026-11-04 work | Developer lead | Four PRs, A to D (split in section 7, under C-03) | C-03 |
| 1 | 2026-11-09 | D-03: Are the five secret variables set in Render today? | Ops | Ops reads the dashboard for names only. | SEC-02, SEC-03 |
| 1 | 2026-11-09 | D-04: E-mail account binding in production | A-SEC | Off by default in production | SEC-04 |
| 1 | 2026-11-09 | D-15: Commission plan `PATCH` with `status` | A-FIN | Refuse every `status` in `PATCH`. | SEC-01 |
| 1 | 2026-11-09 | D-16: Deleting backup branches and the teammate's stash | Developer lead, the teammate | Delete only with written approval, after a patch backup | HK-05, C-02 |
| 5 | 2026-11-13 | D-05: Step-up and separation-of-duties rules for the finance changes | A-FIN, A-SEC | Step-up for every money-changing operation. Second approver for period close, invoice void and connector activation | FIN-02 to FIN-08 |
| 5 | 2026-11-13 | D-07: Consent OTP delivery design. The code is stored only as a hash, so a consumer alone cannot send it | A-COMP, A-SEC | (b) send after the transaction commits, from the request, and invalidate the code if sending fails | FEAT-02 |
| 10 | 2026-11-20 | D-06: Messaging vendors | A-PROD, A-SEC | Reuse the existing Twilio adapter for SMS and WhatsApp; choose an e-mail provider | FEAT-01 |
| 25 | 2026-12-11 | D-14: Partner upload session: contract change and ownership | A-PROD, partner integrators, A-CON | Partner session creates real intents, with per-file metadata, under a deprecation shim | FEAT-03 |
| 26 | 2026-12-14 | D-08: Document storage provider | A-OPS, A-SEC | Supabase Storage S3 endpoint, if its keys can be scoped to one bucket and kept apart from the service-role key | FEAT-07 |
| 26 | 2026-12-14 | D-10: Where the staff invitation sender runs | A-OPS | A Render background worker, declared in `render.yaml` | FEAT-06 |
| 27 | 2026-12-15 | D-11: Where ClamAV runs | A-OPS | A Render private service in the same region as the API | FEAT-09 |
| 31 | 2026-12-21 | D-12: Public upload route and sharing path | A-SEC, A-PROD | Keep closed until FEAT-07, FEAT-09 and FEAT-10 are done | FEAT-10, FEAT-12, TST-02 |
| 34 | 2026-12-24 | D-13: Retention for quarantined files and for the quarantine copies of promoted files | A-COMP | none marked in the plan | FEAT-11 |
| 38 | 2026-12-30 | D-09: Session endpoints (`GET` and `DELETE /v1/me/sessions`). The rule that the API never holds the service-role key conflicts with the provider's admin interface | A-SEC | defer until the auth design is agreed | FEAT-04 |

## 4. Day by day

### Day 0: Fri 6 Nov 2026. Start

Circulate this plan and the decision list (D-01 to D-16). Developer lead backs up both stashes outside the repository and records SHA-256 (C-02). Ops lists the names, not the values, of the secret variables set in Render (input to D-03).

- [ ] **C-02** Back up both stashes outside the repository, with SHA-256. Ask the teammate about stash 1. Owner: Developer lead. Approval: None for the backup. A-DEV and teammate for any drop. Due Mon 9 Nov 2026. Done when: Two patch files saved, hashes recorded, decision recorded.

### Day 1: Mon 9 Nov 2026. Decisions and pre-checks

Decision meeting for D-01, D-02, D-03, D-04, D-15 and D-16. Hosted DB owner runs the read-only pre-checks for C-01 and C-04.

- [ ] **Decision D-01:** Release branch and Vercel production branch. Owner: Developer lead, with Ops. Recommended: Match `CLAUDE.md`: `main` as the release branch, after `beta` is merged into it.
- [ ] **Decision D-02:** How to commit the 2026-11-04 work. Owner: Developer lead. Recommended: Four PRs, A to D (split in section 7, under C-03).
- [ ] **Decision D-03:** Are the five secret variables set in Render today? Owner: Ops. Recommended: Ops reads the dashboard for names only.
- [ ] **Decision D-04:** E-mail account binding in production. Owner: A-SEC. Recommended: Off by default in production.
- [ ] **Decision D-15:** Commission plan `PATCH` with `status`. Owner: A-FIN. Recommended: Refuse every `status` in `PATCH`.
- [ ] **Decision D-16:** Deleting backup branches and the teammate's stash. Owner: Developer lead, the teammate. Recommended: Delete only with written approval, after a patch backup.
- [ ] **C-01** Connector containment on hosted: one connector login still holds an open RM assignment. Run the pre-check, export the evidence, decide on suspension, end the assignment. Owner: Hosted DB owner, security. Approval: A-SEC and A-OPS, in writing. Due Tue 10 Nov 2026. Done when: Post-check: open connector-login role assignments = 0, `role.assignment_ended` recorded = 1, history kept (see details).
- [ ] **C-04** Confirm the state of migrations 0097 to 0102 on hosted with a read-only check, and update `docs/CONNECTOR_HOSTED_DEPLOYMENT_CHECKLIST.md` lines 21 to 34, which are stale. Owner: Hosted DB owner. Approval: A-OPS. Due Tue 10 Nov 2026. Done when: Checklist matches the database.
- [ ] **C-02** finish and close, due today. Done when: Two patch files saved, hashes recorded, decision recorded.

### Day 2: Tue 10 Nov 2026. Containment and P0 starts

Security owner records the written approval for C-01. Hosted DB owner then executes it (hosted write; A-SEC and A-OPS). Open PR B. Start SEC-02 and SEC-04. Start the key-holder inventory for SEC-06. Fix the lint error (CI-02). Ops starts OPS-02 (where the origination files and sharing rows live). Six items start today and two finish (C-01, C-04): the densest day (see section 2).

- [ ] **C-03** Split the uncommitted 2026-11-04 work into PRs A to D, and merge each after its gate passes. Owner: Developer lead. Approval: A-DEV, and the affected owners. Due Thu 26 Nov 2026. Done when: Four PRs merged to the release branch named under D-01, each gate green (see details). Note: Listed under Phase 0 (days 1 and 2) in the plan, but the four PR merges run to day 14. Order: B, A, C, D.
- [ ] **SEC-02** Required secrets in production, and removal of the five literal fallbacks (audit 3.1). Owner: Security owner, with the module owners. Approval: A-SEC. Due Thu 12 Nov 2026. Done when: Production refuses to start without the five variables, or with a short value; no literal remains in the source. Note: Conditional on D-03. If any of the five variables is unset, SEC-03 must come first, and this item moves about five working days later. Merging it must not trigger a deploy before OPS-10.
- [ ] **SEC-04** Account binding by e-mail: off in production; read-only list of existing bindings (audit 3.3). Owner: Security owner, Identity owner. Approval: A-SEC. Due Thu 12 Nov 2026. Done when: Default off in production; the list has been reviewed; a test covers the default.
- [ ] **SEC-06** Rotate the gateway acknowledgement key (AUD-P0-03). Rotation is at each external holder first, then the environment (see details). Owner: Security owner. Approval: A-SEC, plus each external holder. Due Wed 18 Nov 2026. Done when: Inventory signed; rotation done at each holder; new value set in the environment; date recorded; no value recorded. Note: Rotations depend on external holders, so the end date may move.
- [ ] **CI-02** Fix the lint error in `e2e/helpers/mock-session.ts`, line 1247 (`no-empty`). Owner: QA owner. Approval: A-DEV. Done when: `npm run lint` reports 0 errors.
- [ ] **OPS-02** Confirm where the 13 origination files and the 2 sharing rows live. If on the instance disk, copy them out first. Owner: Ops. Approval: A-OPS. Due Wed 11 Nov 2026. Done when: Location recorded; copies verified by SHA-256.
- [ ] **C-01** finish and close, due today. Done when: Post-check: open connector-login role assignments = 0, `role.assignment_ended` recorded = 1, history kept (see details).
- [ ] **C-04** finish and close, due today. Done when: Checklist matches the database.

### Day 3: Wed 11 Nov 2026. P0 security

Merge PR B (C-03). SEC-01: write the failing regression tests first. Correct the stale startup warning (CI-09). Finish OPS-02 with SHA-256 checks. Continue SEC-02 and SEC-04. Start the ledger reconciliation plan (OPS-05).

- [ ] **SEC-01** Commission plan approval bypass: `PATCH` accepts `status` and writes it; the edit path does not check status (audit 3.2). Owner: Finance module owner (Dev 5). Approval: A-FIN, A-CON. Due Fri 13 Nov 2026. Done when: Tests pass: `PATCH` with any `status` is refused; `ACTIVE` is reachable only through approval; an edit to a non-`DRAFT` plan is refused. Note: Needs A-CON as well as A-FIN, because it changes packages/contracts. Add the Contracts section 15 change-log line.
- [ ] **CI-09** Correct the stale startup warning in `apps/api/src/server.ts` (line 101). It says uploads get the signature check only; they are now refused without ClamAV. Owner: Dev 1. Approval: A-DEV. Done when: Warning matches the behaviour, and a test or review confirms it.
- [ ] **OPS-05** Migration ledger reconciliation, following section 11 of `docs/HOSTED_DEPLOYMENT_COMPLETION_REPORT.md`. No `db push` until it is done. Owner: Hosted DB owner. Approval: A-OPS, A-SEC. Due Fri 18 Dec 2026. Done when: Plan approved; ledger matches the applied migrations. Note: Starts day 3 and blocks OPS-09 and any further hosted migration.
- [ ] **OPS-02** finish and close, due today. Done when: Location recorded; copies verified by SHA-256.
- In progress: C-03, SEC-02, SEC-04, SEC-06.

### Day 4: Thu 12 Nov 2026. P0 security

Merge SEC-02 and SEC-04 after review. Open the SEC-01 implementation PR. Start the payout check against bank statements (OPS-07). Start the external key rotations (SEC-06): each holder first, then the environment.

- [ ] **OPS-07** Payout check: payouts marked `PAYMENT_RECORDED` with a `CMS` reference, against bank statements (R1 in the completion report). Owner: Finance. Approval: A-FIN. Due Mon 16 Nov 2026. Done when: Result recorded; unmatched items escalated.
- [ ] **SEC-02** finish and close, due today. Done when: Production refuses to start without the five variables, or with a short value; no literal remains in the source.
- [ ] **SEC-04** finish and close, due today. Done when: Default off in production; the list has been reviewed; a test covers the default.
- In progress: C-03, SEC-01, SEC-06, OPS-05.

### Day 5: Fri 13 Nov 2026. P0 security, week 1 review

Merge SEC-01 with A-FIN and A-CON approval. Decision meeting for D-05 (finance and separation-of-duties rules) and D-07 (consent OTP design). Week 1 review against section 14 of the plan.

- [ ] **Decision D-05:** Step-up and separation-of-duties rules for the finance changes. Owner: A-FIN, A-SEC. Recommended: Step-up for every money-changing operation. Second approver for period close, invoice void and connector activation.
- [ ] **Decision D-07:** Consent OTP delivery design. The code is stored only as a hash, so a consumer alone cannot send it. Owner: A-COMP, A-SEC. Recommended: (b) send after the transaction commits, from the request, and invalidate the code if sending fails.
- [ ] **SEC-01** finish and close, due today. Done when: Tests pass: `PATCH` with any `status` is refused; `ACTIVE` is reachable only through approval; an edit to a non-`DRAFT` plan is refused.
- In progress: C-03, SEC-06, OPS-05, OPS-07.

### Day 6: Mon 16 Nov 2026. Week 2

Finish OPS-07 (payout check). Start OPS-06 (backups: encrypt both dumps, restrict folder access, restore test). Continue SEC-06 rotations.

- [ ] **OPS-06** Backups: encrypt both dumps, restrict folder access, add the `auth` schema, restore-test in a Supabase scratch project. Owner: Ops. Approval: A-OPS. Due Wed 18 Nov 2026. Done when: Restore test passes; encrypted copies verified. Note: Not dependent on anything. Scheduled early because it is cheap and protects every later hosted change.
- [ ] **OPS-07** finish and close, due today. Done when: Result recorded; unmatched items escalated.
- In progress: C-03, SEC-06, OPS-05.

### Day 7: Tue 17 Nov 2026. Week 2

Open PR A (financial step-up gate) for A-FIN and A-SEC review. Start CI-03 (static schema defaults, with A-CON approval). Continue OPS-06.

- [ ] **CI-03** Make schema defaults deterministic: replace `default(() => new Date()…)` in `packages/contracts/src/commission.ts` (line 93) and `payouts.ts` (line 88) with static defaults, or remove them. Owner: Contracts owners. Approval: A-CON. Due Wed 18 Nov 2026. Done when: `npm run gen:openapi` run twice gives no diff.
- In progress: C-03, SEC-06, OPS-05, OPS-06.

### Day 8: Wed 18 Nov 2026. Week 2

Finish CI-03. Start and finish CI-04 (register GET /portal/v1/eligibility in the OpenAPI document). Finish the SEC-06 rotations and record the dates, not the values. Finish OPS-06: encrypted copies verified and restore test passed.

- [ ] **CI-04** Register `GET /portal/v1/eligibility` in the portal OpenAPI paths (`apps/api/src/modules/finance/connector-portal.ts`, line 100). Owner: Portal owner (Dev 5). Approval: A-DEV. Done when: Regeneration keeps the path.
- [ ] **SEC-06** finish and close, due today. Done when: Inventory signed; rotation done at each holder; new value set in the environment; date recorded; no value recorded.
- [ ] **CI-03** finish and close, due today. Done when: `npm run gen:openapi` run twice gives no diff.
- [ ] **OPS-06** finish and close, due today. Done when: Restore test passes; encrypted copies verified.
- In progress: C-03, OPS-05.

### Day 9: Thu 19 Nov 2026. Week 2

PR A in review. Prepare PR C (quarantine and fail-closed scanner) and its test plan.

- In progress: C-03, OPS-05.
- No new tasks today.

### Day 10: Fri 20 Nov 2026. Week 2 review

Merge PR A. Decision meeting for D-06 (messaging vendors). Start SEC-03 (re-hash plan: design and a dry run on a copy; no hosted write). Week 2 review.

- [ ] **Decision D-06:** Messaging vendors. Owner: A-PROD, A-SEC. Recommended: Reuse the existing Twilio adapter for SMS and WhatsApp; choose an e-mail provider.
- [ ] **SEC-03** Re-hash plan for mobile numbers and loan account numbers: design and dry run only (audit 3.1). Owner: Dev, security. Approval: A-SEC to approve the plan. A-OPS and A-SEC for any run. Due Thu 26 Nov 2026. Done when: Plan approved; dry run on a copy reports counts; no hosted write.
- In progress: C-03, OPS-05.

### Day 11: Mon 23 Nov 2026. Week 3

Open PR C with the size exception from A-DEV (it will exceed 400 lines). Continue OPS-05 (ledger reconciliation).

- In progress: C-03, SEC-03, OPS-05.
- No new tasks today.

### Day 12: Tue 24 Nov 2026. Week 3

Start SEC-05 (upload-session secret moves to the environment), SEC-08 (test-login code out of the production bundle) and CI-05 (document the 13 mounted but undocumented routes). PR C in review.

- [ ] **SEC-05** Move the upload-session secret out of the source (`document-sharing-service.ts`, line 30). The route is closed, so this is hygiene for when it reopens (audit 3.1, containment 4). Owner: Documents owner (Dev 3). Approval: A-SEC. Due Wed 25 Nov 2026. Done when: Production refuses to start without the new variable; no literal remains; a session round-trip test passes.
- [ ] **CI-05** Document the 13 mounted but undocumented routes (audit 5.1). Owner: Module owners. Approval: A-DEV. Due Wed 25 Nov 2026. Done when: The OpenAPI document lists all 13; the contract job is green.
- [ ] **SEC-08** Keep test-login code out of the production bundle: `apps/web/src/auth/test-auth.ts` and the three call sites (audit 5.3). Owner: Web owner (Dev 1). Approval: A-DEV. Due Wed 25 Nov 2026. Done when: Production bundle contains no `/public/v1/auth/test-login` and no `VITE_TEST_BYPASS_OTP` (checked by grep).
- In progress: C-03, SEC-03, OPS-05.

### Day 13: Wed 25 Nov 2026. Week 3

Finish SEC-05, SEC-08 and CI-05. PR C review fixes applied.

- [ ] **SEC-05** finish and close, due today. Done when: Production refuses to start without the new variable; no literal remains; a session round-trip test passes.
- [ ] **CI-05** finish and close, due today. Done when: The OpenAPI document lists all 13; the contract job is green.
- [ ] **SEC-08** finish and close, due today. Done when: Production bundle contains no `/public/v1/auth/test-login` and no `VITE_TEST_BYPASS_OTP` (checked by grep).
- In progress: C-03, SEC-03, OPS-05.

### Day 14: Thu 26 Nov 2026. Week 3

Merge PR C, then PR D (documentation). C-03 is complete. Start SEC-07 (dependency upgrades as separate PRs) and CI-06 (isolation cases). Finish the SEC-03 design and dry run. OPS-04 step 1: remove VITE_TEST_BYPASS_OTP from Vercel and check the production bundle. The production-branch switch waits for OPS-10.

- [ ] **CI-06** Add isolation cases for routes the sweep does not reach: lender-case responses (two), platform tenant flags (two), leads assignments list. Update `tests/isolation/sweep-map.ts` where a path parameter is new. Owner: Dev 1 (isolation). Approval: A-DEV. Due Mon 30 Nov 2026. Done when: Cases pass; the sweep covers the routes.
- [ ] **SEC-07** Upgrade vulnerable production dependencies (audit 3.4). Done as separate PRs: 07a express chain (`body-parser`, `qs`), 07b `kysely`, 07c `zod` (touches contracts; needs A-CON), 07d `react-router` (web), 07e `fflate` (archive job). Owner: Dev. Approval: A-DEV, plus A-CON for 07c. Due Fri 4 Dec 2026. Done when: `npm audit --omit=dev --audit-level=high` clean, or accepted in writing; full unit and integration suites pass; builds pass.
- [ ] **OPS-04** Vercel: production branch (D-01), remove `VITE_TEST_BYPASS_OTP` from the environment, rebuild from the release commit, check the bundle. Owner: Ops. Approval: A-OPS. Done when: Bundle check passes: no test strings, no `localhost`, no `service_role`. Note: Split in two. Day 14 removes VITE_TEST_BYPASS_OTP from Vercel and checks the production bundle (P0 access risk, so it does not wait for go-live). The production-branch switch and the rebuild from the release commit are repeated at OPS-10.
- [ ] **C-03** finish and close, due today. Done when: Four PRs merged to the release branch named under D-01, each gate green (see details).
- [ ] **SEC-03** finish and close, due today. Done when: Plan approved; dry run on a copy reports counts; no hosted write.
- In progress: OPS-05.

### Day 15: Fri 27 Nov 2026. Format freeze

Merge freeze for the day. Merge CI-01: one formatting PR with no logic change. Open PRs are rebased after it.

- [ ] **CI-01** Format the repository in one PR with no logic change (284 files: 214 under `apps/`, 30 under `docs/`, 23 under `e2e/`, 5 under `packages/`, the rest under `tools/`, `seeds/` and config). Owner: Developer lead. Approval: A-DEV. Done when: `npm run format:check` exits 0. Note: Format freeze on day 15. Open PRs must rebase after it.
- In progress: CI-06, SEC-07, OPS-05.

### Day 16: Mon 30 Nov 2026. Week 4: financial controls

Week 4 starts. Merge FIN-01 (commission calculation no longer accepts finance.view). Finish CI-06. OPS-05 continues.

- [ ] **FIN-01** Commission calculation: remove `finance.view` from the check (`finance-service.ts`, line 289). Owner: Finance (Dev 5). Approval: A-FIN. Done when: `finance.view` alone is refused; `commission.calculate` allowed.
- [ ] **CI-06** finish and close, due today. Done when: Cases pass; the sweep covers the routes.
- In progress: SEC-07, OPS-05.

### Day 17: Tue 1 Dec 2026. Week 4

Start FIN-02 (new permission ledger.account_manage, with a migration in the owner range, applied locally only).

- [ ] **FIN-02** Ledger account management: new permission `ledger.account_manage` (migration in the owner's range, catalogue entry, role grants) and step-up on creation. Today `finance.view` creates accounts (`ledger-service.ts`, lines 113 and 114). Owner: Ledger owner. Approval: A-FIN, A-SEC. Due Thu 3 Dec 2026. Done when: Migration applied locally; `permission-catalogue.spec` passes; creation needs the new permission and a step-up.
- In progress: SEC-07, OPS-05.

### Day 18: Wed 2 Dec 2026. Week 4

Start FIN-03 (period close: step-up, second approver, required reason). FIN-02 in progress.

- [ ] **FIN-03** Period close: step-up, a second approver, a required reason, and audit of both (`ledger-service.ts`, line 416). Owner: Ledger owner. Approval: A-FIN, A-SEC. Due Fri 4 Dec 2026. Done when: One approver cannot close alone; close needs step-up; reason required.
- In progress: FIN-02, SEC-07, OPS-05.

### Day 19: Thu 3 Dec 2026. Week 4

Start and merge FIN-04 (invoice pay and void). Merge FIN-02 after review.

- [ ] **FIN-04** Invoice pay and void: step-up. Void requires a user other than the issuer (`invoices/service.ts`, line 132). Owner: Finance. Approval: A-FIN. Done when: Tests cover both rules.
- [ ] **FIN-02** finish and close, due today. Done when: Migration applied locally; `permission-catalogue.spec` passes; creation needs the new permission and a step-up.
- In progress: FIN-03, SEC-07, OPS-05.

### Day 20: Fri 4 Dec 2026. Week 4 review

Merge FIN-03. Start FIN-05 (connector activation and status changes) and OPS-03 (MFA enrolment for users with MFA-required roles). Merge the last SEC-07 PR, which closes SEC-07. Owner confirms the sandbox accounts FEAT-01 needs. Week 4 review.

- [ ] **FIN-05** Connector activation: step-up, and the activator must differ from the user who recorded the verification. Connector status changes: step-up for suspend and terminate, and a reason. Owner: Connector owner. Approval: A-COMP, A-SEC. Due Tue 8 Dec 2026. Done when: Tests cover both rules.
- [ ] **OPS-03** MFA enrolment: 20 of 22 app users have no verified factor. Enrol the users who hold MFA-required roles, then set `SUPABASE_MFA_ENABLED=true`. Owner: Security owner, Ops. Approval: A-SEC. Due Mon 28 Dec 2026. Done when: Enrolment list complete; `mfaEnabled` true; a sign-in with step-up works. Note: Enrolment is done by users, so the end date depends on them.
- [ ] **FIN-03** finish and close, due today. Done when: One approver cannot close alone; close needs step-up; reason required.
- [ ] **SEC-07** finish and close, due today. Done when: `npm audit --omit=dev --audit-level=high` clean, or accepted in writing; full unit and integration suites pass; builds pass.
- In progress: OPS-05.

### Day 21: Mon 7 Dec 2026. Week 5: messaging and finance

Start FEAT-01 (messaging adapters behind configuration; reuse the Twilio adapter). Merge CI-07 (dependency audit blocking). Merge FIN-06 (recalculation proposals).

- [ ] **CI-07** Make `dependency-audit` blocking: remove `|| true` from `.github/workflows/ci.yml`. Owner: Dev 1. Approval: A-DEV. Done when: The job fails on a high advisory.
- [ ] **FIN-06** Recalculation proposals: permission changed to `adjustment.create` (`finance-service.ts`, line 521). Owner: Finance. Approval: A-FIN. Done when: Test: the plan editor alone cannot propose.
- [ ] **FEAT-01** Messaging channel adapters for e-mail, SMS and WhatsApp, behind configuration. Reuse the Twilio adapter (`modules/integrations/providers/twilio-adapter.ts`). Today every channel is `UnconfiguredAdapter` (audit 3.5). Owner: Messaging owner. Approval: A-PROD, A-SEC. Due Tue 15 Dec 2026. Done when: Sandbox send succeeds; a failure test passes; no real customer message is sent by any test. Note: Needs sandbox accounts for the chosen providers. That is not an item in the plan; the owner confirms it on day 20.
- In progress: FIN-05, OPS-03, OPS-05.

### Day 22: Tue 8 Dec 2026. Week 5

Finish FIN-05. Merge CI-08 (gitleaks allowlist, only for the rotated items). Start TST-01 (repair e2e specs 17 and 18). Merge FIN-07 (ledger export step-up).

- [ ] **CI-08** Gitleaks allowlist for the known history commits, only after SEC-05 and SEC-06. Owner: Security owner. Approval: A-SEC. Done when: `secrets` job green; the allowlist names only the rotated items.
- [ ] **FIN-07** Ledger export: step-up. Owner: Ledger and reporting owner. Approval: A-SEC. Done when: Test: export needs step-up.
- [ ] **TST-01** Repair e2e specs 17 and 18: `/v1/leads/:id/actions/*` no longer exists. Map to `/transitions`, or retire the steps. Owner: QA owner. Approval: A-DEV. Due Thu 10 Dec 2026. Done when: Both suites pass against the local stack.
- [ ] **FIN-05** finish and close, due today. Done when: Tests cover both rules.
- In progress: FEAT-01, OPS-03, OPS-05.

### Day 23: Wed 9 Dec 2026. Week 5

Start FIN-08 (connector agreements: step-up and separation of duties for scope changes).

- [ ] **FIN-08** Connector agreements: step-up, and separation of duties for scope changes. Owner: Connector owner. Approval: A-COMP. Due Thu 10 Dec 2026. Done when: Tests.
- In progress: FEAT-01, OPS-03, OPS-05, TST-01.

### Day 24: Thu 10 Dec 2026. Week 5

Finish FIN-08. Merge FIN-09 (portal user access grants: step-up). Finish TST-01.

- [ ] **FIN-09** Portal user access grants: step-up. Owner: Connector owner. Approval: A-SEC. Done when: Test.
- [ ] **FIN-08** finish and close, due today. Done when: Tests.
- [ ] **TST-01** finish and close, due today. Done when: Both suites pass against the local stack.
- In progress: FEAT-01, OPS-03, OPS-05.

### Day 25: Fri 11 Dec 2026. Week 5 review

Decision meeting for D-14 (partner upload session contract). Merge FIN-10 (verification note on the lender statement match) and FIN-11 (clawback approval test). Week 5 review.

- [ ] **Decision D-14:** Partner upload session: contract change and ownership. Owner: A-PROD, partner integrators, A-CON. Recommended: Partner session creates real intents, with per-file metadata, under a deprecation shim.
- [ ] **FIN-10** Lender statement match: verify whether it settles payables. Gate it if it does. Owner: Reconciliation owner. Approval: A-FIN. Done when: Verification note recorded; gate and test added if needed. Note: The plan lists "Verification" as the dependency. That verification is not an item, so it is scheduled as a note on day 25.
- [ ] **FIN-11** Clawback approval: test that the creator cannot approve. Owner: Finance. Approval: A-FIN. Done when: Test added.
- In progress: FEAT-01, OPS-03, OPS-05.

### Day 26: Mon 14 Dec 2026. Week 6: partner, storage, decisions

Start FEAT-03 (partner upload sessions, under the D-14 shim). Record the FIN-12 decisions: AUD-P1-02, -06, -07 and -10 (A-FIN, A-COMP). Decision meeting for D-08 (storage provider) and D-10 (where the invitation worker runs).

- [ ] **Decision D-08:** Document storage provider. Owner: A-OPS, A-SEC. Recommended: Supabase Storage S3 endpoint, if its keys can be scoped to one bucket and kept apart from the service-role key.
- [ ] **Decision D-10:** Where the staff invitation sender runs. Owner: A-OPS. Recommended: A Render background worker, declared in `render.yaml`.
- [ ] **FIN-12** Open connector P1 decisions: AUD-P1-02 (approved bank accounts for payouts), AUD-P1-06 (source of the rate card), AUD-P1-07 (verification options A to D), AUD-P1-10 (evidence needed to mark a payment paid). Owner: Finance, Compliance. Approval: A-FIN, A-COMP. Done when: Each decision recorded, and each follow-up scheduled. Note: Four decisions (AUD-P1-02, -06, -07, -10) are not in the D list. Recorded on day 26. Add them to plan section 3.
- [ ] **FEAT-03** Partner upload session: persist the session, take per-file metadata, create real upload intents, and return a URL that works (audit 3.5, `docs/DOCUMENT_UPLOAD_CONTROLS.md` section 6). Owner: Partner API owner, Documents owner. Approval: A-PROD, A-CON. Due Wed 23 Dec 2026. Done when: End-to-end test: the URL from the session completes an upload. Contract change shipped with a deprecation shim.
- In progress: FEAT-01, OPS-03, OPS-05.

### Day 27: Tue 15 Dec 2026. Week 6

Finish FEAT-01 after the sandbox send and the failure test pass. Start FEAT-06 (staff invitation sender, D-10). Start FIN-13 (connector P2 items). Record D-11 (where ClamAV runs).

- [ ] **Decision D-11:** Where ClamAV runs. Owner: A-OPS. Recommended: A Render private service in the same region as the API.
- [ ] **FIN-13** Connector P2 items AUD-P2-02 to 06 (see `docs/CONNECTOR_AUDIT_REMEDIATION_PLAN.md`). Owner: Connector owner. Approval: Per item. Due Thu 24 Dec 2026. Done when: Per the plan's acceptance tests.
- [ ] **FEAT-06** Staff invitation sender in production (audit 5.7). Owner: Dev 1, Ops. Approval: A-OPS. Due Wed 16 Dec 2026. Done when: Invitation sent in staging; runbook written.
- [ ] **FEAT-01** finish and close, due today. Done when: Sandbox send succeeds; a failure test passes; no real customer message is sent by any test.
- In progress: FEAT-03, OPS-03, OPS-05.

### Day 28: Wed 16 Dec 2026. Week 6

Start FEAT-02 (consent OTP, option (b) from D-07; needs FEAT-01). Start FEAT-07 (S3 document storage, D-08). Finish FEAT-06.

- [ ] **FEAT-02** Consent OTP delivery (AUD-P1-01), following the design chosen under D-07. Owner: Dev 5 (consent), messaging owner. Approval: A-COMP, A-PROD, A-SEC. Due Fri 18 Dec 2026. Done when: Test: the code reaches a messaging double; the code is never in an event, a log or a response.
- [ ] **FEAT-07** S3 document storage: private bucket, scoped keys, `DOCUMENT_STORE=s3`. Test against a MinIO container. Owner: Documents owner. Approval: A-SEC, A-OPS. Due Mon 21 Dec 2026. Done when: Round-trip test passes; cutover runbook approved.
- [ ] **FEAT-06** finish and close, due today. Done when: Invitation sent in staging; runbook written.
- In progress: FIN-13, FEAT-03, OPS-03, OPS-05.

### Day 29: Thu 17 Dec 2026. Week 6

Start FEAT-09 (ClamAV service, health check, EICAR test; D-11).

- [ ] **FEAT-09** ClamAV service: provisioning, health checks, and an EICAR integration test. Owner: Ops, Documents owner. Approval: A-OPS. Due Tue 22 Dec 2026. Done when: EICAR returns `INFECTED` in an integration test; a stopped clamd returns 503.
- In progress: FIN-13, FEAT-02, FEAT-03, FEAT-07, OPS-03, OPS-05.

### Day 30: Fri 18 Dec 2026. Week 6 review

Finish FEAT-02. Record CI-10 (e2e in CI: yes or no). Merge TST-05 (skipped live-database suites visible). Merge HK-03 (root files moved). Delete backup branches only with written approval and after the C-02 backup (HK-05). Finish OPS-05 once the ledger matches the applied migrations. Week 6 review.

- [ ] **CI-10** Decide whether e2e and UI suites run in CI (both are commented out in `ci.yml`). Owner: QA owner. Approval: A-DEV. Done when: Decision recorded.
- [ ] **TST-05** Make the skipped live-database suites visible in the default run. They skip silently unless `DATABASE_URL` is set. Owner: Dev. Approval: A-DEV. Done when: Summary lists the skipped suites.
- [ ] **HK-03** Move the root-level testing report, the workbook and `check_status.cjs` under `docs/` and `tools/`. Owner: Dev. Approval: A-DEV. Done when: Root is clean.
- [ ] **HK-05** Delete the nine backup branches and the stale branch `d1/TASK-102-supabase-auth`. Owner: Developer lead. Approval: A-DEV, and written approval. Done when: Branches gone; list recorded.
- [ ] **FEAT-02** finish and close, due today. Done when: Test: the code reaches a messaging double; the code is never in an event, a log or a response.
- [ ] **OPS-05** finish and close, due today. Done when: Plan approved; ledger matches the applied migrations.
- In progress: FIN-13, FEAT-03, FEAT-07, FEAT-09, OPS-03.

### Day 31: Mon 21 Dec 2026. Week 7: public route decision

Record D-12 (public upload route and sharing path). Recommended: keep it closed until FEAT-07, FEAT-09 and FEAT-10 are done. Finish FEAT-07 (S3 round trip test; cutover runbook approved).

- [ ] **Decision D-12:** Public upload route and sharing path. Owner: A-SEC, A-PROD. Recommended: Keep closed until FEAT-07, FEAT-09 and FEAT-10 are done.
- [ ] **FEAT-07** finish and close, due today. Done when: Round-trip test passes; cutover runbook approved.
- In progress: FIN-13, FEAT-03, FEAT-09, OPS-03.

### Day 32: Tue 22 Dec 2026. Week 7

Start FEAT-08 (quarantine location; DOCUMENT_QUARANTINE_DIR). Start TST-02 (e2e specs 14 and 16 match D-12). Finish FEAT-09 (EICAR returns INFECTED; a stopped clamd returns 503).

- [ ] **FEAT-08** Private quarantine location (a separate S3 prefix, or a private disk). Add `DOCUMENT_QUARANTINE_DIR` to the configuration schema. Owner: Documents owner. Approval: A-SEC. Done when: Configuration test; bucket policy reviewed.
- [ ] **TST-02** e2e specs 14 and 16 use the closed upload route. Expect 503, or move them to the document-uploads flow. Owner: QA owner. Approval: A-DEV. Done when: Suites match the decision.
- [ ] **FEAT-09** finish and close, due today. Done when: EICAR returns `INFECTED` in an integration test; a stopped clamd returns 503.
- In progress: FIN-13, FEAT-03, OPS-03.

### Day 33: Wed 23 Dec 2026. Week 7

Finish FEAT-03 (end-to-end test: the session URL completes an upload). Start FEAT-10 (sharing path, D-12). OPS-01 step 1: set the Render variables except SUPABASE_MFA_ENABLED. Merge HK-01 (CLAUDE.md dangling reference).

- [ ] **FEAT-10** Sharing path wired to the configured backends, or kept closed. Owner: Documents owner. Approval: A-SEC. Due Thu 24 Dec 2026. Done when: Tests, or the closure recorded as the decision.
- [ ] **OPS-01** Render production variables: `DOCUMENT_STORE`, `SUPABASE_MFA_ENABLED` (after OPS-03), the storage and ClamAV variables, `IDENTITY_EMAIL_FALLBACK`, and the five secret variables. Confirm `DISABLE_MFA` and `TEST_AUTH_ENABLED` are absent. Owner: Ops. Approval: A-OPS. Done when: Names recorded, values checked without printing them, `/public/v1/auth/config` and `/health` confirmed. Note: Split in two. Day 33 sets all variables except SUPABASE_MFA_ENABLED. The MFA flag is set on day 36, after OPS-03. The plan does not list OPS-03 as a dependency; add it.
- [ ] **HK-01** `CLAUDE.md` refers to `docs/DEFERRED_MODULES_TRACKING.md`, which does not exist. Create it, or remove the reference. Owner: Dev 1. Approval: A-DEV. Done when: No dangling reference.
- [ ] **FEAT-03** finish and close, due today. Done when: End-to-end test: the URL from the session completes an upload. Contract change shipped with a deprecation shim.
- In progress: FIN-13, OPS-03.

### Day 34: Thu 24 Dec 2026. Week 7

Finish FEAT-10 and FIN-13. Record D-13 (retention for quarantined files; compliance).

- [ ] **Decision D-13:** Retention for quarantined files and for the quarantine copies of promoted files. Owner: A-COMP. Recommended: none marked in the plan.
- [ ] **FIN-13** finish and close, due today. Done when: Per the plan's acceptance tests.
- [ ] **FEAT-10** finish and close, due today. Done when: Tests, or the closure recorded as the decision.
- In progress: OPS-03.

### Day 35: Fri 25 Dec 2026. Buffer

Fri 25 Dec 2026 is a buffer day. No planned tasks.

### Day 36: Mon 28 Dec 2026. Week 8: go-live readiness

Finish OPS-03 when the enrolment list is complete, mfaEnabled is true and a step-up sign-in works. Then OPS-01 step 2: set SUPABASE_MFA_ENABLED=true. Start FEAT-05 (database types), FEAT-11 (retention and purge; D-13), TST-03 (Playwright on a schedule) and TST-04 (browser checklist).

- [ ] **FEAT-05** Database types generated from the migrations into `packages/contracts/src/db.ts`, which is empty today. Owner: Dev 1. Approval: A-DEV. Due Tue 29 Dec 2026. Done when: Generated types used by the typecheck.
- [ ] **FEAT-11** Retention for quarantine copies and promoted copies: a delete operation in the store interface, and a purge job. Owner: Documents owner. Approval: A-COMP. Due Tue 29 Dec 2026. Done when: Purge test; retention written down.
- [ ] **TST-03** Run Playwright e2e on a schedule. Owner: QA owner. Approval: A-DEV. Due Tue 29 Dec 2026. Done when: Nightly run recorded. Note: Needs the CI-10 decision (day 30). The first nightly run is recorded by day 37.
- [ ] **TST-04** Browser checklist in `docs/CONNECTOR_AUDIT_REMEDIATION_PLAN.md`, section 10. Owner: QA owner. Approval: A-DEV. Due Tue 29 Dec 2026. Done when: Checklist signed.
- [ ] **OPS-03** finish and close, due today. Done when: Enrolment list complete; `mfaEnabled` true; a sign-in with step-up works.

### Day 37: Tue 29 Dec 2026. Week 8

Finish FEAT-05, FEAT-11, TST-03 (first nightly run recorded) and TST-04 (checklist signed). Run OPS-09 (stale-intent sweep; read-only count first).

- [ ] **OPS-09** One-time sweep of stale `UPLOADED` intents from before the quarantine change. Read-only count first. Owner: Ops. Approval: A-OPS. Done when: Count recorded; sweep approved and recorded.
- [ ] **FEAT-05** finish and close, due today. Done when: Generated types used by the typecheck.
- [ ] **FEAT-11** finish and close, due today. Done when: Purge test; retention written down.
- [ ] **TST-03** finish and close, due today. Done when: Nightly run recorded.
- [ ] **TST-04** finish and close, due today. Done when: Checklist signed.

### Day 38: Wed 30 Dec 2026. Week 8: gate inputs

Run OPS-08 (post-fix read-only check: test-login route absent, MFA state, variables as set). Finish HK-02 (refresh CLAUDE.md known gaps; FEAT-04, FEAT-12 and FEAT-13 listed as open) and HK-04 (reconcile MFA statements). Record D-09 as deferred so that gate condition 11 can be met.

- [ ] **Decision D-09:** Session endpoints (`GET` and `DELETE /v1/me/sessions`). The rule that the API never holds the service-role key conflicts with the provider's admin interface. Owner: A-SEC. Recommended: defer until the auth design is agreed.
- [ ] **OPS-08** Post-fix read-only check of production: test-login route absent, MFA state, variables as set. Owner: Ops. Approval: A-OPS. Done when: Checklist recorded.
- [ ] **HK-02** Refresh the "Known gaps" section of `CLAUDE.md`, last updated 2026-10-21. Owner: Dev 1. Approval: A-DEV. Done when: Matches the audit. Note: The plan says "after Phases 1 to 4". FEAT-04, FEAT-12 and FEAT-13 finish after go-live, so the refresh lists them as open.
- [ ] **HK-04** Reconcile the contradictory MFA statements in `docs/DSA_FINAL_RELEASE_READINESS.md`. Owner: Dev. Approval: A-SEC. Done when: One statement.

### Day 39: Thu 31 Dec 2026. Go-live gate review

Review section 14 of the plan: every P0 and P1 item is Done or Accepted risk; CI is green; decisions D-01 to D-16 are recorded. No new tasks.

- No new tasks today.

### Day 40: Fri 1 Jan 2027. Buffer

Fri 1 Jan 2027 is a buffer day. No planned tasks.

### Day 41: Mon 4 Jan 2027. Redeploy

OPS-10: redeploy Render and Vercel from the release commit, using the production branch from D-01. Then smoke tests: health, auth config, sign-in, one upload path.

- [ ] **OPS-10** Redeploy Render and Vercel from the release commit, then smoke test: health, auth config, sign-in, one upload path. Owner: Ops, Developer lead. Approval: A-OPS, A-DEV. Done when: Smoke tests recorded.

## 5. After go-live and ongoing

- [ ] **FEAT-04** Session endpoints `GET` and `DELETE /v1/me/sessions` (API-AUTH-005 and 006). Scheduled: after go-live. Approval: A-SEC. After go-live (P2). Waits for D-09, which is recorded as deferred on day 38.
- [ ] **FEAT-12** Reopen `/public/v1/upload/:token`, only if D-12 says so. Follow section 8.4 of the containment report. Scheduled: after go-live. Approval: A-SEC. After go-live (P2: required before the next release after go-live). Depends on D-12 keeping the route closed until FEAT-07, FEAT-09 and FEAT-10 are done.
- [ ] **FEAT-13** Move or rename `/v1/portal/connectors/:id/statements`, which is served under `/v1` (audit 5.3). Scheduled: after go-live. Approval: A-PROD. After go-live (P3).
- [ ] **TST-06** Each regression test named in this plan exists and passes in CI. Scheduled: ongoing. Approval: none.
- [ ] **HK-06** Update the audit report as items close. Scheduled: ongoing. Approval: none.

## 6. Item index

| ID | Item | Priority | Size | Owner | When | Approval | Done when |
|---|---|---|---|---|---|---|---|
| C-01 | Connector containment on hosted: one connector login still holds an open RM assignment. Run the pre-check, export the evidence, decide on suspension, end the assignment | P0 | S | Hosted DB owner, security | days 1 to 2 (2026-11-09 to 2026-11-10) | A-SEC and A-OPS, in writing | Post-check: open connector-login role assignments = 0, `role.assignment_ended` recorded = 1, history kept (see details) |
| C-02 | Back up both stashes outside the repository, with SHA-256. Ask the teammate about stash 1 | P0 | S | Developer lead | days 0 to 1 (2026-11-06 to 2026-11-09) | None for the backup. A-DEV and teammate for any drop | Two patch files saved, hashes recorded, decision recorded |
| C-03 | Split the uncommitted 2026-11-04 work into PRs A to D, and merge each after its gate passes | P0 | M | Developer lead | days 2 to 14 (2026-11-10 to 2026-11-26) | A-DEV, and the affected owners | Four PRs merged to the release branch named under D-01, each gate green (see details) |
| C-04 | Confirm the state of migrations 0097 to 0102 on hosted with a read-only check, and update `docs/CONNECTOR_HOSTED_DEPLOYMENT_CHECKLIST.md` lines 21 to 34, which are stale | P1 | S | Hosted DB owner | days 1 to 2 (2026-11-09 to 2026-11-10) | A-OPS | Checklist matches the database |
| SEC-01 | Commission plan approval bypass: `PATCH` accepts `status` and writes it; the edit path does not check status (audit 3.2) | P0 | M | Finance module owner (Dev 5) | days 3 to 5 (2026-11-11 to 2026-11-13) | A-FIN, A-CON | Tests pass: `PATCH` with any `status` is refused; `ACTIVE` is reachable only through approval; an edit to a non-`DRAFT` plan is refused |
| SEC-02 | Required secrets in production, and removal of the five literal fallbacks (audit 3.1) | P0 | M | Security owner, with the module owners | days 2 to 4 (2026-11-10 to 2026-11-12) | A-SEC | Production refuses to start without the five variables, or with a short value; no literal remains in the source |
| SEC-03 | Re-hash plan for mobile numbers and loan account numbers: design and dry run only (audit 3.1) | P1 | M | Dev, security | days 10 to 14 (2026-11-20 to 2026-11-26) | A-SEC to approve the plan. A-OPS and A-SEC for any run | Plan approved; dry run on a copy reports counts; no hosted write |
| SEC-04 | Account binding by e-mail: off in production; read-only list of existing bindings (audit 3.3) | P0 | S | Security owner, Identity owner | days 2 to 4 (2026-11-10 to 2026-11-12) | A-SEC | Default off in production; the list has been reviewed; a test covers the default |
| SEC-05 | Move the upload-session secret out of the source (`document-sharing-service.ts`, line 30). The route is closed, so this is hygiene for when it reopens (audit 3.1, containment 4) | P1 | S | Documents owner (Dev 3) | days 12 to 13 (2026-11-24 to 2026-11-25) | A-SEC | Production refuses to start without the new variable; no literal remains; a session round-trip test passes |
| SEC-06 | Rotate the gateway acknowledgement key (AUD-P0-03). Rotation is at each external holder first, then the environment (see details) | P0 | S | Security owner | days 2 to 8 (2026-11-10 to 2026-11-18) | A-SEC, plus each external holder | Inventory signed; rotation done at each holder; new value set in the environment; date recorded; no value recorded |
| CI-01 | Format the repository in one PR with no logic change (284 files: 214 under `apps/`, 30 under `docs/`, 23 under `e2e/`, 5 under `packages/`, the rest under `tools/`, `seeds/` and config) | P1 | S | Developer lead | day 15 (2026-11-27) | A-DEV | `npm run format:check` exits 0 |
| CI-02 | Fix the lint error in `e2e/helpers/mock-session.ts`, line 1247 (`no-empty`) | P1 | S | QA owner | day 2 (2026-11-10) | A-DEV | `npm run lint` reports 0 errors |
| CI-03 | Make schema defaults deterministic: replace `default(() => new Date()…)` in `packages/contracts/src/commission.ts` (line 93) and `payouts.ts` (line 88) with static defaults, or remove them | P1 | S | Contracts owners | days 7 to 8 (2026-11-17 to 2026-11-18) | A-CON | `npm run gen:openapi` run twice gives no diff |
| CI-04 | Register `GET /portal/v1/eligibility` in the portal OpenAPI paths (`apps/api/src/modules/finance/connector-portal.ts`, line 100) | P1 | S | Portal owner (Dev 5) | day 8 (2026-11-18) | A-DEV | Regeneration keeps the path |
| CI-05 | Document the 13 mounted but undocumented routes (audit 5.1) | P1 | M | Module owners | days 12 to 13 (2026-11-24 to 2026-11-25) | A-DEV | The OpenAPI document lists all 13; the contract job is green |
| CI-06 | Add isolation cases for routes the sweep does not reach: lender-case responses (two), platform tenant flags (two), leads assignments list. Update `tests/isolation/sweep-map.ts` where a path parameter is new | P1 | M | Dev 1 (isolation) | days 14 to 16 (2026-11-26 to 2026-11-30) | A-DEV | Cases pass; the sweep covers the routes |
| CI-07 | Make `dependency-audit` blocking: remove `\|\| true` from `.github/workflows/ci.yml` | P2 | S | Dev 1 | day 21 (2026-12-07) | A-DEV | The job fails on a high advisory |
| CI-08 | Gitleaks allowlist for the known history commits, only after SEC-05 and SEC-06 | P2 | S | Security owner | day 22 (2026-12-08) | A-SEC | `secrets` job green; the allowlist names only the rotated items |
| CI-09 | Correct the stale startup warning in `apps/api/src/server.ts` (line 101). It says uploads get the signature check only; they are now refused without ClamAV | P1 | S | Dev 1 | day 3 (2026-11-11) | A-DEV | Warning matches the behaviour, and a test or review confirms it |
| CI-10 | Decide whether e2e and UI suites run in CI (both are commented out in `ci.yml`) | P3 | S | QA owner | day 30 (2026-12-18) | A-DEV | Decision recorded |
| FIN-01 | Commission calculation: remove `finance.view` from the check (`finance-service.ts`, line 289) | P1 | S | Finance (Dev 5) | day 16 (2026-11-30) | A-FIN | `finance.view` alone is refused; `commission.calculate` allowed |
| FIN-02 | Ledger account management: new permission `ledger.account_manage` (migration in the owner's range, catalogue entry, role grants) and step-up on creation. Today `finance.view` creates accounts (`ledger-service.ts`, lines 113 and 114) | P1 | M | Ledger owner | days 17 to 19 (2026-12-01 to 2026-12-03) | A-FIN, A-SEC | Migration applied locally; `permission-catalogue.spec` passes; creation needs the new permission and a step-up |
| FIN-03 | Period close: step-up, a second approver, a required reason, and audit of both (`ledger-service.ts`, line 416) | P1 | M | Ledger owner | days 18 to 20 (2026-12-02 to 2026-12-04) | A-FIN, A-SEC | One approver cannot close alone; close needs step-up; reason required |
| FIN-04 | Invoice pay and void: step-up. Void requires a user other than the issuer (`invoices/service.ts`, line 132) | P1 | S | Finance | day 19 (2026-12-03) | A-FIN | Tests cover both rules |
| FIN-05 | Connector activation: step-up, and the activator must differ from the user who recorded the verification. Connector status changes: step-up for suspend and terminate, and a reason | P1 | M | Connector owner | days 20 to 22 (2026-12-04 to 2026-12-08) | A-COMP, A-SEC | Tests cover both rules |
| FIN-06 | Recalculation proposals: permission changed to `adjustment.create` (`finance-service.ts`, line 521) | P2 | S | Finance | day 21 (2026-12-07) | A-FIN | Test: the plan editor alone cannot propose |
| FIN-07 | Ledger export: step-up | P2 | S | Ledger and reporting owner | day 22 (2026-12-08) | A-SEC | Test: export needs step-up |
| FIN-08 | Connector agreements: step-up, and separation of duties for scope changes | P2 | M | Connector owner | days 23 to 24 (2026-12-09 to 2026-12-10) | A-COMP | Tests |
| FIN-09 | Portal user access grants: step-up | P2 | S | Connector owner | day 24 (2026-12-10) | A-SEC | Test |
| FIN-10 | Lender statement match: verify whether it settles payables. Gate it if it does | P2 | S | Reconciliation owner | day 25 (2026-12-11) | A-FIN | Verification note recorded; gate and test added if needed |
| FIN-11 | Clawback approval: test that the creator cannot approve | P2 | S | Finance | day 25 (2026-12-11) | A-FIN | Test added |
| FIN-12 | Open connector P1 decisions: AUD-P1-02 (approved bank accounts for payouts), AUD-P1-06 (source of the rate card), AUD-P1-07 (verification options A to D), AUD-P1-10 (evidence needed to mark a payment paid) | P1 | M | Finance, Compliance | day 26 (2026-12-14) | A-FIN, A-COMP | Each decision recorded, and each follow-up scheduled |
| FIN-13 | Connector P2 items AUD-P2-02 to 06 (see `docs/CONNECTOR_AUDIT_REMEDIATION_PLAN.md`) | P2 | L | Connector owner | days 27 to 34 (2026-12-15 to 2026-12-24) | Per item | Per the plan's acceptance tests |
| SEC-07 | Upgrade vulnerable production dependencies (audit 3.4). Done as separate PRs: 07a express chain (`body-parser`, `qs`), 07b `kysely`, 07c `zod` (touches contracts; needs A-CON), 07d `react-router` (web), 07e `fflate` (archive job) | P1 | M | Dev | days 14 to 20 (2026-11-26 to 2026-12-04) | A-DEV, plus A-CON for 07c | `npm audit --omit=dev --audit-level=high` clean, or accepted in writing; full unit and integration suites pass; builds pass |
| SEC-08 | Keep test-login code out of the production bundle: `apps/web/src/auth/test-auth.ts` and the three call sites (audit 5.3) | P1 | S | Web owner (Dev 1) | days 12 to 13 (2026-11-24 to 2026-11-25) | A-DEV | Production bundle contains no `/public/v1/auth/test-login` and no `VITE_TEST_BYPASS_OTP` (checked by grep) |
| FEAT-01 | Messaging channel adapters for e-mail, SMS and WhatsApp, behind configuration. Reuse the Twilio adapter (`modules/integrations/providers/twilio-adapter.ts`). Today every channel is `UnconfiguredAdapter` (audit 3.5) | P1 | L | Messaging owner | days 21 to 27 (2026-12-07 to 2026-12-15) | A-PROD, A-SEC | Sandbox send succeeds; a failure test passes; no real customer message is sent by any test |
| FEAT-02 | Consent OTP delivery (AUD-P1-01), following the design chosen under D-07 | P1 | M | Dev 5 (consent), messaging owner | days 28 to 30 (2026-12-16 to 2026-12-18) | A-COMP, A-PROD, A-SEC | Test: the code reaches a messaging double; the code is never in an event, a log or a response |
| FEAT-03 | Partner upload session: persist the session, take per-file metadata, create real upload intents, and return a URL that works (audit 3.5, `docs/DOCUMENT_UPLOAD_CONTROLS.md` section 6) | P1 | L | Partner API owner, Documents owner | days 26 to 33 (2026-12-14 to 2026-12-23) | A-PROD, A-CON | End-to-end test: the URL from the session completes an upload. Contract change shipped with a deprecation shim |
| FEAT-04 | Session endpoints `GET` and `DELETE /v1/me/sessions` (API-AUTH-005 and 006) | P2 | M | Auth owner | after go-live | A-SEC | Design approved; tests |
| FEAT-05 | Database types generated from the migrations into `packages/contracts/src/db.ts`, which is empty today | P2 | M | Dev 1 | days 36 to 37 (2026-12-28 to 2026-12-29) | A-DEV | Generated types used by the typecheck |
| FEAT-06 | Staff invitation sender in production (audit 5.7) | P1 | S | Dev 1, Ops | days 27 to 28 (2026-12-15 to 2026-12-16) | A-OPS | Invitation sent in staging; runbook written |
| FEAT-07 | S3 document storage: private bucket, scoped keys, `DOCUMENT_STORE=s3`. Test against a MinIO container | P1 | M | Documents owner | days 28 to 31 (2026-12-16 to 2026-12-21) | A-SEC, A-OPS | Round-trip test passes; cutover runbook approved |
| FEAT-08 | Private quarantine location (a separate S3 prefix, or a private disk). Add `DOCUMENT_QUARANTINE_DIR` to the configuration schema | P1 | S | Documents owner | day 32 (2026-12-22) | A-SEC | Configuration test; bucket policy reviewed |
| FEAT-09 | ClamAV service: provisioning, health checks, and an EICAR integration test | P1 | M | Ops, Documents owner | days 29 to 32 (2026-12-17 to 2026-12-22) | A-OPS | EICAR returns `INFECTED` in an integration test; a stopped clamd returns 503 |
| FEAT-10 | Sharing path wired to the configured backends, or kept closed | P2 | M | Documents owner | days 33 to 34 (2026-12-23 to 2026-12-24) | A-SEC | Tests, or the closure recorded as the decision |
| FEAT-11 | Retention for quarantine copies and promoted copies: a delete operation in the store interface, and a purge job | P2 | M | Documents owner | days 36 to 37 (2026-12-28 to 2026-12-29) | A-COMP | Purge test; retention written down |
| FEAT-12 | Reopen `/public/v1/upload/:token`, only if D-12 says so. Follow section 8.4 of the containment report | P2 | M | Documents owner | after go-live | A-SEC | Containment test removed, and the reopening checklist complete |
| FEAT-13 | Move or rename `/v1/portal/connectors/:id/statements`, which is served under `/v1` (audit 5.3) | P3 | S | Dev | after go-live | A-PROD | Decision recorded |
| OPS-01 | Render production variables: `DOCUMENT_STORE`, `SUPABASE_MFA_ENABLED` (after OPS-03), the storage and ClamAV variables, `IDENTITY_EMAIL_FALLBACK`, and the five secret variables. Confirm `DISABLE_MFA` and `TEST_AUTH_ENABLED` are absent | P0 | S | Ops | day 33 (2026-12-23) | A-OPS | Names recorded, values checked without printing them, `/public/v1/auth/config` and `/health` confirmed |
| OPS-02 | Confirm where the 13 origination files and the 2 sharing rows live. If on the instance disk, copy them out first | P0 | S | Ops | days 2 to 3 (2026-11-10 to 2026-11-11) | A-OPS | Location recorded; copies verified by SHA-256 |
| OPS-03 | MFA enrolment: 20 of 22 app users have no verified factor. Enrol the users who hold MFA-required roles, then set `SUPABASE_MFA_ENABLED=true` | P0 | M | Security owner, Ops | days 20 to 36 (2026-12-04 to 2026-12-28) | A-SEC | Enrolment list complete; `mfaEnabled` true; a sign-in with step-up works |
| OPS-04 | Vercel: production branch (D-01), remove `VITE_TEST_BYPASS_OTP` from the environment, rebuild from the release commit, check the bundle | P0 | S | Ops | day 14 (2026-11-26) | A-OPS | Bundle check passes: no test strings, no `localhost`, no `service_role` |
| OPS-05 | Migration ledger reconciliation, following section 11 of `docs/HOSTED_DEPLOYMENT_COMPLETION_REPORT.md`. No `db push` until it is done | P0 | L | Hosted DB owner | days 3 to 30 (2026-11-11 to 2026-12-18) | A-OPS, A-SEC | Plan approved; ledger matches the applied migrations |
| OPS-06 | Backups: encrypt both dumps, restrict folder access, add the `auth` schema, restore-test in a Supabase scratch project | P1 | M | Ops | days 6 to 8 (2026-11-16 to 2026-11-18) | A-OPS | Restore test passes; encrypted copies verified |
| OPS-07 | Payout check: payouts marked `PAYMENT_RECORDED` with a `CMS` reference, against bank statements (R1 in the completion report) | P1 | S | Finance | days 4 to 6 (2026-11-12 to 2026-11-16) | A-FIN | Result recorded; unmatched items escalated |
| OPS-08 | Post-fix read-only check of production: test-login route absent, MFA state, variables as set | P1 | S | Ops | day 38 (2026-12-30) | A-OPS | Checklist recorded |
| OPS-09 | One-time sweep of stale `UPLOADED` intents from before the quarantine change. Read-only count first | P2 | S | Ops | day 37 (2026-12-29) | A-OPS | Count recorded; sweep approved and recorded |
| OPS-10 | Redeploy Render and Vercel from the release commit, then smoke test: health, auth config, sign-in, one upload path | P0 | S | Ops, Developer lead | day 41 (2027-01-04) | A-OPS, A-DEV | Smoke tests recorded |
| TST-01 | Repair e2e specs 17 and 18: `/v1/leads/:id/actions/*` no longer exists. Map to `/transitions`, or retire the steps | P1 | M | QA owner | days 22 to 24 (2026-12-08 to 2026-12-10) | A-DEV | Both suites pass against the local stack |
| TST-02 | e2e specs 14 and 16 use the closed upload route. Expect 503, or move them to the document-uploads flow | P1 | S | QA owner | day 32 (2026-12-22) | A-DEV | Suites match the decision |
| TST-03 | Run Playwright e2e on a schedule | P2 | M | QA owner | days 36 to 37 (2026-12-28 to 2026-12-29) | A-DEV | Nightly run recorded |
| TST-04 | Browser checklist in `docs/CONNECTOR_AUDIT_REMEDIATION_PLAN.md`, section 10 | P2 | M | QA owner | days 36 to 37 (2026-12-28 to 2026-12-29) | A-DEV | Checklist signed |
| TST-05 | Make the skipped live-database suites visible in the default run. They skip silently unless `DATABASE_URL` is set | P3 | S | Dev | day 30 (2026-12-18) | A-DEV | Summary lists the skipped suites |
| TST-06 | Each regression test named in this plan exists and passes in CI | Ongoing |  | Each owner | ongoing |  | Per item |
| HK-01 | `CLAUDE.md` refers to `docs/DEFERRED_MODULES_TRACKING.md`, which does not exist. Create it, or remove the reference | P2 | S | Dev 1 | day 33 (2026-12-23) | A-DEV | No dangling reference |
| HK-02 | Refresh the "Known gaps" section of `CLAUDE.md`, last updated 2026-10-21 | P2 | S | Dev 1 | day 38 (2026-12-30) | A-DEV | Matches the audit |
| HK-03 | Move the root-level testing report, the workbook and `check_status.cjs` under `docs/` and `tools/` | P3 | S | Dev | day 30 (2026-12-18) | A-DEV | Root is clean |
| HK-04 | Reconcile the contradictory MFA statements in `docs/DSA_FINAL_RELEASE_READINESS.md` | P3 | S | Dev | day 38 (2026-12-30) | A-SEC | One statement |
| HK-05 | Delete the nine backup branches and the stale branch `d1/TASK-102-supabase-auth` | P3 | S | Developer lead | day 30 (2026-12-18) | A-DEV, and written approval | Branches gone; list recorded |
| HK-06 | Update the audit report as items close | Ongoing |  | Dev | ongoing |  | Audit reflects the state |

## 7. Verification gate for every code PR

From section 4.1 of the plan. Attach the results to each PR.

- `npm run typecheck`
- `npm run lint` (no new errors)
- `npm run format:check` (after CI-01)
- `npx vitest run` in `apps/api`, and in `apps/web` if web changed
- `npm run test:int`, through the guarded config, if the database path changed
- `npm run test:isolation` if a route changed
- `npm run gen:openapi`, then `git diff --exit-code -- openapi/`, if a route or contract changed
- `npm run build -w @dsa/api` and `npm run build:web` for release-bound PRs

## 8. How to use this in Notion

- Create a page and import this file (Import, then Markdown and CSV). The checkboxes become to-do items.
- Import `docs/notion/FIX_PLAN_TASKS_2026-11-06.csv` as a database. Use the Status column as the tracker, and filter by Owner, Phase or Type.
- Owners are roles. Names are recorded by the owners. Hosted writes, key rotations, MFA changes and deploys each need written approval in the same thread, as the plan says.

