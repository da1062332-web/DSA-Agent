// apps/web/src/shell/partner-login.ts
// A partner portal login (user_type CONNECTOR). The API refuses such a login every internal /v1 endpoint except GET /v1/me
// (CONNECTOR_IDENTITY_NOT_ALLOWED), so the shell must not call those endpoints for it.
export function isPartnerPortalLogin(me: { userType?: string | null } | null | undefined): boolean {
  return me?.userType === 'CONNECTOR';
}
