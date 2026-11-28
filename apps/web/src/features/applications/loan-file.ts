// Rules for the loan-file page /applications/:id (owner: Bhushan, 2026-11-28 redesign). Pure functions, so the page and its tests
// agree. Nothing here decides anything the API decides; it only describes the file for display.
import type { Money } from '@dsa/contracts';
import type { ApplicationStatus } from './rules';

/** The stages of a loan file; the key is the ?stage= value, so a link can open the file on a stage. */
export type StageKey = 'draft' | 'documents' | 'review' | 'ready' | 'lender' | 'sanctioned' | 'disbursed';

/**
 * The road a loan file travels, in order. The labels are what a loan officer calls each stage; `purpose` is what the stage is for,
 * shown at the top of the stage on the page.
 */
export const JOURNEY: readonly {
  key: StageKey;
  status: ApplicationStatus;
  label: string;
  hint: string;
  purpose: string;
  /** Who or what moves the file to the next stage. */
  movesOn: string;
}[] = [
  {
    key: 'draft',
    status: 'DRAFT',
    label: 'Draft',
    hint: 'Applicant and loan request captured',
    purpose:
      'Capture who is borrowing and what they need: the applicants and co-applicants, the loan request, any property pledged, and the product.',
    movesOn: 'Choose the product and start the documents (Next step).',
  },
  {
    key: 'documents',
    status: 'DOCUMENTS_PENDING',
    label: 'Documents',
    hint: 'Collecting the borrower documents',
    purpose: 'Collect and verify the documents the product asks for, from every applicant.',
    movesOn: 'A credit reviewer sends the file to credit review once every mandatory document is accepted.',
  },
  {
    key: 'review',
    status: 'UNDER_REVIEW',
    label: 'Credit review',
    hint: 'Documents and eligibility reviewed',
    purpose:
      'Work out what the household can borrow: club the incomes, count the EMIs, and see which lenders will take the file and for how much.',
    movesOn: 'A credit reviewer marks the file ready for submission.',
  },
  {
    key: 'ready',
    status: 'READY_FOR_SUBMISSION',
    label: 'Ready',
    hint: 'File complete, ready for a lender',
    purpose: 'Choose the lender, open the lender case and build the frozen document package.',
    movesOn: 'Submitting the lender case to the lender moves the file on by itself.',
  },
  {
    key: 'lender',
    status: 'SUBMITTED',
    label: 'With lender',
    hint: 'Logged in with one or more lenders',
    purpose: 'The file is with the lender. Answer their queries until they decide.',
    movesOn: "The lender's sanction, recorded on the lender case, moves the file on.",
  },
  {
    key: 'sanctioned',
    status: 'SANCTIONED',
    label: 'Sanctioned',
    hint: 'A lender sanctioned the loan',
    purpose: 'Record the sanction terms and follow the disbursement.',
    movesOn: 'A verified disbursement moves the file on.',
  },
  {
    key: 'disbursed',
    status: 'DISBURSED',
    label: 'Disbursed',
    hint: 'Loan amount paid out',
    purpose: 'The loan is paid out. Check the disbursement and close the file.',
    movesOn: 'The last step. Close the file once the payout is confirmed.',
  },
];

/** The stage to show: the one named in the address when it exists, else the stage the file is at. */
export function selectedStageIndex(param: string | null, journey: JourneyState): number {
  const named = JOURNEY.findIndex((j) => j.key === param);
  return named >= 0 ? named : journey.activeIndex;
}

/** How a stage stands against where the file is. */
export function stagePosition(
  index: number,
  journey: JourneyState,
): 'done' | 'current' | 'upcoming' | 'stopped' {
  if (index < journey.activeIndex || (index === journey.activeIndex && journey.activeDone)) return 'done';
  if (index === journey.activeIndex) {
    return journey.outcome && journey.outcome !== 'CLOSED' ? 'stopped' : 'current';
  }
  return 'upcoming';
}

export type JourneyOutcome = 'REJECTED' | 'WITHDRAWN' | 'CANCELLED' | 'CLOSED' | null;

export interface JourneyState {
  /** The stage the file is at (or stopped at), as an index into JOURNEY. */
  activeIndex: number;
  /** True when every stage up to and including activeIndex is done (a closed or fully disbursed file). */
  activeDone: boolean;
  /** Set when the file left the road: it stopped at activeIndex with this outcome. */
  outcome: JourneyOutcome;
  /** PARTIALLY_DISBURSED: the last stage is under way. */
  partial: boolean;
}

const indexOf = (s: string | null | undefined) => JOURNEY.findIndex((j) => j.status === s);

/**
 * Where the file stands on the road. A rejected, withdrawn or cancelled file stopped at the stage it left from, which the status
 * history tells (the last move into that status); without history the usual stage for that outcome is assumed.
 */
export function journeyState(
  status: ApplicationStatus,
  history: readonly { fromStatus: string | null; toStatus: string }[] = [],
): JourneyState {
  if (status === 'PARTIALLY_DISBURSED') {
    return { activeIndex: indexOf('DISBURSED'), activeDone: false, outcome: null, partial: true };
  }
  if (status === 'DISBURSED') {
    return { activeIndex: indexOf('DISBURSED'), activeDone: true, outcome: null, partial: false };
  }
  if (status === 'CLOSED') {
    const from = [...history].reverse().find((h) => h.toStatus === 'CLOSED')?.fromStatus;
    const at = from === 'DISBURSED' || from === 'PARTIALLY_DISBURSED' || !from ? 'DISBURSED' : from;
    const stoppedAt = [...history].reverse().find((h) => h.toStatus === at)?.fromStatus;
    // A file closed after a rejection, withdrawal or cancellation stopped where that happened.
    if (at === 'REJECTED' || at === 'WITHDRAWN' || at === 'CANCELLED') {
      const idx = indexOf(stoppedAt);
      return {
        activeIndex: idx >= 0 ? idx : fallbackStop(at),
        activeDone: false,
        outcome: 'CLOSED',
        partial: false,
      };
    }
    return { activeIndex: indexOf('DISBURSED'), activeDone: true, outcome: 'CLOSED', partial: false };
  }
  if (status === 'REJECTED' || status === 'WITHDRAWN' || status === 'CANCELLED') {
    const from = [...history].reverse().find((h) => h.toStatus === status)?.fromStatus;
    const idx = indexOf(from);
    return {
      activeIndex: idx >= 0 ? idx : fallbackStop(status),
      activeDone: false,
      outcome: status,
      partial: false,
    };
  }
  return { activeIndex: Math.max(0, indexOf(status)), activeDone: false, outcome: null, partial: false };
}

function fallbackStop(outcome: 'REJECTED' | 'WITHDRAWN' | 'CANCELLED'): number {
  if (outcome === 'REJECTED') return indexOf('SUBMITTED');
  if (outcome === 'WITHDRAWN') return indexOf('UNDER_REVIEW');
  return indexOf('DRAFT');
}

/** A short reference a person can read out on a call: APP- and the last eight characters of the ULID. */
export function applicationNumber(id: string): string {
  const tail = id.replace(/^app_/, '').slice(-8).toUpperCase();
  return `APP-${tail}`;
}

export const PRODUCT_LABELS: Record<string, string> = {
  PL: 'Personal loan',
  BL: 'Business loan',
  MSME: 'MSME loan',
  LAP: 'Loan against property',
  HL: 'Home loan',
  VL: 'Vehicle loan',
  GL: 'Gold loan',
  EL: 'Education loan',
  OTHER: 'Loan',
};

export const APPLICANT_TYPE_LABELS: Record<string, string> = {
  SALARIED: 'Salaried',
  SELF_EMPLOYED_PROFESSIONAL: 'Self-employed professional',
  SELF_EMPLOYED_BUSINESS: 'Self-employed business',
  NON_INDIVIDUAL: 'Non-individual (company or firm)',
};

/** "HOME_PURCHASE" → "Home purchase". */
export const humanize = (code: string | null | undefined): string =>
  code ? code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, ' ') : '';

/** "3750000.00" → "₹37,50,000" (paise shown only when not zero). */
export function formatInr(amount: string | null | undefined): string {
  if (!amount || !/^\d+(\.\d+)?$/.test(amount)) return '';
  const [whole = '0', fraction = ''] = amount.split('.');
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const grouped = rest ? `${rest},${last3}` : last3;
  const paise = fraction.padEnd(2, '0').slice(0, 2);
  return `₹${grouped}${paise === '00' ? '' : `.${paise}`}`;
}

/** Whole paise of a decimal string, without a float: "5250000.50" → 525000050n. */
const toPaise = (amount: string): bigint => {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
};

/** Sum of the pledged properties, as a two-place amount string. */
export function totalValue(values: readonly Money[]): string {
  const paise = values.reduce((sum, v) => sum + toPaise(v.amount), 0n);
  return `${paise / 100n}.${String(paise % 100n).padStart(2, '0')}`;
}

/**
 * Loan to value: the requested amount as a percentage of the pledged value, one decimal place, or null when nothing is pledged. A
 * lender compares this with its LTV cap; the page only shows it.
 */
export function loanToValue(requested: string, values: readonly Money[]): number | null {
  const value = toPaise(totalValue(values));
  if (value === 0n) return null;
  const tenths = (toPaise(requested) * 1000n + value / 2n) / value; // rounded half up
  return Number(tenths) / 10;
}

/** The tone of a status chip: green done, amber needs action, red stopped, blue in progress. */
export function statusTone(status: ApplicationStatus): 'success' | 'warning' | 'error' | 'info' | 'default' {
  if (status === 'DISBURSED' || status === 'SANCTIONED' || status === 'CLOSED') return 'success';
  if (status === 'REJECTED' || status === 'CANCELLED' || status === 'WITHDRAWN') return 'error';
  if (status === 'DOCUMENTS_PENDING') return 'warning';
  if (status === 'DRAFT') return 'default';
  return 'info';
}

/** One line for a status-history entry: "Draft → Documents pending". */
export function transitionLabel(
  fromStatus: string | null,
  toStatus: string,
  labels: Record<string, string>,
): string {
  const to = labels[toStatus] ?? humanize(toStatus);
  return fromStatus ? `${labels[fromStatus] ?? humanize(fromStatus)} → ${to}` : `Opened as ${to}`;
}

/** "2026-11-26T09:30:00Z" → "26 Nov 2026" (the viewer's time zone). */
export const fileDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

/** "26 Nov 2026, 3:00 pm". */
export const fileDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
