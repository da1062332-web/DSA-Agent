// Swagger must document every route the API serves (owner: Dev 1). A route added without an OpenAPI entry, or an
// operation without a module tag, fails here.
import { buildOpenApiDocument } from '../src/openapi';
import { createRouter as createPlatformRouter } from '../src/modules/platform/router';
import { describe, expect, it } from 'vitest';
import { testDeps } from './support/fake-auth';

type Doc = {
  paths: Record<string, Record<string, { tags?: string[]; operationId?: string }>>;
  tags?: { name: string }[];
};
const doc = buildOpenApiDocument() as unknown as Doc;

/** Express paths use `:id`; OpenAPI uses `{id}`. */
const toOpenApi = (p: string) => p.replace(/:([A-Za-z]+)/g, '{$1}');

function servedOperations(): string[] {
  const router = createPlatformRouter(testDeps());
  return router.stack.flatMap((layer) => {
    const route = layer.route as { path: string; methods: Record<string, boolean> } | undefined;
    if (!route) return [];
    return Object.keys(route.methods).map((m) => `${m} /v1${toOpenApi(route.path)}`);
  });
}

describe('Swagger document covers the served API', () => {
  it('TEST-DOC-001 every /v1 route the platform serves is documented', () => {
    const documented = new Set(
      Object.entries(doc.paths).flatMap(([p, methods]) => Object.keys(methods).map((m) => `${m} ${p}`)),
    );
    const missing = servedOperations().filter((op) => !documented.has(op));
    expect(missing, 'add these to apps/api/src/modules/platform/openapi.ts').toEqual([]);
  });

  it('TEST-DOC-002 every documented operation has exactly one module tag, and that tag is declared', () => {
    const declared = new Set((doc.tags ?? []).map((t) => t.name));
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        expect(op.tags?.length, `${method.toUpperCase()} ${path} needs one tag`).toBe(1);
        expect(declared.has(op.tags![0]!), `${op.tags![0]} is not declared in tags`).toBe(true);
      }
    }
  });

  it('TEST-DOC-003 every operation has an operationId (used by the isolation inventory)', () => {
    for (const [path, methods] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        expect(op.operationId, `${method.toUpperCase()} ${path}`).toBeTruthy();
      }
    }
  });
});
