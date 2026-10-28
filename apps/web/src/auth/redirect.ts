// apps/web/src/auth/redirect.ts
// Secure destination resolution on authentication redirect
import { PLATFORM_TENANT_ID } from '@dsa/contracts';

/**
 * Extracts tenant_id from a JWT string or session payload object.
 */
export function extractTenantId(tokenOrSession?: unknown): string | null {
  if (!tokenOrSession) return null;

  if (typeof tokenOrSession === 'object' && tokenOrSession !== null) {
    const obj = tokenOrSession as Record<string, any>;
    if (obj.user?.app_metadata?.tenant_id) return String(obj.user.app_metadata.tenant_id);
    if (obj.app_metadata?.tenant_id) return String(obj.app_metadata.tenant_id);
    if (obj.tenant_id) return String(obj.tenant_id);
    if (obj.access_token && typeof obj.access_token === 'string') {
      return extractTenantIdFromJwt(obj.access_token);
    }
  }

  if (typeof tokenOrSession === 'string') {
    return extractTenantIdFromJwt(tokenOrSession);
  }

  return null;
}

function extractTenantIdFromJwt(jwt: string): string | null {
  try {
    const parts = jwt.split('.');
    const part1 = parts[1];
    if (!part1) return null;
    const base64 = part1.replace(/-/g, '+').replace(/_/g, '/');
    const jsonStr = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    );
    const payload = JSON.parse(jsonStr);
    return (
      payload?.app_metadata?.tenant_id ||
      payload?.tenant_id ||
      payload?.user_metadata?.tenant_id ||
      null
    );
  } catch {
    return null;
  }
}

/**
 * Resolves a safe redirect destination after login/MFA.
 * Prevents non-platform users from being redirected to platform-only routes (/platform-admin, /platform-console).
 */
export function resolveSafeRedirect(
  requestedPath: string | undefined | null,
  tokenOrSession?: unknown,
): string {
  if (!requestedPath || requestedPath === '/login' || requestedPath === '/mfa') {
    return '/';
  }

  const cleanPath =
    requestedPath.startsWith('/') && !requestedPath.startsWith('//') ? requestedPath : '/';

  const isPlatformPath =
    cleanPath === '/platform-admin' ||
    cleanPath.startsWith('/platform-admin/') ||
    cleanPath === '/platform-console' ||
    cleanPath.startsWith('/platform-console/');

  if (isPlatformPath) {
    const tenantId = extractTenantId(tokenOrSession);
    if (tenantId !== PLATFORM_TENANT_ID) {
      return '/';
    }
  }

  return cleanPath;
}
