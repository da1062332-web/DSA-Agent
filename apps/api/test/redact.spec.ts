// Credentials never reach an error response or a log line (owner: Dev 1). Each case is a shape that has leaked, or could leak.
import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { redactSecrets, registerDatabaseUrl, registerSecrets } from '../src/http/redact';

describe('redactSecrets', () => {
  it('TEST-RED-01 masks the login of a database URL even when nothing was registered', () => {
    expect(redactSecrets('connect failed for postgresql://dsa_api:hunter2hunter2@localhost:5432/postgres')).toBe(
      'connect failed for postgresql://[redacted]@localhost:5432/postgres',
    );
  });

  it('TEST-RED-02 masks key=value secrets and bearer tokens', () => {
    const out = redactSecrets('password=abc123 token: xyz987 Authorization: Bearer opaque-token-value');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('xyz987');
    expect(out).not.toContain('opaque-token-value');
  });

  it('TEST-RED-03 masks a JWT-shaped token', async () => {
    // Signed at run time, so no token literal sits in the source.
    const jwt = await new SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode('redaction-test-key-0123456789abcdef'));
    expect(redactSecrets(`token ${jwt} rejected`)).toBe('token [redacted-jwt] rejected');
  });

  it('TEST-RED-04 masks every registered secret wherever it appears', () => {
    registerSecrets(['registered-secret-value-0001']);
    expect(redactSecrets('a registered-secret-value-0001 b registered-secret-value-0001')).toBe('a [redacted] b [redacted]');
  });

  it('TEST-RED-05 a registered database URL masks its password as written and as decoded', () => {
    registerDatabaseUrl('postgresql://dsa_api:p%40ss-word-0002@localhost:6543/postgres');
    const out = redactSecrets(
      'pw p%40ss-word-0002, decoded p@ss-word-0002, url postgresql://dsa_api:p%40ss-word-0002@localhost:6543/postgres',
    );
    expect(out).not.toContain('ss-word-0002');
    expect(out).not.toContain('p%40');
  });

  it('TEST-RED-06 leaves ordinary messages unchanged', () => {
    expect(redactSecrets('Invalid email and OTP are required.')).toBe('Invalid email and OTP are required.');
    expect(redactSecrets('Tenant is ACTIVE.')).toBe('Tenant is ACTIVE.');
  });
});
