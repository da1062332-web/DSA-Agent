// apps/web/src/features/lender-cases/lender-query.ts — owner: Dev 4 (MOD-LCS Queries)
import type { LenderQueryHistory } from './types';

/**
 * The query a response answers: the oldest one the lender has not had an answer to yet.
 * The response is sent to this query's own id; the case id is never a query id.
 */
export function oldestOpenLenderQuery(queries: readonly LenderQueryHistory[]): LenderQueryHistory | null {
  return queries.find((q) => !q.respondedAt) ?? null;
}
