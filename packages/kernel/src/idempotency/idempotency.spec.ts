import { describe, expect, it } from 'vitest';
import { canonicalJson, requestHash } from './idempotency';

describe('idempotency request hash (TASK-105)', () => {
  it('TEST-KRN-105-01 ignores key order and undefined fields', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, 2], c: undefined } })).toBe('{"a":{"d":[1,2]},"b":1}');
    const a = requestHash({
      key: 'k1234567',
      method: 'post',
      path: '/v1/branches',
      body: { code: 'X1', name: 'N' },
    });
    const b = requestHash({
      key: 'k1234567',
      method: 'POST',
      path: '/v1/branches',
      body: { name: 'N', code: 'X1' },
    });
    expect(a).toBe(b);
  });

  it('TEST-KRN-105-02 a different body or path gives a different hash', () => {
    const base = { key: 'k1234567', method: 'POST', path: '/v1/branches', body: { code: 'X1' } };
    expect(requestHash(base)).not.toBe(requestHash({ ...base, body: { code: 'X2' } }));
    expect(requestHash(base)).not.toBe(requestHash({ ...base, path: '/v1/teams' }));
  });
});
