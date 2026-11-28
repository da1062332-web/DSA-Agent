// TEST-WEB-FILE loan-file page rules (2026-11-28 redesign). Synthetic values only.
import { describe, expect, it } from 'vitest';
import {
  JOURNEY,
  applicationNumber,
  asFileTab,
  formatInr,
  journeyState,
  loanToValue,
  totalValue,
  transitionLabel,
} from './loan-file';

const inr = (amount: string) => ({ amount, currency: 'INR' });
const at = (s: string) => JOURNEY.findIndex((j) => j.status === s);

describe('TEST-WEB-FILE journey', () => {
  it('TEST-WEB-FILE-01 an open file is at its own stage; partial disbursal is the last stage under way', () => {
    expect(journeyState('DRAFT')).toMatchObject({ activeIndex: 0, outcome: null, activeDone: false });
    expect(journeyState('UNDER_REVIEW').activeIndex).toBe(at('UNDER_REVIEW'));
    expect(journeyState('PARTIALLY_DISBURSED')).toMatchObject({
      activeIndex: at('DISBURSED'),
      partial: true,
    });
    expect(journeyState('DISBURSED')).toMatchObject({ activeIndex: at('DISBURSED'), activeDone: true });
  });

  it('TEST-WEB-FILE-02 a stopped file shows where it left the road, from the history or a sensible default', () => {
    const history = [
      { fromStatus: null, toStatus: 'DRAFT' },
      { fromStatus: 'DRAFT', toStatus: 'DOCUMENTS_PENDING' },
      { fromStatus: 'DOCUMENTS_PENDING', toStatus: 'CANCELLED' },
    ];
    expect(journeyState('CANCELLED', history)).toMatchObject({
      activeIndex: at('DOCUMENTS_PENDING'),
      outcome: 'CANCELLED',
    });
    expect(journeyState('CANCELLED')).toMatchObject({ activeIndex: at('DRAFT'), outcome: 'CANCELLED' });
    expect(journeyState('REJECTED')).toMatchObject({ activeIndex: at('SUBMITTED'), outcome: 'REJECTED' });
  });

  it('TEST-WEB-FILE-03 a closed file is complete after disbursal, and stopped where it was when closed after a rejection', () => {
    expect(journeyState('CLOSED', [{ fromStatus: 'DISBURSED', toStatus: 'CLOSED' }])).toMatchObject({
      activeIndex: at('DISBURSED'),
      activeDone: true,
      outcome: 'CLOSED',
    });
    expect(
      journeyState('CLOSED', [
        { fromStatus: 'SUBMITTED', toStatus: 'REJECTED' },
        { fromStatus: 'REJECTED', toStatus: 'CLOSED' },
      ]),
    ).toMatchObject({ activeIndex: at('SUBMITTED'), activeDone: false, outcome: 'CLOSED' });
  });
});

describe('TEST-WEB-FILE figures', () => {
  it('TEST-WEB-FILE-04 the application number is APP- and the last eight ULID characters', () => {
    expect(applicationNumber('app_01M8DSAD6V868WV80KF8AQ7XQ4')).toBe('APP-F8AQ7XQ4');
  });

  it('TEST-WEB-FILE-05 rupees use Indian grouping and drop zero paise', () => {
    expect(formatInr('3750000.00')).toBe('₹37,50,000');
    expect(formatInr('5250000.50')).toBe('₹52,50,000.50');
    expect(formatInr('999.00')).toBe('₹999');
    expect(formatInr('')).toBe('');
  });

  it('TEST-WEB-FILE-06 LTV is requested over the total pledged value, to one decimal, without float error', () => {
    expect(totalValue([inr('5000000.00'), inr('250000.50')])).toBe('5250000.50');
    expect(loanToValue('3750000.00', [inr('5000000.00')])).toBe(75);
    expect(loanToValue('1000000.00', [inr('3000000.00')])).toBe(33.3);
    expect(loanToValue('2000000.00', [inr('3000000.00')])).toBe(66.7);
    expect(loanToValue('3750000.00', [])).toBeNull();
  });

  it('TEST-WEB-FILE-07 an unknown tab opens the overview; history lines read as moves', () => {
    expect(asFileTab('documents')).toBe('documents');
    expect(asFileTab('nope')).toBe('overview');
    expect(asFileTab(null)).toBe('overview');
    const labels = { DRAFT: 'Draft', DOCUMENTS_PENDING: 'Documents pending' };
    expect(transitionLabel(null, 'DRAFT', labels)).toBe('Opened as Draft');
    expect(transitionLabel('DRAFT', 'DOCUMENTS_PENDING', labels)).toBe('Draft → Documents pending');
  });
});
