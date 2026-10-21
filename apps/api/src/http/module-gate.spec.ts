// MOD-TEN entitlements gate (owner: Dev 1).
import { describe, expect, it } from 'vitest';
import { moduleOf } from './module-gate';

describe('module gate', () => {
  it('TEST-TEN-ENT-01 maps gated paths to their module and leaves Workflow A ungated', () => {
    expect(moduleOf('/automations/executions')).toBe('MOD-WFA');
    expect(moduleOf('/payout-requests/x/approval')).toBe('MOD-PAY');
    expect(moduleOf('/webhook-deliveries')).toBe('MOD-API');
    expect(moduleOf('/leads')).toBeNull();
    expect(moduleOf('/applications/app_1/checklist')).toBeNull();
    expect(moduleOf('/lender-cases')).toBeNull();
    expect(moduleOf('/tasks')).toBeNull();
  });
});
