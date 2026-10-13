import { describe, expect, it } from 'vitest';
import type { RequestContext, Tx } from '../kernel';
import { FakeConsentPort } from './fake-consent';
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
