// TEST-WEB-STAGE stage checklists and stage selection on the loan file (2026-11-28). Synthetic values only.
import { describe, expect, it } from 'vitest';
import { JOURNEY, journeyState, selectedStageIndex, stagePosition } from './loan-file';
import { openChecks, stageChecks, type FileFacts } from './stage-checks';

const facts = (over: Partial<FileFacts> = {}): FileFacts => ({
  productCategory: 'PL',
  productChosen: false,
  tenureMonths: 36,
  purposeCode: 'MEDICAL',
  borrowerIncome: true,
  coApplicants: 0,
  collateralItems: 0,
  checklist: null,
  eligibleLenders: null,
  lenderCases: null,
  ...over,
});
const states = (stage: Parameters<typeof stageChecks>[0], f: FileFacts) =>
  stageChecks(stage, f).map((c) => c.state);

describe('TEST-WEB-STAGE stage checklists', () => {
  it('TEST-WEB-STAGE-01 draft: income, request and product are needed; co-applicants are optional; property only for a secured loan', () => {
    expect(states('draft', facts())).toEqual(['done', 'done', 'optional', 'optional', 'todo']);
    expect(states('draft', facts({ productCategory: 'HL' }))[3]).toBe('todo');
    expect(states('draft', facts({ productCategory: 'HL', collateralItems: 1 }))[3]).toBe('done');
    expect(states('draft', facts({ borrowerIncome: null, purposeCode: null }))).toEqual([
      'unknown',
      'todo',
      'optional',
      'optional',
      'todo',
    ]);
    expect(openChecks(stageChecks('draft', facts({ productChosen: true })))).toBe(0);
  });

  it('TEST-WEB-STAGE-02 documents: the checklist exists and every mandatory document is accepted', () => {
    expect(
      states('documents', facts({ checklist: { total: 6, outstandingMandatory: 6, complete: false } })),
    ).toEqual(['done', 'todo']);
    const label = stageChecks(
      'documents',
      facts({ checklist: { total: 6, outstandingMandatory: 2, complete: false } }),
    )[1]!.label;
    expect(label).toMatch(/2 still outstanding/);
    expect(
      states('documents', facts({ checklist: { total: 6, outstandingMandatory: 0, complete: true } })),
    ).toEqual(['done', 'done']);
  });

  it('TEST-WEB-STAGE-03 review needs verified documents and at least one eligible lender; unreadable is unknown, never done', () => {
    expect(states('review', facts())).toEqual(['unknown', 'unknown']);
    expect(
      states(
        'review',
        facts({ checklist: { total: 6, outstandingMandatory: 0, complete: true }, eligibleLenders: 2 }),
      ),
    ).toEqual(['done', 'done']);
    expect(states('review', facts({ eligibleLenders: 0 }))[1]).toBe('todo');
  });

  it('TEST-WEB-STAGE-04 ready, with lender and sanctioned follow the lender case', () => {
    expect(states('ready', facts({ lenderCases: ['PACKAGE_READY'] }))).toEqual(['done', 'done', 'todo']);
    expect(states('lender', facts({ lenderCases: ['QUERY_RAISED'] }))).toEqual(['done', 'todo', 'todo']);
    expect(states('sanctioned', facts({ lenderCases: ['SANCTIONED'] }))).toEqual(['done', 'todo']);
    expect(states('ready', facts())).toEqual(['unknown', 'unknown', 'unknown']);
  });
});

describe('TEST-WEB-STAGE stage selection', () => {
  const at = (k: string) => JOURNEY.findIndex((j) => j.key === k);

  it('TEST-WEB-STAGE-05 the page opens on the current stage unless the address names one', () => {
    const j = journeyState('DOCUMENTS_PENDING');
    expect(selectedStageIndex(null, j)).toBe(at('documents'));
    expect(selectedStageIndex('draft', j)).toBe(at('draft'));
    expect(selectedStageIndex('nonsense', j)).toBe(at('documents'));
  });

  it('TEST-WEB-STAGE-06 each stage is done, current, upcoming, or where a stopped file stopped', () => {
    const j = journeyState('DOCUMENTS_PENDING');
    expect([0, 1, 2].map((i) => stagePosition(i, j))).toEqual(['done', 'current', 'upcoming']);
    const cancelled = journeyState('CANCELLED', [{ fromStatus: 'DOCUMENTS_PENDING', toStatus: 'CANCELLED' }]);
    expect(stagePosition(at('documents'), cancelled)).toBe('stopped');
    expect(stagePosition(at('disbursed'), journeyState('DISBURSED'))).toBe('done');
  });
});
