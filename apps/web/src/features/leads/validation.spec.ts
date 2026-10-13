// Lead form rules (MODULE 7). Each case mirrors what the API accepts or refuses.
import { describe, expect, it } from 'vitest';
import {
  CONSENT_CHANNELS,
  LEAD_SOURCES,
  PRODUCT_CATEGORIES,
  formFieldFor,
  isValidMobile,
  normalizeAmount,
  validateLead,
  type LeadForm,
} from './validation';

const ok: LeadForm = {
  fullName: 'Kavya Deshmukh',
  mobile: '9876501234',
  email: 'kavya.demo@example.com',
  pincode: '411001',
  amount: '300000',
  branchId: 'br_01M4SXZKRV8TA1K0PFRFSH9AZW',
  subSource: '',
  campaign: '',
  noticeVersion: 'v1.0',
};

describe('leads: option lists match the API (TEST-LEAD-WEB-001)', () => {
  it('offers exactly the categories, sources and channels the API accepts', () => {
    expect(PRODUCT_CATEGORIES.map((c) => c.value)).toEqual([
      'PL',
      'BL',
      'MSME',
      'LAP',
      'HL',
      'VL',
      'GL',
      'EL',
      'OTHER',
    ]);
    expect(LEAD_SOURCES.map((s) => s.value)).toEqual([
      'WALK_IN',
      'PHONE',
      'WEBSITE',
      'REFERRAL',
      'CAMPAIGN',
      'API',
      'OTHER',
    ]);
    expect(CONSENT_CHANNELS.map((c) => c.value)).toEqual([
      'IN_PERSON',
      'PHONE',
      'WEB_FORM',
      'EMAIL',
      'OTP',
      'DOCUMENT',
    ]);
  });
});

describe('leads: field rules (TEST-LEAD-WEB-002)', () => {
  it('accepts a complete, valid lead', () => {
    expect(validateLead(ok)).toEqual({});
  });

  it('accepts the mobile formats the API normalises and refuses the rest', () => {
    for (const m of ['9876501234', '09876501234', '919876501234', '+919876501234', '98765 01234']) {
      expect(isValidMobile(m)).toBe(true);
    }
    for (const m of ['12345', '5876501234', '98765012345', 'abcdefghij']) {
      expect(isValidMobile(m)).toBe(false);
    }
  });

  it('normalises amounts to two decimals and refuses zero or text', () => {
    expect(normalizeAmount('300000')).toBe('300000.00');
    expect(normalizeAmount('300000.5')).toBe('300000.50');
    expect(normalizeAmount('3,00,000')).toBe('300000.00');
    expect(normalizeAmount('0')).toBeNull();
    expect(normalizeAmount('abc')).toBeNull();
    expect(normalizeAmount('100.123')).toBeNull();
  });

  it('reports each problem against its own field', () => {
    const e = validateLead({
      ...ok,
      fullName: 'A',
      mobile: '12345',
      email: 'not-an-email',
      pincode: '011001',
      amount: '0',
      branchId: '',
      noticeVersion: 'v 1',
    });
    expect(Object.keys(e).sort()).toEqual([
      'amount',
      'branchId',
      'email',
      'fullName',
      'mobile',
      'noticeVersion',
      'pincode',
    ]);
  });

  it('leaves optional fields alone when blank', () => {
    expect(validateLead({ ...ok, email: '', pincode: '', amount: '' })).toEqual({});
  });
});

describe('leads: API error fields map to form fields (TEST-LEAD-WEB-003)', () => {
  it('maps nested API fields onto the form', () => {
    expect(formFieldFor('consent.noticeVersion')).toBe('noticeVersion');
    expect(formFieldFor('indicativeAmount.amount')).toBe('amount');
    expect(formFieldFor('mobile')).toBe('mobile');
    expect(formFieldFor('unknown.field')).toBeUndefined();
  });
});
