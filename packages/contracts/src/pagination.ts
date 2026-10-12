// packages/contracts/src/pagination.ts — owner: Dev 1 — frozen at Gate 1
// Lists return { data: [...], meta: { nextCursor, limit } } (ADR-4D-07). The cursor is base64url of
// {"k": <last sort value>, "id": <last id>}; sorting is always stable on (sort field, id) — Contracts §5.
import { z } from 'zod';

export const ListMeta = z.object({
  nextCursor: z.string().nullable(),
  limit: z.number().int(),
});
export type ListMeta = z.infer<typeof ListMeta>;

export const CursorQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});
export type CursorQuery = z.infer<typeof CursorQuery>;

export function listResponse<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), meta: ListMeta });
}
