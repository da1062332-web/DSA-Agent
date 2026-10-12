import { describe, expect, it } from 'vitest';
import { MoneySchema } from './money';

describe('MoneySchema', () => {
  it('TEST-KRN-002 rejects a JSON number amount', () => {
    expect(() => MoneySchema.parse({ amount: 300000, currency: 'INR' })).toThrow();
  });

  it('accepts a two-decimal string amount', () => {
    expect(MoneySchema.parse({ amount: '300000.00', currency: 'INR' })).toEqual({
      amount: '300000.00',
      currency: 'INR',
    });
  });

  it.each(['300000', '300000.5', '1e5', '-1.00', '12345678901234567.00'])('rejects amount %s', (amount) => {
    expect(MoneySchema.safeParse({ amount, currency: 'INR' }).success).toBe(false);
  });

  it('rejects a lowercase currency', () => {
    expect(MoneySchema.safeParse({ amount: '1.00', currency: 'inr' }).success).toBe(false);
  });
});
