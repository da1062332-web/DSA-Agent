// Customer profile, identity and addresses (owner: Bhushan, task P1-02 of the multi-lender plan; migration 0110). Shared by the API and
// the web app. PAN and date of birth are accepted only on the identity endpoint, stored encrypted, and returned masked; the clear value
// leaves the API only through the reveal endpoint (reason + step-up). Aadhaar is never accepted.
import { z } from 'zod';
import { MoneySchema } from './money';
import { freeTextNoS3 } from './s3-text';

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const UDYAM_PATTERN = /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/;
export const PINCODE_PATTERN = /^[1-9][0-9]{5}$/;
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const CONSTITUTIONS = [
  'INDIVIDUAL',
  'PROPRIETORSHIP',
  'PARTNERSHIP',
  'LLP',
  'PRIVATE_LIMITED',
  'PUBLIC_LIMITED',
  'TRUST',
  'HUF',
] as const;
export const EMPLOYMENT_TYPES = [
  'SALARIED',
  'SELF_EMPLOYED_PROFESSIONAL',
  'SELF_EMPLOYED_BUSINESS',
  'RETIRED',
  'HOMEMAKER',
  'STUDENT',
  'OTHER',
] as const;
export const ADDRESS_TYPES = ['CURRENT', 'PERMANENT', 'OFFICE'] as const;
export const ADDRESS_OWNERSHIPS = ['OWNED', 'RENTED', 'FAMILY_OWNED', 'COMPANY_PROVIDED', 'OTHER'] as const;
export const REVEALABLE_FIELDS = ['PAN', 'DATE_OF_BIRTH'] as const;

/** Free text that must not carry a PAN, Aadhaar or account number (P1-01 guard). */
const safeText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !freeTextNoS3(s), 'must not contain identity or account numbers');

const upper = (pattern: RegExp, message: string) =>
  z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => pattern.test(s), message);

/** INR money, never negative. */
const MoneyInput = MoneySchema.extend({ currency: z.literal('INR') });

// ---- Profile ----------------------------------------------------------------------------------------------------------------------

export const CustomerProfileUpsert = z
  .object({
    constitution: z.enum(CONSTITUTIONS).nullable().optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).nullable().optional(),
    employerName: safeText(2, 200).nullable().optional(),
    businessName: safeText(2, 200).nullable().optional(),
    vintageMonths: z.number().int().min(0).max(1200).nullable().optional(),
    gstin: upper(GSTIN_PATTERN, 'must be a valid GSTIN').nullable().optional(),
    udyamNumber: upper(UDYAM_PATTERN, 'must look like UDYAM-MH-01-0001234').nullable().optional(),
    monthlyIncome: MoneyInput.nullable().optional(),
    monthlyObligations: MoneyInput.nullable().optional(),
  })
  // .strict(): an unknown key is refused, so PAN, Aadhaar or a date of birth sent here is a 422, never stored or ignored.
  .strict();
export type CustomerProfileUpsertInput = z.infer<typeof CustomerProfileUpsert>;

export const CustomerProfile = z.object({
  customerId: z.string(),
  constitution: z.enum(CONSTITUTIONS).nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES).nullable(),
  employerName: z.string().nullable(),
  businessName: z.string().nullable(),
  vintageMonths: z.number().int().nullable(),
  gstin: z.string().nullable(),
  udyamNumber: z.string().nullable(),
  monthlyIncome: MoneySchema.nullable(),
  monthlyObligations: MoneySchema.nullable(),
  lockVersion: z.number().int(),
  updatedAt: z.string().nullable(),
});
export type CustomerProfileView = z.infer<typeof CustomerProfile>;

// ---- Identity (S3) ----------------------------------------------------------------------------------------------------------------

/** PUT body. A field left out is unchanged; null clears it. */
export const CustomerIdentityUpsert = z
  .object({
    pan: upper(PAN_PATTERN, 'must be a valid PAN (ABCDE1234F)').nullable().optional(),
    dateOfBirth: z.string().regex(ISO_DATE_PATTERN, 'must be a date YYYY-MM-DD').nullable().optional(),
  })
  // .strict(): an Aadhaar number (or any other key) is refused with 422; no Aadhaar is ever accepted.
  .strict()
  .refine((v) => v.pan !== undefined || v.dateOfBirth !== undefined, 'give pan or dateOfBirth');
export type CustomerIdentityUpsertInput = z.infer<typeof CustomerIdentityUpsert>;

export const CustomerIdentity = z.object({
  customerId: z.string(),
  panMasked: z.string().nullable(),
  hasDateOfBirth: z.boolean(),
  birthYear: z.number().int().nullable(),
  /** True when another customer of the tenant holds the same PAN: flagged for review, never merged. */
  possibleDuplicatePan: z.boolean(),
  lockVersion: z.number().int(),
  updatedAt: z.string().nullable(),
});
export type CustomerIdentityView = z.infer<typeof CustomerIdentity>;

export const CustomerRevealRequest = z
  .object({
    field: z.enum(REVEALABLE_FIELDS),
    reason: safeText(5, 200),
  })
  .strict();
export type CustomerRevealInput = z.infer<typeof CustomerRevealRequest>;

export const CustomerRevealResponse = z.object({
  customerId: z.string(),
  field: z.enum(REVEALABLE_FIELDS),
  value: z.string(),
  revealedAt: z.string(),
});

// ---- Addresses --------------------------------------------------------------------------------------------------------------------

export const CustomerAddressCreate = z
  .object({
    addressType: z.enum(ADDRESS_TYPES),
    line1: safeText(3, 200),
    line2: safeText(1, 200).nullable().optional(),
    landmark: safeText(1, 120).nullable().optional(),
    city: safeText(2, 80),
    state: safeText(2, 80),
    pincode: z.string().trim().regex(PINCODE_PATTERN, 'must be a six-digit pincode'),
    ownership: z.enum(ADDRESS_OWNERSHIPS).nullable().optional(),
    yearsAtAddress: z.number().int().min(0).max(100).nullable().optional(),
  })
  .strict();
export type CustomerAddressCreateInput = z.infer<typeof CustomerAddressCreate>;

export const CustomerAddressUpdate = CustomerAddressCreate.omit({ addressType: true })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'give at least one field');
export type CustomerAddressUpdateInput = z.infer<typeof CustomerAddressUpdate>;

export const CustomerAddress = z.object({
  id: z.string(),
  customerId: z.string(),
  addressType: z.enum(ADDRESS_TYPES),
  line1: z.string(),
  line2: z.string().nullable(),
  landmark: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
  ownership: z.enum(ADDRESS_OWNERSHIPS).nullable(),
  yearsAtAddress: z.number().int().nullable(),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CustomerAddressView = z.infer<typeof CustomerAddress>;

/** Whole years between a YYYY-MM-DD date of birth and `now` (UTC). Never reads the clock itself. */
export function ageOn(dateOfBirth: string, now: Date): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  const beforeBirthday = now.getUTCMonth() + 1 < m || (now.getUTCMonth() + 1 === m && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isRealDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
