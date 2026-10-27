import { AppError } from '@dsa/contracts';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';
import { mintBypassToken, mintTestToken } from '../testing';
import { createTokenVerifier } from './verify-token';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const HOSTED = 'https://mlpkwwhnagxzinaohdxg.supabase.co';
const SECRET = 'unit-test-hs256-key-not-used-anywhere-else';
const BYPASS = 'bypass-secret-for-kernel-tests-0123456789';
/** The secret that used to be the default in the repository. It must never be accepted. */
const PUBLISHED = 'dsa-crm-test-bypass-jwt-secret-key-2026';
const SUB = '6f1c2b8e-1d2a-4c55-9a77-0d6b1e2f3a4b';
const TENANT = 'ten_01JTESTTENANT0000000000000';

const verifier = createTokenVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: SECRET });
const mint = (o: Partial<Parameters<typeof mintTestToken>[0]> = {}) =>
  mintTestToken({ supabaseUrl: SUPABASE_URL, jwtSecret: SECRET, sub: SUB, tenantId: TENANT, ...o });
const noJwks = async () => new Uint8Array();

/** A token signed by hand, the way an attacker would: any issuer, any secret, no test helper. */
const forge = (secret: string, issuer: string) =>
  new SignJWT({ role: 'authenticated', aal: 'aal2', app_metadata: { tenant_id: TENANT } })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(issuer)
    .setAudience('authenticated')
    .setSubject(SUB)
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(secret));

async function errorCode(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  return (err as AppError).code;
}

describe('createTokenVerifier', () => {
  it('TEST-KRN-102-01 accepts a valid HS256 token and reads sub, tenant and aal', async () => {
    const t = await verifier.verify(await mint());
    expect(t).toEqual({
      subject: SUB,
      tenantId: TENANT,
      aal: 'aal1',
      mfaVerifiedAt: null,
      email: null,
      authMethods: ['password'],
    });
  });

  it('TEST-KRN-102-02 reports the TOTP time for an aal2 token', async () => {
    const now = new Date('2026-10-12T05:00:00Z');
    const t = await verifier.verify(await mint({ aal: 'aal2', now, ttlSeconds: 10 ** 9 }));
    expect(t.aal).toBe('aal2');
    expect(t.mfaVerifiedAt).toEqual(now);
  });

  it('TEST-KRN-102-05 reads the sign-in methods from amr, and ignores entries that do not name a method', async () => {
    const token = await new SignJWT({
      role: 'authenticated',
      aal: 'aal1',
      amr: [{ method: 'otp', timestamp: 1 }, 'password', { method: 7 }, null],
      app_metadata: { tenant_id: TENANT },
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setSubject(SUB)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    expect((await verifier.verify(token)).authMethods).toEqual(['otp']);
  });

  it('TEST-KRN-102-03 rejects an expired token with TOKEN_EXPIRED', async () => {
    const token = await mint({ now: new Date(Date.now() - 7200_000), ttlSeconds: 60 });
    expect(await errorCode(verifier.verify(token))).toBe('TOKEN_EXPIRED');
  });

  it('TEST-KRN-102-04 rejects a token signed with another secret', async () => {
    const token = await mint({ jwtSecret: 'another-secret-another-secret-another-secret' });
    expect(await errorCode(verifier.verify(token))).toBe('UNAUTHENTICATED');
  });

  it('TEST-KRN-102-05 rejects a token without app_metadata.tenant_id', async () => {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setSubject(SUB)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    expect(await errorCode(verifier.verify(token))).toBe('UNAUTHENTICATED');
  });

  it('TEST-KRN-102-06 rejects a token from another issuer', async () => {
    const token = await mint({ supabaseUrl: 'http://localhost:9999' });
    expect(await errorCode(verifier.verify(token))).toBe('UNAUTHENTICATED');
  });

  it('TEST-KRN-102-07 rejects HS256 when no secret is configured', async () => {
    const noSecret = createTokenVerifier({ supabaseUrl: SUPABASE_URL, jwks: async () => new Uint8Array() });
    expect(await errorCode(noSecret.verify(await mint()))).toBe('UNAUTHENTICATED');
  });

  it('TEST-KRN-102-08 rejects garbage', async () => {
    expect(await errorCode(verifier.verify('not.a.jwt'))).toBe('UNAUTHENTICATED');
  });

  it('TEST-KRN-102-09 accepts an ES256 token from the JWKS', async () => {
    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256' };
    const es = createTokenVerifier({ supabaseUrl: SUPABASE_URL, jwks: createLocalJWKSet({ keys: [jwk] }) });
    const token = await new SignJWT({ aal: 'aal1', app_metadata: { tenant_id: TENANT } })
      .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
      .setIssuer(`${SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setSubject(SUB)
      .setExpirationTime('1h')
      .sign(privateKey);
    expect((await es.verify(token)).tenantId).toBe(TENANT);
  });

  it('TEST-KRN-102-10 test tokens refuse a hosted SUPABASE_URL', async () => {
    await expect(mint({ supabaseUrl: 'https://abc.supabase.co' })).rejects.toThrow(/local Supabase/);
  });

  it('TEST-KRN-102-11 a forged token signed with the once-published secret is refused by the hosted project', async () => {
    const token = await forge(PUBLISHED, `${HOSTED}/auth/v1`);
    const hosted = createTokenVerifier({ supabaseUrl: HOSTED, jwks: noJwks });
    expect(await errorCode(hosted.verify(token))).toBe('UNAUTHENTICATED');
  });

  it('TEST-KRN-102-12 the test bypass secret is honoured only against the local stack', async () => {
    const token = await mintBypassToken({ supabaseUrl: SUPABASE_URL, secret: BYPASS, sub: SUB, tenantId: TENANT });
    const local = createTokenVerifier({ supabaseUrl: SUPABASE_URL, bypassSecret: BYPASS, jwks: noJwks });
    expect((await local.verify(token)).aal).toBe('aal2');

    const forgedForHosted = await forge(BYPASS, `${HOSTED}/auth/v1`);
    const hosted = createTokenVerifier({ supabaseUrl: HOSTED, bypassSecret: BYPASS, jwks: noJwks });
    expect(await errorCode(hosted.verify(forgedForHosted))).toBe('UNAUTHENTICATED');
  });

  it('TEST-KRN-102-13 without a bypass secret the local stack refuses test-login tokens', async () => {
    const token = await mintBypassToken({ supabaseUrl: SUPABASE_URL, secret: BYPASS, sub: SUB, tenantId: TENANT });
    const noBypass = createTokenVerifier({ supabaseUrl: SUPABASE_URL, jwks: noJwks });
    expect(await errorCode(noBypass.verify(token))).toBe('UNAUTHENTICATED');
  });

  it('TEST-KRN-102-14 a token issued by another project is refused even when it carries the legacy secret', async () => {
    const token = await forge(SECRET, `${HOSTED}/auth/v1`);
    expect(await errorCode(verifier.verify(token))).toBe('UNAUTHENTICATED');
  });

  it('TEST-KRN-102-15 test bypass tokens cannot be minted against a hosted project', async () => {
    await expect(
      mintBypassToken({ supabaseUrl: HOSTED, secret: BYPASS, sub: SUB, tenantId: TENANT }),
    ).rejects.toThrow(/local Supabase/);
  });

  it('TEST-KRN-102-16 the local stack accepts either spelling of its host', async () => {
    const token = await mint({ supabaseUrl: 'http://localhost:54321' });
    expect((await verifier.verify(token)).tenantId).toBe(TENANT);
  });
});
