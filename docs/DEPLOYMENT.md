# Deploying the DSA CRM

Written for: the engineer or operator who sets up the Render API service and the Vercel web project.

- **API:** Render, from `apps/api`. Blueprint: [render.yaml](../render.yaml).
- **Web:** Vercel, from `apps/web`. Config: [apps/web/vercel.json](../apps/web/vercel.json).
- **Node:** 24 (see [.nvmrc](../.nvmrc)). Both platforms must use 24.

Values for every variable below live in the Render and Vercel dashboards. Never put them in the repo.

## Why the Render build failed, and the fix

Render ran `npm install` from `apps/api`. npm links only the workspace packages that `apps/api` declares, and `apps/api` imported `@dsa/bre-core` without declaring it. The API bundle then failed with `Could not resolve "@dsa/bre-core"`.

The fix declares `"@dsa/bre-core": "*"` in [apps/api/package.json](../apps/api/package.json) and adds the matching entry to [package-lock.json](../package-lock.json). The lockfile diff is that one line.

Checked locally with clean copies of `origin/beta`: `npm install` in `apps/api` and `npm run build` pass after the fix. Before the fix, the same steps fail with the four errors from the Render log. Local Node is 22, not 24, so Render has not been re-run.

## Render: API

| Setting           | Value                          |
| ----------------- | ------------------------------ |
| Root directory    | `apps/api`                     |
| Build command     | `npm install && npm run build` |
| Start command     | `npm start`                    |
| Health check path | `/health`                      |
| Node              | 24 (from `.nvmrc`)             |

Environment variables (names only):

| Variable               | Required                            | Notes                                                                                                                                                                                    |
| ---------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`             | yes                                 | `production`                                                                                                                                                                             |
| `DATABASE_URL`         | yes                                 | Hosted pooler (transaction mode, port 6543), connecting as the `dsa_api` role. Never `postgres`, `supabase_admin` or `service_role`.                                                     |
| `SUPABASE_URL`         | yes                                 | Hosted project URL                                                                                                                                                                       |
| `SUPABASE_JWT_SECRET`  | if the project uses a shared secret | Leave blank for asymmetric keys                                                                                                                                                          |
| `APP_SIGNING_SECRET`   | yes                                 | At least 32 characters. Must be the same on every instance. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`                                     |
| `CORS_ALLOWED_ORIGINS` | yes                                 | Comma-separated. Must include the Vercel URL, e.g. `https://<project>.vercel.app`                                                                                                        |
| `LOG_LEVEL`            | no                                  | Default `info`                                                                                                                                                                           |
| `DOCUMENT_STORE`       | yes before production uploads       | `s3` plus `DOCUMENT_S3_ENDPOINT`, `DOCUMENT_S3_BUCKET`, `DOCUMENT_S3_ACCESS_KEY_ID`, `DOCUMENT_S3_SECRET_ACCESS_KEY`. Without them, files stay on the instance and are lost on redeploy. |
| `CLAMAV_ADDRESS`       | yes before partner uploads          | Malware scanning. Partner uploads are refused without a working scanner.                                                                                                                 |

The API refuses to start in production if `APP_SIGNING_SECRET` is missing or short, or if `ENABLE_MOCK_PROVIDERS` is set. It also refuses to start if `TEST_AUTH_ENABLED` is set against a hosted Supabase URL, and `DISABLE_MFA` is allowed only against a local stack. Do not set any of these on Render.

`PORT` is set by Render. Do not set it.

## Vercel: web

| Setting         | Value                                            |
| --------------- | ------------------------------------------------ |
| Root directory  | `apps/web`                                       |
| Framework       | Vite (set in `vercel.json`)                      |
| Install / build | Vercel defaults: `npm install` / `npm run build` |
| Output          | `dist`                                           |
| Node            | 24                                               |

Environment variables (names only):

| Variable                        | Value                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`             | The Render API URL, `https://…`. Required: without a valid URL, every API call fails. |
| `VITE_SUPABASE_URL`             | The hosted project URL                                                                |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The publishable key only. Never a service-role or secret key.                         |

Do not set `VITE_TEST_AUTH`, `VITE_TEST_BYPASS_OTP` or `VITE_DISABLE_MFA` on Vercel. The production build removes test sign-in, but do not rely on that alone.

`vercel.json` rewrites every path to `index.html`, so deep links such as `/leads/123` load the app instead of returning 404.

## Order of operations

1. **Database.** The deploy does not run migrations. Apply them only as set out in `docs/MIGRATION_INVENTORY_CONNECTOR_2026-11.md` (not yet on beta), after the open decisions are made.
2. **API on Render.** Set the variables above, deploy, and check `https://<api>/health`.
3. **Web on Vercel.** Set the variables above, using the Render URL, and deploy.
4. **Back to Render.** Set `CORS_ALLOWED_ORIGINS` to the Vercel URL and redeploy. Browser calls fail until this is done.

## Observed state (2026-11-03, read-only checks; not a deployment log)

- **API (Render):** `/health` returns 200. `/public/v1/auth/config` returns `{"mfaEnabled":false}`, so the running code includes the MFA
  setting endpoint, and the service's `SUPABASE_MFA_ENABLED` is `false`. `/v1/me` without a token returns 401. The CORS preflight allows the
  Vercel origin.
- **Web (Vercel):** the page and a deep link return 200. The bundle points at the Render API and the hosted Supabase project and has no
  `localhost` API references. It does **not** contain the auth-config request or the OTP gating, so the served frontend predates the MFA
  change. The likely cause is that the Vercel production branch is `main`, which is still at `d423452`. Not verified: the Vercel settings
  (no dashboard access).
- **Migration order risk:** the running API needs the sub-permission migrations 0098 and 0099 on the database it uses. See
  [docs/HOSTED_MIGRATION_RUNBOOK.md](HOSTED_MIGRATION_RUNBOOK.md), section 6, and check it before anything else.
- **Not verified:** authenticated sign-in, tenant loading and the connector APIs. Those need a test account and the hosted data.

## Before going live

These are open in `docs/CONNECTOR_SECURITY_AUDIT.md` (not yet on beta) and are not fixed by this change:

- **F1.** The old hosted database password is still in git history and has not been rotated. An administrator must rotate it first (`docs/SECURITY_CREDENTIAL_ROTATION.md`, not yet on beta).
- **F21, F22.** Two isolation tests fail (a signed link accepted with a changed encoding, and a resend returning `SKIPPED`).
- **F7.** `check_status.cjs` skips TLS certificate checks. It is an operator script, not part of the deployed API.
- **Connector activation.** Blocked until the consent rule is decided (`docs/CONNECTOR_VERIFICATION_DECISION.md`, not yet on beta).
- **Partner uploads.** Keep off until `CLAMAV_ADDRESS` is configured and confirmed.
