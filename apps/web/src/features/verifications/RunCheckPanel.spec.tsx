// apps/web/src/features/verifications/RunCheckPanel.spec.tsx — P1-06: what "Run a provider check" shows on the verification workbench.
// The web workspace tests screens with react-dom/server (no browser), so each case puts the attempt (run-check-session.ts, whose rules are
// tested in run-check-session.spec.ts) into a state and renders the panel in it. Clicks are the session's methods, called directly.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { VerificationRecord } from '@dsa/contracts';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as useMeModule from '../../api/useMe';
import { ApiError } from '../../api/client';
import { RunCheckPanel } from './RunCheckPanel';
import { RunCheckSession } from './run-check-session';
import { VerificationPage } from './VerificationPage';

vi.mock('../../api/useMe', async () => {
  const actual = await vi.importActual<typeof useMeModule>('../../api/useMe');
  return { ...actual, useMe: vi.fn() };
});

// Synthetic values that appear nowhere else in the repository.
const PAN = 'QXZKW7391L';
const GSTIN = '27QXZKW7391L1Z5';
const ACCOUNT = '731904826517';
const NAME = 'Sunita Devi Verma';
const CUSTOMER = 'cus_01M4V6DFM0TFA9D04QJTW32ETD';
const CONSENT = 'cnst_01M4V6DFM0TFA9D04QJTW32ETD';

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

const record = (overrides: Partial<VerificationRecord> = {}): VerificationRecord => ({
  id: 'ver_01M4V6DFM0TFA9D04QJTW32ETD',
  tenantId: 'ten_demo_01',
  subjectType: 'CUSTOMER',
  subjectId: CUSTOMER,
  checkType: 'PAN',
  method: 'PROVIDER_AUTOMATED',
  purpose: 'KYC',
  consentRecordId: CONSENT,
  result: 'VERIFIED',
  minimalResult: {
    statusDescription: 'PAN verified',
    maskedIdentifier: 'QXZKW****L',
    nameMatchScore: 96,
    providerReference: 'req_pan_1',
    discrepancies: [],
  },
  evidenceRef: 'KARZA:req_pan_1',
  validityExpiresAt: null,
  performedBy: 'usr_demo_01',
  performedAt: '2026-11-27T10:00:00.000Z',
  notes: null,
  lockVersion: 0,
  createdAt: '2026-11-27T10:00:00.000Z',
  ...overrides,
});
const bankRecord = (overrides: Partial<VerificationRecord> = {}) =>
  record({
    checkType: 'BANK_ACCOUNT',
    minimalResult: {
      statusDescription: 'Bank account verified',
      maskedIdentifier: '********6517',
      nameMatchScore: 100,
      providerReference: 'req_bank_1',
      discrepancies: [],
    },
    evidenceRef: 'KARZA:req_bank_1',
    ...overrides,
  });
const unknownRecord = () =>
  bankRecord({
    result: 'INCONCLUSIVE',
    minimalResult: {
      statusDescription: 'Bank account check inconclusive',
      maskedIdentifier: '********6517',
      discrepancies: ['OUTCOME_UNKNOWN'],
    },
    evidenceRef: 'KARZA:idem_0123456789abcdef0123',
  });

type Answer = VerificationRecord | Error | 'never';
function sessionWith(...answers: Answer[]) {
  const queue = [...answers];
  const session = new RunCheckSession({
    call: async () => {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next === 'never') return new Promise<VerificationRecord>(() => {});
      if (next instanceof Error) throw next;
      return next ?? record();
    },
    newKey: () => 'key_1',
  });
  return session;
}
const fillPan = (s: RunCheckSession) => {
  s.setField('subjectId', CUSTOMER);
  s.setField('consentRecordId', CONSENT);
  s.setField('idNumber', PAN);
  s.setField('name', NAME);
};
const fillBank = (s: RunCheckSession) => {
  s.setCheck('BANK_ACCOUNT');
  s.setField('subjectId', CUSTOMER);
  s.setField('consentRecordId', CONSENT);
  s.setField('accountNumber', ACCOUNT);
  s.setField('ifsc', 'HDFC0001234');
  s.setField('name', NAME);
};

const render = (session: RunCheckSession) =>
  renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <RunCheckPanel session={session} />
    </QueryClientProvider>,
  );
const has = (html: string, testId: string) =>
  html.includes(`data-testid="verifications.run-check-${testId}"`);

beforeEach(() => {
  vi.clearAllMocks();
  mockGrants(['verification.read', 'verification.perform']);
});

describe('P1-06 run a provider check: who sees the panel', () => {
  it('P1-06 the panel is not on the page without verification.perform, and is with it', () => {
    mockGrants(['verification.read']);
    expect(render(sessionWith(record()))).not.toContain('Run a provider check');
    expect(has(render(sessionWith(record())), 'panel')).toBe(false);

    mockGrants(['verification.read', 'verification.perform']);
    const html = render(sessionWith(record()));
    expect(html).toContain('Run a provider check');
    expect(has(html, 'panel')).toBe(true);
  });

  it('P1-06 while the user is still loading, or could not be loaded, the panel stays hidden (it fails closed)', () => {
    vi.mocked(useMeModule.useMe).mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    } as never);
    expect(has(render(sessionWith(record())), 'panel')).toBe(false);
    vi.mocked(useMeModule.useMe).mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    } as never);
    expect(has(render(sessionWith(record())), 'panel')).toBe(false);
  });

  it('P1-06 the verification workbench shows the panel only with verification.perform', () => {
    const page = () =>
      renderToString(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter initialEntries={['/verifications/workbench']}>
            <VerificationPage />
          </MemoryRouter>
        </QueryClientProvider>,
      );

    mockGrants(['verification.read']);
    expect(has(page(), 'panel')).toBe(false);
    mockGrants(['verification.read', 'verification.perform']);
    const html = page();
    expect(has(html, 'panel')).toBe(true);
    expect(html).toContain('Verification Workbench');
  });
});

describe('P1-06 run a provider check: the form', () => {
  it('P1-06 a PAN check asks for the subject, the consent, the PAN and an optional name, each with a test id, and nothing of the bank check', () => {
    const html = render(sessionWith(record()));

    for (const id of ['type', 'subject-type', 'subject-id', 'consent-id', 'id-number', 'name', 'submit']) {
      expect(has(html, id), id).toBe(true);
    }
    expect(has(html, 'account-number')).toBe(false);
    expect(has(html, 'ifsc')).toBe(false);
    expect(has(html, 'bank-note')).toBe(false);
    expect(html).toContain('Run check');
    expect(html).not.toContain('sends ₹1');
  });

  it('P1-06 a bank check asks for the account number and the IFSC, says it sends ₹1, and the button says so too', () => {
    const session = sessionWith(bankRecord());
    session.setCheck('BANK_ACCOUNT');
    const html = render(session);

    for (const id of ['account-number', 'ifsc', 'bank-note', 'name', 'submit'])
      expect(has(html, id), id).toBe(true);
    expect(has(html, 'id-number')).toBe(false);
    expect(html).toContain('A bank check sends ₹1');
    expect(html).toContain('Run check (sends ₹1)');
    // The account number is a numeric field.
    expect(html).toMatch(/data-testid="verifications\.run-check-account-number"[^>]*/);
    expect(html).toContain('inputMode="numeric"');
  });

  it('P1-06 a GST check labels its field GSTIN', () => {
    const session = sessionWith(record());
    session.setCheck('GST');
    const html = render(session);

    expect(html).toContain('GSTIN');
    expect(has(html, 'id-number')).toBe(true);
  });

  it('P1-06 the fields that take a PAN, GSTIN, account number or name turn off autofill and spell-check', () => {
    const session = sessionWith(record());
    const pan = render(session);
    session.setCheck('BANK_ACCOUNT');
    const bank = render(session);

    for (const html of [pan, bank]) {
      expect(html).toContain('autoComplete="off"');
      expect(html).toContain('spellcheck="false"');
    }
  });

  it('P1-06 a field with a problem shows its message and not what was typed', async () => {
    const session = sessionWith(record());
    session.setField('subjectId', CUSTOMER);
    session.setField('consentRecordId', CONSENT);
    session.setField('idNumber', 'QXZKW739L');
    await session.submit();
    const html = render(session);

    expect(html).toContain('Enter a valid PAN');
    // The only place the wrong PAN appears is the field's own (disabled) value, never the message.
    expect(html.replace(/value="[^"]*"/g, '')).not.toContain('QXZKW739L');
  });

  it('P1-06 while the request is open the form is locked and the button says Running', () => {
    const session = sessionWith('never');
    fillPan(session);
    void session.submit();
    const html = render(session);

    expect(session.getState().phase).toBe('sending');
    expect(html).toContain('Running…');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="verifications\.run-check-submit"/);
    expect(has(html, 'retry')).toBe(false);
  });
});

describe('P1-06 run a provider check: a result', () => {
  it('P1-06 a PAN result shows the result, the masked PAN, the name-match score and the vendor reference, and not what was typed', async () => {
    const session = sessionWith(record());
    fillPan(session);
    await session.submit();
    const html = render(session);

    for (const id of [
      'result',
      'result-chip',
      'masked-identifier',
      'name-score',
      'provider-reference',
      'evidence-ref',
      'new-check',
    ]) {
      expect(has(html, id), id).toBe(true);
    }
    expect(html).toContain('VERIFIED');
    expect(html).toContain('QXZKW****L');
    expect(html).toContain('96 / 100');
    expect(html).toContain('req_pan_1');
    expect(html).toContain('KARZA:req_pan_1');
    expect(has(html, 'unknown-warning')).toBe(false);
    expect(has(html, 'submit')).toBe(false);
    expect(html).not.toContain(PAN);
    expect(html).not.toContain(NAME);
  });

  it('P1-06 a bank result shows the masked account, and neither the account number, the PAN, the GSTIN nor the name appears anywhere on the page', async () => {
    const session = sessionWith(bankRecord());
    fillBank(session);
    session.setField('idNumber', GSTIN);
    await session.submit();
    const html = render(session);

    expect(html).toContain('********6517');
    expect(html).toContain('Bank account (₹1 penny drop)');
    for (const typed of [ACCOUNT, PAN, GSTIN, NAME]) expect(html).not.toContain(typed);
  });

  it('P1-06 a rejected result lists its reasons in plain words, once each', async () => {
    const session = sessionWith(
      record({
        result: 'REJECTED',
        minimalResult: {
          statusDescription: 'PAN not verified',
          maskedIdentifier: 'QXZKW****L',
          nameMatchScore: 12,
          discrepancies: ['NAME_MISMATCH', 'PAN_NOT_VALID'],
        },
      }),
    );
    fillPan(session);
    await session.submit();
    const html = render(session);

    expect(html).toContain('REJECTED');
    expect(html).toContain('The name does not match the name on record.');
    expect(html).toContain('The PAN is not valid or not active.');
    expect(html.match(/run-check-reason/g)).toHaveLength(2);
    // No provider reference was returned, so the line is not drawn.
    expect(has(html, 'provider-reference')).toBe(false);
  });

  it('P1-06 an unknown bank outcome shows the warning with the case, says nothing is certain, and offers "Start a new bank check", not "New check"', async () => {
    const session = sessionWith(unknownRecord());
    fillBank(session);
    await session.submit();
    const html = render(session);

    expect(has(html, 'unknown-warning')).toBe(true);
    expect(html).toContain('The bank did not confirm.');
    expect(html).toContain('₹1 may or may not have been sent');
    expect(html).toContain('Confirm with the provider before starting another check');
    expect(html).toContain('(case: KARZA:idem_0123456789abcdef0123)');
    expect(html).toContain('Start a new bank check');
    expect(html).toContain('INCONCLUSIVE');
    // The same fact is not repeated as a reason line, and there is no automatic retry control.
    expect(has(html, 'reason')).toBe(false);
    expect(has(html, 'retry')).toBe(false);
    expect(has(html, 'submit')).toBe(false);
  });

  it('P1-06 the unknown-outcome confirmation dialog repeats the warning, and asks before a new bank check is started', async () => {
    const session = sessionWith(unknownRecord());
    fillBank(session);
    await session.submit();
    expect(has(render(session), 'confirm-dialog')).toBe(false);

    session.newCheck();
    const html = render(session);

    expect(session.getState().phase).toBe('confirm-new');
    expect(has(html, 'confirm-dialog')).toBe(true);
    expect(html).toContain('Start a new bank check?');
    expect(html).toContain('may already have sent ₹1');
    expect(html).toContain('A new check sends ₹1 again');
    expect(has(html, 'confirm-new')).toBe(true);
    expect(has(html, 'cancel-new')).toBe(true);
    // The result stays visible behind the question.
    expect(has(html, 'unknown-warning')).toBe(true);
  });
});

describe('P1-06 run a provider check: an error', () => {
  const api = (code: string, httpStatus: number, details: ApiError['details'] = []) =>
    new ApiError(code, httpStatus, `server text ${PAN}`, 'corr_abc_123', details);

  it('P1-06 a provider that could not be reached says so, quotes the reference, offers "Try again" and keeps the form (locked) for it', async () => {
    const session = sessionWith(api('DEPENDENCY_UNAVAILABLE', 503));
    fillBank(session);
    await session.submit();
    const html = render(session);

    expect(has(html, 'error')).toBe(true);
    expect(html).toContain('The provider could not be reached');
    expect(html).toContain('corr_abc_123');
    expect(has(html, 'retry')).toBe(true);
    expect(has(html, 'discard')).toBe(true);
    expect(has(html, 'edit-request')).toBe(false);
    expect(has(html, 'submit')).toBe(false);
    expect(html).not.toContain('server text');
    // A bank attempt that can be retried says to stay on the page: the reference of the attempt lives only there.
    expect(has(html, 'leave-note')).toBe(true);
    expect(html).toContain('a new bank check');
  });

  it('P1-06 a failed PAN attempt has no such note (a PAN lookup moves no money), and neither has a bank error that cannot be retried', async () => {
    const pan = sessionWith(api('DEPENDENCY_UNAVAILABLE', 503));
    fillPan(pan);
    await pan.submit();
    expect(has(render(pan), 'retry')).toBe(true);
    expect(has(render(pan), 'leave-note')).toBe(false);

    const bank = sessionWith(api('CONSENT_REQUIRED', 422));
    fillBank(bank);
    await bank.submit();
    expect(has(render(bank), 'edit-request')).toBe(true);
    expect(has(render(bank), 'leave-note')).toBe(false);
  });

  it('P1-06 a lost connection says it cannot tell whether the request arrived', async () => {
    const session = sessionWith(new ApiError('DEPENDENCY_UNAVAILABLE', 0, 'Cannot reach the API.'));
    fillBank(session);
    await session.submit();
    const html = render(session);

    expect(html).toContain('Connection lost');
    expect(html).toContain('cannot tell whether the request reached the server');
    expect(has(html, 'retry')).toBe(true);
  });

  const refused: [string, Error, string][] = [
    [
      'no provider set up',
      api('VALIDATION_ERROR', 422, [{ field: 'check', issue: 'NO_ACTIVE_CONNECTION' }]),
      'No provider is set up for this check',
    ],
    ['a missing consent', api('CONSENT_REQUIRED', 422), 'Consent is missing'],
    ['an unknown id', api('NOT_FOUND', 404), 'Not found'],
    ['a key that was used before', api('IDEMPOTENCY_KEY_REUSED', 422), 'This request was already used'],
    [
      'a consent of someone else',
      api('VALIDATION_ERROR', 422, [{ field: 'consentRecordId', issue: 'CONSENT_SUBJECT_MISMATCH' }]),
      'This consent belongs to someone else',
    ],
  ];
  it.each(refused)(
    'P1-06 %s shows its own message and "Change the request", not "Try again"',
    async (_label, error, title) => {
      const session = sessionWith(error);
      fillPan(session);
      await session.submit();
      const html = render(session);

      expect(html).toContain(title);
      expect(html).toContain('corr_abc_123');
      expect(has(html, 'edit-request')).toBe(true);
      expect(has(html, 'retry')).toBe(false);
    },
  );

  it('P1-06 a server error (500) can be retried and shows its own message', async () => {
    const session = sessionWith(api('INTERNAL_ERROR', 500));
    fillPan(session);
    await session.submit();
    const html = render(session);

    expect(html).toContain('The server could not complete the check');
    expect(has(html, 'retry')).toBe(true);
  });

  it('P1-06 giving up a failed bank attempt asks first, with the same dialog', async () => {
    const session = sessionWith(api('DEPENDENCY_UNAVAILABLE', 503));
    fillBank(session);
    await session.submit();
    session.discard();
    const html = render(session);

    expect(has(html, 'confirm-dialog')).toBe(true);
    expect(has(html, 'error')).toBe(true);
  });
});

describe('P1-06 run a provider check: the list filter', () => {
  // The filter is a MUI Select whose options are not in the page until it is opened, so this reads the source of the page.
  const source = readFileSync(path.resolve(__dirname, 'VerificationPage.tsx'), 'utf8');

  it('P1-06 the check-type filter offers the bank option, and the manual create form does not', () => {
    const filterBar = source.slice(
      source.indexOf('<InputLabel>Check Type</InputLabel>'),
      source.indexOf('<InputLabel>Result</InputLabel>'),
    );
    expect(filterBar).toContain('<MenuItem value="BANK_ACCOUNT">Bank Account (penny drop)</MenuItem>');
    expect(source.match(/value="BANK_ACCOUNT"/g)).toHaveLength(1);
  });
});
