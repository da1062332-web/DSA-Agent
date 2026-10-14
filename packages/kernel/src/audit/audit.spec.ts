import { describe, expect, it } from 'vitest';
import { redactSensitivePayload } from './audit';

describe('audit payload redaction (TASK-105 / MOD-AUD)', () => {
  it('redacts sensitive keys such as password, token, secret, otp, pan, aadhaar', () => {
    const raw = {
      name: 'John Doe',
      password: 'superSecretPassword123',
      token: 'jwt.token.here',
      otp: '123456',
      nested: {
        api_key: 'sk_live_12345',
        client_secret: 'top_secret',
        status: 'ACTIVE',
      },
      list: [{ secret: 'nestedSecret' }, { safe: 42 }],
    };

    const redacted = redactSensitivePayload(raw) as Record<string, unknown>;
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.token).toBe('[REDACTED]');
    expect(redacted.otp).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).api_key).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).client_secret).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).status).toBe('ACTIVE');
    expect(redacted.name).toBe('John Doe');

    const list = redacted.list as Array<Record<string, unknown>>;
    expect(list[0]!.secret).toBe('[REDACTED]');
    expect(list[1]!.safe).toBe(42);
  });

  it('redacts string values matching PAN and Aadhaar patterns', () => {
    const raw = {
      referenceCode: 'ABCDE1234F', // PAN pattern
      idNumber: '123456789012', // Aadhaar 12-digit pattern
      normalText: 'Regular text value',
    };

    const redacted = redactSensitivePayload(raw) as Record<string, unknown>;
    expect(redacted.referenceCode).toBe('[REDACTED]');
    expect(redacted.idNumber).toBe('[REDACTED]');
    expect(redacted.normalText).toBe('Regular text value');
  });

  it('handles null, undefined and primitive values safely', () => {
    expect(redactSensitivePayload(null)).toBeNull();
    expect(redactSensitivePayload(undefined)).toBeUndefined();
    expect(redactSensitivePayload(100)).toBe(100);
    expect(redactSensitivePayload(true)).toBe(true);
  });
});
