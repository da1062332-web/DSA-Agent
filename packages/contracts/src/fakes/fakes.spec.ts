import { describe, expect, it } from 'vitest';
import type { Tx } from '../kernel';
import { FakeConsentPort } from './fake-consent';
import { FakeUserDirectoryPort } from './fake-user-directory';

const tx = {} as Tx;

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
