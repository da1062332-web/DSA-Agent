// Query client with one place that reports every write (owner: Dev 1). A mutation shows a success toast from
// meta.successMessage and an error toast from the API error, so each screen confirms and fails the same way.
// Set meta.silent when the screen shows its own result, and meta.handled when the mutation already raised its toast.
import { MutationCache, QueryClient } from '@tanstack/react-query';
import { ApiError, errorText } from '../api/client';
import { toastBridge } from './toast';

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { successMessage?: string; silent?: boolean; handled?: boolean };
  }
}

/** A refused or not found request (400, 401, 403, 404, 422) gets the same answer on retry, so only transient failures are retried. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= 3) return false;
  const status =
    error instanceof ApiError
      ? error.httpStatus
      : typeof (error as any)?.httpStatus === 'number'
        ? (error as any).httpStatus
        : typeof (error as any)?.status === 'number'
          ? (error as any).status
          : undefined;
  if (status !== undefined && [400, 401, 403, 404, 422].includes(status)) return false;
  return true;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: shouldRetry } },
    mutationCache: new MutationCache({
      onSuccess: (_data, _vars, _ctx, mutation) => {
        const meta = mutation.meta;
        if (meta?.silent || meta?.handled) return;
        if (meta?.successMessage) toastBridge.success(meta.successMessage);
      },
      onError: (error, _vars, _ctx, mutation) => {
        const meta = mutation.meta;
        if (meta?.silent || meta?.handled) return;
        toastBridge.error(errorText(error));
      },
    }),
  });
}
