// Acceptance for the S3 guard and the log mask (task P1-01, checklist 4.5.3; TEST-SECRETS-07). Both use the shared code only: the
// free-text validator freeTextNoS3 (@dsa/contracts) and the log masks redactSecrets (http/redact.ts). No other validator or mask is used.
import { ErrorEnvelope, freeTextNoS3, type PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { redactSecrets } from '../src/http/redact';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const PAN = 'ABCDE1234F';
const IDEM = { 'Idempotency-Key': 's3-acceptance-key-01' };
const complaint = {
  complainantType: 'APPLICATION',
  complainantId: 'app_01HZX0000000000000000000AA',
  channel: 'PHONE',
  category: 'SERVICE',
  description: 'Customer waited three weeks for a callback',
};

const as = (txRunner?: unknown, ...codes: PermissionCode[]) =>
  createTestApp({
    auth: fakeAuth(
      testPrincipal({ grants: codes.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })) }),
    ),
    deps: txRunner ? { txRunner: txRunner as never } : undefined,
  });

describe('TEST-SECRETS-07 the S3 guard and the log mask, end to end', () => {
  it('TEST-SECRETS-07 a note carrying "PAN ABCDE1234F" is refused with 422 by the shared validator', async () => {
    expect(freeTextNoS3(`PAN ${PAN}`)).toBe(true);

    const res = await request(as(undefined, 'complaint.create'))
      .post('/v1/complaints')
      .set(IDEM)
      .send({ ...complaint, description: `PAN ${PAN}` });

    expect(res.status).toBe(422);
    expect(ErrorEnvelope.parse(res.body).error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toContain(PAN);
  });

  it('TEST-SECRETS-07 an error containing a PAN is logged masked as ABCDE****F, and the raw PAN never reaches the log', async () => {
    expect(redactSecrets(`lookup failed for ${PAN}`)).toBe('lookup failed for ABCDE****F');

    const logged: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
    try {
      const txRunner = { withTenantTx: () => Promise.reject(new Error(`lookup failed for ${PAN}`)) };
      const res = await request(as(txRunner, 'complaint.create')).post('/v1/complaints').set(IDEM).send(complaint);

      expect(res.status).toBe(500);
      const log = logged.join('\n');
      expect(log).toContain('ABCDE****F');
      expect(log).not.toContain(PAN);
      expect(JSON.stringify(res.body)).not.toContain(PAN);
    } finally {
      spy.mockRestore();
    }
  });
});
