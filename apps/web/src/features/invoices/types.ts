// apps/web/src/features/invoices/types.ts — Module 33: Invoices (MOD-INV) UI types
export type InvoiceDirection = 'TO_LENDER' | 'FROM_CONNECTOR';
export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PAID' | 'VOID';

export interface TaxFields {
  gstRate?: number;
  gstAmount?: number;
  tdsRate?: number;
  tdsAmount?: number;
  hsnSac?: string;
  irn?: string;
  pan?: string;
  gstin?: string;
  [key: string]: unknown;
}

export interface InvoiceRecord {
  id: string;
  tenantId: string;
  direction: InvoiceDirection;
  number: string;
  date: string;
  dueDate: string | null;
  amount: number;
  currency: string;
  taxFields: TaxFields;
  status: InvoiceStatus;
  calculationIds: string[];
  partyId: string;
  partyName: string | null;
  notes: string | null;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface CreateInvoiceInput {
  direction: InvoiceDirection;
  number: string;
  date: string;
  dueDate?: string | null;
  amount: number;
  currency?: string;
  partyId: string;
  partyName?: string | null;
  taxFields?: TaxFields;
  calculationIds?: string[];
  notes?: string | null;
}

export interface UpdateInvoiceStatusInput {
  status: 'ISSUED' | 'PAID' | 'VOID';
  notes?: string;
}

export interface ConnectorStatementLine {
  id: string;
  date: string;
  type: string;
  description: string;
  referenceId: string | null;
  credit: number;
  debit: number;
  runningBalance: number;
}

export interface ConnectorStatement {
  connectorId: string;
  connectorName?: string | null;
  fromDate: string;
  toDate: string;
  currency: string;
  openingBalance: number;
  totalCredits: number;
  totalDebits: number;
  netChange: number;
  closingBalance: number;
  entries: ConnectorStatementLine[];
}
