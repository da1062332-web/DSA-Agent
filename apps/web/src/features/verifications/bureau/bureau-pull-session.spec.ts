// apps/web/src/features/verifications/bureau/bureau-pull-session.spec.ts — P1-05: the discipline of a pull on screen, tested on the state machine
// the screen is made of (bureau-pull-session.ts). A pull costs money, so: one Idempotency-Key per attempt, the same key on every retry, no retry
// that a person did not ask for, and a new key only for a new attempt.
import { QueryClient } from '@tanstack/react-query';
import type { CreditReport, PullCreditReport } from '@dsa/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../api/client';
import { BureauPullSession, type BureauPullState } from './bureau-pull-session';

// Synthetic values that appear nowhere else in the repository.
const PAN = 'JQXWV5182D';
const DOB = '1973-12-09';
const NAME = 'Meenakshi Raghunathan Pillai';
const CUSTOMER_NAME = 'Customer On The Page';
const START = new Date('2026-11-28T10:00:00.000Z');

const report = (over: Partial<CreditReport> = {}): CreditReport => ({
  id: 'crp_01M4V6DFM0TFA9D04QJTW32ETD',
  tenantId: 'ten_demo_01',
  customerId: 'cust_1',
  consentRecordId: 'cnst_01M4V6DFM0TFA9D04QJTW32ETD',
  bureau: 'CIBIL',
  provider: 'CRIF',
  outcome: 'SCORED',
  reportDate: '2026-11-28',
  score: 742,
  activeAccounts: 3,
  monthlyEmi: { amount: '18400.00', currency: 'INR' },
  maxDpd12m: 0,
  enquiries6m: 1,
  vendorRef: 'req_1',
  cost: { amount: '45.00', currency: 'INR' },
  pulledBy: 'usr_demo_01',
  pulledAt: '2026-11-28T10:00:05.000Z',
  lockVersion: 0,
  createdAt: '2026-11-28T10:00:05.000Z',
  ...over,
});

const apiError = (code: string, httpStatus: number, details: ApiError['details'] = []) =>
  new ApiError(code, httpStatus, `server text with ${PAN} ${DOB}`, 'corr_1', details);
const connectionLost = () => new ApiError('DEPENDENCY_UNAVAILABLE', 0, 'Cannot reach the API.');

/** A session whose API answers from a script (the last answer repeats); `calls` records every request with its key. */
function setup(...answers: (CreditReport | Error)[]) {
  const calls: { body: PullCreditReport; key: string }[] = [];
  const queue = [...answers];
  let n = 0;
  const newKey = vi.fn(() => `key_${++n}`);
  const onResult = vi.fn();
  const clock = { now: new Date(START) };
  const session = new BureauPullSession(
    {
      call: async (body, key) => {
        calls.push({ body, key });
        const next = queue.length > 1 ? queue.shift() : queue[0];
        if (next instanceof Error) throw next;
        return next ?? report();
      },
      newKey,
      now: () => clock.now,
      onResult,
    },
    CUSTOMER_NAME,
  );
  return { session, calls, newKey, onResult, clock };
}
type Session = ReturnType<typeof setup>['session'];
const fill = (s: Session) => {
  s.setField('name', NAME);
  s.setField('pan', PAN);
  s.setField('dateOfBirth', DOB);
};
const phase = (s: Session) => s.getState().phase;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('P1-05 a pull on screen: a report', () => {
  it('P1-05 the form starts with the customer name and nothing else typed', () => {
    const { session } = setup(report());

    expect(session.getState()).toMatchObject({
      phase: 'editing',
      form: { name: CUSTOMER_NAME, pan: '', dateOfBirth: '' },
      report: null,
      cached: false,
    });
  });

  it('P1-05 a valid form is sent once with a new key; the report ends the attempt and clears the PAN, date of birth and name', async () => {
    const { session, calls, newKey, onResult } = setup(report());
    fill(session);

    await session.submit('CIBIL');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      body: { bureau: 'CIBIL', name: NAME, pan: PAN, dateOfBirth: DOB },
      key: 'key_1',
    });
    expect(newKey).toHaveBeenCalledTimes(1);
    const state = session.getState();
    expect(state.phase).toBe('done');
    expect(state.report?.score).toBe(742);
    expect(state.cached).toBe(false);
    expect(state.form).toEqual({ name: '', pan: '', dateOfBirth: '' });
    for (const typed of [PAN, DOB, NAME]) expect(JSON.stringify(state)).not.toContain(typed);
    expect(onResult).toHaveBeenCalledWith(state.report);
  });

  it('P1-05 a report pulled before the attempt began is a cache answer; a report pulled during it is not', async () => {
    const cached = setup(report({ pulledAt: '2026-11-28T06:00:00.000Z' }));
    fill(cached.session);
    await cached.session.submit('CIBIL');
    expect(cached.session.getState().cached).toBe(true);

    const fresh = setup(report({ pulledAt: '2026-11-28T10:00:03.000Z' }));
    fill(fresh.session);
    await fresh.session.submit('CIBIL');
    expect(fresh.session.getState().cached).toBe(false);
  });

  it('P1-05 a report of no history is a report too, with no score', async () => {
    const { session } = setup(
      report({
        outcome: 'NO_HISTORY',
        score: null,
        activeAccounts: null,
        monthlyEmi: null,
        maxDpd12m: null,
        enquiries6m: null,
      }),
    );
    fill(session);

    await session.submit('CRIF');

    expect(session.getState()).toMatchObject({
      phase: 'done',
      bureau: 'CRIF',
      report: { outcome: 'NO_HISTORY', score: null },
    });
  });

  it('P1-05 a bad form sends nothing and makes no key, and each bad field is named with a message that does not repeat it', async () => {
    const { session, calls, newKey } = setup(report());
    session.setField('pan', 'JQXWV518D');
    session.setField('dateOfBirth', '2020-01-01');

    await session.submit('CIBIL');

    expect(calls).toHaveLength(0);
    expect(newKey).not.toHaveBeenCalled();
    const state = session.getState();
    expect(state.phase).toBe('editing');
    expect(Object.keys(state.fieldErrors).sort()).toEqual(['dateOfBirth', 'pan']);
    for (const typed of ['JQXWV518D', '2020-01-01'])
      expect(JSON.stringify(state.fieldErrors)).not.toContain(typed);
    // Fixing a field clears its message, and the form can then be sent.
    session.setField('pan', PAN);
    session.setField('dateOfBirth', DOB);
    expect(session.getState().fieldErrors).toEqual({});
    await session.submit('CIBIL');
    expect(calls).toHaveLength(1);
  });

  it('P1-05 the age rule uses the clock of the session: a person who is 18 only tomorrow is refused today and accepted tomorrow', async () => {
    const { session, calls, clock } = setup(report());
    session.setField('pan', PAN);
    session.setField('dateOfBirth', '2008-11-29');

    await session.submit('CIBIL');
    expect(calls).toHaveLength(0);
    expect(session.getState().fieldErrors.dateOfBirth).toContain('18 to 100');

    clock.now = new Date('2026-11-29T10:00:00.000Z');
    await session.submit('CIBIL');
    expect(calls).toHaveLength(1);
  });

  it('P1-05 nothing can be edited while a request is open', async () => {
    let release: (r: CreditReport) => void = () => {};
    const session = new BureauPullSession({
      call: () => new Promise((resolve) => (release = resolve)),
      newKey: () => 'key_open',
      now: () => START,
    });
    fill(session);

    const pending = session.submit('CIBIL');
    session.setField('pan', 'ABCDE1234F');
    session.setField('name', 'Someone Else');

    expect(session.getState().form).toMatchObject({ pan: PAN, name: NAME });
    release(report());
    await pending;
  });

  it('P1-05 a failing refresh after a report does not turn the stored report into an error', async () => {
    const session = new BureauPullSession({
      call: async () => report(),
      newKey: () => 'key_1',
      now: () => START,
      onResult: () => {
        throw new Error('refresh failed');
      },
    });
    fill(session);

    await session.submit('CIBIL');

    expect(phase(session)).toBe('done');
  });
});

describe('P1-05 a pull on screen: THE MONEY RULE', () => {
  it('P1-05 a 429, then a 503, then a 500, then the report: every send of one attempt carries the SAME key and the SAME request', async () => {
    const { session, calls, newKey } = setup(
      apiError('RATE_LIMITED', 429),
      apiError('DEPENDENCY_UNAVAILABLE', 503),
      apiError('INTERNAL_ERROR', 500),
      report(),
    );
    fill(session);

    await session.submit('CIBIL');
    expect(phase(session)).toBe('failed');
    expect(session.getState().error).toMatchObject({ canRetry: true, correlationId: 'corr_1' });
    // What was typed stays: the same request has to be sent again.
    expect(session.getState().form).toMatchObject({ pan: PAN, dateOfBirth: DOB, name: NAME });
    await session.retry();
    await session.retry();
    await session.retry();

    expect(calls).toHaveLength(4);
    expect(new Set(calls.map((c) => c.key)).size).toBe(1);
    for (const call of calls) expect(call.body).toEqual(calls[0]?.body);
    expect(newKey).toHaveBeenCalledTimes(1);
    expect(phase(session)).toBe('done');
    expect(session.getState().form.pan).toBe('');
  });

  it('P1-05 a lost connection keeps the form and retries with the SAME key: the request may have arrived', async () => {
    const { session, calls } = setup(connectionLost(), report());
    fill(session);

    await session.submit('CIBIL');
    expect(session.getState().error).toMatchObject({ title: 'Connection lost', canRetry: true });
    await session.retry();

    expect(calls[1]?.key).toBe(calls[0]?.key);
    expect(phase(session)).toBe('done');
  });

  it('P1-05 nothing retries by itself, however long it waits: no timer, in a failed attempt or after a report', async () => {
    vi.useFakeTimers();
    const failed = setup(apiError('DEPENDENCY_UNAVAILABLE', 503), report());
    fill(failed.session);
    await failed.session.submit('CIBIL');
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(failed.calls).toHaveLength(1);
    expect(phase(failed.session)).toBe('failed');

    const done = setup(report());
    fill(done.session);
    await done.session.submit('CIBIL');
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(done.calls).toHaveLength(1);
  });

  it('P1-05 two quick clicks send one request with one key; "Try again" while a request is open does nothing', async () => {
    const calls: string[] = [];
    let release: (r: CreditReport) => void = () => {};
    const newKey = vi.fn(() => `key_${calls.length + 1}`);
    const session = new BureauPullSession({
      call: (_body, key) => {
        calls.push(key);
        return new Promise((resolve) => (release = resolve));
      },
      newKey,
      now: () => START,
    });
    fill(session);

    const first = session.submit('CIBIL');
    const second = session.submit('CIBIL');
    await session.retry();

    expect(phase(session)).toBe('sending');
    expect(calls).toHaveLength(1);
    expect(newKey).toHaveBeenCalledTimes(1);
    release(report());
    await Promise.all([first, second]);
    expect(phase(session)).toBe('done');
    expect(calls).toHaveLength(1);
  });

  it('P1-05 "Try again" does nothing after a report, and nothing when the failure says the request has to change', async () => {
    const done = setup(report());
    fill(done.session);
    await done.session.submit('CIBIL');
    await done.session.retry();
    expect(done.calls).toHaveLength(1);

    const refused = setup(apiError('CONSENT_REQUIRED', 422), report());
    fill(refused.session);
    await refused.session.submit('CIBIL');
    expect(refused.session.getState().error).toMatchObject({ title: 'Consent is missing', canRetry: false });
    await refused.session.retry();
    expect(refused.calls).toHaveLength(1);
  });

  it('P1-05 a refused request goes back to the form with what was typed kept, and the next send is a new attempt with a new key', async () => {
    const { session, calls, newKey } = setup(apiError('CONSENT_REQUIRED', 422), report());
    fill(session);
    await session.submit('CIBIL');

    session.editRequest();
    expect(phase(session)).toBe('editing');
    expect(session.getState().form).toMatchObject({ pan: PAN, dateOfBirth: DOB, name: NAME });
    await session.submit('CIBIL');

    expect(calls).toHaveLength(2);
    expect(calls[1]?.key).not.toBe(calls[0]?.key);
    expect(newKey).toHaveBeenCalledTimes(2);
  });

  it('P1-05 a pull again after a report is a new attempt with a new key; the form is empty again, with only the customer name', async () => {
    const { session, calls, newKey } = setup(report(), report({ pulledAt: '2026-11-28T06:00:00.000Z' }));
    fill(session);
    await session.submit('CIBIL');

    session.newPull();
    expect(session.getState()).toMatchObject({
      phase: 'editing',
      report: null,
      form: { name: CUSTOMER_NAME, pan: '', dateOfBirth: '' },
    });
    fill(session);
    await session.submit('CIBIL');

    expect(calls[1]?.key).not.toBe(calls[0]?.key);
    expect(newKey).toHaveBeenCalledTimes(2);
    // The second answer is the stored report from earlier: the bureau was not charged again.
    expect(session.getState().cached).toBe(true);
  });

  it('P1-05 giving up an attempt that could still be retried forgets it: the next send is a new attempt with a new key', async () => {
    const { session, calls, newKey } = setup(apiError('DEPENDENCY_UNAVAILABLE', 503), report());
    fill(session);
    await session.submit('CIBIL');

    session.discard();
    expect(session.getState()).toMatchObject({
      phase: 'editing',
      error: null,
      form: { pan: '', dateOfBirth: '' },
    });
    fill(session);
    await session.submit('CIBIL');

    expect(calls[1]?.key).not.toBe(calls[0]?.key);
    expect(newKey).toHaveBeenCalledTimes(2);
  });

  it('P1-05 a request that cannot be retried cannot be given up with discard, and an open form can be cancelled', async () => {
    const { session } = setup(apiError('CONSENT_REQUIRED', 422));
    fill(session);
    await session.submit('CIBIL');
    session.discard();
    expect(phase(session)).toBe('failed');

    const open = setup(report());
    fill(open.session);
    open.session.cancel();
    expect(open.session.getState().form).toEqual({ name: CUSTOMER_NAME, pan: '', dateOfBirth: '' });
  });
});

describe('P1-05 a pull on screen: typed values stay inside the screen', () => {
  const typed = [PAN, DOB, NAME];

  it('P1-05 no typed value reaches the console, localStorage, sessionStorage or the query cache, through a failure, a retry and a report', async () => {
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
    // A failure, a retry that fails again, a retry that gives the report, then a new pull answered from the cache.
    const script: (CreditReport | Error)[] = [
      connectionLost(),
      apiError('RATE_LIMITED', 429),
      report(),
      report({ pulledAt: '2026-11-28T06:00:00.000Z' }),
    ];
    const refresh = vi.fn(() => queryClient.invalidateQueries({ queryKey: ['credit-report-latest'] }));
    const session = new BureauPullSession({
      call: async () => {
        const next = script.shift();
        if (next instanceof Error) throw next;
        return next as CreditReport;
      },
      newKey: () => 'key_x',
      now: () => START,
      onResult: refresh,
    });
    fill(session);
    await session.submit('CIBIL');
    await session.retry();
    await session.retry();
    session.newPull();
    fill(session);
    await session.submit('CIBIL');
    session.dispose();
    expect(script).toEqual([]);

    const seen = [
      ...consoleSpies.map((spy) => spy.mock.calls),
      local.setItem.mock.calls,
      local.getItem.mock.calls,
      sessionStore.setItem.mock.calls,
      sessionStore.getItem.mock.calls,
    ];
    for (const value of typed) expect(JSON.stringify(seen.flat())).not.toContain(value);
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
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('P1-05 disposing the screen forgets what was typed, even in the middle of an attempt that failed', async () => {
    const { session } = setup(connectionLost());
    fill(session);
    await session.submit('CIBIL');
    expect(session.getState().form.pan).toBe(PAN);

    session.dispose();

    const state = session.getState();
    expect(state.form).toEqual({ name: '', pan: '', dateOfBirth: '' });
    for (const value of typed) expect(JSON.stringify(state)).not.toContain(value);
  });

  it('P1-05 at every point the typed values are only in the form, never in the error, the report or the field errors', async () => {
    const states: BureauPullState[] = [];
    const { session } = setup(apiError('INTERNAL_ERROR', 500), report());
    session.subscribe(() => states.push(session.getState()));
    fill(session);
    await session.submit('CIBIL');
    await session.retry();

    expect(states.length).toBeGreaterThan(4);
    for (const state of states) {
      for (const value of typed) {
        expect(JSON.stringify(state.error), value).not.toContain(value);
        expect(JSON.stringify(state.report), value).not.toContain(value);
        expect(JSON.stringify(state.fieldErrors), value).not.toContain(value);
      }
    }
  });
});
