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

// --- Paise arithmetic (P2-01) -------------------------------------------------------------------------------------
// Money is summed in whole paise with integers, never floats (plan section 12.10). These live here rather than inside
// one module because the commission engine calculates an amount and the invoices module bills it, and the acceptance
// test is that the two agree to the paisa. Two private copies would be free to drift.

/** '4000.50' -> 400050n. Accepts a bare decimal string with at most two decimal places. */
export function parseMoneyToPaise(amountStr: string): bigint {
  const parts = amountStr.split('.');
  const whole = BigInt(parts[0] || '0');
  const frac = (parts[1] || '').padEnd(2, '0').slice(0, 2);
  return whole * 100n + BigInt(frac);
}

/** 400050n -> '4000.50'. */
export function formatPaiseToMoney(paise: bigint): string {
  const whole = paise / 100n;
  const frac = (paise % 100n).toString().padStart(2, '0');
  return `${whole}.${frac}`;
}

/**
 * Integer division honouring a commission plan's rounding_mode. Every amount here is non-negative, so rounding down is
 * the same as truncating. An unknown mode falls back to half-up, which is the column's default.
 */
export function divideWithRounding(numerator: bigint, denominator: bigint, roundingMode: string): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  switch (roundingMode) {
    case 'ROUND_DOWN':
      return quotient;
    case 'ROUND_UP':
      return quotient + 1n;
    case 'ROUND_HALF_EVEN': {
      const twice = remainder * 2n;
      if (twice > denominator) return quotient + 1n;
      if (twice < denominator) return quotient;
      return quotient % 2n === 0n ? quotient : quotient + 1n;
    }
    case 'ROUND_HALF_UP':
    default:
      return remainder * 2n >= denominator ? quotient + 1n : quotient;
  }
}

/** A share of an amount in basis points (100 bps = 1.00%). Exact: the rate never passes through a float. */
export function computeAmountWithBps(amountPaise: bigint, rateBps: number, roundingMode: string): bigint {
  return divideWithRounding(amountPaise * BigInt(rateBps), 10_000n, roundingMode);
}
