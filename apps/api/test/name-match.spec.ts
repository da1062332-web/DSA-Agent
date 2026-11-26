// apps/api/test/name-match.spec.ts — P1-06: the conservative name matcher the KYC adapter scores names with.
import { describe, expect, it } from 'vitest';
import { nameMatchScore, nameTokens } from '../src/modules/integrations/name-match';

describe('P1-06 name matcher', () => {
  it('P1-06 tokens ignore case, punctuation, honorifics and company-form abbreviations', () => {
    expect(nameTokens('Mr. Ravi  K.-Sharma')).toEqual(['RAVI', 'K', 'SHARMA']);
    expect(nameTokens('ABC Traders Pvt. Ltd.')).toEqual(['ABC', 'TRADERS', 'PRIVATE', 'LIMITED']);
    expect(nameTokens('M/S Sharma & Sons')).toEqual(['SHARMA', 'AND', 'SONS']);
    expect(nameTokens('Mrs')).toEqual([]);
  });

  it('P1-06 the same name in any case or word order scores 100', () => {
    expect(nameMatchScore('Ravi Kumar Sharma', 'RAVI KUMAR SHARMA')).toBe(100);
    expect(nameMatchScore('Sharma, Ravi Kumar', 'RAVI KUMAR SHARMA')).toBe(100);
    expect(nameMatchScore('ABC Traders Pvt. Ltd.', 'ABC TRADERS PRIVATE LIMITED')).toBe(100);
    expect(nameMatchScore('M/S Sharma & Sons', 'SHARMA AND SONS')).toBe(100);
  });

  it('P1-06 an initial matches the word it starts, a missing middle name costs half a word', () => {
    expect(nameMatchScore('R K Sharma', 'Ravi Kumar Sharma')).toBe(93.3);
    expect(nameMatchScore('Mr. Ravi K. Sharma', 'Ravi Kumar Sharma')).toBeGreaterThanOrEqual(90);
    expect(nameMatchScore('Ravi Sharma', 'Ravi Kumar Sharma')).toBe(80);
  });

  it('P1-06 one typing slip is forgiven in a long word only, so a different person is not matched', () => {
    expect(nameMatchScore('Ravi Kumar Sharmaa', 'Ravi Kumar Sharma')).toBeGreaterThanOrEqual(90);
    expect(nameMatchScore('Ravi Kumar Sharms', 'Ravi Kumar Sharma')).toBeLessThan(80);
    expect(nameMatchScore('Rajesh Kumar', 'Ramesh Kumar')).toBe(50);
  });

  it('P1-06 unrelated names score far below any sensible threshold', () => {
    expect(nameMatchScore('Mohan Lal Gupta', 'Ravi Kumar Sharma')).toBeLessThan(30);
  });

  it('P1-06 a name with no usable word scores 0', () => {
    expect(nameMatchScore('', 'Ravi Kumar Sharma')).toBe(0);
    expect(nameMatchScore('Mr', 'Ravi Kumar Sharma')).toBe(0);
    expect(nameMatchScore('Ravi', '')).toBe(0);
  });

  it('P1-06 the score is symmetric, between 0 and 100, and has at most one decimal', () => {
    const names = [
      'Ravi Kumar Sharma',
      'R K Sharma',
      'Ravi Sharma',
      'Sharma Ravi',
      'Mohan Lal Gupta',
      'Rajesh Kumar',
      'Ramesh Kumar',
      'ABC Traders Pvt Ltd',
      'ABC Trading Company',
      'A',
      'Ravi Kumar Sharmaa',
    ];
    for (const a of names) {
      for (const b of names) {
        const score = nameMatchScore(a, b);
        expect(score, `${a} / ${b}`).toBe(nameMatchScore(b, a));
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
        expect(Math.abs(score * 10 - Math.round(score * 10)), `${a} / ${b}`).toBeLessThan(1e-9);
      }
    }
  });
});
