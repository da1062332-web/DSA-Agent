// Shared helpers for the flow-wise demo seed — synthetic data only (ASM-4D-06).
// Rows are plain objects keyed by column name. The loader (tools/seed-local-flow.ts) turns them into INSERTs.
import { createHash } from 'node:crypto';

export type Row = Record<string, unknown>;

/** Collects rows per table, in the order they were added. */
export class Tables {
  private readonly data = new Map<string, Row[]>();

  add(table: string, row: Row): Row {
    const list = this.data.get(table) ?? [];
    list.push(row);
    this.data.set(table, list);
    return row;
  }

  addAll(table: string, rows: Row[]): void {
    for (const row of rows) this.add(table, row);
  }

  entries(): [string, Row[]][] {
    return [...this.data.entries()];
  }
}

export const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex');
export const sha256Bytes = (value: string) => createHash('sha256').update(value).digest();
export const pad = (n: number, width = 3) => String(n).padStart(width, '0');
/** Date-time offset from an anchor, as an ISO string with the Indian offset kept. */
export const at = (anchor: string, days = 0, hours = 0) =>
  new Date(Date.parse(anchor) + days * 86_400_000 + hours * 3_600_000).toISOString();
/** Calendar date offset from an ISO date (YYYY-MM-DD). */
export const onDate = (isoDate: string, days = 0) =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Fixed anchor for the whole seed: October 2026, so every flow sits in the past relative to the seed run. */
export const ANCHOR = '2026-10-01T09:00:00+05:30';

export const FIRST_NAMES = [
  'Aarav',
  'Ananya',
  'Vikram',
  'Meera',
  'Rahul',
  'Kavya',
  'Imran',
  'Neha',
  'Suresh',
  'Pooja',
  'Karan',
  'Tanvi',
  'Dev',
  'Sana',
  'Rohit',
  'Anjali',
  'Nikhil',
  'Farah',
  'Gaurav',
  'Ishita',
];
export const LAST_NAMES = [
  'Sharma',
  'Iyer',
  'Khan',
  'Patel',
  'Desai',
  'Reddy',
  'Mehta',
  'Nair',
  'Singh',
  'Joshi',
  'Kulkarni',
  'Shah',
  'Verma',
  'Fernandes',
  'Bose',
  'Gupta',
  'Menon',
  'Rao',
  'Pillai',
  'Chopra',
];
export const FIRMS = [
  'Lotus Garment Works',
  'Harbor Spice Traders',
  'Meridian Auto Parts',
  'Cedar Pharma Distributors',
  'Pinnacle Tiles LLP',
  'Silverline Printing Press',
  'Orchid Hospitality',
  'Granite Logistics',
  'Bluefin Packaging',
  'Maple Dairy Co-op',
  'Juniper Electronics',
  'Northwind Agro Supplies',
];

/** Indian mobile in E.164: +91 then nine digits starting 9. `tagDigit` keeps the two tenants' numbers apart. */
export const mobileFor = (tagDigit: string, n: number) => `+91${tagDigit}${pad(n, 8)}`;

/** Synthetic PAN-shaped data is avoided on purpose: masks use stars only and encrypted fields are hashes. */
export const panMask = (n: number) => `******${pad(n, 4)}`;

export const emailFor = (first: string, last: string, n: number) =>
  `${first}.${last}${n}@example.com`.toLowerCase();

/**
 * Checked lookup for the seed's collections. A missing key or index is a seed bug, so it throws here instead of
 * letting `undefined` reach a row (the typecheck runs with noUncheckedIndexedAccess).
 */
export function ix<T>(collection: readonly T[] | Readonly<Record<string, T>>, key: number | string): T {
  const value = (collection as unknown as Record<string | number, T | undefined>)[key];
  if (value === undefined) throw new Error(`seed lookup missing: ${String(key)}`);
  return value;
}
