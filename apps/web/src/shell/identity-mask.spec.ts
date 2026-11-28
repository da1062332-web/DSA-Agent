// Identity masks on screens (task P1-01, checklist 4.4). One helper in display.tsx, built on the shared rules in @dsa/contracts.
import { describe, expect, it } from 'vitest';
import { displayContact, displayEmail, displayMobile, displayPan } from './display';

describe('TEST-SECRETS-05 identity masks on screens', () => {
  it('TEST-SECRETS-05 a PAN shows as ABCDE****F, in any letter case and with spaces typed around it', () => {
    expect(displayPan('ABCDE1234F')).toBe('ABCDE****F');
    expect(displayPan('abcde1234f')).toBe('ABCDE****F');
    expect(displayPan(' ABCDE 1234F ')).toBe('ABCDE****F');
  });

  it('TEST-SECRETS-05 text that is not a 10-character PAN shows as four stars, never as typed', () => {
    expect(displayPan('ABC123')).toBe('****');
    expect(displayPan('ABCDE1234FXYZ')).toBe('****');
  });

  it('TEST-SECRETS-05 a mobile shows as +91 ****** 3210, ignoring spaces typed in it', () => {
    expect(displayMobile('+919876543210')).toBe('+91 ****** 3210');
    expect(displayMobile('+91 98765 43210')).toBe('+91 ****** 3210');
  });

  it('TEST-SECRETS-05 an e-mail shows as j***e@example.com', () => {
    expect(displayEmail('john.doe@example.com')).toBe('j***e@example.com');
    expect(displayEmail('  ab@example.com ')).toBe('a***@example.com');
  });

  it('TEST-SECRETS-05 a contact is masked by its shape: an e-mail or a mobile', () => {
    expect(displayContact('john.doe@example.com')).toBe('j***e@example.com');
    expect(displayContact('+919876543210')).toBe('+91 ****** 3210');
  });

  it('TEST-SECRETS-05 a value the API has already masked is shown as it is, never masked twice', () => {
    expect(displayPan('ABCDE****F')).toBe('ABCDE****F');
    expect(displayMobile('+91 ****** 3210')).toBe('+91 ****** 3210');
    expect(displayEmail('j***e@example.com')).toBe('j***e@example.com');
  });

  it('TEST-SECRETS-05 a raw PAN or mobile with a stray star is still masked', () => {
    expect(displayPan('ABCDE1234F*')).toBe('ABCDE****F');
    expect(displayMobile('+919876543210*')).toBe('+91 ****** 3210');
  });

  it('TEST-SECRETS-05 the placeholder mask XXXXXX0901 from the partner feed is shown as it is', () => {
    expect(displayMobile('XXXXXX0901')).toBe('XXXXXX0901');
  });

  it('TEST-SECRETS-05 an e-mail typed with x letters is masked, not passed through', () => {
    expect(displayEmail('xxxx@example.com')).toBe('x***x@example.com');
  });

  it('TEST-SECRETS-05 an empty value shows nothing, so the screen can use its own placeholder', () => {
    expect(displayPan(null)).toBeNull();
    expect(displayPan('')).toBeNull();
    expect(displayMobile(undefined)).toBeNull();
    expect(displayEmail('')).toBeNull();
    expect(displayContact(null)).toBeNull();
  });
});
