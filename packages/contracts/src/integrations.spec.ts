import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_CATEGORIES,
  CapabilityCategorySchema,
  CapabilityDescriptorSchema,
  STANDARD_CAPABILITY_DESCRIPTORS,
} from './integrations';

describe('integration capability categories and descriptors (P1-06)', () => {
  it('P1-06 registers TELEPHONY, FRAUD and LENDER and keeps every earlier category (additive)', () => {
    expect(CAPABILITY_CATEGORIES).toEqual(
      expect.arrayContaining(['MESSAGING', 'VERIFICATION', 'STORAGE', 'BANKING', 'BUREAU']),
    );
    expect(CAPABILITY_CATEGORIES).toEqual(expect.arrayContaining(['TELEPHONY', 'FRAUD', 'LENDER']));
    expect(new Set(CAPABILITY_CATEGORIES).size).toBe(CAPABILITY_CATEGORIES.length);
  });

  it('P1-06 accepts a descriptor in each new category and rejects an unregistered one', () => {
    const base = STANDARD_CAPABILITY_DESCRIPTORS[0]!;
    for (const category of ['TELEPHONY', 'FRAUD', 'LENDER']) {
      expect(CapabilityCategorySchema.safeParse(category).success).toBe(true);
      expect(CapabilityDescriptorSchema.safeParse({ ...base, category }).success).toBe(true);
    }
    expect(CapabilityDescriptorSchema.safeParse({ ...base, category: 'CRYPTO' }).success).toBe(false);
  });

  it('P1-06 every standard descriptor uses a registered category and a unique capability name', () => {
    const names = STANDARD_CAPABILITY_DESCRIPTORS.map((d) => d.capability);
    expect(new Set(names).size).toBe(names.length);
    for (const d of STANDARD_CAPABILITY_DESCRIPTORS) {
      expect(CapabilityDescriptorSchema.safeParse(d).success).toBe(true);
      expect(CAPABILITY_CATEGORIES).toContain(d.category);
    }
  });

  it('P1-06 VERIFICATION.BANK is served by KARZA and asks only for provider-neutral configuration', () => {
    const bank = STANDARD_CAPABILITY_DESCRIPTORS.find((d) => d.capability === 'VERIFICATION.BANK');
    expect(bank).toBeDefined();
    expect(bank!.supportedProviders).toContain('KARZA');
    expect(bank!.requiredConfigFields).toEqual(['apiEndpoint', 'minMatchScore']);
    expect(bank!.dataClassification).toBe('S3');
  });

  it('P1-06 PAN, GST and bank checks all list KARZA as a supported provider', () => {
    for (const capability of ['VERIFICATION.PAN', 'VERIFICATION.GST', 'VERIFICATION.BANK']) {
      const d = STANDARD_CAPABILITY_DESCRIPTORS.find((x) => x.capability === capability);
      expect(d?.supportedProviders, capability).toContain('KARZA');
    }
  });
});
