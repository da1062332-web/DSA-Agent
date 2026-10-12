// Request and response schemas for module platform (owner: Dev 1).
// MOD-TEN (current tenant), MOD-ORG (organisation, branches, teams, work queues), MOD-USR read model, /v1/me.
import { CursorQuery, IdSchema, PERMISSION_CODES, listResponse } from '@dsa/contracts';
import { z } from 'zod';

// Free text rejects PAN, Aadhaar and 9–18-digit account-like numbers (Contracts §12, S3 out of MVP).
const S3_PATTERNS = [/[A-Z]{5}[0-9]{4}[A-Z]/i, /\b\d{4}\s?\d{4}\s?\d{4}\b/, /\b\d{9,18}\b/];
const safeText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !S3_PATTERNS.some((p) => p.test(s)), 'must not contain identity or account numbers');

const Version = z.number().int();
const Timestamp = z.string();
const Timezone = z.string().regex(/^[A-Za-z_]+\/[A-Za-z_]+$/, 'IANA time zone, e.g. Asia/Kolkata');
const BranchCode = z.string().regex(/^[A-Z0-9_-]{2,20}$/, '2–20 of A-Z 0-9 _ -');
const QueueCode = z.string().regex(/^[A-Z0-9_-]{2,40}$/, '2–40 of A-Z 0-9 _ -');
const RecordType = z.enum(['LEAD', 'APPLICATION', 'TASK']);
const QueueKind = z.enum(['INTAKE', 'UNASSIGNED', 'TEAM', 'FUNCTIONAL', 'EXCEPTION']);
const Constitution = z.enum([
  'PROPRIETORSHIP',
  'PARTNERSHIP',
  'LLP',
  'PVT_LTD',
  'PUBLIC_LTD',
  'TRUST',
  'OTHER',
]);
const atLeastOne = (o: Record<string, unknown>) => Object.values(o).some((v) => v !== undefined);

export const ListQuery = CursorQuery.extend({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  q: z.string().trim().max(100).optional(),
});

// ---- /v1/me (API-USR-010) ----
export const MeResponse = z.object({
  id: IdSchema('usr'),
  tenantId: IdSchema('ten'),
  email: z.string(),
  displayName: z.string(),
  primaryBranchId: z.string().nullable(),
  queueIds: z.array(z.string()),
  grants: z.array(
    z.object({
      code: z.enum(PERMISSION_CODES),
      scope: z.enum(['OWN', 'TEAM', 'BRANCH', 'TENANT']),
      branchIds: z.array(z.string()),
    }),
  ),
  /** Time of the latest TOTP verification in this session (aal2), else null. Step-up needs it within 900 s. */
  mfaVerifiedAt: z.string().nullable(),
});
export type MeResponse = z.infer<typeof MeResponse>;

// ---- MOD-TEN: the caller's tenant ----
export const Tenant = z.object({
  id: IdSchema('ten'),
  slug: z.string(),
  legalName: z.string(),
  tenantType: z.string(),
  dataRegion: z.string(),
  timezone: z.string(),
  status: z.string(),
  createdAt: Timestamp,
});
export type Tenant = z.infer<typeof Tenant>;

// ---- MOD-ORG: organisation (API-ORG-001/002) ----
export const Organisation = z.object({
  id: z.string(),
  legalName: z.string(),
  constitution: Constitution,
  status: z.string(),
  version: Version,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Organisation = z.infer<typeof Organisation>;
export const OrganisationPatch = z
  .object({ legalName: safeText(200).optional(), constitution: Constitution.optional() })
  .strict()
  .refine(atLeastOne, 'at least one field is required');

// ---- MOD-ORG: branches (API-ORG-003…006) ----
export const Branch = z.object({
  id: z.string(),
  organisationId: z.string(),
  code: z.string(),
  name: z.string(),
  pincode: z.string().nullable(),
  timezone: z.string(),
  status: z.string(),
  version: Version,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Branch = z.infer<typeof Branch>;
export const BranchCreate = z
  .object({
    code: BranchCode,
    name: safeText(120),
    pincode: z
      .string()
      .regex(/^[1-9][0-9]{5}$/, '6-digit PIN code')
      .nullable()
      .optional(),
    timezone: Timezone.optional(),
  })
  .strict();
export const BranchPatch = z
  .object({
    name: safeText(120).optional(),
    pincode: z
      .string()
      .regex(/^[1-9][0-9]{5}$/, '6-digit PIN code')
      .nullable()
      .optional(),
    timezone: Timezone.optional(),
  })
  .strict()
  .refine(atLeastOne, 'at least one field is required');

// ---- MOD-ORG: teams (API-ORG-007…009) ----
export const TeamMember = z.object({ userId: z.string(), displayName: z.string(), since: Timestamp });
export const Team = z.object({
  id: z.string(),
  name: z.string(),
  branchId: z.string().nullable(),
  managerUserId: z.string().nullable(),
  status: z.string(),
  memberCount: z.number().int(),
  version: Version,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Team = z.infer<typeof Team>;
export const TeamDetail = Team.extend({ members: z.array(TeamMember) });
export type TeamDetail = z.infer<typeof TeamDetail>;
export const TeamCreate = z
  .object({
    name: safeText(120),
    branchId: z.string().nullable().optional(),
    managerUserId: z.string().nullable().optional(),
  })
  .strict();
export const TeamPatch = z
  .object({
    name: safeText(120).optional(),
    branchId: z.string().nullable().optional(),
    managerUserId: z.string().nullable().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict()
  .refine(atLeastOne, 'at least one field is required');
export const TeamMembersPut = z.object({ userIds: z.array(z.string()).max(200) }).strict();

// ---- MOD-ORG: work queues (API-ORG-011…014) ----
export const QueueMember = z.object({
  userId: z.string(),
  displayName: z.string(),
  canPick: z.boolean(),
  canAssign: z.boolean(),
  since: Timestamp,
});
export const WorkQueue = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  kind: QueueKind,
  branchId: z.string().nullable(),
  teamId: z.string().nullable(),
  recordTypes: z.array(RecordType),
  active: z.boolean(),
  memberCount: z.number().int(),
  version: Version,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type WorkQueue = z.infer<typeof WorkQueue>;
export const WorkQueueDetail = WorkQueue.extend({ members: z.array(QueueMember) });
export type WorkQueueDetail = z.infer<typeof WorkQueueDetail>;
export const WorkQueueCreate = z
  .object({
    code: QueueCode,
    name: safeText(120),
    kind: QueueKind,
    branchId: z.string().nullable().optional(),
    teamId: z.string().nullable().optional(),
    recordTypes: z.array(RecordType).min(1),
  })
  .strict()
  .refine((q) => !['INTAKE', 'UNASSIGNED'].includes(q.kind) || !!q.branchId, {
    message: 'INTAKE and UNASSIGNED queues need a branch',
    path: ['branchId'],
  })
  .refine((q) => q.kind !== 'TEAM' || !!q.teamId, { message: 'TEAM queues need a team', path: ['teamId'] });
export const WorkQueuePatch = z
  .object({
    name: safeText(120).optional(),
    active: z.boolean().optional(),
    recordTypes: z.array(RecordType).min(1).optional(),
  })
  .strict()
  .refine(atLeastOne, 'at least one field is required');
export const WorkQueueMembersPut = z
  .object({
    members: z
      .array(z.object({ userId: z.string(), canPick: z.boolean(), canAssign: z.boolean() }).strict())
      .max(200),
  })
  .strict();

// ---- MOD-USR read model for pickers (no email: lists mask contact data) ----
export const UserSummary = z.object({
  id: z.string(),
  displayName: z.string(),
  primaryBranchId: z.string(),
  status: z.string(),
  availability: z.string(),
});
export type UserSummary = z.infer<typeof UserSummary>;

export const BranchList = listResponse(Branch);
export const TeamList = listResponse(Team);
export const WorkQueueList = listResponse(WorkQueue);
export const UserList = listResponse(UserSummary);
export const UserListQuery = CursorQuery.extend({
  status: z.enum(['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']).optional(),
  branchId: z.string().optional(),
  q: z.string().trim().max(100).optional(),
});
