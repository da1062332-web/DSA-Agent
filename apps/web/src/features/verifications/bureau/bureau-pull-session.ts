// apps/web/src/features/verifications/bureau/bureau-pull-session.ts — owner: Prathamesh (MOD-VER web, P1-05). The attempt of "Pull report" as a
// small state machine, with no React in it so every rule can be tested. Same design as run-check-session.ts (P1-06).
//
// A pull COSTS MONEY, so one request must not be sent twice by accident.
//   1. One Idempotency-Key per ATTEMPT. It is made when a valid form is sent for the first time and kept until the attempt ends. A retry sends
//      the SAME request with the SAME key; the server then runs it once or replays what it stored.
//   2. Nothing retries by itself: no timer, no automatic second send. A second send needs a person pressing "Try again".
//   3. A click while a request is open does nothing (no double send), so two clicks can never carry two keys.
//   4. A result ends the attempt and clears the PAN, date of birth and name. A new pull starts with a new key; the server's 24-hour cache then
//      returns the stored report instead of charging again.
//   5. An error that says the request must change returns to the form with what was typed kept; the next send is a new attempt.
// Typed values live only in this object. They are cleared when a result arrives and when the screen goes.
import type { CreditBureau, CreditReport, PullCreditReport } from '@dsa/contracts';
import {
  describePullError,
  emptyBureauPullForm,
  isFromCache,
  parseBureauPullForm,
  type BureauFieldErrors,
  type BureauPullForm,
  type PullErrorView,
} from './credit-reports';

export type BureauPullPhase =
  /** No request is open. The form can be edited and sent. */
  | 'editing'
  /** A request is in flight. Nothing can be sent or edited. */
  | 'sending'
  /** The API answered with an error, or the connection broke. See `error.canRetry`. */
  | 'failed'
  /** A report came back. The attempt is over and the typed values are cleared. */
  | 'done';

export interface BureauPullState {
  phase: BureauPullPhase;
  form: BureauPullForm;
  /** The bureau of the open attempt (the card's selector can change meanwhile; an open attempt keeps its own). */
  bureau: CreditBureau | null;
  fieldErrors: BureauFieldErrors;
  error: PullErrorView | null;
  report: CreditReport | null;
  /** True when the report was answered from the 24-hour cache: the bureau was not charged again. */
  cached: boolean;
}

export interface BureauPullDeps {
  /** Sends the request. `key` is the same for every retry of one attempt. */
  call: (body: PullCreditReport, key: string) => Promise<CreditReport>;
  /** Makes a fresh Idempotency-Key. Called once per attempt. */
  newKey: () => string;
  /** The clock: for the age rule, and for telling a cache answer from a new report. A test passes its own. */
  now: () => Date;
  /** Called after a report, for example to refresh the latest report and the history. It receives the report, which holds no identifier. */
  onResult?: (report: CreditReport) => void;
}

const initialState = (name: string): BureauPullState => ({
  phase: 'editing',
  form: emptyBureauPullForm(name),
  bureau: null,
  fieldErrors: {},
  error: null,
  report: null,
  cached: false,
});

export class BureauPullSession {
  private state: BureauPullState;
  private readonly listeners = new Set<() => void>();
  /** The key, the validated request and the start time of the open attempt. All dropped when the attempt ends. */
  private key: string | null = null;
  private body: PullCreditReport | null = null;
  private startedAt = 0;

  constructor(
    private readonly deps: BureauPullDeps,
    /** The customer's own name, shown on the page, to prefill the name field. It can be edited. */
    private readonly defaultName = '',
  ) {
    this.state = initialState(defaultName);
  }

  // Arrow properties, so React's useSyncExternalStore gets stable functions.
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): BureauPullState => this.state;

  private set(next: Partial<BureauPullState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of [...this.listeners]) listener();
  }

  // ── editing ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Changes one field. Only while editing: a request that is open is not changed under its key. */
  setField<K extends keyof BureauPullForm>(field: K, value: BureauPullForm[K]): void {
    if (this.state.phase !== 'editing') return;
    const fieldErrors = { ...this.state.fieldErrors };
    delete fieldErrors[field];
    this.set({ form: { ...this.state.form, [field]: value }, fieldErrors });
  }

  // ── sending ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Checks the form and sends it with a NEW key. A bad form sends nothing and makes no key. Does nothing unless the phase is `editing`. */
  async submit(bureau: CreditBureau): Promise<void> {
    if (this.state.phase !== 'editing') return;
    const parsed = parseBureauPullForm(this.state.form, bureau, this.deps.now());
    if (!parsed.ok) {
      this.set({ fieldErrors: parsed.fieldErrors });
      return;
    }
    this.body = parsed.body;
    this.key = this.deps.newKey();
    this.startedAt = this.deps.now().getTime();
    this.set({ fieldErrors: {}, bureau });
    await this.send();
  }

  /** Sends the SAME request with the SAME key again. Only after a failure that says a retry is the right step. */
  async retry(): Promise<void> {
    if (this.state.phase !== 'failed' || !this.state.error?.canRetry) return;
    await this.send();
  }

  private async send(): Promise<void> {
    const { body, key } = this;
    if (!body || !key) return;
    this.set({ phase: 'sending', error: null });
    let report: CreditReport;
    try {
      report = await this.deps.call(body, key);
    } catch (err) {
      this.set({ phase: 'failed', error: describePullError(err) });
      return;
    }
    // Outside the try: a problem while showing a stored report must never look like a failed request that can be sent again.
    this.finish(report);
  }

  private finish(report: CreditReport): void {
    const cached = isFromCache(report, this.startedAt);
    this.key = null;
    this.body = null;
    this.set({
      phase: 'done',
      form: emptyBureauPullForm(''),
      fieldErrors: {},
      error: null,
      report,
      cached,
    });
    try {
      this.deps.onResult?.(report);
    } catch {
      // A failing refresh must not turn a stored report into an error on screen.
    }
  }

  // ── after a failure ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The request was refused and has to change: back to editing with what was typed kept; the next send makes a NEW key. */
  editRequest(): void {
    if (this.state.phase !== 'failed' || this.state.error?.canRetry) return;
    this.key = null;
    this.body = null;
    this.set({ phase: 'editing', error: null });
  }

  /**
   * Gives up an attempt that could still be retried. The screen says first that a new pull may then be charged again if the first request
   * did reach the bureau. Back to an empty form.
   */
  discard(): void {
    if (this.state.phase !== 'failed' || !this.state.error?.canRetry) return;
    this.reset();
  }

  // ── after a report, and when the screen closes ─────────────────────────────────────────────────────────────────────────────
  /** Starts another pull: a new attempt, with a new key at its first send. */
  newPull(): void {
    if (this.state.phase !== 'done') return;
    this.reset();
  }

  /** Closes an unfinished form: forgets what was typed. Not while a request is open or one could still be retried (see discard). */
  cancel(): void {
    if (this.state.phase !== 'editing') return;
    this.reset();
  }

  /** Forgets the typed values and the attempt. For the component's unmount. */
  dispose(): void {
    this.key = null;
    this.body = null;
    this.set({ form: emptyBureauPullForm('') });
  }

  private reset(): void {
    this.key = null;
    this.body = null;
    this.set({
      phase: 'editing',
      form: emptyBureauPullForm(this.defaultName),
      bureau: null,
      fieldErrors: {},
      error: null,
      report: null,
      cached: false,
    });
  }
}
