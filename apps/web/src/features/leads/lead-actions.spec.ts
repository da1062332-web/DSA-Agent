import { describe, expect, it } from 'vitest';
import { leadActions } from './lead-actions';

describe('leadActions: reopen capability (LEAD-09)', () => {
  it('offers reopen for DISQUALIFIED lead when user has lead.reopen permission', () => {
    const actions = leadActions('DISQUALIFIED', (code) => code === 'lead.reopen');
    expect((actions as unknown as { reopen: boolean }).reopen).toBe(true);
  });

  it('offers reopen for NOT_CONTACTABLE lead when user has lead.reopen permission', () => {
    const actions = leadActions('NOT_CONTACTABLE', (code) => code === 'lead.reopen');
    expect((actions as unknown as { reopen: boolean }).reopen).toBe(true);
  });

  it('denies reopen if user lacks lead.reopen permission', () => {
    const actions = leadActions('DISQUALIFIED', () => false);
    expect((actions as unknown as { reopen: boolean }).reopen).toBe(false);
  });

  it('denies reopen if lead is in open state (e.g. NEW or IN_PROGRESS)', () => {
    const actions = leadActions('NEW', () => true);
    expect((actions as unknown as { reopen: boolean }).reopen).toBe(false);
  });
});
