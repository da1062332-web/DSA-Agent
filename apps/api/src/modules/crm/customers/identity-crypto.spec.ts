// TEST-CUST-P102 field encryption for customer PAN and date of birth (task P1-02). Synthetic values only.
import { describe, expect, it } from 'vitest';
import { decryptIdentityField, encryptIdentityField, panHash, panHashCandidates } from './identity-crypto';

const T1 = 'ten_test_a';
const T2 = 'ten_test_b';

describe('TEST-CUST-P102 identity crypto', () => {
  it('TEST-CUST-P102-20 round-trips, and the ciphertext differs on every write and never contains the PAN', () => {
    const a = encryptIdentityField(T1, 'cust_1', 'PAN', 'ABCDE1234F');
    const b = encryptIdentityField(T1, 'cust_1', 'PAN', 'ABCDE1234F');
    expect(a.equals(b)).toBe(false);
    expect(a.toString('latin1')).not.toContain('ABCDE1234F');
    expect(decryptIdentityField(T1, 'cust_1', 'PAN', a)).toBe('ABCDE1234F');
  });

  it('TEST-CUST-P102-21 a ciphertext moved to another customer, tenant or field does not decrypt', () => {
    const c = encryptIdentityField(T1, 'cust_1', 'PAN', 'ABCDE1234F');
    expect(() => decryptIdentityField(T1, 'cust_2', 'PAN', c)).toThrow();
    expect(() => decryptIdentityField(T2, 'cust_1', 'PAN', c)).toThrow();
    expect(() => decryptIdentityField(T1, 'cust_1', 'DATE_OF_BIRTH', c)).toThrow();
  });

  it('TEST-CUST-P102-22 a tampered or truncated ciphertext does not decrypt', () => {
    const c = encryptIdentityField(T1, 'cust_1', 'DATE_OF_BIRTH', '1990-01-31');
    const tampered = Buffer.from(c);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    expect(() => decryptIdentityField(T1, 'cust_1', 'DATE_OF_BIRTH', tampered)).toThrow();
    expect(() => decryptIdentityField(T1, 'cust_1', 'DATE_OF_BIRTH', c.subarray(0, 20))).toThrow();
  });

  it('TEST-CUST-P102-23 the PAN hash is stable within a tenant, differs across tenants, and the current hash is a candidate', () => {
    expect(panHash(T1, 'ABCDE1234F').equals(panHash(T1, 'ABCDE1234F'))).toBe(true);
    expect(panHash(T1, 'ABCDE1234F').equals(panHash(T2, 'ABCDE1234F'))).toBe(false);
    expect(panHashCandidates(T1, 'ABCDE1234F')[0]!.equals(panHash(T1, 'ABCDE1234F'))).toBe(true);
  });
});
