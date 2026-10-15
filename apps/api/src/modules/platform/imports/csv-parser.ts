// apps/api/src/modules/platform/imports/csv-parser.ts — owner: Platform Squad (MOD-IMP, TASK-413)
import { AppError } from '@dsa/contracts';

export interface ParsedCsvResult {
  headers: string[];
  totalRows: number;
  previewRows: Record<string, string>[];
  allRows: Record<string, string>[];
}

/**
 * Sanitizes a cell value to prevent CSV / Spreadsheet formula injection.
 * Prepends a single quote if the value begins with =, +, -, @, \t, or \r.
 */
export function sanitizeFormulaInjection(value: string): string {
  const trimmed = value.trim();
  if (/^[=+\-@\t\r]/.test(trimmed)) {
    return `'${trimmed}`;
  }
  return value;
}

/**
 * RFC 4180 compliant lightweight streaming CSV parser without external dependencies.
 * Enforces a strict maximum row limit of 10,000 rows.
 */
export function parseCsvBuffer(
  buffer: Buffer,
  maxRows = 10000,
): ParsedCsvResult {
  // Check for binary/null bytes to reject non-text files masquerading as CSV
  if (buffer.includes(0x00)) {
    throw AppError.of('VALIDATION_ERROR', 'File contains binary null characters and is not a valid CSV text file.', [
      { field: 'file', issue: 'INVALID_ENCODING' },
    ]);
  }

  const text = buffer.toString('utf8');

  // Reject active formula injection attacks (DDE commands, shell launches, external pipes)
  if (/(?:^|[,;\r\n"])\s*[=+\-@]\s*(cmd|powershell|mshta|cscript|wscript|calc|dde)/im.test(text)) {
    throw AppError.of(
      'VALIDATION_ERROR',
      'Formula injection risk detected in file content.',
      [{ field: 'file', issue: 'FORMULA_INJECTION_RISK' }],
    );
  }
  const lines: string[][] = [];
  let currentLine: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else {
          insideQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === ',') {
        currentLine.push(sanitizeFormulaInjection(currentField.trim()));
        currentField = '';
      } else if (char === '\r') {
        if (nextChar === '\n') i++;
        currentLine.push(sanitizeFormulaInjection(currentField.trim()));
        currentField = '';
        if (currentLine.some((c) => c.length > 0)) {
          lines.push(currentLine);
        }
        currentLine = [];
      } else if (char === '\n') {
        currentLine.push(sanitizeFormulaInjection(currentField.trim()));
        currentField = '';
        if (currentLine.some((c) => c.length > 0)) {
          lines.push(currentLine);
        }
        currentLine = [];
      } else {
        currentField += char;
      }
    }

    if (lines.length > maxRows + 1) {
      throw AppError.of(
        'VALIDATION_ERROR',
        `Import file exceeds the maximum allowed batch size of ${maxRows} rows.`,
        [{ field: 'file', issue: 'MAX_ROWS_EXCEEDED' }],
      );
    }
  }

  // Push final field/line if remaining
  if (currentField.length > 0 || currentLine.length > 0) {
    currentLine.push(sanitizeFormulaInjection(currentField.trim()));
    if (currentLine.some((c) => c.length > 0)) {
      lines.push(currentLine);
    }
  }

  if (lines.length < 1) {
    throw AppError.of('VALIDATION_ERROR', 'The uploaded file is empty.', [
      { field: 'file', issue: 'FILE_EMPTY' },
    ]);
  }

  const rawHeaders = lines[0]!;
  const headers = rawHeaders.map((h, idx) => h.trim() || `column_${idx + 1}`);

  const allRows: Record<string, string>[] = [];
  for (let r = 1; r < lines.length; r++) {
    const row = lines[r]!;
    const rowObj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c]!;
      rowObj[header] = row[c] ?? '';
    }
    allRows.push(rowObj);
  }

  return {
    headers,
    totalRows: allRows.length,
    previewRows: allRows.slice(0, 10),
    allRows,
  };
}

/**
 * Serializes records into a CSV buffer with quote-escaping and formula injection protection.
 */
export function serializeCsv(
  headers: string[],
  rows: Record<string, unknown>[],
): Buffer {
  const headerLine = headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(',');
  const lines = [headerLine];

  for (const row of rows) {
    const line = headers.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) return '""';
      const strVal = sanitizeFormulaInjection(String(val)).replace(/"/g, '""');
      return `"${strVal}"`;
    });
    lines.push(line.join(','));
  }

  return Buffer.from(lines.join('\r\n'), 'utf8');
}
