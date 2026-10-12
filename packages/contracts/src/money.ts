// packages/contracts/src/money.ts — owner: Dev 1 — frozen at Gate 1
// Money is always { amount: "300000.00", currency: "INR" }: the amount is a decimal string, never a JSON number
// (Contracts §5). Pattern from Contracts §4.1: amount ^\d{1,16}\.\d{2}$ ; currency ^[A-Z]{3}$.
// Arithmetic uses decimal.js (scale 10 intermediate, HALF_EVEN in the BRE) — ADR-014.
import { z } from 'zod';

export const MoneySchema = z.object({
  amount: z.string().regex(/^\d{1,16}\.\d{2}$/, 'amount must be a decimal string with 2 places'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'currency must be an ISO 4217 code'),
});
export type Money = z.infer<typeof MoneySchema>;

/** DECIMAL facts and values are JSON strings (Contracts §4.2). */
export const DecimalStringSchema = z.string().regex(/^-?\d+(\.\d{1,10})?$/, 'must be a decimal string');
