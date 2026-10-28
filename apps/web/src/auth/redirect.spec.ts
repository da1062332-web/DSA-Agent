import { describe, expect, it } from 'vitest';
import { PLATFORM_TENANT_ID } from '@dsa/contracts';
import { extractTenantId, resolveSafeRedirect } from './redirect';

describe('resolveSafeRedirect', () => {
  const customerTenantId = 'ten_adity_finserv_001';

  // Helper to construct a dummy JWT with given payload
  function makeJwt(payload: Record<string, unknown>) {
    const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = btoa(JSON.stringify(payload));
    return `${header}.${body}.signature`;
  }

  const platformJwt = makeJwt({ app_metadata: { tenant_id: PLATFORM_TENANT_ID } });
  const customerJwt = makeJwt({ app_metadata: { tenant_id: customerTenantId } });

  it('defaults to "/" for empty or login/mfa destinations', () => {
    expect(resolveSafeRedirect('')).toBe('/');
    expect(resolveSafeRedirect(null)).toBe('/');
    expect(resolveSafeRedirect('/login')).toBe('/');
    expect(resolveSafeRedirect('/mfa')).toBe('/');
  });

  it('permits standard customer paths for any user', () => {
    expect(resolveSafeRedirect('/leads', customerJwt)).toBe('/leads');
    expect(resolveSafeRedirect('/applications', { tenant_id: customerTenantId })).toBe('/applications');
    expect(resolveSafeRedirect('/tasks', platformJwt)).toBe('/tasks');
  });

  it('redirects non-platform users away from /platform-admin to "/"', () => {
    expect(resolveSafeRedirect('/platform-admin', customerJwt)).toBe('/');
    expect(resolveSafeRedirect('/platform-admin/tenants/ten_1', { app_metadata: { tenant_id: customerTenantId } })).toBe('/');
    expect(resolveSafeRedirect('/platform-console', null)).toBe('/');
  });

  it('permits platform operator into /platform-admin', () => {
    expect(resolveSafeRedirect('/platform-admin', platformJwt)).toBe('/platform-admin');
    expect(resolveSafeRedirect('/platform-admin', { user: { app_metadata: { tenant_id: PLATFORM_TENANT_ID } } })).toBe('/platform-admin');
  });

  it('correctly extracts tenant id from various session structures', () => {
    expect(extractTenantId(platformJwt)).toBe(PLATFORM_TENANT_ID);
    expect(extractTenantId({ tenant_id: 'ten_abc' })).toBe('ten_abc');
    expect(extractTenantId({ user: { app_metadata: { tenant_id: 'ten_xyz' } } })).toBe('ten_xyz');
    expect(extractTenantId(null)).toBeNull();
  });
});
