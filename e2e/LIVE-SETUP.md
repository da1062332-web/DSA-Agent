# Live UI walkthrough: setup and run

Test ID **TC-SE-LIVE-01**: a Sales Executive logs in, creates a lead, logs a call, checks follow-up tasks and checks role limits, all in the real app.

The live setup is **local only**. It uses the local Supabase stack (127.0.0.1:54321 / 54322), a local API on port 3100 and a local web app on port 5180. It never touches the hosted project, and the existing dev servers on ports 3000 and 5173 are not used.

## One-time setup

Run these from the repo root (`DSA-Agent/`).

1. **Start the local Supabase stack** (needs Docker Desktop running):

   ```
   npm run db:start
   ```

2. **Apply all migrations to the local database.** A local database can be left with only some migrations applied, so do this every time you see "policy/column not found" errors:

   ```
   npm run db:reset
   ```

   This wipes the **local** database only. It does not touch hosted.

3. **Create the local API role.** Run this once after each `db:reset` if the API says "password authentication failed for user dsa_api". Use the password from `DATABASE_URL` in `apps/api/.env.e2e`:

   ```
   docker exec supabase_db_dsa-crm psql -U postgres -d postgres -c "CREATE ROLE dsa_api LOGIN PASSWORD '<password from apps/api/.env.e2e>' NOBYPASSRLS IN ROLE dsa_app;"
   docker exec supabase_db_dsa-crm psql -U postgres -d postgres -c "ALTER ROLE dsa_api SET search_path = app, extensions;"
   ```

   If the role already exists, use `ALTER ROLE dsa_api LOGIN PASSWORD '...'` instead.

4. **Local env files.** These are git-ignored (`.env.*`). They point only at 127.0.0.1:

   - `apps/api/.env.e2e`: local `DATABASE_URL`, `SUPABASE_URL`, the local service key and JWT secret, `TEST_BYPASS_OTP=000000`, and `DEMO_USER_PASSWORD` (the password for the demo users).
   - `apps/web/.env.e2e`: local `VITE_SUPABASE_URL`, the local anon key, `VITE_API_BASE_URL=http://localhost:3100`, `VITE_TEST_BYPASS_OTP=000000`.

   To recreate them, copy the values from `npm run db:status`. Do not copy them into `.env` or `apps/*/.env.local`.

5. **Create the demo users in the local database** (takes about 10 seconds):

   ```
   cd tools
   npx tsx --env-file=../apps/api/.env.e2e provision-tenant.ts --tenant demo-alpha
   cd ..
   ```

   This creates `sales1@alpha.com` (ROLE-SALES-EXEC) and the other demo-alpha users, all with `DEMO_USER_PASSWORD`. Run `db:reset` first if you run it again, because the emails already exist.

6. **Install dependencies and the browser** (once):

   ```
   npm install
   npx playwright install chromium
   ```

## Run the test

Run by test ID:

```
npm run test:e2e:live -- -g TC-SE-LIVE-01
```

Watch the browser:

```
npm run test:e2e:live -- -g TC-SE-LIVE-01 --headed
```

Run all live tests:

```
npm run test:e2e:live
```

Playwright starts the local API and the web app itself, and stops them when the run ends. Failure screenshots and traces are in `test-results/`. To open a trace: `npx playwright show-trace <path to trace.zip>`.

The normal suite (`npm run test:e2e`) does not run this test. It only runs when `playwright.live.config.ts` sets `E2E_LIVE=1`.

## What the test checks, in order

Each step shows a banner on screen and then pauses (`STEP_PAUSE_MS`, default 2.5 seconds), so a headed run can be followed.

| Step | What the Sales Executive does | What the test checks |
| --- | --- | --- |
| 1 | Signs in with email, password and the 6-digit code | "Create Lead" is shown on the dashboard |
| 2 | Opens New Lead, presses Create Lead with nothing filled in, then saves a lead | Name error shown first; lead page opens with state NEW |
| 3 | Attempts contact | State becomes CONTACT_ATTEMPTED |
| 4 | Marks the lead in progress | State becomes IN_PROGRESS |
| 5 | Logs a call (connected) | A "connected" entry appears in Activity |
| 6 | Qualifies the lead (amount and income) | State becomes QUALIFIED |
| 7 | Checks role limits | Convert, Assign and Add task are hidden; the "First contact" task is shown |
| 8 | Opens /commission and /audit | Each shows "You do not have permission to access this page." |
| 9 | Signs out | Back on the login page |

## Problems found while setting this up

- **Stale migrations.** The local database had 21 of 76 migrations applied. Fix: `npm run db:reset`.
- **dsa_api role missing after a reset.** Fix: step 3 above.
- **Long digits in free text are refused.** A name with a 13-digit timestamp was rejected with "prohibited s3 data". Free-text fields reject 9 to 18 digit runs (account-number rule). The test uses a base-36 run tag instead.
- **Sales Executive has no `task.create`.** The "Add task" button is hidden for this role. The test checks that, not an add-task flow.
- **The activity success message is too brief to assert on.** The form closes when saved. The test checks the Activity list instead.

## Security notes

- The login screen falls back to the test-login endpoint with the test OTP `000000`. That is acceptable on this machine only. `TEST_BYPASS_OTP` must not be set on any hosted environment.
- The local files `apps/api/.env.e2e` and `apps/web/.env.e2e` hold local-only secrets. Do not share or commit them.
