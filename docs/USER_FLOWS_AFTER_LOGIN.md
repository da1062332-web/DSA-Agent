# Qloax DSA Platform: user flows after login

Written from the code as it is on `beta` (2026-10-24). Each section says what the app does, then what a person in that role does day to day. The per-role menus are taken from `shell/access.ts` and the permission grants in `shell/role-grants.fixture.ts` (the live `qloax-dsa` tenant, read 2026-10-19).

---

## 1. The path every user takes

1. **Sign in** at `/login` with email and password (Supabase).
2. **Second factor.** If the account has an authenticator app, the app asks for the 6-digit code (`/mfa`). If the account must have one and does not, it opens the set-up page (`/mfa?enrol=true`).
3. **Profile load.** The app reads `/v1/me` for the user's roles and permissions. Until it has them, it shows a spinner.
4. **Home.** `/` shows the screen for the user's role (section 3). If the user has more than one role, a switcher appears at the top.
5. **Work.** The sidebar shows only the screens that user's permissions allow. A screen typed into the address bar that the user may not open shows a "Forbidden" page. The API checks every action again on its own side.

Sign-out clears the session, the cached data and the page, then returns to `/login`.

---

## 2. Sign in and second factor (what happens in the code)

| Step | What happens | Where |
|---|---|---|
| Type email and password, press Sign in | Supabase `signInWithPassword`. Times out after 15 seconds. | `auth/LoginPage.tsx` |
| Wrong password | "Invalid email or password." | same |
| Password accepted | The app stores the email as "pending" and opens the code box. | same |
| Enter 6-digit code | Checks the authenticator factor, then goes to the page the user came from. | same |
| No authenticator yet | Set-up page with a QR code and a key. | `auth/MfaPage.tsx` |
| Forgot password | Email with a one-time link. The confirmation says the same thing whether or not the email exists. | `auth/PasswordPages.tsx` |
| Reset link opened | Set a new password, then go to sign-in. | same |

**Important:** if the password check fails, the login page also tries a **test login** at `/public/v1/auth/test-login` with a fixed code (default `000000`). See section 6, item 1.

---

## 3. Who sees what

Fourteen roles exist in the tenant. Thirteen are assigned to the test users below. The fourteenth, `ROLE-VERIFIER`, has permissions but no test user and no dashboard (see section 6).

### 3.1 Live test users (`@qloax.com`)

| Person | Login | Role(s) | Home screen |
|---|---|---|---|
| Asha Admin | admin@qloax.com | Org Owner + Tenant Admin | Admin dashboard |
| Omkar Owner | owner@qloax.com | Org Owner | Admin dashboard |
| Bhavna Branch Mgr | branchmgr@qloax.com | Branch Manager | Manager dashboard |
| Tarun Team Mgr | teammgr@qloax.com | Team Manager | Manager dashboard |
| Riya RM | rm@qloax.com | Relationship Manager | RM dashboard |
| Sameer Sales | sales@qloax.com | Sales Executive | Sales dashboard |
| Lata Loan Ops | loanops@qloax.com | Loan Operations | Loan Ops dashboard |
| Vikram Verifier | verifier@qloax.com | Document Verifier | Verifier dashboard |
| Chetan Compliance | compliance@qloax.com | Compliance Officer | Compliance dashboard |
| Farhan Finance | finance@qloax.com | Finance Executive | Finance dashboard |
| Charu Commission | commission@qloax.com | Commission Approver | Finance dashboard |
| Rekha Rule Author | ruleauthor@qloax.com | Rule Author | Rule engine dashboard (author) |
| Ravi Rule Approver | ruleapprover@qloax.com | Rule Approver | Rule engine dashboard (approver) |

If a user holds several roles, the switcher lets them change between dashboards.

---

## 4. Each role, step by step

Each block gives the purpose in one line, the day-to-day flow, and the menu the role sees.

### 4.1 Sales Executive (Sameer Sales)
**Purpose:** find and work new leads.
**Flow:**
1. Dashboard shows new inbound leads, leads awaiting first contact, follow-ups, and urgent tasks.
2. Open **Leads**, then a lead. Record each call or visit under **Activity** (outcome, duration, note).
3. Move the lead to *In progress*, then *Qualified* when it passes the checks. The sales role can qualify and disqualify, but cannot convert or assign.
4. A qualified lead goes to the RM (converted by the RM, section 4.4).
5. Log messages under **Messaging**. Consent and quiet hours are checked.

**Menu:** Home, Tasks, Activity, Notifications · Leads, Customers, Messaging · Lenders, Products · Workforce · Privacy and consent, Security.

### 4.2 Branch Manager (Bhavna Branch Mgr)
**Purpose:** run the branch: allocate leads, watch the pipeline, approve disbursements.
**Flow:**
1. Dashboard: unassigned inbound leads, team queue backlog, branch originations, sanctioned volume.
2. **Leads**: assign leads to sales officers (the branch manager can assign; sales cannot).
3. **Applications** and **Lender cases**: follow files through to sanction and disbursement.
4. **Sanction and disbursement**: record tranches and verify them. Creator cannot verify their own record (dual control).
5. **Users**: manage staff accounts for the branch. **Workforce**: check capacity.
6. Review **Commission**, **Payouts** and **Reconciliation** for the branch.

**Menu:** Home, Tasks, Approvals, Activity, Notifications · Leads, Customers, Messaging · Applications, Documents, Document sharing, Verifications, Lender cases, Sanctions, Eligibility, Lenders, Products · Commission, Payouts, Ledger, Invoices, Reconciliation · Connectors, Workforce, Connector portal · Automation, Users, Access control, Privacy, Security, Integrations, API management, Import/export.

### 4.3 Team Manager (Tarun Team Mgr)
**Purpose:** lead a sales team and keep its files moving.
**Flow:**
1. Dashboard: team queue backlog and team tasks.
2. Watch the team's leads and applications; help move stuck files.
3. Check **Workforce** capacity before allocating more work.
4. Cannot manage users or change configuration.

**Menu:** Home, Tasks, Activity, Notifications · Leads, Customers, Messaging · Applications, Documents, Lender cases, Eligibility, Lenders, Products · Workforce · Privacy, Security.

### 4.4 Relationship Manager (Riya RM)
**Purpose:** own the customer relationship and take files to sanction.
**Flow:**
1. Dashboard: qualified leads ready to convert, active origination files, pipeline value.
2. Open a qualified lead and **convert** it to an application.
3. Collect documents (checklist on the application). Request verification.
4. Follow the lender case until sanction. Use **Eligibility** to check the file against product rules.
5. Track the customer's consent under **Privacy and consent**.

**Menu:** Home, Tasks, Activity, Notifications · Leads, Customers, Messaging · Applications, Documents, Verifications, Verification workbench, Lender cases, Eligibility, Lenders, Products · Workforce · Privacy, Security.

### 4.5 Loan Operations (Lata Loan Ops)
**Purpose:** underwrite, submit to lenders, record sanctions and disbursements.
**Flow:**
1. Dashboard: applications in review, applications on hold, sanctioned files ready for tranche disbursal.
2. Work the **Applications** queue. Put files on hold with a reason, or release them.
3. Submit to a lender: **Lender cases**, then build the package, submit, and handle queries.
4. Record sanction and tranche disbursements under **Sanctions**.
5. Run **Automation** rules when they are needed.

**Menu:** Home, Tasks, Approvals, Activity, Notifications · Messaging · Applications, Documents, Document sharing, Verifications, Verification workbench, Lender cases, Sanctions, Eligibility, Lenders, Products · Connectors, Workforce, Connector portal · Automation, Security.

### 4.6 Document Verifier (Vikram Verifier)
**Purpose:** check each document and attest the verification.
**Flow:**
1. Dashboard: pending verifications, verified cases, rejected or discrepant cases, the priority queue.
2. Open **Verification workbench**. Review each document version: accept or reject with a reason.
3. Complete the verification. A verifier cannot upload or waive documents.
4. Rejected items go back to the customer or RM as a new version.

**Menu:** Home, Activity, Notifications · Applications, Documents, Verifications, Verification workbench, Lender cases, Eligibility, Lenders, Products · Workforce · Security.

### 4.7 Compliance Officer (Chetan Compliance)
**Purpose:** watch the audit trail, DPDP obligations and security incidents.
**Flow:**
1. Dashboard: open incidents, audit events, high-severity items, resolution rate.
2. **Security events and incidents**: record an incident, then move it through response to closure. Record the authority notice when personal data is involved.
3. **Audit**: search the immutable log and export evidence.
4. **Privacy and consent**: check consent records and data-sharing history.
5. Read-only on leads and applications.

**Menu:** Home, Activity, Notifications · Leads, Customers · Applications, Documents, Verifications, Verification workbench, Lender cases, Eligibility, Lenders, Products · Workforce · Audit, Privacy, Security events, Security.

### 4.8 Finance Executive (Farhan Finance)
**Purpose:** keep the ledger and reconciliation right.
**Flow:**
1. Dashboard: awaiting approval, pending payout value, calculated commissions.
2. **Reconciliation**: match lender statements to commission lines, resolve variances, and raise disputes.
3. **Invoices**: create and manage invoices.
4. **Ledger**: check journals and periods.
5. Cannot change commission plans or approve payouts.

**Menu:** Home, Notifications · Lenders, Products · Commission, Payouts, Ledger, Invoices, Reconciliation · Workforce · Security.

### 4.9 Commission Approver (Charu Commission)
**Purpose:** approve commission adjustments and payout batches.
**Flow:**
1. Dashboard shares the finance view: payout batches waiting approval, ready for bank dispatch.
2. **Approvals**: approve or reject commission adjustments.
3. **Payouts**: approve batches. A second person must record the bank payment (dual control).
4. **Commission**: review calculated amounts and active plans.

**Menu:** Home, Approvals, Notifications · Lenders, Products · Commission, Payouts, Ledger, Invoices, Reconciliation · Workforce · Security.

### 4.10 Rule Author (Rekha Rule Author)
**Purpose:** write decision rules and the decision tables the platform runs.
**Flow:**
1. Dashboard: total rule sets, decision definitions, rule lifecycle.
2. **Rule sets**: create a new draft version, edit rules, run validation and test cases.
3. Submit the version for approval. Cannot approve their own version.
4. **Decisions**: read the decision records the engine produced.

**Menu:** Home, Notifications · Lenders, Products · Workforce · Rule sets, Decisions, Security.

### 4.11 Rule Approver (Ravi Rule Approver)
**Purpose:** approve or send back rule versions before they go live.
**Flow:**
1. Dashboard: rule versions waiting approval.
2. Open a version, check its rules, validation and simulations.
3. Approve, request changes, or reject with a comment. Approval is recorded.
4. Publish is done in line with the rules approval process.

**Menu:** Home, Notifications · Lenders, Products · Workforce · Rule sets, Decisions, Security.

### 4.12 Organisation Owner (Omkar Owner)
**Purpose:** run the whole organisation: configuration, people, branches, reports.
**Flow:**
1. Dashboard: operating branches, active staff, total originations, disbursed volume, pipeline.
2. **Organisation, Branches, Teams, Work queues, Configuration**: set up the business (SLAs, business hours, lead routing).
3. **Access control**: role and permission assignment. The owner can manage roles but not users (see section 6).
4. **Performance Dashboard, Targets, Leaderboard, Reports**: targets and reporting.
5. **Integrations, API management, Automation**: connect partners and run workflows.

**Menu:** everything in the tenant menu (see the Tenant Admin list below, with the same items).

### 4.13 Tenant Administrator (Asha Admin)
**Purpose:** administer the tenant: users, configuration, audit, integrations.
**Flow:**
1. Dashboard: same as the Org Owner.
2. **Users**: create and manage staff accounts and their roles.
3. **Configuration, Audit, Import/export**: change settings, review the audit trail, bulk-import leads or customers.
4. Work with **Grievances** when customers complain.

**Menu:** Home, Tasks, Approvals, Activity, Notifications · Leads, Customers, Messaging, Grievances · Applications, Documents, Document sharing, Verifications, Verification workbench, Lender cases, Sanctions, Eligibility, Lenders, Products · Invoices · Connectors, Workforce, Connector portal · Performance, Targets, Leaderboard, Reports · Automation, Users, Access control, Organisation, Branches, Teams, Work queues, Configuration, Audit, Privacy, Security events, Security, Integrations, API management, Import/export.

---

## 5. The whole business flow, hand to hand

1. **Capture:** Sales (or a connector) creates a lead. A duplicate check runs.
2. **Allocate:** Branch or Team Manager assigns the lead.
3. **Contact and qualify:** Sales logs calls, moves the lead to qualified.
4. **Convert:** RM converts the lead into an application and collects documents.
5. **Verify:** Document Verifier checks each document and completes the verification.
6. **Eligibility:** Loan Ops or RM runs the eligibility check.
7. **Submit to lender:** Loan Ops builds the lender package, submits, answers queries.
8. **Sanction and disburse:** Lender sanctions. Loan Ops records sanction and tranches; a second person verifies each tranche.
9. **Commission:** Finance calculates; Commission Approver approves; payouts are recorded.
10. **Reconcile and audit:** Finance matches lender statements; Compliance watches the audit trail and incidents throughout.

---

## 6. Problems found in the code (fix before production)

1. **Test login is always on.** `/public/v1/auth/test-login` has no environment check, its code defaults to `000000` (`apps/api/src/config.ts`), and it writes the code to the log in plain text (`public-auth-router.ts`, line 73). The web app also defaults `VITE_TEST_BYPASS_OTP` to `000000` (`apps/web/.env.local`). Anyone who knows an email can sign in as that user. **Must be switched off outside development.**
2. **Placeholder QR code.** `auth/MfaPage.tsx` has a fallback QR code and the key `SETTING-UP-KEY-000000`. If enrolment fails, the page can show that fake code. It should show an error instead.
3. **`ROLE-VERIFIER` has no dashboard.** It is in the grants fixture and the sidebar, but `RoleDashboardRouter` does not route it. Its users see the generic home page.
4. **Tenant Admin holds Platform Console permissions by mistake** (audit F-09). The app hides the console, but the grant should be removed in the database.
5. **Org Owner has `role.manage` without `user.manage`** (audit F-13). Intended per the audit; confirm.
6. **Dashboard fallback.** Any role the router does not know gets the generic home page without a warning.

---

## 7. How to test a flow yourself

1. Sign in as the user in section 3.1 (on a development build only).
2. Check the sidebar against section 4.
3. Open each screen the role should not see by typing its address. It should show "Forbidden".
4. Run the matching specs: `npm run --workspace @dsa/web test -- src/shell`.
