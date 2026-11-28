// apps/api/src/modules/platform/imports/mis-row.ts — owner: Devyani (P1-07 / TASK-140).
// Reading one row of a bank's daily status sheet. Pure functions, no I/O: these are where a MIS import goes quietly
// wrong — a date read in the wrong order, an amount with a currency symbol — and a wrong value here is not visible
// anywhere downstream, so each is tested on its own.
import type { LenderCaseStatus, MisDateFormat, MisStatusMap } from '@dsa/contracts';

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** True for a date that exists: rejects 31-02-2026, which every separator-splitting parser otherwise accepts. */
function isRealDate(year: string, month: string, day: string): boolean {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1) return false;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= daysInMonth;
}

/**
 * The sheet's date text as YYYY-MM-DD, or null when it is not a date in the lender's stated format.
 *
 * The format is stated per lender and never inferred: 03-04-2026 is a valid date read either way, so a day-first
 * sheet read as month-first produces a wrong date rather than an error on the twelve ambiguous days of each month,
 * and nothing downstream could tell. Guessing per row would make a single file land in two different months.
 */
export function parseMisDate(raw: string, format: MisDateFormat): string | null {
  const text = raw.trim();
  if (!text) return null;

  if (format === 'YYYY-MM-DD') {
    const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
    if (!m) return null;
    const [, y, mo, d] = m as unknown as [string, string, string, string];
    const month = mo.padStart(2, '0');
    const day = d.padStart(2, '0');
    return isRealDate(y, month, day) ? `${y}-${month}-${day}` : null;
  }

  if (format === 'DD-MMM-YYYY') {
    const m = /^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{4})$/.exec(text);
    if (!m) return null;
    const [, d, monthName, y] = m as unknown as [string, string, string, string];
    const month = MONTHS[monthName.slice(0, 3).toLowerCase()];
    if (!month) return null;
    const day = d.padStart(2, '0');
    return isRealDate(y, month, day) ? `${y}-${month}-${day}` : null;
  }

  // DD-MM-YYYY and DD/MM/YYYY: the same reading, so a sheet that switches separator mid-column still parses.
  const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(text);
  if (!m) return null;
  const [, d, mo, y] = m as unknown as [string, string, string, string];
  const month = mo.padStart(2, '0');
  const day = d.padStart(2, '0');
  return isRealDate(y, month, day) ? `${y}-${month}-${day}` : null;
}

/**
 * The sheet's amount as a number, or null when it is not one.
 *
 * Bank sheets write amounts as "4,00,000.00", "Rs. 400000", "₹4,00,000" and "400000.00 Cr". Indian digit grouping is
 * not three-at-a-time, so a parser that assumes thousands separators mis-reads it; stripping every grouping character
 * and keeping the decimal point is both simpler and correct for either convention.
 *
 * Zero and negatives are rejected rather than clamped: a zero-rupee disbursement is a sheet error, and a negative one
 * is a reversal, which is a different operation the import must not perform silently.
 */
export function parseMisAmount(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;

  const cleaned = text
    .replace(/(^|\s)(rs\.?|inr|₹)\s*/gi, '$1')
    .replace(/\s*(cr|dr)\.?$/i, '')
    .replace(/,/g, '')
    .trim();

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

/**
 * The lender's word for a stage, as our status. Compared trimmed and case-insensitively, because one file holds
 * "Disbursed", "DISBURSED" and "Disbursed " for the same stage, and an operator mapping each spelling separately
 * would miss the fourth the bank invents next month.
 */
export function resolveMisStatus(raw: string, statusMap: MisStatusMap): LenderCaseStatus | null {
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  for (const [word, status] of Object.entries(statusMap)) {
    if (word.trim().toLowerCase() === key) return status;
  }
  return null;
}
