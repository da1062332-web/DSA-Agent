import { describe, expect, it } from 'vitest';
import {
  NO_PROMISE,
  RESULT_LABELS,
  canOverride,
  isValidOverrideReason,
  latestAssessment,
  type EligibilityAssessment,
  type ProductResult,
} from './eligibility';

const result = (r: ProductResult['result'], id = 'prv_a_1'): ProductResult => ({ productVersionId: id, result: r, criteria: [] });
const assessment = (id: string, results: ProductResult[], overrides: EligibilityAssessment['overrides'] = []): EligibilityAssessment => ({
  id,
  applicationId: 'app_1',
  assessedAt: '2026-10-15T00:00:00.000Z',
  results,
  decisionRecordIds: [],
  overrides,
  createdBy: 'usr_1',
  version: 0,
});

describe('eligibility rules (MOD-ELG)', () => {
  it('TEST-ELG-WEB-001 the newest assessment is the last in the list, and none gives undefined', () => {
    expect(latestAssessment([assessment('elg_1', []), assessment('elg_2', [])])?.id).toBe('elg_2');
    expect(latestAssessment([])).toBeUndefined();
  });

  it('TEST-ELG-WEB-002 an override reason must be 10 to 500 characters after trimming', () => {
    expect(isValidOverrideReason('too short')).toBe(false);
    expect(isValidOverrideReason('   a b c d e   ')).toBe(false);
    expect(isValidOverrideReason('Income proof reviewed by the branch manager')).toBe(true);
    expect(isValidOverrideReason('x'.repeat(501))).toBe(false);
  });

  it('TEST-ELG-WEB-003 only a failed result that is not already overridden can be overridden', () => {
    expect(canOverride(assessment('e', [result('UNKNOWN')]), result('UNKNOWN'))).toBe(false);
    expect(canOverride(assessment('e', [result('PASS')]), result('PASS'))).toBe(false);
    expect(canOverride(assessment('e', [result('FAIL')]), result('FAIL'))).toBe(true);
    const done = [{ productVersionId: 'prv_a_1', reason: 'r'.repeat(12), overriddenBy: 'u', overriddenAt: '2026-10-15T00:00:00.000Z' }];
    expect(canOverride(assessment('e', [result('FAIL')], done), result('FAIL'))).toBe(false);
  });

  it('TEST-ELG-WEB-004 every result has plain wording, and the no-promise line says it is not an approval', () => {
    expect(Object.keys(RESULT_LABELS).sort()).toEqual(['FAIL', 'PASS', 'UNKNOWN']);
    expect(RESULT_LABELS.UNKNOWN).toBe('Cannot be assessed yet');
    expect(NO_PROMISE).toMatch(/does not approve/);
  });
});
