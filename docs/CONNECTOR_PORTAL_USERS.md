# Connector portal users: implementation guide

Status: built and tested locally, 2026-10-29. Not deployed. No hosted change.

## Model

- A **connector** is a business profile (`app.connector`). A **portal user** is a login (`app.app_user`, `user_type = 'CONNECTOR'`) linked by `connector_id`. They are separate: a connector may have no portal user, or several.
- A portal user holds **no role**. Portal access (`/portal/v1`) comes from the login's identity and its link to an `ACTIVE` connector. The internal API (`/v1`, `/platform/v1`) refuses a connector login, except `GET /v1/me`. A role on a connector login is refused by the API and, once migration 0097 is applied, by the database.
- The **relationship manager** is an internal staff member (`relationship_owner_user_id`). It is not a portal user.

## Invitation lifecycle

Portal users are invited through the same pipeline as staff:

1. `POST /v1/connectors/{id}/users` (with `connector.manage` and an `Idempotency-Key`) creates the login with status `INVITED`, the placeholder subject `invite:<user id>`, and one `PENDING` invitation whose delivery is `QUEUED`.
2. The provisioning worker (`apps/api/src/provisioning/invitation-delivery.ts`) creates or finds the Supabase Auth account, writes the tenant claim, binds the real Auth subject, and sends the e-mail. Delivery becomes `SENT`, with a 24-hour expiry. A provider failure is retried with backoff, then recorded as `FAILED` with a short code.
3. The invitee sets a password. On the first password sign-in, the principal resolver marks the invitation `ACCEPTED` and the login `ACTIVE`.

Nothing in this lifecycle creates a synthetic identity, marks a login `ACTIVE` early, or assigns a role.

| Situation | Behaviour |
|---|---|
| Same request retried (same `Idempotency-Key`) | The same login is returned (`200`, `Idempotent-Replayed: true`) |
| E-mail already used in the organization | `422 DUPLICATE_EMAIL`. Same rule as staff invitations; internal staff only. |
| Connector `SUSPENDED` or `TERMINATED` | `409 INVALID_STATE` |
| Connector `DRAFT` or `PENDING_VERIFICATION` | Invitation allowed. The portal refuses the login until the connector is `ACTIVE`. |
| Resend while the e-mail is still queued, within one minute, or after five resends | `409 INVALID_STATE` |
| Expired invitation | Resend queues a new one |
| Invitation withdrawn | The login is `DEACTIVATED` and can never be activated |

## Endpoints

All need `connector.manage`, and the connector must be visible to the caller (otherwise `404`). The user id in the path must be a connector login of that connector (otherwise `404`).

| Method and path | Purpose |
|---|---|
| `POST /v1/connectors/{id}/users` | Invite (body: `email`, `displayName`, optional `mobileE164`; header `Idempotency-Key`) |
| `GET /v1/connectors/{id}/users` | List portal users with account status and latest invitation state |
| `POST /v1/connectors/{id}/users/{userId}/invitation/resend` | Queue a new set-password e-mail |
| `POST /v1/connectors/{id}/users/{userId}/invitation/revocation` | Withdraw an unaccepted invitation (body: `reason`) |
| `POST /v1/connectors/{id}/users/{userId}/access` | `SUSPEND` an active login or `REACTIVATE` a suspended one (body: `action`, `reason`) |

Audit events: `connector.portal_user_invited`, `connector.portal_invitation_resent`, `connector.portal_invitation_revoked`, `connector.portal_user_suspended`, `connector.portal_user_reactivated`.

Suspension takes effect on the next request, because the resolver reads the status every time. It does not revoke Supabase sessions.

## UI

The Connector page has a **Portal Access & Users** tab (`apps/web/src/features/connectors/ConnectorPortalUsers.tsx`). It shows each portal user's name, e-mail, linked connector, account status, invitation state and send date. Its actions are resend, withdraw, suspend and reactivate, each with a reason and a confirmation. Last sign-in is not shown, because it is not reliably available to the API.

The **Add Connector** dialog can invite a portal user after saving. The connector is saved first. If the invitation then fails, the tab shows **Retry invitation** with the same key, so a retry creates neither a second connector nor a second login.

## Manual QA (local stack)

1. Sign in as a tenant administrator (`connector.manage`). Open Connectors, then Add Connector. Fill the profile, choose an internal relationship manager, tick **Invite a portal user after saving**, and enter a name and an e-mail. Save.
2. The Portal Access & Users tab shows the user as `INVITED` with "Queued, not yet sent".
3. Run the provisioning worker (`npm run worker`). The invitation shows "Sent, awaiting password". The e-mail arrives in the local mail catcher.
4. Open the link, set a password and sign in. The web app routes the connector login to the portal; the user shows `ACTIVE`.
5. Activate the connector if it is not active yet. In the portal, send a consent code for a customer mobile, verify it, and submit a referral. The referral appears with a masked name.
6. Open statements and the rate card: only this connector's lines and agreement appear.
7. As the administrator, suspend the portal user with a reason. The next portal request fails. Reactivate it, and access returns.
