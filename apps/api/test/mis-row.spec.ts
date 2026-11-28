// Reading one row of a bank's daily status sheet (P1-07 / TASK-140). These are the functions where a MIS import goes
// quietly wrong: a wrong date or a mis-read amount is written as fact and nothing downstream can tell.
import { describe, expect, it } from 'vitest';
import { parseMisAmount, parseMisDate, resolveMisStatus } from '../src/modules/platform/imports/mis-row';
import type { MisStatusMap } from '@dsa/contracts';

describe('TEST-MIS-ROW parsing one row of a lender status sheet', () => {
  describe('parseMisDate', () => {
    it('TEST-MIS-ROW-01 reads a day-first date as day-first', () => {
      expect(parseMisDate('03-04-2026', 'DD-MM-YYYY')).toBe('2026-04-03');
      expect(parseMisDate('3/4/2026', 'DD/MM/YYYY')).toBe('2026-04-03');
    });

    it('TEST-MIS-ROW-02 reads the same text differently under a different stated format', () => {
      // The whole reason the format is per lender and never inferred: both readings are valid dates, so a sheet read
      // the wrong way produces a wrong date rather than an error, on the twelve ambiguous days of every month.
      expect(parseMisDate('03-04-2026', 'DD-MM-YYYY')).toBe('2026-04-03');
      expect(parseMisDate('2026-04-03', 'YYYY-MM-DD')).toBe('2026-04-03');
      expect(parseMisDate('03-04-2026', 'YYYY-MM-DD')).toBeNull();
    });

    it('TEST-MIS-ROW-03 accepts either separator for a day-first sheet', () => {
      // One file routinely mixes them; a lender should not need two mappings for that.
      expect(parseMisDate('03/04/2026', 'DD-MM-YYYY')).toBe('2026-04-03');
      expect(parseMisDate('03-04-2026', 'DD/MM/YYYY')).toBe('2026-04-03');
    });

    it('TEST-MIS-ROW-04 reads a month name, in any case', () => {
      expect(parseMisDate('03-Apr-2026', 'DD-MMM-YYYY')).toBe('2026-04-03');
      expect(parseMisDate('3 APRIL 2026', 'DD-MMM-YYYY')).toBe('2026-04-03');
      expect(parseMisDate('03-Xyz-2026', 'DD-MMM-YYYY')).toBeNull();
    });

    it('TEST-MIS-ROW-05 rejects a date that does not exist', () => {
      // A parser that only splits on separators accepts this and produces 2026-03-03 through Date rollover.
      expect(parseMisDate('31-02-2026', 'DD-MM-YYYY')).toBeNull();
      expect(parseMisDate('29-02-2026', 'DD-MM-YYYY')).toBeNull();
      expect(parseMisDate('29-02-2024', 'DD-MM-YYYY')).toBe('2024-02-29');
      expect(parseMisDate('00-04-2026', 'DD-MM-YYYY')).toBeNull();
      expect(parseMisDate('03-13-2026', 'DD-MM-YYYY')).toBeNull();
    });

    it('TEST-MIS-ROW-06 returns null for blank and for text', () => {
      expect(parseMisDate('', 'DD-MM-YYYY')).toBeNull();
      expect(parseMisDate('   ', 'DD-MM-YYYY')).toBeNull();
      expect(parseMisDate('pending', 'DD-MM-YYYY')).toBeNull();
    });
  });

  describe('parseMisAmount', () => {
    it('TEST-MIS-ROW-07 reads Indian digit grouping', () => {
      // Not three-at-a-time: a parser assuming thousands separators mis-reads this.
      expect(parseMisAmount('4,00,000.00')).toBe(400000);
      expect(parseMisAmount('1,20,00,000')).toBe(12000000);
      expect(parseMisAmount('400000')).toBe(400000);
    });

    it('TEST-MIS-ROW-08 strips the currency marks banks put in the cell', () => {
      expect(parseMisAmount('Rs. 400000')).toBe(400000);
      expect(parseMisAmount('rs 4,00,000')).toBe(400000);
      expect(parseMisAmount('₹4,00,000.50')).toBe(400000.5);
      expect(parseMisAmount('INR 400000')).toBe(400000);
      expect(parseMisAmount('400000 Cr')).toBe(400000);
    });

    it('TEST-MIS-ROW-09 refuses zero and negatives instead of clamping them', () => {
      // Zero is a sheet error and a negative is a reversal, which is a different operation entirely. Either one
      // silently clamped to a disbursement would put money in the commission engine that the bank never paid.
      expect(parseMisAmount('0')).toBeNull();
      expect(parseMisAmount('0.00')).toBeNull();
      expect(parseMisAmount('-400000')).toBeNull();
    });

    it('TEST-MIS-ROW-10 refuses anything that is not a number', () => {
      expect(parseMisAmount('')).toBeNull();
      expect(parseMisAmount('pending')).toBeNull();
      expect(parseMisAmount('4,00,000.000')).toBeNull();
      expect(parseMisAmount('4.0.0')).toBeNull();
    });
  });

  describe('resolveMisStatus', () => {
    const statusMap: MisStatusMap = {
      'Disb Done': 'DISBURSED',
      Sanctioned: 'SANCTIONED',
      'Under Review': 'UNDER_PROCESSING',
    };

    it('TEST-MIS-ROW-11 matches whatever case and spacing the file happens to use', () => {
      // One file holds all of these for the same stage; an operator should not have to map each spelling.
      expect(resolveMisStatus('Disb Done', statusMap)).toBe('DISBURSED');
      expect(resolveMisStatus('DISB DONE', statusMap)).toBe('DISBURSED');
      expect(resolveMisStatus('  disb done  ', statusMap)).toBe('DISBURSED');
    });

    it('TEST-MIS-ROW-12 returns null for a word the lender has not mapped', () => {
      // Null becomes an exception row naming the word, which is what tells the operator what to add.
      expect(resolveMisStatus('Pending With Credit', statusMap)).toBeNull();
      expect(resolveMisStatus('', statusMap)).toBeNull();
    });
  });
});
