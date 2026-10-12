# apps/web/src/auth — owner: Dev 1 (UI-PLT-001)

`supabase.ts` (client built with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`, used for `auth.*` only), `AuthProvider`, the TOTP enrolment and challenge flow (`/mfa`), and `StepUpDialog`. The dialog opens when the API returns `401 STEP_UP_REQUIRED` on rule approve, publish or suspend.
