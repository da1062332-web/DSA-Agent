// apps/web/src/features/lender-cases/lender-query.spec.ts — owner: Dev 4 (MOD-LCS Queries)
import { describe, expect, it } from 'vitest';
import { oldestOpenLenderQuery } from './lender-query';
import type { LenderQueryHistory } from './types';

const query = (id: string, respondedAt: string | null): LenderQueryHistory => ({
  id,
  tenantId: 'ten_test',
  lenderCaseId: 'lcs_test',
  text: `question ${id}`,
  requestedItems: [],
  lenderDueDate: null,
  taskId: null,
  responseManifestId: respondedAt ? 'pkg_test' : null,
  respondedAt,
  createdAt: '2026-10-26T09:00:00Z',
  createdBy: 'usr_test',
  responseText: respondedAt ? 'answer' : null,
  responseDocumentReferences: [],
});

describe('Module 18 — oldestOpenLenderQuery (MOD-LCS queries)', () => {
  it('returns null when there are no queries', () => {
    expect(oldestOpenLenderQuery([])).toBeNull();
  });

  it('returns null when every query is already answered', () => {
    expect(oldestOpenLenderQuery([query('lq_1', '2026-10-26T10:00:00Z')])).toBeNull();
  });

  it('answers the oldest open query, skipping answered ones', () => {
    const picked = oldestOpenLenderQuery([
      query('lq_1', '2026-10-26T10:00:00Z'),
      query('lq_2', null),
      query('lq_3', null),
    ]);
    expect(picked?.id).toBe('lq_2');
  });
});
