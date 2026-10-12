// packages/contracts/src/ids.ts — owner: Dev 1 — frozen at Gate 1
// Identifiers are ULIDs with a type prefix, e.g. lead_01J… (ADR-013). newId(prefix) lives in the kernel (TASK-101).
import { z } from 'zod';

// Prefixes named in the Contracts and Migration Plan pages.
// TODO(TASK-101, Dev 1): complete this list for every MVP table before Gate 1 (each owner proposes theirs by PR).
// Platform (Dev 1, TASK-103/104): org, br, team, tm, role, ura, wq, wqm.
export const ID_PREFIXES = [
  'ten',
  'usr',
  'org',
  'br',
  'team',
  'tm',
  'role',
  'ura',
  'wq',
  'wqm',
  'lead',
  'app',
  'task',
  'pkg',
  'dr',
  'aud',
  'evt',
] as const;
export type IdPrefix = (typeof ID_PREFIXES)[number];

const ULID = '[0-9A-HJKMNP-TV-Z]{26}';

export function IdSchema<P extends IdPrefix>(prefix: P) {
  return z.string().regex(new RegExp(`^${prefix}_${ULID}$`), `must be a ${prefix}_ identifier`);
}
