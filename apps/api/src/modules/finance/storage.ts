// apps/api/src/modules/finance/storage.ts — Object storage adapter and bank-file generator for MOD-PAY
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface StoredFinancialFile {
  objectKey: string;
  sha256: string;
  sizeBytes: number;
}

export interface FinancialStoragePort {
  save(tenantId: string, objectKey: string, buffer: Buffer, mimeType: string): Promise<StoredFinancialFile>;
  get(tenantId: string, objectKey: string): Promise<Buffer | null>;
  delete?(tenantId: string, objectKey: string): Promise<boolean>;
}

/**
 * In-memory storage provider for tests and transient environments.
 */
export class InMemoryFinancialStorage implements FinancialStoragePort {
  private files = new Map<string, { buffer: Buffer; sha256: string }>();

  async save(
    tenantId: string,
    objectKey: string,
    buffer: Buffer,
    _mimeType: string,
  ): Promise<StoredFinancialFile> {
    const key = `${tenantId}/${objectKey}`;
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    this.files.set(key, { buffer, sha256 });
    return {
      objectKey,
      sha256,
      sizeBytes: buffer.length,
    };
  }

  async get(tenantId: string, objectKey: string): Promise<Buffer | null> {
    const key = `${tenantId}/${objectKey}`;
    const item = this.files.get(key);
    return item ? Buffer.from(item.buffer) : null;
  }

  async delete(tenantId: string, objectKey: string): Promise<boolean> {
    const key = `${tenantId}/${objectKey}`;
    return this.files.delete(key);
  }
}

/**
 * Local filesystem storage provider for development environments.
 */
export class LocalFinancialStorage implements FinancialStoragePort {
  private baseDir: string;

  constructor(baseDir = './uploads/finance-files') {
    this.baseDir = path.resolve(baseDir);
  }

  async save(
    tenantId: string,
    objectKey: string,
    buffer: Buffer,
    _mimeType: string,
  ): Promise<StoredFinancialFile> {
    const tenantDir = path.join(this.baseDir, tenantId);
    await fs.mkdir(tenantDir, { recursive: true });

    const safeFilename = path.basename(objectKey);
    const filePath = path.join(tenantDir, safeFilename);

    await fs.writeFile(filePath, buffer);

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    return {
      objectKey: path.relative(this.baseDir, filePath),
      sha256,
      sizeBytes: buffer.length,
    };
  }

  async get(tenantId: string, objectKey: string): Promise<Buffer | null> {
    const safeFilename = path.basename(objectKey);
    const filePath = path.join(this.baseDir, tenantId, safeFilename);

    // Prevent directory traversal attacks
    if (!filePath.startsWith(this.baseDir)) {
      return null;
    }

    try {
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async delete(tenantId: string, objectKey: string): Promise<boolean> {
    const safeFilename = path.basename(objectKey);
    const filePath = path.join(this.baseDir, tenantId, safeFilename);
    try {
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Sanitizes CSV cell fields to prevent CSV formula injection (CSV Command Injection).
 * If a field begins with '=', '+', '-', '@', '\t', or '\r', prefix it with a single quote.
 * Escapes quotes and wraps fields containing commas, quotes, or newlines in double quotes.
 */
export function sanitizeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  let str = String(value);

  // Check for formula injection triggers at beginning of string
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  // If contains delimiter, quote, or newline, escape quotes and enclose in quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export interface BankFilePayoutRecord {
  id: string;
  connectorId: string;
  total: string;
  currency: string;
  connectorName?: string;
  accountNumber?: string;
  ifscCode?: string;
}

/**
 * Deterministic bank file generator for bulk payout settlement.
 * Complies with NEFT/RTGS NACH bulk file structure with formula injection mitigation.
 */
export function generateBankFileCsv(
  batchId: string,
  records: BankFilePayoutRecord[],
): { csvString: string; buffer: Buffer; sha256: string; recordCount: number } {
  const headers = [
    'RecordType',
    'BatchId',
    'PayoutId',
    'ConnectorId',
    'BeneficiaryName',
    'AccountNumber',
    'IFSCCode',
    'Amount',
    'Currency',
    'PaymentType',
    'Remarks',
  ];

  const rows: string[] = [headers.join(',')];

  for (const rec of records) {
    const row = [
      sanitizeCsvField('PAYMENT'),
      sanitizeCsvField(batchId),
      sanitizeCsvField(rec.id),
      sanitizeCsvField(rec.connectorId),
      sanitizeCsvField(rec.connectorName || `Connector ${rec.connectorId}`),
      sanitizeCsvField(rec.accountNumber || 'NOT_CONFIGURED'),
      sanitizeCsvField(rec.ifscCode || 'HDFC0000001'),
      sanitizeCsvField(rec.total),
      sanitizeCsvField(rec.currency || 'INR'),
      sanitizeCsvField('NEFT'),
      sanitizeCsvField(`Commission payout ${rec.id}`),
    ];
    rows.push(row.join(','));
  }

  const csvString = `${rows.join('\n')}\n`;
  const buffer = Buffer.from(csvString, 'utf8');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  return {
    csvString,
    buffer,
    sha256,
    recordCount: records.length,
  };
}
