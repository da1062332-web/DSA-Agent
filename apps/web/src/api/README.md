# apps/web/src/api — owner: Dev 1 (UI-PLT-001)

The typed API client goes here: `apiClient` on `fetch` with the Supabase access token as `Authorization: Bearer`, `X-Correlation-Id`, `Idempotency-Key` on POSTs marked Idem, `If-Match` on writes, and the `ErrorEnvelope` from `@dsa/contracts` parsed into a typed error. `useMe()` (`GET /v1/me`) goes here too.

Screen owners call it through TanStack Query hooks in their own `features/<name>/` folder.
