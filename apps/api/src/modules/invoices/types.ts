// apps/api/src/modules/invoices/types.ts — Module 33: Invoices (MOD-INV) types
export type {
  InvoiceDirection,
  InvoiceStatus,
  LedgerEntryType,
  TaxFields,
  CreateInvoiceInput,
  UpdateInvoiceStatusInput,
  InvoiceListQuery,
  StatementQuery,
  InvoiceRecord,
  LedgerEntryRecord,
  ConnectorStatementLine,
  ConnectorStatement,
} from '@dsa/contracts';

export interface InvoiceRow {
  id: string;
  tenant_id: string;
  direction: 'TO_LENDER' | 'FROM_CONNECTOR';
  number: string;
  date: string | Date;
  due_date: string | Date | null;
  amount: string | number;
  currency: string;
  tax_fields: any;
  status: 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID';
  calculation_ids: string[];
  party_id: string;
  party_name: string | null;
  notes: string | null;
  lock_version: number;
  created_at: string | Date;
  created_by: string;
  updated_at: string | Date;
  updated_by: string;
}

export interface LedgerEntryRow {
  id: string;
  tenant_id: string;
  connector_id: string;
  entry_type: 'COMMISSION_EARNED' | 'PAYOUT_DISBURSED' | 'ADJUSTMENT' | 'TAX_DEDUCTION' | 'OPENING_BALANCE';
  amount: string | number;
  currency: string;
  reference_id: string | null;
  description: string | null;
  entry_date: string | Date;
  balance_after: string | number;
  lock_version: number;
  created_at: string | Date;
  created_by: string;
  updated_at: string | Date;
  updated_by: string;
}
