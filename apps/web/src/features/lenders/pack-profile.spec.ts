// P2-04 pack profile editor helpers (owner: Dipanshu). Reordering, the pattern check and the file-name preview.
import { describe, expect, it } from 'vitest';
import { move, patternError, previewNames } from './pack-profile';

describe('P2-04 pack profile helpers', () => {
  it('TEST-PACK-WEB-001 move swaps neighbours and ignores moves off either end', () => {
    expect(move(['PAN', 'ITR', 'BANK_STATEMENT'], 1, -1)).toEqual(['ITR', 'PAN', 'BANK_STATEMENT']);
    expect(move(['PAN', 'ITR'], 0, -1)).toEqual(['PAN', 'ITR']);
    expect(move(['PAN', 'ITR'], 1, 1)).toEqual(['PAN', 'ITR']);
  });

  it('TEST-PACK-WEB-002 the pattern check matches the API: {seq} required, known tokens only', () => {
    expect(patternError('{seq}_{docType}')).toBeNull();
    expect(patternError('{docType}_x')).toMatch(/\{seq\}/);
    expect(patternError('{seq}_{name}')).toMatch(/tokens/);
  });

  it('TEST-PACK-WEB-003 the preview lists the listed types first, then an unlisted one, named by the pattern', () => {
    expect(previewNames(['PAN', 'BANK_STATEMENT'], '{seq}_{docType}_{party}')).toEqual([
      '1_PAN_Applicant.pdf',
      '2_BANK_STATEMENT_Applicant.pdf',
      '3_OTHER_Applicant.pdf',
    ]);
    expect(previewNames([], 'bad')).toEqual([]);
  });
});
