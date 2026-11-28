// apps/web/src/features/verifications/bureau/BureauCard.spec.tsx — P1-05: what the Bureau card shows on the customer page. The web workspace
// tests screens with react-dom/server (no browser), so each case seeds the query data the card reads, puts the attempt
// (bureau-pull-session.ts, whose rules are tested in bureau-pull-session.spec.ts) into a state, and renders the card in it. Clicks are the
// session's methods, called directly.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CreditReport } from '@dsa/contracts';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as useMeModule from '../../../api/useMe';
import { ApiError } from '../../../api/client';
import { CustomerDetailPage } from '../../customers/CustomerDetailPage';
import type { ConsentResource } from '../../customers/types';
import { BureauCard } from './BureauCard';
import { BureauPullSession } from './bureau-pull-session';

vi.mock('../../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../../api/useMe');
  return { ...actual, useMe: vi.fn() };
});

// Synthetic values that appear nowhere else in the repository.
const PAN = 'JQXWV5182D';
const DOB = '1973-12-09';
const NAME = 'Meenakshi Raghunathan Pillai';
const ID = 'cust_ui_bureau_1';
const START = new Date('2026-11-28T10:00:00.000Z');

function mockGrants(grants: string[]) {
  vi.mocked(useMeModule.useMe).mockReturnValue({
    data: {
      id: 'usr_test',
      tenantId: 'ten_test',
      email: 'test@example.com',
      displayName: 'Test User',
      primaryBranchId: null,
      queueIds: [],
      grants: grants.map((code) => ({ code, scope: 'TENANT', branchIds: [] })),
      mfaVerifiedAt: null,
    },
    isLoading: false,
    isError: false,
  } as never);
}

const report = (over: Partial<CreditReport> = {}): CreditReport => ({
  id: 'crp_01M4V6DFM0TFA9D04QJTW32ETD',
  tenantId: 'ten_demo_01',
  customerId: ID,
  consentRecordId: 'cnst_01M4V6DFM0TFA9D04QJTW32ETD',
  bureau: 'CIBIL',
  provider: 'CRIF',
  outcome: 'SCORED',
  reportDate: '2026-11-28',
  score: 742,
  activeAccounts: 3,
  monthlyEmi: { amount: '1234567.50', currency: 'INR' },
  maxDpd12m: 30,
  enquiries6m: 2,
  vendorRef: 'req_bureau_77',
  cost: { amount: '45.00', currency: 'INR' },
  pulledBy: 'usr_demo_01',
  pulledAt: '2026-11-28T10:00:05.000Z',
  lockVersion: 0,
  createdAt: '2026-11-28T10:00:05.000Z',
  ...over,
});
const noHistory = () =>
  report({
    outcome: 'NO_HISTORY',
    score: null,
    activeAccounts: null,
    monthlyEmi: null,
    maxDpd12m: null,
    enquiries6m: null,
    cost: null,
  });

const consent = (over: Partial<ConsentResource> = {}): ConsentResource =>
  ({
    id: 'cnst_1',
    tenantId: 'ten_1',
    subjectType: 'CUSTOMER',
    subjectId: ID,
    purpose: 'BUREAU_PULL',
    purposeTarget: 'CIBIL',
    noticeVersion: 'V1',
    channel: 'OTP',
    evidenceRef: null,
    capturedBy: 'usr_1',
    capturedAt: '2026-11-20T09:00:00.000Z',
    status: 'ACTIVE',
    withdrawnAt: null,
    withdrawnBy: null,
    withdrawalReason: null,
    expiresAt: null,
    createdAt: '2026-11-20T09:00:00.000Z',
    ...over,
  }) as unknown as ConsentResource;

interface Seed {
  consents?: ConsentResource[];
  latest?: CreditReport | null;
  history?: CreditReport[];
  nextCursor?: string | null;
}

function client(seed: Seed = {}) {
  // retryOnMount false: a query seeded in an error state is shown as it is, not fetched again as the browser would.
  const c = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, retryOnMount: false } },
  });
  if (seed.consents) c.setQueryData(['customer-consents', ID], seed.consents);
  if ('latest' in seed) c.setQueryData(['credit-report-latest', ID, 'CIBIL'], seed.latest);
  if (seed.history) {
    c.setQueryData(['credit-report-history', ID, 'CIBIL'], {
      pages: [{ data: seed.history, meta: { nextCursor: seed.nextCursor ?? null, limit: 20 } }],
      pageParams: [undefined],
    });
  }
  return c;
}

/** The query is in an error state, as it is after a failed read. */
function failQuery(c: QueryClient, queryKey: unknown[], error: Error) {
  c.getQueryCache().build(c, { queryKey }).setState({
    status: 'error',
    error,
    data: undefined,
    fetchStatus: 'idle',
    errorUpdateCount: 1,
    errorUpdatedAt: Date.now(),
  });
}

type Answer = CreditReport | Error;
function sessionWith(...answers: Answer[]) {
  const queue = [...answers];
  return new BureauPullSession(
    {
      call: async () => {
        const next = queue.length > 1 ? queue.shift() : queue[0];
        if (next instanceof Error) throw next;
        return next ?? report();
      },
      newKey: () => 'key_1',
      now: () => START,
    },
    NAME,
  );
}
const fill = (s: BureauPullSession) => {
  s.setField('name', NAME);
  s.setField('pan', PAN);
  s.setField('dateOfBirth', DOB);
};

function render(
  props: { session?: BureauPullSession; defaultDialogOpen?: boolean } = {},
  seed: Seed | QueryClient = {},
) {
  const c = seed instanceof QueryClient ? seed : client(seed);
  return renderToString(
    <QueryClientProvider client={c}>
      <MemoryRouter>
        <BureauCard customerId={ID} customerName={NAME} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const has = (html: string, testId: string) => html.includes(`data-testid="customers.bureau-${testId}"`);
/** The Pull button is drawn disabled by MUI: disabled="" and the Mui-disabled class. */
const pullDisabled = (html: string) =>
  new RegExp(`<button[^>]*disabled=""[^>]*data-testid="customers\\.bureau-pull"`).test(html);

beforeEach(() => {
  vi.clearAllMocks();
  mockGrants(['customer.read', 'credit_report.read', 'credit_report.pull']);
});

describe('P1-05 Bureau card: who sees it', () => {
  it('P1-05 the card is not on the page without credit_report.read, and is with it', () => {
    mockGrants(['customer.read', 'credit_report.pull']);
    expect(has(render(), 'card')).toBe(false);

    mockGrants(['customer.read', 'credit_report.read']);
    const html = render();
    expect(has(html, 'card')).toBe(true);
    expect(html).toContain('Credit bureau report');
  });

  it('P1-05 the Pull button is not drawn without credit_report.pull, and the reading still works', () => {
    mockGrants(['customer.read', 'credit_report.read']);
    const html = render({}, { consents: [consent()], latest: report(), history: [report()] });

    expect(has(html, 'card')).toBe(true);
    expect(has(html, 'pull')).toBe(false);
    expect(has(html, 'score')).toBe(true);
  });

  it('P1-05 while the user is loading, or could not be loaded, the card stays hidden (it fails closed)', () => {
    vi.mocked(useMeModule.useMe).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as never);
    expect(has(render(), 'card')).toBe(false);
    vi.mocked(useMeModule.useMe).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as never);
    expect(has(render(), 'card')).toBe(false);
  });

  it('P1-05 the customer page shows the card for a user with credit_report.read and not without', () => {
    const page = () => {
      const c = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
      c.setQueryData(['customer', ID], {
        customer: {
          id: ID,
          tenantId: 'ten_1',
          partyType: 'INDIVIDUAL',
          fullName: NAME,
          homeBranchId: 'br_1',
          status: 'ACTIVE',
          lockVersion: 1,
          primaryMobileMasked: '+91******0099',
          primaryEmailMasked: null,
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-02T00:00:00.000Z',
        },
        etag: '"1"',
      });
      return renderToString(
        <QueryClientProvider client={c}>
          <MemoryRouter initialEntries={[`/customers/${ID}`]}>
            <Routes>
              <Route path="/customers/:id" element={<CustomerDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    };

    mockGrants(['customer.read']);
    expect(has(page(), 'card')).toBe(false);
    mockGrants(['customer.read', 'credit_report.read']);
    const html = page();
    expect(has(html, 'card')).toBe(true);
    expect(html).toContain('Credit bureau report');
    // The rest of the customer page is still there.
    expect(html).toContain('Consent Management');
  });
});

describe('P1-05 Bureau card: the consent of the bureau', () => {
  it('P1-05 an active consent says so with when and how it was given, offers no "Record consent" link, and the Pull button is enabled', () => {
    const html = render({}, { consents: [consent({ channel: 'IN_PERSON' })] });

    expect(has(html, 'consent-status')).toBe(true);
    expect(html).toContain('Consent active');
    expect(html).toContain('Given for CIBIL');
    expect(html).toContain('in person');
    expect(has(html, 'record-consent-link')).toBe(false);
    expect(has(html, 'pull-blocked')).toBe(false);
    expect(has(html, 'pull')).toBe(true);
    expect(pullDisabled(html)).toBe(false);
  });

  it('P1-05 with no consent for the bureau the Pull button is disabled, says why, and links to the consent page', () => {
    // A consent for another bureau does not count.
    const html = render({}, { consents: [consent({ purposeTarget: 'CRIF' })] });

    expect(html).toContain('No active consent');
    expect(html).toContain('No consent has been recorded for this bureau.');
    expect(has(html, 'pull-blocked')).toBe(true);
    expect(pullDisabled(html)).toBe(true);
    expect(has(html, 'record-consent-link')).toBe(true);
    expect(html).toContain(`href="/customers/${ID}/consents"`);
  });

  it('P1-05 a withdrawn consent and an expired one each have their own words and block the pull', () => {
    const withdrawn = render({}, { consents: [consent({ status: 'WITHDRAWN' })] });
    const expired = render({}, { consents: [consent({ status: 'EXPIRED' })] });
    const lapsed = render({}, { consents: [consent({ expiresAt: '2026-01-01T00:00:00.000Z' })] });

    expect(withdrawn).toContain('The customer withdrew the consent for this bureau.');
    expect(expired).toContain('The consent for this bureau has expired.');
    expect(lapsed).toContain('The consent for this bureau has expired.');
    for (const html of [withdrawn, expired, lapsed]) {
      expect(pullDisabled(html)).toBe(true);
      expect(has(html, 'record-consent-link')).toBe(true);
    }
  });

  it('P1-05 consents that could not be read are "unknown", never "none": the Pull button stays enabled and the server decides', () => {
    const html = render({}, {});

    expect(html).toContain('Consent unknown');
    expect(html).toContain('could not be read here');
    expect(html).not.toContain('No consent has been recorded');
    expect(pullDisabled(html)).toBe(false);
  });

  it('P1-05 only BUREAU_PULL consents count: a verification or loan-processing consent for the same name does not', () => {
    const html = render(
      {},
      {
        consents: [
          consent({ purpose: 'VERIFICATION_CHECK' as never }),
          consent({ purpose: 'LOAN_PROCESSING' as never, purposeTarget: null }),
        ],
      },
    );

    expect(html).toContain('No active consent');
    expect(pullDisabled(html)).toBe(true);
  });
});

describe('P1-05 Bureau card: the latest report and the history', () => {
  it('P1-05 a scored report shows the score, the date, the accounts, the EMIs, the days past due, the enquiries, the reference and the cost', () => {
    const html = render({}, { consents: [consent()], latest: report(), history: [report()] });

    for (const id of [
      'result',
      'score',
      'outcome',
      'report-date',
      'accounts',
      'emi',
      'dpd',
      'enquiries',
      'vendor-ref',
      'cost',
    ])
      expect(has(html, id), id).toBe(true);
    expect(html).toContain('of 300 to 900');
    expect(html).toContain('742');
    expect(html).toContain('2026-11-28');
    expect(html).toContain('₹12,34,567.50');
    expect(html).toContain('req_bureau_77');
    expect(html).toContain('₹45.00');
    expect(html).toContain('Scored');
    expect(html).toContain('Pull again');
    expect(has(html, 'none')).toBe(false);
  });

  it('P1-05 a report of no history says so in words, with no score and no figures', () => {
    const html = render({}, { consents: [consent()], latest: noHistory(), history: [noHistory()] });

    expect(html).toContain('No credit history was found at CIBIL');
    expect(has(html, 'score')).toBe(false);
    expect(has(html, 'emi')).toBe(false);
    expect(has(html, 'accounts')).toBe(false);
    expect(has(html, 'report-date')).toBe(true);
    expect(html).not.toContain('of 300 to 900');
    expect(html).toContain('No history');
  });

  it('P1-05 with no report yet the card says so, and the button says "Pull report"', () => {
    const html = render({}, { consents: [consent()], latest: null, history: [] });

    expect(has(html, 'none')).toBe(true);
    expect(html).toContain('No report pulled yet.');
    expect(has(html, 'result')).toBe(false);
    expect(html).toContain('Pull report');
    expect(html).toContain('No reports pulled for CIBIL.');
  });

  it('P1-05 the history lists each report with its outcome, score, EMIs and days past due, and offers "Load more" only when there is a next page', () => {
    const rows = [
      report({ id: 'crp_a' }),
      noHistory(),
      report({ id: 'crp_c', score: 801, monthlyEmi: { amount: '9000.00', currency: 'INR' }, maxDpd12m: 0 }),
    ];

    const more = render(
      {},
      { consents: [consent()], latest: rows[0], history: rows, nextCursor: 'cursor_next' },
    );
    const last = render({}, { consents: [consent()], latest: rows[0], history: rows, nextCursor: null });

    expect(more.match(/customers\.bureau-history-row/g)).toHaveLength(3);
    expect(more).toContain('801');
    expect(more).toContain('₹9,000.00');
    expect(more).toContain('No history');
    expect(has(more, 'load-more')).toBe(true);
    expect(has(last, 'load-more')).toBe(false);
    expect(has(last, 'history')).toBe(true);
  });

  it('P1-05 a failed read says what failed in fixed words with the reference, not the server text', () => {
    const c = client({ consents: [consent()] });
    failQuery(
      c,
      ['credit-report-latest', ID, 'CIBIL'],
      new ApiError('INTERNAL_ERROR', 500, `server text ${PAN}`, 'corr_read_1'),
    );

    const html = render({}, c);

    expect(has(html, 'read-error')).toBe(true);
    expect(html).toContain('The reports could not be loaded.');
    expect(html).toContain('corr_read_1');
    expect(html).not.toContain('server text');
    expect(html).not.toContain(PAN);
  });

  it('P1-05 a read without permission says so', () => {
    const c = client({ consents: [consent()] });
    failQuery(c, ['credit-report-latest', ID, 'CIBIL'], new ApiError('FORBIDDEN', 403, 'no'));

    expect(render({}, c)).toContain('You do not have permission to view credit reports.');
  });
});

describe('P1-05 Bureau card: the Pull report dialog', () => {
  const ready: Seed = { consents: [consent()], latest: null, history: [] };

  it('P1-05 the dialog asks for the name (prefilled with the customer name), the PAN and the date of birth, with autofill and spell-check off', () => {
    const html = render({ session: sessionWith(report()), defaultDialogOpen: true }, ready);

    for (const id of ['dialog', 'name', 'pan', 'dob', 'submit', 'cancel'])
      expect(has(html, id), id).toBe(true);
    expect(html).toContain('Pull a CIBIL report');
    expect(html).toContain(`value="${NAME}"`);
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain('spellcheck="false"');
    expect(html).toContain('sent to the bureau for this pull only');
    expect(has(html, 'error')).toBe(false);
  });

  it('P1-05 the dialog is not drawn until it is opened', () => {
    const html = render({ session: sessionWith(report()) }, ready);

    expect(has(html, 'dialog')).toBe(false);
    expect(has(html, 'pan')).toBe(false);
  });

  it('P1-05 a field with a problem shows its message and not what was typed', async () => {
    const session = sessionWith(report());
    session.setField('pan', 'JQXWV518D');
    session.setField('dateOfBirth', '2020-01-01');
    await session.submit('CIBIL');

    const html = render({ session, defaultDialogOpen: true }, ready);

    expect(html).toContain('Enter a valid PAN');
    expect(html).toContain('aged 18 to 100');
    expect(html.replace(/value="[^"]*"/g, '')).not.toContain('JQXWV518D');
    expect(html.replace(/value="[^"]*"/g, '')).not.toContain('2020-01-01');
  });

  it('P1-05 while the request is open the form is locked and the buttons say Pulling', () => {
    const session = new BureauPullSession(
      { call: () => new Promise<CreditReport>(() => {}), newKey: () => 'key_1', now: () => START },
      NAME,
    );
    fill(session);
    void session.submit('CIBIL');

    const html = render({ session, defaultDialogOpen: true }, ready);

    expect(session.getState().phase).toBe('sending');
    expect(html).toContain('Pulling…');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="customers\.bureau-submit"/);
    expect(has(html, 'retry')).toBe(false);
    expect(pullDisabled(html)).toBe(true);
  });

  it('P1-05 a server error that can be retried shows its own title, the reference, "Try again" and "Stop this pull" with the note about a second charge', async () => {
    const session = sessionWith(
      new ApiError('DEPENDENCY_UNAVAILABLE', 503, `server text ${PAN}`, 'corr_pull_503'),
    );
    fill(session);
    await session.submit('CIBIL');

    const html = render({ session, defaultDialogOpen: true }, ready);

    expect(has(html, 'error')).toBe(true);
    expect(html).toContain('The bureau could not be reached');
    expect(html).toContain('corr_pull_503');
    expect(has(html, 'retry')).toBe(true);
    expect(has(html, 'stop')).toBe(true);
    expect(has(html, 'stop-note')).toBe(true);
    expect(html).toContain('may charge a second time');
    expect(has(html, 'edit-request')).toBe(false);
    expect(has(html, 'submit')).toBe(false);
    expect(html).not.toContain('server text');
    // Closing the dialog keeps the attempt: the Pull button offers to resume it.
    expect(html).toContain('Resume pull');
    expect(html).toContain('>Close<');
  });

  it('P1-05 a lost connection says it cannot tell whether the request arrived', async () => {
    const session = sessionWith(new ApiError('DEPENDENCY_UNAVAILABLE', 0, 'Cannot reach the API.'));
    fill(session);
    await session.submit('CIBIL');

    const html = render({ session, defaultDialogOpen: true }, ready);

    expect(html).toContain('Connection lost');
    expect(html).toContain('cannot tell whether the request reached the server');
    expect(has(html, 'retry')).toBe(true);
  });

  const refused: [string, ApiError, string][] = [
    [
      'a missing consent',
      new ApiError('CONSENT_REQUIRED', 422, 'x', 'corr_a', [
        { field: 'bureau', issue: 'BUREAU_CONSENT_REQUIRED' },
      ]),
      'Consent is missing',
    ],
    [
      'no provider set up',
      new ApiError('VALIDATION_ERROR', 422, 'x', 'corr_a', [
        { field: 'bureau', issue: 'NO_ACTIVE_CONNECTION' },
      ]),
      'No bureau provider is set up',
    ],
    [
      'an age the server refused',
      new ApiError('VALIDATION_ERROR', 422, 'x', 'corr_a', [{ field: 'dateOfBirth', issue: 'INVALID_AGE' }]),
      'Date of birth not accepted',
    ],
    [
      'a bureau that did not accept the details',
      new ApiError('VALIDATION_ERROR', 422, 'x', 'corr_a', [
        { issue: 'VENDOR_STATUS', meta: { vendorStatusCode: '102' } },
      ]),
      'The bureau did not accept this request',
    ],
    ['an unknown customer', new ApiError('NOT_FOUND', 404, 'x', 'corr_a'), 'Customer not found'],
    [
      'a key that was already used',
      new ApiError('IDEMPOTENCY_KEY_REUSED', 422, 'x', 'corr_a'),
      'This request was already used',
    ],
  ];
  it.each(refused)(
    'P1-05 %s shows its own message and "Change the request", not "Try again"',
    async (_label, error, title) => {
      const session = sessionWith(error);
      fill(session);
      await session.submit('CIBIL');

      const html = render({ session, defaultDialogOpen: true }, ready);

      expect(html).toContain(title);
      expect(html).toContain('corr_a');
      expect(has(html, 'edit-request')).toBe(true);
      expect(has(html, 'retry')).toBe(false);
      expect(has(html, 'stop-note')).toBe(false);
    },
  );

  it('P1-05 a 429 and a 500 can be retried with their own titles', async () => {
    for (const [error, title] of [
      [new ApiError('RATE_LIMITED', 429, 'x', 'corr_b'), 'The bureau is busy'],
      [new ApiError('INTERNAL_ERROR', 500, 'x', 'corr_b'), 'The server could not complete the pull'],
    ] as const) {
      const session = sessionWith(error);
      fill(session);
      await session.submit('CIBIL');
      const html = render({ session, defaultDialogOpen: true }, ready);
      expect(html).toContain(title);
      expect(has(html, 'retry')).toBe(true);
    }
  });
});

describe('P1-05 Bureau card: after a report', () => {
  const seed: Seed = { consents: [consent()], latest: report(), history: [report()] };

  it('P1-05 a new report is announced, the dialog is closed, and no typed value is anywhere on the page', async () => {
    const session = sessionWith(report({ pulledAt: '2026-11-28T10:00:03.000Z' }));
    fill(session);
    await session.submit('CIBIL');

    const html = render({ session, defaultDialogOpen: true }, seed);

    expect(has(html, 'done')).toBe(true);
    expect(html).toContain('The report was pulled.');
    expect(has(html, 'cached-note')).toBe(false);
    expect(has(html, 'dialog')).toBe(false);
    for (const typed of [PAN, DOB, NAME]) expect(html, typed).not.toContain(typed);
    expect(has(html, 'score')).toBe(true);
  });

  it('P1-05 a report that came from the 24-hour cache says the bureau was not charged again', async () => {
    const session = sessionWith(report({ pulledAt: '2026-11-28T06:00:00.000Z' }));
    fill(session);
    await session.submit('CIBIL');

    const html = render({ session }, seed);

    expect(has(html, 'cached-note')).toBe(true);
    expect(html).toContain('This report is from the last 24 hours, so the bureau was not charged again.');
  });

  it('P1-05 a report of no history is announced in words', async () => {
    const session = sessionWith(noHistory());
    fill(session);
    await session.submit('CRIF');

    const html = render({ session }, seed);

    expect(html).toContain('The bureau holds no history for this customer.');
  });

  it('P1-05 "Pull again" after a report starts a new attempt: the form is empty again, with only the customer name', async () => {
    const session = sessionWith(report());
    fill(session);
    await session.submit('CIBIL');

    session.newPull();
    const html = render({ session, defaultDialogOpen: true }, seed);

    expect(session.getState()).toMatchObject({
      phase: 'editing',
      form: { name: NAME, pan: '', dateOfBirth: '' },
    });
    expect(has(html, 'done')).toBe(false);
    expect(html).not.toContain(PAN);
    expect(html).not.toContain(DOB);
  });
});
