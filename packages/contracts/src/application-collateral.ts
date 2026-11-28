// Co-applicant relationships and property collateral on a loan application (owner: Bhushan, task P1-03 of the multi-lender plan;
// migration 0111 for collateral, M-072 for the relationship column). Shared by the API and the web app, so the form offers exactly
// what the API accepts. Added 2026-11-28 (Contracts §15, additive).
import { z } from 'zod';
import { MoneySchema } from './money';
import { PINCODE_PATTERN, ISO_DATE_PATTERN, isRealDate } from './customer-profile';
import { freeTextNoS3 } from './s3-text';

// ---- Co-applicant relationships -----------------------------------------------------------------------------------------------

/** Values of application_party.relationship_to_primary (CHECK in M-072). */
export const PARTY_RELATIONSHIPS = [
  'SPOUSE',
  'PARENT',
  'CHILD',
  'SIBLING',
  'PARTNER',
  'DIRECTOR',
  'OTHER',
] as const;
export type PartyRelationship = (typeof PARTY_RELATIONSHIPS)[number];

/** Family relationships: only between two individuals. */
export const FAMILY_RELATIONSHIPS: readonly PartyRelationship[] = ['SPOUSE', 'PARENT', 'CHILD', 'SIBLING'];

export type PartyTypeCode = 'INDIVIDUAL' | 'ENTITY';

/**
 * Why a relationship cannot join this party to this primary applicant, or null when it can.
 *   REQUIRED                 a co-applicant must say how they relate to the primary applicant (a guarantor may leave it out)
 *   FAMILY_NEEDS_INDIVIDUALS spouse, parent, child or sibling: both parties are individuals
 *   DIRECTOR_NEEDS_ENTITY    a director is an individual co-applying with a company (the primary applicant is an entity)
 * PARTNER (business partner, or a partner of a firm) and OTHER join any two parties.
 */
export function partyRelationshipIssue(input: {
  role: 'CO_APPLICANT' | 'GUARANTOR';
  relationship: PartyRelationship | null | undefined;
  primaryPartyType: PartyTypeCode;
  partyType: PartyTypeCode;
}): 'REQUIRED' | 'FAMILY_NEEDS_INDIVIDUALS' | 'DIRECTOR_NEEDS_ENTITY' | null {
  const { role, relationship, primaryPartyType, partyType } = input;
  if (!relationship) return role === 'CO_APPLICANT' ? 'REQUIRED' : null;
  if (FAMILY_RELATIONSHIPS.includes(relationship)) {
    return primaryPartyType === 'INDIVIDUAL' && partyType === 'INDIVIDUAL'
      ? null
      : 'FAMILY_NEEDS_INDIVIDUALS';
  }
  if (relationship === 'DIRECTOR') {
    return primaryPartyType === 'ENTITY' && partyType === 'INDIVIDUAL' ? null : 'DIRECTOR_NEEDS_ENTITY';
  }
  return null;
}

/** The relationships a form should offer when it knows only the primary applicant's party type. */
export function relationshipsForPrimary(primaryPartyType: PartyTypeCode): PartyRelationship[] {
  return PARTY_RELATIONSHIPS.filter((r) =>
    primaryPartyType === 'ENTITY' ? !FAMILY_RELATIONSHIPS.includes(r) : r !== 'DIRECTOR',
  );
}

// ---- Collateral ---------------------------------------------------------------------------------------------------------------

export const COLLATERAL_PROPERTY_TYPES = [
  'RESIDENTIAL_FLAT',
  'RESIDENTIAL_PLOT',
  'COMMERCIAL',
  'INDUSTRIAL',
] as const;
export const COLLATERAL_OWNERSHIP_TYPES = ['FREEHOLD', 'LEASEHOLD'] as const;
export const COLLATERAL_OCCUPANCY_TYPES = ['SELF_OCCUPIED', 'TENANTED', 'VACANT'] as const;
/** At most this many live collateral items on one application. */
export const MAX_COLLATERAL_PER_APPLICATION = 20;

const safeText = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !freeTextNoS3(s), 'must not contain identity or account numbers');

/** INR, more than zero, and small enough to count in whole paise with a safe integer (≈ ₹90 lakh crore). */
export const CollateralValue = MoneySchema.extend({ currency: z.literal('INR') })
  .refine((m) => /[1-9]/.test(m.amount), { message: 'must be more than zero', path: ['amount'] })
  .refine((m) => m.amount.split('.')[0]!.length <= 13, { message: 'is too large', path: ['amount'] });

const AppraisalDate = z
  .string()
  .regex(ISO_DATE_PATTERN, 'must be a date in YYYY-MM-DD form')
  .refine(isRealDate, 'must be a real calendar date');

export const CollateralCreate = z
  .object({
    propertyType: z.enum(COLLATERAL_PROPERTY_TYPES),
    addressLine1: safeText(3, 200),
    city: safeText(2, 80),
    state: safeText(2, 80),
    pincode: z.string().trim().regex(PINCODE_PATTERN, 'must be a six-digit pincode'),
    estimatedMarketValue: CollateralValue,
    ownershipType: z.enum(COLLATERAL_OWNERSHIP_TYPES),
    occupancyType: z.enum(COLLATERAL_OCCUPANCY_TYPES).nullable().optional(),
    appraisalDate: AppraisalDate.nullable().optional(),
  })
  .strict();
export type CollateralCreateInput = z.infer<typeof CollateralCreate>;

export const CollateralUpdate = CollateralCreate.partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'give at least one field');
export type CollateralUpdateInput = z.infer<typeof CollateralUpdate>;

export const Collateral = z.object({
  id: z.string(),
  applicationId: z.string(),
  propertyType: z.enum(COLLATERAL_PROPERTY_TYPES),
  addressLine1: z.string(),
  city: z.string(),
  state: z.string(),
  pincode: z.string(),
  estimatedMarketValue: MoneySchema,
  ownershipType: z.enum(COLLATERAL_OWNERSHIP_TYPES),
  occupancyType: z.enum(COLLATERAL_OCCUPANCY_TYPES).nullable(),
  appraisalDate: z.string().nullable(),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CollateralView = z.infer<typeof Collateral>;
