import { describe, expect, it } from 'vitest';
import type { RequestContext, Tx } from '../kernel';
import { FakeConsentPort } from './fake-consent';
import { FakeKycCheckPort, fakeKycResult } from './fake-kyc';
import { FakeTaskPort } from './fake-task';
import { FakeUserDirectoryPort } from './fake-user-directory';

const tx = {} as Tx;
const ctx = {} as RequestContext;

describe('FakeUserDirectoryPort', () => {
  it('pickRoundRobin cycles the seeded list', async () => {
    const dir = new FakeUserDirectoryPort();
    dir.roundRobinMembers.set('queue_1', ['usr_A', 'usr_B']);
    const picks = [];
    for (let i = 0; i < 3; i++) picks.push((await dir.pickRoundRobin(tx, 'queue_1'))?.userId);
    expect(picks).toEqual(['usr_A', 'usr_B', 'usr_A']);
  });

  it('pickRoundRobin returns null for an empty queue', async () => {
    expect(await new FakeUserDirectoryPort().pickRoundRobin(tx, 'queue_x')).toBeNull();
  });
});

describe('FakeConsentPort', () => {
  it('finds only ACTIVE consent for the purpose', async () => {
    const consent = new FakeConsentPort();
    consent.consents.set('c1', {
      consentId: 'c1',
      customerId: 'cust_1',
      purpose: 'CONTACT',
      status: 'WITHDRAWN',
    });
    consent.consents.set('c2', {
      consentId: 'c2',
      customerId: 'cust_1',
      purpose: 'CONTACT',
      status: 'ACTIVE',
    });
    expect(await consent.findActive(tx, { customerId: 'cust_1', purpose: 'CONTACT' })).toEqual({
      consentId: 'c2',
    });
    expect(await consent.findActive(tx, { customerId: 'cust_1', purpose: 'MARKETING' })).toBeNull();
  });
});

describe('Module 9 — FakeTaskPort (Contracts)', () => {
  it('creates task, records command in commands list, and returns CreatedTask response', async () => {
    const taskPort = new FakeTaskPort();
    const cmd = {
      type: 'FOLLOW_UP' as const,
      title: 'First Contact Follow-up',
      owner: { userId: 'usr_01' },
      linked: { type: 'LEAD' as const, id: 'lead_01', branchId: 'br_01' },
      slaClass: 'CUSTOMER_FIRST_CONTACT' as const,
      idempotencyKey: 'idem_fake_task_01',
    };

    const res = await taskPort.createTask(tx, ctx, cmd);

    expect(taskPort.commands.length).toBe(1);
    expect(taskPort.commands[0]).toEqual(cmd);
    expect(res.taskId).toBe('task_fake_1');
    expect(res.dueAt).toBeDefined();
    expect(res.replayed).toBe(false);
  });
});

describe('P1-06 FakeKycCheckPort (Contracts)', () => {
  const request = { check: 'PAN' as const, idNumber: 'ABCDE1234F', caseId: 'idem_0123456789abcdef0123' };

  it('P1-06 records every request in order and answers VERIFIED when nothing is scripted', async () => {
    const port = new FakeKycCheckPort();

    const first = await port.run(tx, ctx, request);
    await port.run(tx, ctx, { ...request, check: 'GST', idNumber: '27ABCDE1234F1Z5' });

    expect(port.requests.map((r) => r.check)).toEqual(['PAN', 'GST']);
    expect(first).toMatchObject({ outcome: 'VERIFIED', verificationResult: 'VERIFIED', provider: 'FAKE' });
  });

  it('P1-06 uses scripted answers in order and repeats the last one', async () => {
    const port = new FakeKycCheckPort().respondWith(
      fakeKycResult({ outcome: 'MISMATCH', verificationResult: 'REJECTED', reason: 'ID_INVALID' }),
      fakeKycResult({ outcome: 'FAILED', verificationResult: 'INCONCLUSIVE', reason: 'NAME_NOT_RETURNED' }),
    );

    const results = [];
    for (let i = 0; i < 3; i++) results.push((await port.run(tx, ctx, request)).verificationResult);

    expect(results).toEqual(['REJECTED', 'INCONCLUSIVE', 'INCONCLUSIVE']);
  });

  it('P1-06 throws a scripted Error instead of returning it, so nothing is recorded as a result', async () => {
    const port = new FakeKycCheckPort().respondWith(new Error('vendor down'), fakeKycResult());

    await expect(port.run(tx, ctx, request)).rejects.toThrow('vendor down');
    await expect(port.run(tx, ctx, request)).resolves.toMatchObject({ outcome: 'VERIFIED' });
    expect(port.requests).toHaveLength(2);
  });

  it('P1-06 the default result carries masked data only, never the identifier it was asked about', async () => {
    const result = await new FakeKycCheckPort().run(tx, ctx, request);

    expect(JSON.stringify(result)).not.toContain(request.idNumber);
    expect(result.identifierMasked).toBe('ABCDE****F');
  });

  it('P1-06 takes a bank-account request, and an unknown outcome of the penny drop can be scripted as INCONCLUSIVE', async () => {
    const bank = {
      check: 'BANK_ACCOUNT' as const,
      accountNumber: '123456789012',
      ifsc: 'HDFC0001234',
      caseId: request.caseId,
    };
    const port = new FakeKycCheckPort().respondWith(
      fakeKycResult({
        outcome: 'FAILED',
        verificationResult: 'INCONCLUSIVE',
        reason: 'OUTCOME_UNKNOWN',
        identifierMasked: '********9012',
      }),
    );

    const result = await port.run(tx, ctx, bank);

    expect(port.requests).toEqual([bank]);
    expect(result).toMatchObject({
      outcome: 'FAILED',
      verificationResult: 'INCONCLUSIVE',
      reason: 'OUTCOME_UNKNOWN',
      identifierMasked: '********9012',
    });
    expect(JSON.stringify(result)).not.toContain(bank.accountNumber);
  });
});
