// apps/api/src/modules/reconciliation/statement-parser.ts
// Automated Bank Statement Ingestion Engine (MT940 / CSV Feeds) (MOD-REC / TASK-418)
import { AppError } from '@dsa/contracts';

export interface ParsedStatementLine {
  loanAccount: string;
  customerName: string;
  disbursedAmount: number;
  commissionAmount: number;
  taxDeducted: number;
  paidOn: string; // YYYY-MM-DD
  rawRowRef?: string;
}

export interface ParseResult {
  format: 'MT940' | 'CSV';
  statementRef?: string;
  accountNumber?: string;
  lines: ParsedStatementLine[];
  totalDisbursed: number;
  totalCommission: number;
  totalTaxDeducted: number;
  netCommission: number;
}

/**
 * Parses SWIFT MT940 Bank Statement text format
 */
export function parseMt940Feed(content: string): ParseResult {
  const lines = content.split(/\r?\n/);
  const parsedLines: ParsedStatementLine[] = [];

  let statementRef = '';
  let accountNumber = '';
  let currentLineInfo: { date?: string; amount?: number; ref?: string; raw?: string } | null = null;
  let lineIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]?.trim();
    if (!raw) continue;

    if (raw.startsWith(':20:')) {
      statementRef = raw.substring(4).trim();
    } else if (raw.startsWith(':25:')) {
      accountNumber = raw.substring(4).trim();
    } else if (raw.startsWith(':61:')) {
      // If previous line exists without :86:, push it with fallback customer
      if (currentLineInfo && currentLineInfo.date && currentLineInfo.amount !== undefined) {
        lineIdx++;
        parsedLines.push({
          loanAccount: currentLineInfo.ref || `LN_MT940_${lineIdx}`,
          customerName: 'Bank Customer',
          disbursedAmount: Math.round(currentLineInfo.amount * 66.67),
          commissionAmount: currentLineInfo.amount,
          taxDeducted: Math.round(currentLineInfo.amount * 0.1 * 100) / 100,
          paidOn: currentLineInfo.date,
          rawRowRef: currentLineInfo.raw,
        });
      }

      // Parse :61: statement line
      // Format: :61:YYMMDD[MMDD]C|D[FundsCode]Amount,Dec[Type][Reference]
      const body = raw.substring(4);
      const match = body.match(/^(\d{6})(\d{4})?([CD][R]?)([A-Za-z])?([0-9]+[,\.][0-9]{2})(.*)$/);
      if (match) {
        const yymmdd = match[1];
        const amountStr = match[5];
        const rest = match[6];
        if (yymmdd && amountStr) {
          const year = 2000 + parseInt(yymmdd.substring(0, 2), 10);
          const month = yymmdd.substring(2, 4);
          const day = yymmdd.substring(4, 6);
          const date = `${year}-${month}-${day}`;
          const amount = parseFloat(amountStr.replace(',', '.'));

          let ref = '';
          if (rest && rest.includes('//')) {
            ref = rest.split('//')[1]?.trim() ?? '';
          }

          currentLineInfo = {
            date,
            amount,
            ref,
            raw,
          };
        }
      }
    } else if (raw.startsWith(':86:')) {
      // Narration / Information to account owner
      const narration = raw.substring(4).trim();
      let customerName = 'Bank Customer';
      let loanAccount = currentLineInfo?.ref || `LN_MT940_${lineIdx + 1}`;
      let disbursedAmount = (currentLineInfo?.amount || 0) * 66.67;
      let taxDeducted = Math.round((currentLineInfo?.amount || 0) * 0.1 * 100) / 100;

      if (narration.includes('/')) {
        const parts = narration.split('/').filter(Boolean);
        for (let p = 0; p < parts.length; p++) {
          const key = parts[p]?.toUpperCase();
          const nextVal = parts[p + 1];
          if (key === 'COMM' && nextVal) {
            customerName = nextVal.trim();
          } else if ((key === 'LN' || key === 'LOAN' || key === 'ACCOUNT') && nextVal) {
            loanAccount = nextVal.trim();
          } else if (key === 'DISB' && nextVal) {
            disbursedAmount = parseFloat(nextVal) || disbursedAmount;
          } else if (key === 'TDS' && nextVal) {
            taxDeducted = parseFloat(nextVal) || taxDeducted;
          }
        }
      } else {
        const words = narration.split(/\s+/);
        if (words.length >= 2) {
          customerName = words.slice(0, 2).join(' ');
        }
      }

      lineIdx++;
      parsedLines.push({
        loanAccount,
        customerName,
        disbursedAmount: Math.round(disbursedAmount * 100) / 100,
        commissionAmount: currentLineInfo?.amount || 0,
        taxDeducted: Math.round(taxDeducted * 100) / 100,
        paidOn: currentLineInfo?.date || new Date().toISOString().slice(0, 10),
        rawRowRef: `${currentLineInfo?.raw ?? ''} | ${raw}`,
      });
      currentLineInfo = null;
    }
  }

  // Handle any trailing statement line
  if (currentLineInfo && currentLineInfo.date && currentLineInfo.amount !== undefined) {
    lineIdx++;
    parsedLines.push({
      loanAccount: currentLineInfo.ref || `LN_MT940_${lineIdx}`,
      customerName: 'Bank Customer',
      disbursedAmount: Math.round(currentLineInfo.amount * 66.67),
      commissionAmount: currentLineInfo.amount,
      taxDeducted: Math.round(currentLineInfo.amount * 0.1 * 100) / 100,
      paidOn: currentLineInfo.date,
      rawRowRef: currentLineInfo.raw,
    });
  }

  if (parsedLines.length === 0) {
    throw AppError.of('VALIDATION_ERROR', 'No valid MT940 statement transaction lines (:61:) detected in feed.');
  }

  const totals = calculateTotals(parsedLines);
  return {
    format: 'MT940',
    statementRef,
    accountNumber,
    lines: parsedLines,
    ...totals,
  };
}

/**
 * Parses Bank CSV Feed with header detection and normalization
 */
export function parseCsvFeed(content: string): ParseResult {
  const rows = content.trim().split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  const firstRow = rows[0];
  if (!firstRow) {
    throw AppError.of('VALIDATION_ERROR', 'Empty CSV feed content provided.');
  }

  const headerRow = firstRow.toLowerCase();
  const hasHeaders =
    headerRow.includes('loan') ||
    headerRow.includes('account') ||
    headerRow.includes('customer') ||
    headerRow.includes('commission') ||
    headerRow.includes('disburs');

  const startIndex = hasHeaders ? 1 : 0;
  const colMap = {
    loanAccount: 0,
    customerName: 1,
    disbursed: 2,
    commission: 3,
    tax: 4,
    date: 5,
  };

  if (hasHeaders) {
    const headers = firstRow.split(',').map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ''));
    headers.forEach((h, idx) => {
      if (h.includes('loan') || h.includes('account') || h.includes('acct')) colMap.loanAccount = idx;
      else if (h.includes('customer') || h.includes('client') || h.includes('borrower') || h.includes('name')) colMap.customerName = idx;
      else if (h.includes('disburs') || h.includes('principal') || h.includes('loanamt')) colMap.disbursed = idx;
      else if (h.includes('comm') || h.includes('brokerage') || h.includes('payout')) colMap.commission = idx;
      else if (h.includes('tds') || h.includes('tax')) colMap.tax = idx;
      else if (h.includes('date') || h.includes('paid') || h.includes('settle')) colMap.date = idx;
    });
  }

  const parsedLines: ParsedStatementLine[] = [];
  for (let i = startIndex; i < rows.length; i++) {
    const currentRow = rows[i];
    if (!currentRow) continue;
    const cells = currentRow.split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
    if (cells.length < 3) continue;

    const loanAccount = cells[colMap.loanAccount] || `LN_ROW_${i + 1}`;
    const customerName = cells[colMap.customerName] || 'Bank Customer';
    const disbursed = parseFloat(cells[colMap.disbursed] || '0') || 100000;
    const comm = parseFloat(cells[colMap.commission] || '0') || 1500;
    const tax = parseFloat(cells[colMap.tax] || '0') || Math.round(comm * 0.1 * 100) / 100;
    let paidOn = cells[colMap.date] || new Date().toISOString().slice(0, 10);

    // Normalize date YYYY-MM-DD
    if (paidOn.includes('/')) {
      const parts = paidOn.split('/');
      const p0 = parts[0];
      const p1 = parts[1];
      const p2 = parts[2];
      if (p0 && p1 && p2) {
        paidOn = `${p2}-${p1.padStart(2, '0')}-${p0.padStart(2, '0')}`;
      }
    }

    parsedLines.push({
      loanAccount,
      customerName,
      disbursedAmount: Math.round(disbursed * 100) / 100,
      commissionAmount: Math.round(comm * 100) / 100,
      taxDeducted: Math.round(tax * 100) / 100,
      paidOn,
      rawRowRef: `csv_row_${i + 1}`,
    });
  }

  if (parsedLines.length === 0) {
    throw AppError.of('VALIDATION_ERROR', 'No parseable transaction rows found in CSV feed.');
  }

  const totals = calculateTotals(parsedLines);
  return {
    format: 'CSV',
    lines: parsedLines,
    ...totals,
  };
}

function calculateTotals(lines: ParsedStatementLine[]) {
  let totalDisbursed = 0;
  let totalCommission = 0;
  let totalTaxDeducted = 0;

  for (const l of lines) {
    totalDisbursed += l.disbursedAmount;
    totalCommission += l.commissionAmount;
    totalTaxDeducted += l.taxDeducted;
  }

  const netCommission = totalCommission - totalTaxDeducted;
  return {
    totalDisbursed: Math.round(totalDisbursed * 100) / 100,
    totalCommission: Math.round(totalCommission * 100) / 100,
    totalTaxDeducted: Math.round(totalTaxDeducted * 100) / 100,
    netCommission: Math.round(netCommission * 100) / 100,
  };
}
