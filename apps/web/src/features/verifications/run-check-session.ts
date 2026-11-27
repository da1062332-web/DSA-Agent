// apps/web/src/features/verifications/run-check-session.ts — owner: Prathamesh (MOD-VER web, P1-06). The attempt of "Run a provider check" as a
// small state machine, with no React in it so every rule can be tested.
//
// THE MONEY RULE. A bank check sends Rs 1, so one request must never reach the provider twice by accident.
//   1. One Idempotency-Key per ATTEMPT. It is made when a valid form is sent for the first time and kept until the attempt ends.
//      A retry sends the SAME request with the SAME key; the server then either runs it once or replays what it stored.
//   2. Nothing retries by itself: no timer, no automatic second send. A second send needs a person pressing "Try again".
//   3. A click while a request is open does nothing (no double send), so two clicks can never carry two keys.
//   4. A result ends the attempt and clears what was typed. A new check, and for a bank check whose outcome is unknown a confirmed one,
//      starts with a new key.
// Typed values live only in this object (the component's state). They are cleared when a result arrives.
import type { RunVerificationCheck, VerificationRecord } from '@dsa/contracts';
import {
  describeRunCheckError,
  emptyRunCheckForm,
  isUnknownOutcome,
  parseRunCheckForm,
  withoutSensitiveValues,
  type RunCheckErrorView,
  type RunCheckFieldErrors,
  type RunCheckForm,
} from './run-check';

export type RunCheckPhase =
  /** No request is open. The form can be edited and sent. */
  | 'editing'
  /** A request is in flight. Nothing can be sent or edited. */
  | 'sending'
  /** The API answered with an error, or the connection broke. Nothing is stored (or it is unknown); see `error.canRetry`. */
  | 'failed'
  /** A result came back. The attempt is over and the typed values are cleared. */
  | 'done'
  /** The person asked to start a new bank check after one whose outcome is unknown, and has to confirm. */
  | 'confirm-new';

export interface RunCheckState {
  phase: RunCheckPhase;
  form: RunCheckForm;
  fieldErrors: RunCheckFieldErrors;
  error: RunCheckErrorView | null;
  record: VerificationRecord | null;
  /** Where "Cancel" of the confirmation goes back to. */
  confirmFrom: 'done' | 'failed' | null;
}

export interface RunCheckDeps {
  /** Sends the request. `key` is the same for every retry of one attempt. */
  call: (body: RunVerificationCheck, key: string) => Promise<VerificationRecord>;
  /** Makes a fresh Idempotency-Key. Called once per attempt. */
  newKey: () => string;
  /** Called after a result, for example to refresh the records list. It receives the record, which holds masked values only. */
  onResult?: (record: VerificationRecord) => void;
}

const initialState = (): RunCheckState => ({
  phase: 'editing',
  form: emptyRunCheckForm(),
  fieldErrors: {},
  error: null,
  record: null,
  confirmFrom: null,
});

export class RunCheckSession {
  private state: RunCheckState = initialState();
  private readonly listeners = new Set<() => void>();
  /** The key of the open attempt, and the validated request it belongs to. Both are dropped when the attempt ends. */
  private key: string | null = null;
  private body: RunVerificationCheck | null = null;

  constructor(private readonly deps: RunCheckDeps) {}

  // Arrow properties, so React's useSyncExternalStore gets stable functions.
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): RunCheckState => this.state;

  private set(next: Partial<RunCheckState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of [...this.listeners]) listener();
  }

  // ── editing ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Changes one field. Only while editing: a request that is open is not changed under its key. */
  setField<K extends keyof RunCheckForm>(field: K, value: RunCheckForm[K]): void {
    if (this.state.phase !== 'editing') return;
    const fieldErrors = { ...this.state.fieldErrors };
    delete fieldErrors[field];
    this.set({ form: { ...this.state.form, [field]: value }, fieldErrors });
  }

  /** Chooses the check. What was typed for another check (a PAN, an account number) is dropped, not carried across. */
  setCheck(check: RunCheckForm['check']): void {
    if (this.state.phase !== 'editing' || this.state.form.check === check) return;
    this.set({ form: { ...withoutSensitiveValues(this.state.form), ifsc: '', check }, fieldErrors: {} });
  }

  // ── sending ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Checks the form and sends it with a NEW key. A bad form sends nothing. Does nothing unless the phase is `editing`. */
  async submit(): Promise<void> {
    if (this.state.phase !== 'editing') return;
    const parsed = parseRunCheckForm(this.state.form);
    if (!parsed.ok) {
      this.set({ fieldErrors: parsed.fieldErrors });
      return;
    }
    this.body = parsed.body;
    this.key = this.deps.newKey();
    this.set({ fieldErrors: {} });
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
    let record: VerificationRecord;
    try {
      record = await this.deps.call(body, key);
    } catch (err) {
      this.set({ phase: 'failed', error: describeRunCheckError(err) });
      return;
    }
    // Outside the try: a problem while showing a stored result must never look like a failed request that can be sent again.
    this.finish(record);
  }

  private finish(record: VerificationRecord): void {
    this.key = null;
    this.body = null;
    this.set({
      phase: 'done',
      form: withoutSensitiveValues(this.state.form),
      fieldErrors: {},
      error: null,
      record,
    });
    try {
      this.deps.onResult?.(record);
    } catch {
      // A failing refresh must not turn a stored result into an error on screen.
    }
  }

  // ── after a failure ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** The request was refused and has to change: back to editing with what was typed kept, under a NEW key at the next send. */
  editRequest(): void {
    if (this.state.phase !== 'failed' || this.state.error?.canRetry) return;
    this.key = null;
    this.body = null;
    this.set({ phase: 'editing', error: null });
  }

  /** Gives up an attempt that could still be retried. For a bank check it needs a confirmation first, as the Rs 1 may have been sent. */
  discard(): void {
    if (this.state.phase !== 'failed' || !this.state.error?.canRetry) return;
    if (this.state.form.check === 'BANK_ACCOUNT') {
      this.set({ phase: 'confirm-new', confirmFrom: 'failed' });
      return;
    }
    this.reset();
  }

  // ── after a result ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Starts another check. After a bank check of unknown outcome it asks for confirmation first. */
  newCheck(): void {
    if (this.state.phase !== 'done') return;
    if (this.state.record && isUnknownOutcome(this.state.record)) {
      this.set({ phase: 'confirm-new', confirmFrom: 'done' });
      return;
    }
    this.reset();
  }

  confirmNew(): void {
    if (this.state.phase === 'confirm-new') this.reset();
  }

  cancelNew(): void {
    if (this.state.phase !== 'confirm-new') return;
    this.set({ phase: this.state.confirmFrom ?? 'done', confirmFrom: null });
  }

  /** Forgets the typed values. For the component's unmount. */
  dispose(): void {
    this.key = null;
    this.body = null;
    this.set({ form: withoutSensitiveValues(this.state.form) });
  }

  private reset(): void {
    this.key = null;
    this.body = null;
    this.set({
      phase: 'editing',
      form: withoutSensitiveValues(this.state.form),
      fieldErrors: {},
      error: null,
      record: null,
      confirmFrom: null,
    });
  }
}
