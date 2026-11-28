// apps/web/src/features/customers/consent-form.spec.ts — P1-05 (guest work in the customers lane, review: Bhushan): the rules of the "Record consent"
// form for the purpose BUREAU_PULL. consent-form.ts has no React in it, so no browser is needed. The page itself is in
// CustomerConsents.bureau.spec.tsx.
import { CREDIT_BUREAUS } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import { BUREAU_LABELS, recordBureauConsentPath } from '../verifications/bureau/credit-reports';
import {
  ALREADY_ACTIVE,
  BUREAU_REQUIRED,
  CONSENT_PURPOSE_OPTIONS,
  DEFAULT_LENDER_TARGET,
  LENDER_OR_AGENCY_REQUIRED,
  NOT_AVAILABLE_YET,
  buildConsentPayload,
  describeConsentError,
  initialConsentForm,
  isBureau,
  targetAfterPurposeChange,
  targetKind,
  type ConsentFormValues,
  type ConsentPurposeValue,
} from './consent-form';

const form = (over: Partial<ConsentFormValues> = {}): ConsentFormValues => ({
  purpose: 'BUREAU_PULL',
  purposeTarget: 'CIBIL',
  noticeVersion: 'NV-2026.1',
  channel: 'IN_PERSON',
  evidenceRef: '',
  ...over,
});

describe('P1-05 consent form: the Purpose select', () => {
  it('P1-05 offers BUREAU_PULL after the five purposes it always had, each once', () => {
    expect(CONSENT_PURPOSE_OPTIONS).toEqual([
      'CONTACT',
      'LOAN_PROCESSING',
      'SHARE_WITH_LENDER',
      'VERIFICATION_CHECK',
      'MARKETING',
      'BUREAU_PULL',
    ]);
    expect(new Set(CONSENT_PURPOSE_OPTIONS).size).toBe(CONSENT_PURPOSE_OPTIONS.length);
  });

  it('P1-05 each purpose has one kind of target: a bureau only for BUREAU_PULL, and none for the purposes that take none', () => {
    expect(targetKind('BUREAU_PULL')).toBe('BUREAU');
    expect(targetKind('SHARE_WITH_LENDER')).toBe('LENDER');
    expect(targetKind('VERIFICATION_CHECK')).toBe('AGENCY');
    for (const p of ['CONTACT', 'LOAN_PROCESSING', 'MARKETING'] as const) expect(targetKind(p)).toBe('NONE');
  });

  it('P1-05 the bureaus are the four of the contracts, and each has a label', () => {
    expect(CREDIT_BUREAUS).toEqual(['CIBIL', 'CRIF', 'EXPERIAN', 'EQUIFAX']);
    for (const b of CREDIT_BUREAUS) {
      expect(isBureau(b)).toBe(true);
      expect(BUREAU_LABELS[b]).toBeTruthy();
    }
    for (const bad of ['', 'cibil', ' CIBIL', 'TRANSUNION', 'LENDER_HDFC_01'])
      expect(isBureau(bad)).toBe(false);
  });
});

describe('P1-05 consent form: the target follows its purpose and is never carried to another', () => {
  it('P1-05 choosing BUREAU_PULL starts with NO bureau, even when a lender was pre-filled before', () => {
    expect(targetAfterPurposeChange('CONTACT', 'BUREAU_PULL', '')).toBe('');
    expect(targetAfterPurposeChange('SHARE_WITH_LENDER', 'BUREAU_PULL', DEFAULT_LENDER_TARGET)).toBe('');
    expect(targetAfterPurposeChange('VERIFICATION_CHECK', 'BUREAU_PULL', 'AGENCY_X')).toBe('');
  });

  it('P1-05 a bureau left selected is dropped when the purpose changes to any other purpose', () => {
    for (const to of CONSENT_PURPOSE_OPTIONS.filter((p) => p !== 'BUREAU_PULL')) {
      const kept = targetAfterPurposeChange('BUREAU_PULL', to, 'CRIF');
      expect(kept).not.toBe('CRIF');
      // For a lender or agency purpose the form pre-fills the lender it always pre-filled; for the others there is no target at all.
      expect(kept).toBe(targetKind(to) === 'NONE' ? '' : DEFAULT_LENDER_TARGET);
    }
  });

  it('P1-05 a lender typed for one purpose does not stay behind for a purpose that takes none', () => {
    for (const to of ['CONTACT', 'LOAN_PROCESSING', 'MARKETING'] as const) {
      expect(targetAfterPurposeChange('SHARE_WITH_LENDER', to, 'LENDER_X')).toBe('');
    }
  });

  it('P1-05 behaviour that existed before is kept: lender and agency share their target, and an empty one gets the pre-filled lender', () => {
    expect(targetAfterPurposeChange('SHARE_WITH_LENDER', 'VERIFICATION_CHECK', 'LENDER_X')).toBe('LENDER_X');
    expect(targetAfterPurposeChange('VERIFICATION_CHECK', 'SHARE_WITH_LENDER', 'AGENCY_X')).toBe('AGENCY_X');
    expect(targetAfterPurposeChange('CONTACT', 'SHARE_WITH_LENDER', '')).toBe(DEFAULT_LENDER_TARGET);
    expect(targetAfterPurposeChange('CONTACT', 'VERIFICATION_CHECK', '')).toBe(DEFAULT_LENDER_TARGET);
  });

  it('P1-05 choosing the same purpose again changes nothing', () => {
    expect(targetAfterPurposeChange('BUREAU_PULL', 'BUREAU_PULL', 'EQUIFAX')).toBe('EQUIFAX');
    expect(targetAfterPurposeChange('SHARE_WITH_LENDER', 'SHARE_WITH_LENDER', 'LENDER_X')).toBe('LENDER_X');
  });
});

describe('P1-05 consent form: the request that is sent', () => {
  it('P1-05 a BUREAU_PULL consent carries the bureau as its purposeTarget, for each of the four bureaus', () => {
    for (const bureau of CREDIT_BUREAUS) {
      const r = buildConsentPayload(form({ purposeTarget: bureau }));
      expect(r).toEqual({
        ok: true,
        payload: {
          purpose: 'BUREAU_PULL',
          purposeTarget: bureau,
          noticeVersion: 'NV-2026.1',
          channel: 'IN_PERSON',
          evidenceRef: undefined,
        },
      });
    }
  });

  it('P1-05 Record is refused until a bureau is chosen: no bureau, a blank, or something that is not a bureau', () => {
    for (const purposeTarget of ['', '   ', 'TRANSUNION', 'cibil', 'LENDER_HDFC_01']) {
      expect(buildConsentPayload(form({ purposeTarget }))).toEqual({ ok: false, error: BUREAU_REQUIRED });
    }
  });

  it('P1-05 a target left in the form is NOT sent with a purpose that takes none (a bureau, a lender)', () => {
    for (const purpose of ['CONTACT', 'LOAN_PROCESSING', 'MARKETING'] as const) {
      for (const purposeTarget of ['CIBIL', 'LENDER_HDFC_01']) {
        const r = buildConsentPayload(form({ purpose, purposeTarget }));
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.payload.purposeTarget).toBeUndefined();
      }
    }
  });

  it('P1-05 lender and agency purposes still need their target, trimmed, as before', () => {
    const r = buildConsentPayload(form({ purpose: 'SHARE_WITH_LENDER', purposeTarget: ' LENDER_X ' }));

    expect(r.ok && r.payload.purposeTarget).toBe('LENDER_X');
    expect(buildConsentPayload(form({ purpose: 'SHARE_WITH_LENDER', purposeTarget: '' }))).toEqual({
      ok: false,
      error: LENDER_OR_AGENCY_REQUIRED,
    });
    expect(buildConsentPayload(form({ purpose: 'VERIFICATION_CHECK', purposeTarget: '  ' }))).toEqual({
      ok: false,
      error: LENDER_OR_AGENCY_REQUIRED,
    });
  });

  it('P1-05 the notice version falls back as before and the evidence reference is trimmed or left out', () => {
    const r = buildConsentPayload(
      form({ noticeVersion: '  ', evidenceRef: ' DOC-SIGNED-001 ', channel: 'OTP' }),
    );

    expect(r).toEqual({
      ok: true,
      payload: {
        purpose: 'BUREAU_PULL',
        purposeTarget: 'CIBIL',
        noticeVersion: 'NV-2026.1',
        channel: 'OTP',
        evidenceRef: 'DOC-SIGNED-001',
      },
    });
  });
});

describe('P1-05 consent form: the deep link from the Bureau card', () => {
  const params = (query: string) => new URLSearchParams(query);

  it('P1-05 ?record=BUREAU_PULL&bureau=CRIF opens the dialog with BUREAU_PULL and CRIF chosen', () => {
    expect(initialConsentForm(params('record=BUREAU_PULL&bureau=CRIF'))).toEqual({
      open: true,
      purpose: 'BUREAU_PULL',
      purposeTarget: 'CRIF',
    });
  });

  it('P1-05 the link the Bureau card makes is read back as the same purpose and bureau, for each bureau', () => {
    for (const bureau of CREDIT_BUREAUS) {
      const path = recordBureauConsentPath('cust_1', bureau);
      const query = new URL(path, 'http://localhost').searchParams;

      expect(initialConsentForm(query)).toEqual({
        open: true,
        purpose: 'BUREAU_PULL',
        purposeTarget: bureau,
      });
      // Only those two values are in the address.
      expect([...query.keys()].sort()).toEqual(['bureau', 'record']);
    }
  });

  it('P1-05 without a link the page starts as it always did: closed, CONTACT, no target', () => {
    expect(initialConsentForm(params(''))).toEqual({ open: false, purpose: 'CONTACT', purposeTarget: '' });
    expect(initialConsentForm(params('bureau=CRIF'))).toEqual({
      open: false,
      purpose: 'CONTACT',
      purposeTarget: '',
    });
  });

  it('P1-05 a record value that is not a purpose is ignored: no dialog', () => {
    for (const q of [
      'record=NOPE',
      'record=',
      'record=bureau_pull',
      'record=BUREAU_PULL%20',
      'record=%3Cscript%3E&bureau=CRIF',
    ]) {
      expect(initialConsentForm(params(q))).toEqual({ open: false, purpose: 'CONTACT', purposeTarget: '' });
    }
  });

  it('P1-05 a bureau value that is not a bureau is ignored: the dialog opens with the bureau still to be chosen', () => {
    for (const q of [
      'record=BUREAU_PULL',
      'record=BUREAU_PULL&bureau=TRANSUNION',
      'record=BUREAU_PULL&bureau=cibil',
      'record=BUREAU_PULL&bureau=',
      'record=BUREAU_PULL&bureau=LENDER_HDFC_01',
    ]) {
      expect(initialConsentForm(params(q))).toEqual({
        open: true,
        purpose: 'BUREAU_PULL',
        purposeTarget: '',
      });
    }
  });

  it('P1-05 a bureau that comes with another purpose is ignored, and another valid purpose opens the dialog as the Purpose select would', () => {
    expect(initialConsentForm(params('record=MARKETING&bureau=CRIF'))).toEqual({
      open: true,
      purpose: 'MARKETING',
      purposeTarget: '',
    });
    expect(initialConsentForm(params('record=SHARE_WITH_LENDER&bureau=CRIF'))).toEqual({
      open: true,
      purpose: 'SHARE_WITH_LENDER',
      purposeTarget: DEFAULT_LENDER_TARGET,
    });
  });

  it('P1-05 nothing else in the address is read: the first value counts and other names are ignored', () => {
    const r = initialConsentForm(
      params('record=BUREAU_PULL&bureau=CRIF&bureau=EQUIFAX&purposeTarget=EXPERIAN&tenantId=ten_x'),
    );

    expect(r).toEqual({ open: true, purpose: 'BUREAU_PULL', purposeTarget: 'CRIF' });
  });
});

describe('P1-05 consent form: what the person is told when the server refuses', () => {
  const unique = {
    code: 'INVALID_STATE',
    message: 'A record with the same unique value already exists.',
    details: [{ issue: 'UNIQUE_VIOLATION' }],
  };

  it('P1-05 a second active consent for the same bureau says so, names the bureau, and what to do', () => {
    const text = describeConsentError(unique, 'BUREAU_PULL', 'EXPERIAN');

    expect(text).toBe(
      'This customer already has an active consent for Experian. To record it again, withdraw the existing one first.',
    );
    expect(text).not.toContain('unique value');
  });

  it('P1-05 a second active consent for another purpose gets the plain words too, without naming a target', () => {
    expect(describeConsentError(unique, 'SHARE_WITH_LENDER', 'LENDER_X')).toBe(ALREADY_ACTIVE);
    expect(describeConsentError(unique, 'CONTACT', '')).toBe(ALREADY_ACTIVE);
    expect(describeConsentError(unique, 'BUREAU_PULL', 'TRANSUNION')).toBe(ALREADY_ACTIVE);
    expect(ALREADY_ACTIVE).not.toContain('LENDER_X');
  });

  it('P1-05 a 422 on the target of a BUREAU_PULL asks for a bureau', () => {
    const err = {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: [{ field: 'purposeTarget', issue: 'whatever the server said' }],
    };

    expect(describeConsentError(err, 'BUREAU_PULL', '')).toBe(BUREAU_REQUIRED);
  });

  it('P1-05 a database rule broken by a BUREAU_PULL says the system does not accept it yet (migration 0130 not applied there)', () => {
    const err = {
      code: 'VALIDATION_ERROR',
      message: 'The request breaks a data rule.',
      details: [{ issue: 'CONSTRAINT', meta: { constraint: 'x' } }],
    };

    expect(describeConsentError(err, 'BUREAU_PULL', 'CIBIL')).toBe(NOT_AVAILABLE_YET);
    // The same database error for another purpose keeps the server's words.
    expect(describeConsentError(err, 'CONTACT', '')).toBe('The request breaks a data rule.');
  });

  it('P1-05 any other error keeps the server message, and something that is not an error gets a fixed sentence', () => {
    expect(
      describeConsentError(
        { code: 'FORBIDDEN', message: 'You do not have permission.', details: [] },
        'BUREAU_PULL',
        'CIBIL',
      ),
    ).toBe('You do not have permission.');
    expect(describeConsentError(new Error('Network down'), 'BUREAU_PULL', 'CIBIL')).toBe('Network down');
    expect(describeConsentError(undefined, 'BUREAU_PULL', 'CIBIL')).toBe(
      'The consent could not be recorded.',
    );
    expect(describeConsentError({ message: '' }, 'BUREAU_PULL', 'CIBIL')).toBe(
      'The consent could not be recorded.',
    );
  });

  it('P1-05 no message built here contains what was typed: a typed bureau that is not one of the four never appears in it', () => {
    const typed = 'ZZ-TYPED-VALUE-99';
    const purposes: ConsentPurposeValue[] = [...CONSENT_PURPOSE_OPTIONS];
    for (const p of purposes) {
      expect(describeConsentError(unique, p, typed)).not.toContain(typed);
      expect(
        describeConsentError(
          { code: 'VALIDATION_ERROR', details: [{ field: 'purposeTarget', issue: 'x' }] },
          p,
          typed,
        ),
      ).not.toContain(typed);
    }
    const built = buildConsentPayload(form({ purposeTarget: typed }));
    expect(JSON.stringify(built)).not.toContain(typed);
  });
});
