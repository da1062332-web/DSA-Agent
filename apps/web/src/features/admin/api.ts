// Admin data hooks (owner: Dev 1) — organisation, branches, teams, work queues, users. Everything comes from the
// platform API; nothing is cached outside TanStack Query.
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useRef } from 'react';
import { apiFetch, errorText, newIdempotencyKey, type ApiRequest } from '../../api/client';
import { useToast } from '../../shell/toast';

export interface ListPage<T> {
  data: T[];
  meta: { nextCursor: string | null; limit: number };
}

export interface Organisation {
  id: string;
  legalName: string;
  constitution: string;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Branch {
  id: string;
  organisationId: string;
  code: string;
  name: string;
  pincode: string | null;
  timezone: string;
  status: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Team {
  id: string;
  name: string;
  branchId: string | null;
  managerUserId: string | null;
  status: string;
  memberCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface TeamDetail extends Team {
  members: { userId: string; displayName: string; since: string }[];
}

export type QueueKind = 'INTAKE' | 'UNASSIGNED' | 'TEAM' | 'FUNCTIONAL' | 'EXCEPTION';
export type RecordType = 'LEAD' | 'APPLICATION' | 'TASK';
export interface WorkQueue {
  id: string;
  code: string;
  name: string;
  kind: QueueKind;
  branchId: string | null;
  teamId: string | null;
  recordTypes: RecordType[];
  active: boolean;
  memberCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface QueueMember {
  userId: string;
  displayName: string;
  canPick: boolean;
  canAssign: boolean;
  since: string;
}
export interface WorkQueueDetail extends WorkQueue {
  members: QueueMember[];
}

export interface UserSummary {
  id: string;
  displayName: string;
  primaryBranchId: string;
  status: string;
  availability: string;
}

export const CONSTITUTIONS = [
  'PROPRIETORSHIP',
  'PARTNERSHIP',
  'LLP',
  'PVT_LTD',
  'PUBLIC_LTD',
  'TRUST',
  'OTHER',
];
export const QUEUE_KINDS: QueueKind[] = ['INTAKE', 'UNASSIGNED', 'TEAM', 'FUNCTIONAL', 'EXCEPTION'];
export const RECORD_TYPES: RecordType[] = ['LEAD', 'APPLICATION', 'TASK'];

type Filters = Record<string, string | undefined>;

/** Cursor-paged list (Contracts §5): pages are fetched on demand with "Load more". */
export function useList<T>(path: string, filters: Filters = {}, limit = 50, enabled = true) {
  return useInfiniteQuery({
    enabled,
    queryKey: [path, filters],
    queryFn: ({ pageParam }) =>
      apiFetch<ListPage<T>>(path, { query: { ...filters, limit, cursor: pageParam ?? undefined } }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.meta.nextCursor,
  });
}

/** Up to 200 rows for pickers and id → name lookups. */
export function useLookup<T>(path: string, filters: Filters = {}, enabled = true) {
  return useQuery({
    queryKey: [path, 'lookup', filters],
    queryFn: () => apiFetch<ListPage<T>>(path, { query: { ...filters, limit: 200 } }).then((p) => p.data),
    staleTime: 30_000,
    enabled,
  });
}

export function useResource<T>(path: string | null) {
  return useQuery({
    queryKey: [path],
    queryFn: () => apiFetch<T>(path!),
    enabled: !!path,
  });
}

/**
 * A write that invalidates the given list keys on success. POSTs keep one Idempotency-Key per open form, so a
 * retry after a network error cannot create the record twice; call `resetKey()` when the form is reopened.
 */
export function useCommand<TBody, TResult>(
  request: (body: TBody) => { path: string } & Omit<ApiRequest, 'body' | 'idempotencyKey'>,
  invalidate: QueryKey[],
  /** Toast shown when the write succeeds. Pass null for none (for example when the screen shows its own result). */
  successMessage: string | null = 'Saved.',
) {
  const qc = useQueryClient();
  const toast = useToast();
  const key = useRef(newIdempotencyKey());
  const mutation = useMutation({
    meta: { handled: true },
    mutationFn: (body: TBody) => {
      const { path, ...rest } = request(body);
      return apiFetch<TResult>(path, {
        ...rest,
        body,
        idempotencyKey: rest.method === 'POST' ? key.current : undefined,
      });
    },
    onSuccess: async () => {
      key.current = newIdempotencyKey();
      if (successMessage) toast.success(successMessage);
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
    },
    onError: (err) => toast.error(errorText(err)),
  });
  return { ...mutation, resetKey: () => (key.current = newIdempotencyKey()) };
}
