// packages/contracts/src/ledger.ts — MOD-LED Ledger Management (DOM-K)
import { z } from 'zod';

export const LEDGER_ACCOUNT_TYPES = [
  'ASSET',
  'LIABILITY',
  'INCOME',
  'EXPENSE',
  'SUSPENSE',
  'TAX_PAYABLE',
  'TAX_RECEIVABLE',
] as const;
export type LedgerAccountType = (typeof LEDGER_ACCOUNT_TYPES)[number];

export const JOURNAL_STATUSES = ['POSTED', 'REVERSED', 'CLOSED'] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export const JOURNAL_REFERENCE_TYPES = [
  'PAYOUT_RECORDING',
  'ADJUSTMENT',
  'COMMISSION_ACCRUAL',
  'PERIOD_CLOSE',
  'MANUAL',
] as const;
export type JournalReferenceType = (typeof JOURNAL_REFERENCE_TYPES)[number];

export const ENTRY_DIRECTIONS = ['DEBIT', 'CREDIT'] as const;
export type EntryDirection = (typeof ENTRY_DIRECTIONS)[number];

export const COUNTERPARTY_TYPES = ['CONNECTOR', 'LENDER', 'BANK', 'BORROWER', 'INTERNAL'] as const;
export type CounterpartyType = (typeof COUNTERPARTY_TYPES)[number];

// --- ENT-079: ledger_account ---
export const LedgerAccountSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  code: z.string().min(1, 'Account code required'),
  name: z.string().min(1, 'Account name required'),
  type: z.enum(LEDGER_ACCOUNT_TYPES),
  counterpartyType: z.enum(COUNTERPARTY_TYPES).nullable().optional(),
  counterpartyId: z.string().nullable().optional(),
  currency: z.string().default('INR'),
  isActive: z.boolean().default(true),
  lockVersion: z.number().int().default(1),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
});
export type LedgerAccount = z.infer<typeof LedgerAccountSchema>;

// API-LED-001: GET /v1/ledger/accounts
export const ListLedgerAccountsQuerySchema = z.object({
  counterpartyType: z.enum(COUNTERPARTY_TYPES).optional(),
  counterpartyId: z.string().optional(),
  type: z.enum(LEDGER_ACCOUNT_TYPES).optional(),
  isActive: z.boolean().optional(),
});
export type ListLedgerAccountsQuery = z.input<typeof ListLedgerAccountsQuerySchema>;

export const CreateLedgerAccountInputSchema = z
  .object({
    code: z.string().min(1, 'Account code required'),
    name: z.string().min(1, 'Account name required'),
    type: z.enum(LEDGER_ACCOUNT_TYPES),
    counterpartyType: z.enum(COUNTERPARTY_TYPES).optional(),
    counterpartyId: z.string().optional(),
    currency: z.string().default('INR'),
    isActive: z.boolean().default(true),
  })
  .refine(
    (data) => {
      // OD-021: TAX_PAYABLE and TAX_RECEIVABLE must remain inactive
      if ((data.type === 'TAX_PAYABLE' || data.type === 'TAX_RECEIVABLE') && data.isActive !== false) {
        return false;
      }
      return true;
    },
    {
      message:
        'OD-021: TAX_PAYABLE and TAX_RECEIVABLE accounts must remain inactive until tax policy approval',
      path: ['isActive'],
    },
  );
export type CreateLedgerAccountInput = z.input<typeof CreateLedgerAccountInputSchema>;

// --- ENT-081: journal lines (table ledger_journal_line; ledger_entry is the connector statement table of migration 0053) ---
export const LedgerEntrySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  journalId: z.string(),
  accountId: z.string(),
  accountCode: z.string().optional(),
  accountName: z.string().optional(),
  entryType: z.enum(ENTRY_DIRECTIONS),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount must be positive numeric(18,2)'),
  currency: z.string().default('INR'),
  narration: z.string().nullable().optional(),
  lineNumber: z.number().int().positive(),
  createdAt: z.string().or(z.date()),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

// --- ENT-080: ledger_journal ---
export const LedgerJournalSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  journalNumber: z.string(),
  referenceType: z.enum(JOURNAL_REFERENCE_TYPES),
  referenceId: z.string(),
  idempotencyKey: z.string().nullable().optional(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be YYYY-MM'),
  status: z.enum(JOURNAL_STATUSES),
  reversalOfJournalId: z.string().nullable().optional(),
  postedAt: z.string().or(z.date()),
  postedBy: z.string(),
  createdAt: z.string().or(z.date()),
  lines: z.array(LedgerEntrySchema).optional(),
});
export type LedgerJournal = z.infer<typeof LedgerJournalSchema>;

// API-LED-003: GET /v1/ledger/journals
export const ListLedgerJournalsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(20),
  period: z.string().optional(),
  referenceType: z.enum(JOURNAL_REFERENCE_TYPES).optional(),
  referenceId: z.string().optional(),
});
export type ListLedgerJournalsQuery = z.input<typeof ListLedgerJournalsQuerySchema>;

// Posting input for internal system commands
export const PostJournalLineInputSchema = z.object({
  accountCode: z.string().min(1, 'accountCode required'),
  entryType: z.enum(ENTRY_DIRECTIONS),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Positive numeric(18,2) required'),
  narration: z.string().optional(),
});
export type PostJournalLineInput = z.input<typeof PostJournalLineInputSchema>;

export const PostJournalInputSchema = z
  .object({
    referenceType: z.enum(JOURNAL_REFERENCE_TYPES),
    referenceId: z.string().min(1, 'referenceId required'),
    idempotencyKey: z.string().optional(),
    period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Period must be YYYY-MM'),
    currency: z.string().default('INR'),
    narration: z.string().optional(),
    lines: z.array(PostJournalLineInputSchema).min(2, 'Journal must have at least 2 lines'),
  })
  .refine(
    (data) => {
      // Validate debit == credit
      const debits = data.lines
        .filter((l) => l.entryType === 'DEBIT')
        .reduce((sum, l) => sum + Math.round(parseFloat(l.amount) * 100), 0);
      const credits = data.lines
        .filter((l) => l.entryType === 'CREDIT')
        .reduce((sum, l) => sum + Math.round(parseFloat(l.amount) * 100), 0);
      return debits === credits && debits > 0;
    },
    {
      message: 'LEDGER_UNBALANCED: Total debits must equal total credits and be greater than zero',
      path: ['lines'],
    },
  );
export type PostJournalInput = z.input<typeof PostJournalInputSchema>;

// API-LED-006: POST /v1/ledger/periods/{period}/close
export const CloseLedgerPeriodInputSchema = z.object({
  note: z.string().optional(),
});
export type CloseLedgerPeriodInput = z.input<typeof CloseLedgerPeriodInputSchema>;

export const PeriodCloseResponseSchema = z.object({
  period: z.string(),
  status: z.literal('CLOSED'),
  closedAt: z.string(),
  closedBy: z.string(),
  note: z.string().nullable().optional(),
  trialBalanceZeroSum: z.boolean(),
  trialBalanceVariance: z.string(),
});
export type PeriodCloseResponse = z.infer<typeof PeriodCloseResponseSchema>;

// API-LED-002: GET /v1/ledger/accounts/{id}/balance
export const GetAccountBalanceQuerySchema = z.object({
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'asOfDate must be YYYY-MM-DD')
    .optional(),
});
export type GetAccountBalanceQuery = z.input<typeof GetAccountBalanceQuerySchema>;

export const AccountBalanceResponseSchema = z.object({
  accountId: z.string(),
  accountCode: z.string(),
  accountName: z.string(),
  type: z.enum(LEDGER_ACCOUNT_TYPES),
  currency: z.string(),
  asOfDate: z.string(),
  debitTotal: z.string(),
  creditTotal: z.string(),
  balance: z.string(),
  lineCount: z.number().int(),
});
export type AccountBalanceResponse = z.infer<typeof AccountBalanceResponseSchema>;

// API-LED-004: GET /v1/connectors/{id}/statements
export const GetConnectorStatementsQuerySchema = z.object({
  fromPeriod: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  toPeriod: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  limit: z.number().int().min(1).max(200).optional().default(50),
});
export type GetConnectorStatementsQuery = z.input<typeof GetConnectorStatementsQuerySchema>;

export const ConnectorStatementLineSchema = z.object({
  date: z.string(),
  journalNumber: z.string(),
  referenceType: z.string(),
  referenceId: z.string(),
  narration: z.string().nullable().optional(),
  debit: z.string(),
  credit: z.string(),
  runningBalance: z.string(),
});
export type LedgerConnectorStatementLine = z.infer<typeof ConnectorStatementLineSchema>;

export const ConnectorStatementResponseSchema = z.object({
  connectorId: z.string(),
  currency: z.string(),
  periodRange: z.string(),
  openingBalance: z.string(),
  totalDebits: z.string(),
  totalCredits: z.string(),
  closingBalance: z.string(),
  lineCount: z.number().int(),
  lines: z.array(ConnectorStatementLineSchema),
});
export type ConnectorStatementResponse = z.infer<typeof ConnectorStatementResponseSchema>;

// API-LED-005: POST /v1/ledger/exports
export const CreateLedgerExportInputSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  format: z.enum(['CSV', 'JSON', 'EXCEL']).default('CSV'),
  includeInactiveAccounts: z.boolean().default(false),
});
export type CreateLedgerExportInput = z.input<typeof CreateLedgerExportInputSchema>;

export const LedgerExportResponseSchema = z.object({
  exportId: z.string(),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']),
  format: z.string(),
  period: z.string().nullable().optional(),
  downloadUrl: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type LedgerExportResponse = z.infer<typeof LedgerExportResponseSchema>;
