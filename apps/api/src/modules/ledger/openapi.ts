// apps/api/src/modules/ledger/openapi.ts — MOD-LED Ledger Management OpenAPI specs
import {
  AccountBalanceResponseSchema,
  CloseLedgerPeriodInputSchema,
  ConnectorStatementResponseSchema,
  CreateLedgerAccountInputSchema,
  CreateLedgerExportInputSchema,
  LedgerAccountSchema,
  LedgerExportResponseSchema,
  LedgerJournalSchema,
  PeriodCloseResponseSchema,
  PostJournalInputSchema,
} from '@dsa/contracts';
import type { OpenAPIRegistry } from '@dsa/contracts/openapi';
import { z } from 'zod';

export const tags = [
  {
    name: 'MOD-LED Ledger Management',
    description: 'Double-entry ledger, accounts, journals, balances, and period close (MOD-LED).',
  },
];

export function registerOpenApi(registry: OpenAPIRegistry): void {
  registry.register('LedgerAccount', LedgerAccountSchema);
  registry.register('LedgerJournal', LedgerJournalSchema);
  registry.register('AccountBalanceResponse', AccountBalanceResponseSchema);
  registry.register('ConnectorStatementResponse', ConnectorStatementResponseSchema);
  registry.register('PeriodCloseResponse', PeriodCloseResponseSchema);
  registry.register('LedgerExportResponse', LedgerExportResponseSchema);

  // API-LED-001: GET /v1/ledger/accounts
  registry.registerPath({
    method: 'get',
    path: '/v1/ledger/accounts',
    operationId: 'API-LED-001',
    summary: 'List ledger accounts (API-LED-001)',
    tags: ['MOD-LED Ledger Management'],
    responses: {
      200: {
        description: 'Ledger accounts list',
        content: { 'application/json': { schema: z.object({ data: z.array(LedgerAccountSchema) }) } },
      },
    },
  });

  // POST /v1/ledger/accounts
  registry.registerPath({
    method: 'post',
    path: '/v1/ledger/accounts',
    operationId: 'API-LED-001-CREATE',
    summary: 'Create ledger account',
    tags: ['MOD-LED Ledger Management'],
    request: {
      body: { content: { 'application/json': { schema: CreateLedgerAccountInputSchema } }, required: true },
    },
    responses: {
      201: {
        description: 'Account created',
        content: { 'application/json': { schema: LedgerAccountSchema } },
      },
    },
  });

  // API-LED-002: GET /v1/ledger/journals
  registry.registerPath({
    method: 'get',
    path: '/v1/ledger/journals',
    operationId: 'API-LED-002',
    summary: 'List ledger journals with cursor pagination (API-LED-002)',
    tags: ['MOD-LED Ledger Management'],
    responses: {
      200: {
        description: 'Journals list',
        content: {
          'application/json': {
            schema: z.object({
              data: z.array(LedgerJournalSchema),
              nextCursor: z.string().nullable(),
            }),
          },
        },
      },
    },
  });

  // POST /v1/ledger/journals
  registry.registerPath({
    method: 'post',
    path: '/v1/ledger/journals',
    operationId: 'API-LED-002-POST',
    summary: 'Post balanced double-entry journal',
    tags: ['MOD-LED Ledger Management'],
    request: {
      body: { content: { 'application/json': { schema: PostJournalInputSchema } }, required: true },
    },
    responses: {
      201: {
        description: 'Journal posted',
        content: { 'application/json': { schema: LedgerJournalSchema } },
      },
    },
  });

  // API-LED-003: POST /v1/ledger/periods/{period}/close
  registry.registerPath({
    method: 'post',
    path: '/v1/ledger/periods/{period}/close',
    operationId: 'API-LED-003',
    summary: 'Close ledger accounting period with step-up MFA and maker-checker validation (API-LED-003)',
    tags: ['MOD-LED Ledger Management'],
    request: {
      params: z.object({ period: z.string() }),
      body: { content: { 'application/json': { schema: CloseLedgerPeriodInputSchema } } },
    },
    responses: {
      200: {
        description: 'Period closed',
        content: { 'application/json': { schema: PeriodCloseResponseSchema } },
      },
    },
  });

  // API-LED-004: GET /v1/ledger/accounts/{id}/balance
  registry.registerPath({
    method: 'get',
    path: '/v1/ledger/accounts/{id}/balance',
    operationId: 'API-LED-004',
    summary: 'Get account balance with as-of-date calculation (API-LED-004)',
    tags: ['MOD-LED Ledger Management'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Account balance summary',
        content: { 'application/json': { schema: AccountBalanceResponseSchema } },
      },
    },
  });

  // API-LED-005: GET /v1/connectors/{id}/statements
  registry.registerPath({
    method: 'get',
    path: '/v1/connectors/{id}/statements',
    operationId: 'API-LED-005',
    summary: 'Get connector sub-ledger statement (API-LED-005)',
    tags: ['MOD-LED Ledger Management'],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: 'Connector financial statement',
        content: { 'application/json': { schema: ConnectorStatementResponseSchema } },
      },
    },
  });

  // API-LED-006: POST /v1/ledger/exports
  registry.registerPath({
    method: 'post',
    path: '/v1/ledger/exports',
    operationId: 'API-LED-006',
    summary: 'Queue accounting ledger export job (API-LED-006)',
    tags: ['MOD-LED Ledger Management'],
    request: {
      body: { content: { 'application/json': { schema: CreateLedgerExportInputSchema } } },
    },
    responses: {
      202: {
        description: 'Export queued',
        content: { 'application/json': { schema: LedgerExportResponseSchema } },
      },
    },
  });
}
