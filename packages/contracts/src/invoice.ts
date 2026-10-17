// packages/contracts/src/invoice.ts — Module 33: Invoices (MOD-INV) & Connector Statements
import { z } from 'zod';

export const INVOICE_DIRECTIONS = ['TO_LENDER', 'FROM_CONNECTOR'] as const;
export type InvoiceDirection = (typeof INVOICE_DIRECTIONS)[number];

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PAID', 'VOID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const LEDGER_ENTRY_TYPES = [
  'COMMISSION_EARNED',
  'PAYOUT_DISBURSED',
  'ADJUSTMENT',
  'TAX_DEDUCTION',
  'OPENING_BALANCE',
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

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

export const TaxFieldsSchema = z
  .object({
    gstRate: z.number().nonnegative().optional(),
    gstAmount: z.number().nonnegative().optional(),
    tdsRate: z.number().nonnegative().optional(),
    tdsAmount: z.number().nonnegative().optional(),
    hsnSac: z.string().max(20).optional(),
    irn: z.string().max(100).optional(),
    pan: z.string().max(20).optional(),
    gstin: z.string().max(20).optional(),
  })
  .passthrough();

// API-INV-001: POST /v1/invoices
export const CreateInvoiceInputSchema = z.object({
  direction: z.enum(INVOICE_DIRECTIONS),
  number: z.string().trim().min(1).max(100),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must be in YYYY-MM-DD format')
    .optional()
    .nullable(),
  amount: z.number().nonnegative(),
  currency: z.string().trim().length(3).default('INR'),
  partyId: z.string().trim().min(1),
  partyName: z.string().trim().max(255).optional().nullable(),
  taxFields: TaxFieldsSchema.optional().default({}),
  calculationIds: z.array(z.string().trim()).optional().default([]),
  notes: z.string().max(1000).optional().nullable(),
});
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceInputSchema>;

// API-INV-003: POST /v1/invoices/:id/status
export const UpdateInvoiceStatusInputSchema = z.object({
  status: z.enum(['ISSUED', 'PAID', 'VOID']),
  notes: z.string().max(500).optional(),
});
export type UpdateInvoiceStatusInput = z.infer<typeof UpdateInvoiceStatusInputSchema>;

// API-INV-002: GET /v1/invoices
export const InvoiceListQuerySchema = z.object({
  direction: z.enum(INVOICE_DIRECTIONS).optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  partyId: z.string().optional(),
  search: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type InvoiceListQuery = z.infer<typeof InvoiceListQuerySchema>;

// API-LED-004 / API-CPT-004: GET /v1/connectors/:id/statements
export const StatementQuerySchema = z.object({
  fromDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'fromDate must be YYYY-MM-DD')
    .optional(),
  toDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'toDate must be YYYY-MM-DD')
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export type StatementQuery = z.infer<typeof StatementQuerySchema>;

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

export interface LedgerEntryRecord {
  id: string;
  tenantId: string;
  connectorId: string;
  entryType: LedgerEntryType;
  amount: number;
  currency: string;
  referenceId: string | null;
  description: string | null;
  entryDate: string;
  balanceAfter: number;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
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
