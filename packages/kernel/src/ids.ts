// Prefixed ULIDs (ADR-013) — owner: Dev 1 — TASK-101.
import type { IdGenerator, IdPrefix } from '@dsa/contracts';
import { monotonicFactory } from 'ulid';

export function createIdGenerator(): IdGenerator {
  const ulid = monotonicFactory();
  return { next: (prefix: IdPrefix) => `${prefix}_${ulid()}` };
}
