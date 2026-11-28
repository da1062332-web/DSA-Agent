// apps/web/src/features/verifications/run-check-session.spec.ts — P1-06: THE MONEY RULE on screen, tested on the state machine the screen is
// made of (run-check-session.ts). A bank check sends Rs 1, so: one Idempotency-Key per attempt, the same key on every retry, no retry that a
// person did not ask for, and a new key only after a result and, when the outcome is unknown, only after a confirmation.
import { QueryClient } from '@tanstack/react-query';
import type { RunVerificationCheck, VerificationRecord } from '@dsa/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import { RunCheckSession, type RunCheckState } from './run-check-session';

// Synthetic values that appear nowhere else in the repository.
const PAN = 'QXZKW7391L';
const GSTIN = '27QXZKW7391L1Z5';
const ACCOUNT = '731904826517';
const NAME = 'Sunita Devi Verma';
const CUSTOMER = 'cus_01M4V6DFM0TFA9D04QJTW32ETD';
const CONSENT = 'cnst_01M4V6DFM0TFA9D04QJTW32ETD';

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
const bankRecord = (result: VerificationRecord['result'], discrepancies: string[] = []) =>
  record({
    checkType: 'BANK_ACCOUNT',
    result,
    minimalResult: { statusDescription: 'Bank account', maskedIdentifier: '********6517', discrepancies },
    evidenceRef: 'KARZA:idem_0123456789abcdef0123',
  });
const unknownRecord = () => bankRecord('INCONCLUSIVE', ['OUTCOME_UNKNOWN']);

const apiError = (code: string, httpStatus: number, details: ApiError['details'] = []) =>
  new ApiError(code, httpStatus, `server text with ${PAN} ${ACCOUNT}`, 'corr_1', details);
const connectionLost = () => new ApiError('DEPENDENCY_UNAVAILABLE', 0, 'Cannot reach the API.');

type Call = (body: RunVerificationCheck, key: string) => Promise<VerificationRecord>;

/** A session whose API answers from a script (the last answer repeats); `calls` records every request with its key. */
function setup(...answers: (VerificationRecord | Error)[]) {
  const calls: { body: RunVerificationCheck; key: string }[] = [];
  const queue = [...answers];
  const call: Call = async (body, key) => {
    calls.push({ body, key });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return next ?? record();
  };
  let n = 0;
  const newKey = vi.fn(() => `key_${++n}`);
  const onResult = vi.fn();
  const session = new RunCheckSession({ call, newKey, onResult });
  return { session, calls, newKey, onResult };
}

type Session = ReturnType<typeof setup>['session'];
const fillPan = (s: Session) => {
  s.setField('subjectId', CUSTOMER);
  s.setField('consentRecordId', CONSENT);
  s.setField('idNumber', PAN);
};
const fillBank = (s: Session) => {
  s.setCheck('BANK_ACCOUNT');
  s.setField('subjectId', CUSTOMER);
  s.setField('consentRecordId', CONSENT);
  s.setField('accountNumber', ACCOUNT);
  s.setField('ifsc', 'HDFC0001234');
  s.setField('name', NAME);
};
const phase = (s: Session) => s.getState().phase;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('P1-06 run a check on screen: a result', () => {
  it('P1-06 a valid PAN form is sent once with a new key, and the result ends the attempt and clears what was typed', async () => {
    const { session, calls, newKey, onResult } = setup(record());
    fillPan(session);
    session.setField('name', NAME);

    await session.submit();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.key).toBe('key_1');
    expect(calls[0]?.body).toMatchObject({ check: 'PAN', idNumber: PAN, name: NAME, purpose: 'KYC' });
    expect(newKey).toHaveBeenCalledTimes(1);
    const state = session.getState();
    expect(state.phase).toBe('done');
    expect(state.record?.result).toBe('VERIFIED');
    expect(state.form).toMatchObject({ idNumber: '', accountNumber: '', name: '', subjectId: CUSTOMER });
    expect(JSON.stringify(state)).not.toContain(PAN);
    expect(JSON.stringify(state)).not.toContain(NAME);
    expect(onResult).toHaveBeenCalledWith(state.record);
  });

  it('P1-06 a GST form and a bank form are sent with their own fields, each with its own key', async () => {
    const { session, calls } = setup(record({ checkType: 'GST' }), bankRecord('VERIFIED'));
    fillPan(session);
    session.setCheck('GST');
    session.setField('idNumber', GSTIN);
    await session.submit();
    session.newCheck();
    fillBank(session);
    await session.submit();

    expect(calls.map((c) => c.body.check)).toEqual(['GST', 'BANK_ACCOUNT']);
    expect(calls[0]?.body).toMatchObject({ idNumber: GSTIN });
    expect(calls[1]?.body).toMatchObject({ accountNumber: ACCOUNT, ifsc: 'HDFC0001234', name: NAME });
    expect(calls[0]?.key).not.toBe(calls[1]?.key);
    expect(JSON.stringify(session.getState())).not.toContain(GSTIN);
    expect(JSON.stringify(session.getState())).not.toContain(ACCOUNT);
  });

  it('P1-06 a bad form sends nothing and makes no key, and each bad field is named with a message that does not repeat it', async () => {
    const { session, calls, newKey } = setup(record());
    session.setField('subjectId', CUSTOMER);
    session.setField('consentRecordId', CONSENT);
    session.setField('idNumber', 'QXZKW739L');

    await session.submit();

    expect(calls).toHaveLength(0);
    expect(newKey).not.toHaveBeenCalled();
    const state = session.getState();
    expect(state.phase).toBe('editing');
    expect(Object.keys(state.fieldErrors)).toEqual(['idNumber']);
    expect(JSON.stringify(state.fieldErrors)).not.toContain('QXZKW739L');
    // Fixing the field clears its message and the form can then be sent.
    session.setField('idNumber', PAN);
    expect(session.getState().fieldErrors).toEqual({});
    await session.submit();
    expect(calls).toHaveLength(1);
  });

  it('P1-06 a lead id under "Customer" sends nothing and makes no key; choosing "Lead" then sends it', async () => {
    const { session, calls, newKey } = setup(record());
    session.setField('subjectId', 'lead_01M8DS9KFG4FGQPBQ1D4Z12X3S');
    session.setField('consentRecordId', CONSENT);
    session.setField('idNumber', PAN);

    await session.submit();

    expect(phase(session)).toBe('editing');
    expect(session.getState().fieldErrors.subjectId).toContain('This looks like a lead id. Choose "Lead"');
    expect(calls).toHaveLength(0);
    expect(newKey).not.toHaveBeenCalled();

    session.setField('subjectType', 'LEAD');
    await session.submit();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      subjectType: 'LEAD',
      subjectId: 'lead_01M8DS9KFG4FGQPBQ1D4Z12X3S',
    });
    expect(newKey).toHaveBeenCalledTimes(1);
  });

  it('P1-06 a bad bank form (8-digit account, bad IFSC) sends nothing', async () => {
    const { session, calls } = setup(bankRecord('VERIFIED'));
    fillBank(session);
    session.setField('accountNumber', '48201937');
    session.setField('ifsc', 'HDFC1001234');

    await session.submit();

    expect(calls).toHaveLength(0);
    expect(Object.keys(session.getState().fieldErrors).sort()).toEqual(['accountNumber', 'ifsc']);
    expect(JSON.stringify(session.getState().fieldErrors)).not.toContain('48201937');
    expect(JSON.stringify(session.getState().fieldErrors)).not.toContain('HDFC1001234');
  });

  it('P1-06 changing the check drops what was typed for the other one, and the form cannot be edited while a request is open', async () => {
    const { session } = setup(record());
    fillPan(session);
    session.setCheck('BANK_ACCOUNT');
    expect(session.getState().form).toMatchObject({
      check: 'BANK_ACCOUNT',
      idNumber: '',
      accountNumber: '',
      ifsc: '',
    });
    expect(session.getState().form.subjectId).toBe(CUSTOMER);

    // While the request is open nothing can change under its key.
    let release: (r: VerificationRecord) => void = () => {};
    const open = new RunCheckSession({
      call: () => new Promise((resolve) => (release = resolve)),
      newKey: () => 'key_open',
    });
    fillPan(open);
    const pending = open.submit();
    open.setField('idNumber', 'ZZZZZ9999Z');
    open.setCheck('GST');
    expect(open.getState().form.idNumber).toBe(PAN);
    expect(open.getState().form.check).toBe('PAN');
    release(record());
    await pending;
  });

  it('P1-06 a failing refresh after a result does not turn the stored result into an error', async () => {
    const calls: string[] = [];
    const session = new RunCheckSession({
      call: async (_body, key) => {
        calls.push(key);
        return record();
      },
      newKey: () => 'key_1',
      onResult: () => {
        throw new Error('refresh failed');
      },
    });
    fillPan(session);

    await session.submit();

    expect(phase(session)).toBe('done');
    expect(calls).toEqual(['key_1']);
  });
});

describe('P1-06 run a check on screen: THE MONEY RULE', () => {
  it('P1-06 (a) a 503 then "Try again" sends the SAME request with the SAME key, and the success ends the attempt', async () => {
    const { session, calls, newKey } = setup(apiError('DEPENDENCY_UNAVAILABLE', 503), bankRecord('VERIFIED'));
    fillBank(session);

    await session.submit();
    expect(phase(session)).toBe('failed');
    expect(session.getState().error).toMatchObject({ canRetry: true, correlationId: 'corr_1' });
    // What was typed is still there, because the same request has to be sent again.
    expect(session.getState().form.accountNumber).toBe(ACCOUNT);

    await session.retry();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.key).toBe(calls[0]?.key);
    expect(calls[1]?.body).toEqual(calls[0]?.body);
    expect(newKey).toHaveBeenCalledTimes(1);
    expect(phase(session)).toBe('done');
    expect(session.getState().form.accountNumber).toBe('');
  });

  it('P1-06 (a) the same key is used for as many retries as it takes: 429, then 503, then 500, then the result', async () => {
    const { session, calls, newKey } = setup(
      apiError('RATE_LIMITED', 429),
      apiError('DEPENDENCY_UNAVAILABLE', 503),
      apiError('INTERNAL_ERROR', 500),
      bankRecord('VERIFIED'),
    );
    fillBank(session);

    await session.submit();
    await session.retry();
    await session.retry();
    await session.retry();

    expect(calls).toHaveLength(4);
    expect(new Set(calls.map((c) => c.key)).size).toBe(1);
    expect(newKey).toHaveBeenCalledTimes(1);
    expect(phase(session)).toBe('done');
  });

  it('P1-06 (b) an OUTCOME_UNKNOWN result shows the unknown outcome, and nothing retries by itself however long it waits', async () => {
    vi.useFakeTimers();
    const { session, calls } = setup(unknownRecord(), bankRecord('VERIFIED'));
    fillBank(session);

    await session.submit();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    await vi.runOnlyPendingTimersAsync();

    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    const state = session.getState();
    expect(state.phase).toBe('done');
    expect(state.record).toMatchObject({
      result: 'INCONCLUSIVE',
      minimalResult: { discrepancies: ['OUTCOME_UNKNOWN'] },
    });
    // Nothing typed is kept: a person cannot press "send" on the old request again.
    expect(state.form.accountNumber).toBe('');
    await session.retry();
    expect(calls).toHaveLength(1);
  });

  it('P1-06 (b) there is no timer, interval or retry hook anywhere in a failed attempt either', async () => {
    vi.useFakeTimers();
    const { session, calls } = setup(apiError('DEPENDENCY_UNAVAILABLE', 503), bankRecord('VERIFIED'));
    fillBank(session);

    await session.submit();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(vi.getTimerCount()).toBe(0);
    expect(calls).toHaveLength(1);
    expect(phase(session)).toBe('failed');
  });

  it('P1-06 (c) "New check" after an unknown outcome asks for a confirmation first, and the answer "cancel" changes nothing', async () => {
    const { session, calls, newKey } = setup(unknownRecord(), bankRecord('VERIFIED'));
    fillBank(session);
    await session.submit();

    session.newCheck();
    expect(phase(session)).toBe('confirm-new');
    expect(session.getState().record).not.toBeNull();
    session.cancelNew();

    expect(phase(session)).toBe('done');
    expect(session.getState().record?.minimalResult.discrepancies).toContain('OUTCOME_UNKNOWN');
    expect(calls).toHaveLength(1);
    expect(newKey).toHaveBeenCalledTimes(1);
  });

  it('P1-06 (c) once confirmed, the new bank check uses a DIFFERENT key, and the first one is never sent again', async () => {
    const { session, calls, newKey } = setup(unknownRecord(), bankRecord('VERIFIED'));
    fillBank(session);
    await session.submit();

    session.newCheck();
    session.confirmNew();
    expect(phase(session)).toBe('editing');
    expect(session.getState().record).toBeNull();
    expect(session.getState().form.accountNumber).toBe('');
    fillBank(session);
    await session.submit();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.key).not.toBe(calls[0]?.key);
    expect(newKey).toHaveBeenCalledTimes(2);
    expect(session.getState().record?.result).toBe('VERIFIED');
  });

  it('P1-06 a result that is not an unknown outcome allows a new check without a confirmation, still with a new key', async () => {
    const { session, calls } = setup(bankRecord('VERIFIED'), bankRecord('REJECTED', ['NAME_MISMATCH']));
    fillBank(session);
    await session.submit();

    session.newCheck();
    expect(phase(session)).toBe('editing');
    fillBank(session);
    await session.submit();

    expect(calls[1]?.key).not.toBe(calls[0]?.key);
    expect(session.getState().record?.result).toBe('REJECTED');
  });

  it('P1-06 (d) a network failure keeps the form and retries with the SAME key: the request may have arrived', async () => {
    const { session, calls } = setup(connectionLost(), bankRecord('VERIFIED'));
    fillBank(session);

    await session.submit();

    const failed = session.getState();
    expect(failed.phase).toBe('failed');
    expect(failed.error).toMatchObject({ title: 'Connection lost', canRetry: true });
    expect(failed.form).toMatchObject({ accountNumber: ACCOUNT, ifsc: 'HDFC0001234', name: NAME });

    await session.retry();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.key).toBe(calls[0]?.key);
    expect(phase(session)).toBe('done');
  });

  it('P1-06 two quick clicks send one request with one key; a click on "Try again" while a request is open does nothing', async () => {
    const calls: string[] = [];
    let release: (r: VerificationRecord) => void = () => {};
    const newKey = vi.fn(() => `key_${calls.length + 1}`);
    const session = new RunCheckSession({
      call: (_body, key) => {
        calls.push(key);
        return new Promise((resolve) => (release = resolve));
      },
      newKey,
    });
    fillBank(session);

    const first = session.submit();
    const second = session.submit();
    await session.retry();

    expect(phase(session)).toBe('sending');
    expect(calls).toHaveLength(1);
    expect(newKey).toHaveBeenCalledTimes(1);
    release(bankRecord('VERIFIED'));
    await Promise.all([first, second]);
    expect(phase(session)).toBe('done');
    expect(calls).toHaveLength(1);
  });

  it('P1-06 "Try again" does nothing after a result, and nothing when the failure says the request has to change', async () => {
    const { session, calls } = setup(apiError('CONSENT_REQUIRED', 422), bankRecord('VERIFIED'));
    fillBank(session);
    await session.submit();

    expect(session.getState().error).toMatchObject({ title: 'Consent is missing', canRetry: false });
    await session.retry();
    expect(calls).toHaveLength(1);
  });

  it('P1-06 a refused request goes back to editing with what was typed kept, and the next send is a new attempt with a new key', async () => {
    const { session, calls, newKey } = setup(
      apiError('VALIDATION_ERROR', 422, [{ field: 'consentRecordId', issue: 'CONSENT_SUBJECT_MISMATCH' }]),
      bankRecord('VERIFIED'),
    );
    fillBank(session);
    await session.submit();
    expect(session.getState().error?.canRetry).toBe(false);

    session.editRequest();
    expect(phase(session)).toBe('editing');
    expect(session.getState().form.accountNumber).toBe(ACCOUNT);
    session.setField('consentRecordId', 'cnst_01M4V6DFM0TFA9D04QJTW32ETE');
    await session.submit();

    expect(calls).toHaveLength(2);
    expect(calls[1]?.key).not.toBe(calls[0]?.key);
    expect(newKey).toHaveBeenCalledTimes(2);
  });

  it('P1-06 giving up a bank attempt that could still be retried asks for a confirmation, like a new check after an unknown outcome', async () => {
    const { session, newKey } = setup(apiError('DEPENDENCY_UNAVAILABLE', 503), bankRecord('VERIFIED'));
    fillBank(session);
    await session.submit();

    session.discard();
    expect(phase(session)).toBe('confirm-new');
    session.cancelNew();
    expect(phase(session)).toBe('failed');
    expect(session.getState().error?.canRetry).toBe(true);

    session.discard();
    session.confirmNew();
    expect(phase(session)).toBe('editing');
    expect(session.getState().form.accountNumber).toBe('');
    expect(newKey).toHaveBeenCalledTimes(1);
  });

  it('P1-06 giving up a PAN attempt needs no confirmation: a PAN lookup moves no money', async () => {
    const { session } = setup(apiError('DEPENDENCY_UNAVAILABLE', 503));
    fillPan(session);
    await session.submit();

    session.discard();

    expect(phase(session)).toBe('editing');
    expect(session.getState().form.idNumber).toBe('');
  });
});

describe('P1-06 run a check on screen: typed values stay inside the screen', () => {
  const typed = [PAN, GSTIN, ACCOUNT, NAME];
  const everything = (calls: unknown[][]) => JSON.stringify(calls);

  it('P1-06 no typed value reaches the console, localStorage, sessionStorage or the query cache, through a result, a failure and a retry', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const storage = () => ({
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0,
    });
    const local = storage();
    const sessionStore = storage();
    vi.stubGlobal('localStorage', local);
    vi.stubGlobal('sessionStorage', sessionStore);
    const queryClient = new QueryClient();
    // A failure, a retry that fails again, a retry that gives an unknown outcome, then a second check that gives a result.
    const script: (VerificationRecord | Error)[] = [
      connectionLost(),
      apiError('RATE_LIMITED', 429),
      unknownRecord(),
      bankRecord('VERIFIED'),
    ];
    const refresh = vi.fn(() => queryClient.invalidateQueries({ queryKey: ['verifications'] }));
    const session = new RunCheckSession({
      call: async () => {
        const next = script.shift();
        if (next instanceof Error) throw next;
        return next ?? bankRecord('VERIFIED');
      },
      newKey: () => 'key_x',
      onResult: refresh,
    });
    fillBank(session);
    await session.submit();
    await session.retry();
    await session.retry();
    session.newCheck();
    session.confirmNew();
    fillBank(session);
    await session.submit();
    session.dispose();
    expect(script).toEqual([]);

    const seen = [
      ...consoleSpies.map((spy) => spy.mock.calls),
      local.setItem.mock.calls,
      local.getItem.mock.calls,
      sessionStore.setItem.mock.calls,
      sessionStore.getItem.mock.calls,
    ];
    for (const value of typed) expect(everything(seen.flat() as unknown[][])).not.toContain(value);
    const cached = JSON.stringify([
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.state),
      queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.state),
    ]);
    for (const value of typed) expect(cached).not.toContain(value);
    // Two results, two refreshes: the list is refreshed, and nothing else is cached.
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('P1-06 disposing the screen forgets what was typed, even in the middle of an attempt that failed', async () => {
    const { session } = setup(connectionLost());
    fillBank(session);
    await session.submit();
    expect(session.getState().form.accountNumber).toBe(ACCOUNT);

    session.dispose();

    const state = session.getState();
    expect(state.form).toMatchObject({ idNumber: '', accountNumber: '', name: '' });
    expect(JSON.stringify(state)).not.toContain(ACCOUNT);
    expect(JSON.stringify(state)).not.toContain(NAME);
    // The error and the stored result carry no typed value at any time.
    expect(JSON.stringify(state.error)).not.toContain(ACCOUNT);
  });

  it('P1-06 a state at any point holds the typed values only in the form, never in the error or the record', async () => {
    const states: RunCheckState[] = [];
    const { session } = setup(apiError('INTERNAL_ERROR', 500), unknownRecord());
    session.subscribe(() => states.push(session.getState()));
    fillBank(session);
    await session.submit();
    await session.retry();

    expect(states.length).toBeGreaterThan(5);
    for (const state of states) {
      for (const value of typed) {
        expect(JSON.stringify(state.error), value).not.toContain(value);
        expect(JSON.stringify(state.record), value).not.toContain(value);
        expect(JSON.stringify(state.fieldErrors), value).not.toContain(value);
      }
    }
  });
});
