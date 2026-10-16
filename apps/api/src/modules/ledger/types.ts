// apps/api/src/modules/ledger/types.ts — MOD-LED Ledger Management
export * from '@dsa/contracts';

export interface LedgerAccountRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  type: string;
  counterparty_type: string | null;
  counterparty_id: string | null;
  currency: string;
  is_active: boolean;
  lock_version: number;
  created_at: Date;
  updated_at: Date;
}

export interface LedgerJournalRow {
  id: string;
  tenant_id: string;
  journal_number: string;
  reference_type: string;
  reference_id: string;
  idempotency_key: string | null;
  period: string;
  status: 'POSTED' | 'REVERSED' | 'CLOSED';
  reversal_of_journal_id: string | null;
  posted_at: Date;
  posted_by: string;
  created_at: Date;
}

export interface LedgerEntryRow {
  id: string;
  tenant_id: string;
  journal_id: string;
  account_id: string;
  entry_type: 'DEBIT' | 'CREDIT';
  amount: string;
  currency: string;
  narration: string | null;
  line_number: number;
  created_at: Date;
}

export interface LedgerPeriodRow {
  id: string;
  tenant_id: string;
  period: string;
  status: 'OPEN' | 'CLOSED';
  closed_at: Date | null;
  closed_by: string | null;
  closing_note: string | null;
  created_at: Date;
}
