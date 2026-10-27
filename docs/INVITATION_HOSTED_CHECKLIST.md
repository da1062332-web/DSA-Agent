# Staff invitations: hosted checklist (Architecture B)

Status: **nothing here has been run against the hosted Supabase project.** No invitation has been sent, no setting has been changed, no user record has been bound, and migrations 0092 and 0093 have not been applied. Every step needs the owner's explicit approval first.

Written for: the platform owner, who approves each step, and the engineer who runs the approved steps.

Related: [INVITATION_ARCHITECTURE_DECISION.md](INVITATION_ARCHITECTURE_DECISION.md) (accepted decisions D1, D2, D4, D5), [HOSTED_SUPABASE_REMEDIATION_PLAN.md](HOSTED_SUPABASE_REMEDIATION_PLAN.md) (R3 and P0-3 for the key).

---

## 0. Before anything else

| # | Step | Why |
|---|---|---|
| H0 | Rotate the service-role key (P0-3, decision D3). | The current key is in public git history and valid until 2036. The worker must start with a key nobody else has. |
| H0b | Confirm the migration owner for M-092 and M-093 in `supabase/MANIFEST.md` (now "Dev 1 (owner to confirm)"). | Repository convention. |

## 1. Database: migrations 0092 and 0093

- `supabase/migrations/20261001000092_staff_invitations.sql`: the `staff_invitation` table, one PENDING invitation per user, row-level security, no DELETE grant.
- `supabase/migrations/20261001000093_staff_invitation_provisioning.sql`: delivery columns and `app.pending_staff_invitation_deliveries` (SYSTEM context only, returns ids).

Apply in that order, with approval. Read-only checks afterwards:

- `select relrowsecurity from pg_class where relname = 'staff_invitation';` → `true`
- `select privilege_type from information_schema.role_table_grants where table_name = 'staff_invitation' and grantee = 'dsa_app';` → SELECT, INSERT, UPDATE
- `select indexname from pg_indexes where tablename = 'staff_invitation';` → includes `staff_invitation_one_pending` and `staff_invitation_delivery_due`
- `select has_function_privilege('dsa_app', 'app.pending_staff_invitation_deliveries(integer, integer)', 'execute');` → `true`

Until both are applied, the API's invitation routes fail on the hosted database (the table does not exist). Apply them before deploying the API change.

## 2. Supabase Authentication settings

1. **URL Configuration:** record the current Site URL; add `<web origin>/accept-invitation` to Redirect URLs (`http://localhost:5173/accept-invitation` only if local testing against the hosted project is approved).
2. **Email:** choose SMTP (the built-in mailer is rate-limited and for testing). Sender name and address. Note the hourly e-mail limit under Rate Limits.
   **Templates (scanner-safe links).** Mail scanners (Gmail, Outlook, antivirus) open links before the person does, and the default `{{ .ConfirmationURL }}` link is single-use, so the person then sees "Invitation link expired" (`otp_expired`). Point the links at the app instead; the app uses the token only when the person presses Continue:
   - **Invite user:** `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=invite">Accept the invitation</a>`
   - **Reset password** (used by resends and by Forgot password): `<a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery">Choose your password</a>`
   Also check **Email OTP Expiration** (Authentication → Providers → Email): it is how long Supabase keeps the link valid (default 3600 seconds). The app's own 24-hour limit applies on top.
3. **Sign-ups:** turn off "Allow new users to sign up". The worker refuses to adopt an account with no tenant claim, but closing sign-ups removes the case.
4. **Password policy:** minimum 12 characters, matching the accept page.

## 3. The provisioning worker

1. Create `apps/api/.env.provisioning` on the machine that runs the worker (never committed; `.env.*` is in `.gitignore`):
   - `PROVISIONING_WORKER_ENABLED=true`
   - `DATABASE_URL` — the `dsa_api` role (the worker refuses `postgres` and `service_role`)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` — the rotated key, here only
   - `INVITE_REDIRECT_URL` — exactly the allow-listed `/accept-invitation` URL
2. Remove `SUPABASE_SERVICE_ROLE_KEY` from `apps/api/.env`. (The API also removes it from its own process and warns if it finds it.) The older tools `provision:tenant` and `provision:platform-admin` still read `apps/api/.env`; give them the key only when they are run.
3. Start the worker: `npm run provisioning:worker -w @dsa/tools`, or `-- --once` from a scheduler. It prints one line per invitation: result, invitation id, tenant id, and a failure code if any.

Rollback: stop the worker. Invitations then stay QUEUED and can activate nobody; nothing else changes.

## 4. Identity binding (D5)

1. **Phase 1, read-only (needs approval because it reads the hosted project):** `npm run identity:inventory -w @dsa/tools`. It reads users in read-only transactions as `dsa_api` and lists Auth accounts; it writes nothing. Review every row that is not BOUND or PENDING_INVITATION.
2. **Resolve by hand** the rows reported as BOUND_MISMATCH, NO_ACCOUNT, CROSS_TENANT, NO_CLAIM, ACCOUNT_TAKEN or AMBIGUOUS.
3. **Phase 2 (writes hosted user records, needs approval):** `npm run identity:bind -w @dsa/tools` (dry run), then `-- --apply --project-ref <ref> --expect <n>` with the count from the dry run.
4. **Phase 3:** when the inventory shows nothing left, set `IDENTITY_EMAIL_FALLBACK=false` in the API environment and watch the logs for "identity resolved by e-mail" (there should be none).

## 5. One real invitation test (needs approval)

Use a mailbox you own that is not a staff member's address, a test branch and no roles.

| Step | Action | Expected |
|---|---|---|
| 1 | Create User form: invite the test address | "Invitation sent". User INVITED; `staff_invitation` PENDING, delivery QUEUED; one `user.invited`. |
| 2 | Worker: run once | Line `SENT invitation=… account=CREATED`. `app_user.idp_subject` = the new Auth user id; delivery SENT; one `user.invitation_sent`. |
| 3 | Supabase dashboard → Users | The account exists, and its `app_metadata.tenant_id` is the test tenant. |
| 4 | Open the e-mail link in a private window | `/accept-invitation`, showing the account address. |
| 5 | Before setting a password, call the API with that session | 401; the user stays INVITED. |
| 6 | Set a password (12+ characters) | "Your password is set". Sessions ended. |
| 7 | Sign in with the address and password | Succeeds; MFA steps as configured. Decode the access token locally (do not paste it anywhere): `amr` includes `password`. |
| 8 | `/v1/me` | The user is ACTIVE; one `user.invitation_accepted` and one `user.activated`. |
| 9 | Resend within 60 seconds | 409. |

Afterwards, removing the test user and the Auth account needs approval. Keep the audit rows.

## 6. Approval summary

| # | Step | Status |
|---|---|---|
| A1 | Rotate the service-role key (H0, D3) | Not given |
| A2 | Apply migrations 0092 and 0093 to the hosted database (section 1) | Not given |
| A3 | Redirect allow-list, SMTP, templates, sign-ups off, password policy (section 2) | Not given |
| A4 | Run the provisioning worker against the hosted project (section 3) | Not given |
| A5 | Deploy the API change (requires A2 first) | Not given |
| A6 | Run the read-only identity inventory against the hosted project (section 4.1) | Not given |
| A7 | Bind hosted user records (section 4.3) | Not given |
| A8 | Turn the e-mail fallback off (section 4.4) | Not given |
| A9 | Real invitation test (section 5) and removing the test user afterwards | Not given |
