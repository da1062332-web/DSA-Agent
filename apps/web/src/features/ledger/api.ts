// apps/web/src/features/ledger/api.ts — MOD-LED Web API
import { apiFetch } from '../../api/client';
import type {
  AccountBalanceResponse,
  CloseLedgerPeriodInput,
  ConnectorStatementResponse,
  CreateLedgerAccountInput,
  CreateLedgerExportInput,
  GetAccountBalanceQuery,
  GetConnectorStatementsQuery,
  LedgerAccount,
  LedgerExportResponse,
  LedgerJournal,
  ListLedgerAccountsQuery,
  ListLedgerJournalsQuery,
  PeriodCloseResponse,
} from '@dsa/contracts';

export async function fetchLedgerAccounts(
  query?: ListLedgerAccountsQuery,
): Promise<{ data: LedgerAccount[] }> {
  return apiFetch<{ data: LedgerAccount[] }>('/v1/ledger/accounts', {
    query: query as any,
  });
}

export async function createLedgerAccount(input: CreateLedgerAccountInput): Promise<LedgerAccount> {
  return apiFetch<LedgerAccount>('/v1/ledger/accounts', {
    method: 'POST',
    body: input,
  });
}

export async function fetchLedgerJournals(
  query?: ListLedgerJournalsQuery,
): Promise<{ data: LedgerJournal[]; nextCursor: string | null }> {
  return apiFetch<{ data: LedgerJournal[]; nextCursor: string | null }>('/v1/ledger/journals', {
    query: query as any,
  });
}

export async function fetchAccountBalance(id: string, asOfDate?: string): Promise<AccountBalanceResponse> {
  return apiFetch<AccountBalanceResponse>(`/v1/ledger/accounts/${id}/balance`, {
    query: asOfDate ? { asOfDate } : undefined,
  });
}

export async function fetchConnectorStatements(
  id: string,
  query?: GetConnectorStatementsQuery,
): Promise<ConnectorStatementResponse> {
  return apiFetch<ConnectorStatementResponse>(`/v1/connectors/${id}/statements`, {
    query: query as any,
  });
}

export async function closeLedgerPeriod(
  period: string,
  input: CloseLedgerPeriodInput,
): Promise<PeriodCloseResponse> {
  return apiFetch<PeriodCloseResponse>(`/v1/ledger/periods/${period}/close`, {
    method: 'POST',
    body: input,
  });
}

export async function createLedgerExport(input: CreateLedgerExportInput): Promise<LedgerExportResponse> {
  return apiFetch<LedgerExportResponse>('/v1/ledger/exports', {
    method: 'POST',
    body: input,
  });
}

export async function fetchTrialBalance(period?: string): Promise<{
  period?: string;
  totalDebit: string;
  totalCredit: string;
  variance: string;
  isBalanced: boolean;
}> {
  return apiFetch('/v1/ledger/trial-balance', {
    query: period ? { period } : undefined,
  });
}
