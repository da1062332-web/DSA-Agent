// Compact OpenAPI path registration (owner: Dev 1). Modules describe an operation once; this adds the path parameters from
// the Express path, the Idempotency-Key and If-Match headers when the route requires them (Contracts §5), and the standard
// error envelope (Contracts §6).
import { ErrorEnvelope } from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z, type AnyZodObject, type ZodTypeAny } from 'zod';

export interface OperationSpec {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** Express-style path, e.g. /v1/connectors/:id/agreements. */
  path: string;
  operationId: string;
  summary: string;
  tag: string;
  query?: AnyZodObject;
  body?: ZodTypeAny;
  response?: ZodTypeAny;
  /** Success status; default 200 (201 for creating POSTs is set by the caller). */
  status?: number;
  idempotent?: boolean;
  ifMatch?: boolean;
  /** Unauthenticated route (/public/v1). */
  public?: boolean;
}

const errors = {
  401: 'Not authenticated',
  403: 'Missing permission',
  404: 'Not found, or outside the caller tenant or scope',
  409: 'Conflict (version, state or idempotency)',
  422: 'Validation failed',
} as const;

/** A JSON object whose fields are described by the linked schema in @dsa/contracts. */
export const JsonObject = z.record(z.unknown());

export function registerOperation(registry: OpenAPIRegistry, op: OperationSpec): void {
  const params = [...op.path.matchAll(/:(\w+)/g)].map((m) => m[1]!);
  const headers: Record<string, ZodTypeAny> = {};
  if (op.idempotent) headers['Idempotency-Key'] = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
  if (op.ifMatch) headers['If-Match'] = z.string();
  const errorResponses = Object.fromEntries(
    Object.entries(errors)
      .filter(([code]) => !(op.public && (code === '401' || code === '403')))
      .map(([code, description]) => [
        code,
        { description, content: { 'application/json': { schema: ErrorEnvelope } } },
      ]),
  );
  registry.registerPath({
    method: op.method,
    path: op.path.replace(/:(\w+)/g, '{$1}'),
    operationId: op.operationId,
    summary: op.summary,
    tags: [op.tag],
    ...(op.public ? { security: [] } : {}),
    request: {
      ...(params.length ? { params: z.object(Object.fromEntries(params.map((p) => [p, z.string()]))) } : {}),
      ...(op.query ? { query: op.query } : {}),
      ...(Object.keys(headers).length ? { headers: z.object(headers) } : {}),
      ...(op.body ? { body: { content: { 'application/json': { schema: op.body } }, required: true } } : {}),
    },
    responses: {
      [op.status ?? 200]: {
        description: 'Success',
        content: { 'application/json': { schema: op.response ?? JsonObject } },
      },
      ...errorResponses,
    },
  });
}
