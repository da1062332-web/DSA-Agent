// Identity binding (D5), the pure part: how each application user is classified against the Supabase Auth accounts. No database, no
// network. The database part (read-only inventory and the binding itself) is tested in tests/isolation/cases/identity-binding.spec.ts.
import { describe, expect, it } from 'vitest';
import { classifyBindings, maskEmail, summarize, type AppUserRecord } from './identity-binding';

const A = 'ten_A';
const B = 'ten_B';
const user = (
  id: string,
  email: string,
  idpSubject: string,
  over: Partial<AppUserRecord> = {},
): AppUserRecord => ({
  id,
  tenantId: A,
  email,
  idpSubject,
  status: 'ACTIVE',
  ...over,
});
const account = (id: string, email: string | null, tenantId: string | null) => ({ id, email, tenantId });

describe('classifying application users for binding', () => {
  it('TEST-BIND-01 a user bound to an account with the same address and tenant is BOUND; any difference is BOUND_MISMATCH', () => {
    const rows = classifyBindings(
      [user('u1', 'One@x.test', 'a1'), user('u2', 'two@x.test', 'a2'), user('u3', 'three@x.test', 'a3')],
      [account('a1', 'one@x.test', A), account('a2', 'other@x.test', A), account('a3', 'three@x.test', B)],
    );
    expect(rows.map((r) => r.category)).toEqual(['BOUND', 'BOUND_MISMATCH', 'BOUND_MISMATCH']);
  });

  it('TEST-BIND-02 an unbound user with exactly one fitting account in its own tenant is BINDABLE to that account', () => {
    const [row] = classifyBindings(
      [user('u1', 'one@x.test', 'legacy-subject')],
      [account('a1', 'one@x.test', A)],
    );
    expect(row).toMatchObject({ category: 'BINDABLE', proposedSubject: 'a1' });
  });

  it('TEST-BIND-03 another tenant’s account, an account with no claim, or no account at all is never bindable', () => {
    const rows = classifyBindings(
      [user('u1', 'one@x.test', 's1'), user('u2', 'two@x.test', 's2'), user('u3', 'three@x.test', 's3')],
      [account('a1', 'one@x.test', B), account('a2', 'two@x.test', null)],
    );
    expect(rows.map((r) => r.category)).toEqual(['CROSS_TENANT', 'NO_CLAIM', 'NO_ACCOUNT']);
    expect(rows.every((r) => r.proposedSubject === undefined)).toBe(true);
  });

  it('TEST-BIND-04 an account already bound to another user, or two accounts with one address, needs a person', () => {
    const taken = classifyBindings(
      [user('u1', 'one@x.test', 'a1'), user('u2', 'ONE@x.test', 'old', { tenantId: A })],
      [account('a1', 'one@x.test', A)],
    );
    expect(taken.map((r) => r.category)).toEqual(['BOUND', 'ACCOUNT_TAKEN']);
    const twin = classifyBindings(
      [user('u1', 'one@x.test', 'old')],
      [account('a1', 'one@x.test', A), account('a2', 'one@x.test', A)],
    );
    expect(twin[0]?.category).toBe('AMBIGUOUS');
  });

  it('TEST-BIND-05 a new invitation (placeholder subject, INVITED) is left to the provisioning worker', () => {
    const [row] = classifyBindings(
      [user('u1', 'one@x.test', 'invite:u1', { status: 'INVITED' })],
      [account('a1', 'one@x.test', A)],
    );
    expect(row?.category).toBe('PENDING_INVITATION');
  });

  it('TEST-BIND-06 the summary counts every category, and e-mail addresses are printed masked', () => {
    const counts = summarize(classifyBindings([user('u1', 'one@x.test', 's1')], []));
    expect(counts.NO_ACCOUNT).toBe(1);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(1);
    expect(maskEmail('vaibhav.qloax@gmail.com')).toBe('va***@gmail.com');
  });
});
