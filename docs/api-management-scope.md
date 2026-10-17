# Module 36: API Management (MOD-API) — Scope & Implementation Specification

**Owner:** Akash (Developer 2 / Coordinator)  
**Status:** Approved & Implemented (Release MVP)  
**Specification Reference:** System Architecture v1.2 §4.36, Modules 36 & 37 Audit Remediation

---

## 1. Executive Summary

This document specifies the finalized release scope for Module 36 (API Management) within the DSA CRM platform, distinguishing between approved MVP capabilities implemented in the current release and functionality explicitly deferred to Phase 2.

The audit identified missing `/v1/api-clients` endpoints and schema definitions (`app.api_client`), alongside ambiguous release boundaries for enterprise API gateway features. This specification reconciles these findings by delivering a fully multi-tenant, secure API client management subsystem with role-based governance.

---

## 2. Approved Release Scope (Current Release / MVP)

The following capabilities are approved, fully implemented, and covered by automated tests:

### 2.1 Database & Multi-Tenancy Architecture

- **Schema Entity:** `app.api_client` table deployed via migration `20261001000044_access_control_and_api_clients.sql`.
- **Tenant Isolation:** Enforced via PostgreSQL Row-Level Security (`enable_tenant_rls('api_client')`) keyed to `app.tenant_id`.
- **Secret Security:** Client secrets are generated using cryptographically secure random bytes (`crypto.randomBytes(24)`), prefixed with `sec_`, and hashed with SHA-256 (`client_secret_hash`). Unmasked secrets are displayed **only once** upon creation or rotation and are never stored in plaintext.

### 2.2 API Endpoints (`/v1/api-clients`)

All endpoints are mounted under `/v1/api-clients` and protected by permission checks (`api.read`, `api.manage`, `config.manage`):

| Method   | Endpoint                            | Description                                                        | Required Permission             |
| :------- | :---------------------------------- | :----------------------------------------------------------------- | :------------------------------ |
| `GET`    | `/v1/api-clients`                   | List registered API clients with metadata and status               | `api.read` or `api.manage`      |
| `POST`   | `/v1/api-clients`                   | Register new API client; returns one-time unmasked `clientSecret`  | `api.manage` or `config.manage` |
| `GET`    | `/v1/api-clients/:id`               | Retrieve API client details by ID                                  | `api.read` or `api.manage`      |
| `PATCH`  | `/v1/api-clients/:id`               | Update client name, partner name, status, scopes, or rate limits   | `api.manage` or `config.manage` |
| `DELETE` | `/v1/api-clients/:id`               | Revoke and remove client access                                    | `api.manage` or `config.manage` |
| `POST`   | `/v1/api-clients/:id/rotate-secret` | Rotate client secret; returns new one-time secret and updates hash | `api.manage` or `config.manage` |

### 2.3 Access Control & Governance

- **Granular Scopes:** API clients are scoped to authorized actions (e.g., `partner.lead_ingest`, `partner.application_read`, `webhook.manage`, `api.read`).
- **IP Allowlisting:** Optional CIDR/IP filtering (`allowedIps` array) to restrict origin IPs for partner integrations.
- **Configurable Rate Limits:** Per-client rate limits defined in requests-per-minute (`rateLimitRpm`, default 120 RPM, range 10–10,000 RPM).
- **Client Lifecycle:** Lifecycle states supported: `ACTIVE`, `SUSPENDED`, `REVOKED`.

### 2.4 Web Management Console

- UI screen available at `/api-management` for tenant administrators to view, create, configure, suspend, and rotate secrets for partner API clients.
- One-time credential reveal modal with copy-to-clipboard functionality.

---

## 3. Explicitly Deferred Functionality (Post-MVP / Phase 2)

To maintain stability and adhere to architectural boundaries, the following enterprise gateway features are documented as deferred:

1. **OAuth2 / OIDC Authorization Server (`/v1/oauth2/token`):**
   - _Deferred Design:_ Full RFC 6749 OAuth2 `client_credentials` grant exchange with short-lived asymmetric JWT access tokens and JWKS endpoints.
   - _MVP Alternative:_ Direct API key and client credential hash authentication (`x-api-key` / `dsa_live_*` and HMAC secret verification), which provides immediate multi-tenant isolation without the operational complexity of a full token server.

2. **Mutual TLS (mTLS) Certificate Lifecycle:**
   - _Deferred Design:_ Ingesting, pinning, and validating client X.509 certificates at the application layer.
   - _MVP Alternative:_ Terminated at the reverse proxy/ingress edge; IP allowlisting provides network-layer restriction.

3. **Distributed Redis Rate-Limiter Gateway:**
   - _Deferred Design:_ Cross-region token-bucket rate limiter cluster with dynamic sliding windows via Redis cluster.
   - _MVP Alternative:_ In-process rate limiting with configured RPM thresholds per client.

4. **Public Developer Self-Service Portal:**
   - _Deferred Design:_ Public sign-up, automated sandbox provisioning, and community forum.
   - _MVP Alternative:_ Tenant administrators provision and distribute partner client credentials directly via the DSA CRM backoffice console (`/api-management`).

---

## 4. Verification & Audit Trail

- Automated unit and integration tests covering credential issuance, secret hashing, scope validation, secret rotation, and RBAC permissions reside in `apps/api/test/partner-api.spec.ts`.
- OpenAPI documentation is registered under tag `MOD-API API Management` and verified via `tools/gen-openapi.ts`.
