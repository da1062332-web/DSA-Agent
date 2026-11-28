// TEST-WEB-SRCH customer search box rules (2026-11-28). Synthetic values only.
import { describe, expect, it } from 'vitest';
import { isMobileTerm, searchHint, searchProblem, searchTerm } from './customer-search';

describe('TEST-WEB-SRCH customer search box', () => {
  it('TEST-WEB-SRCH-01 a mobile in any common form is searched as typed', () => {
    for (const m of ['9876500011', '+91 98765 00011', '09876500011', '919876500011', '98765-00011']) {
      expect(isMobileTerm(m), m).toBe(true);
      expect(searchTerm(m), m).toBe(m);
    }
  });

  it('TEST-WEB-SRCH-02 a partial mobile waits for all 10 digits, with a hint and no warning', () => {
    expect(searchTerm('98765')).toBeNull();
    expect(searchProblem('98765')).toBeNull();
    expect(searchHint('98765')).toMatch(/10 digits/);
  });

  it('TEST-WEB-SRCH-03 a name needs 2 letters; PAN, Aadhaar or account numbers are never sent', () => {
    expect(searchTerm('a')).toBeNull();
    expect(searchTerm('as')).toBe('as');
    expect(searchTerm('ABCDE1234F')).toBeNull();
    expect(searchProblem('ABCDE1234F')).toMatch(/PAN/);
    expect(searchTerm('123412341234')).toBeNull();
    expect(searchProblem('123412341234')).toMatch(/not a valid/);
    expect(searchHint('')).toMatch(/mobile number or at least 2 letters/);
  });
});
