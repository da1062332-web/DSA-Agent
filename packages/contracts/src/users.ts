import { z } from 'zod';
import { IdSchema } from './ids';

export const USER_STATUSES = ['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const USER_AVAILABILITIES = ['AVAILABLE', 'BUSY', 'OFF_DUTY', 'ON_LEAVE'] as const;
export type UserAvailability = (typeof USER_AVAILABILITIES)[number];

export const USER_TYPES = ['STAFF'] as const;
export type UserType = (typeof USER_TYPES)[number];

export const SCOPE_TYPES = ['OWN', 'TEAM', 'BRANCH', 'TENANT'] as const;

export const UserSummary = z.object({
  id: IdSchema('usr'),
  tenantId: z.string(),
  email: z.string().email(),
  mobileE164: z.string().nullable().optional(),
  displayName: z.string(),
  userType: z.enum(USER_TYPES),
  status: z.enum(USER_STATUSES),
  availability: z.enum(USER_AVAILABILITIES),
  primaryBranchId: z.string(),
  assignedRoles: z.array(z.string()),
  lockVersion: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type UserSummary = z.infer<typeof UserSummary>;

export const CreateUserRequest = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(100),
  mobileE164: z
    .string()
    .regex(/^\+[1-9][0-9]{7,14}$/, 'Must be E.164 phone number, e.g. +919876543210')
    .nullable()
    .optional(),
  primaryBranchId: z.string().min(1),
  status: z.enum(USER_STATUSES).default('ACTIVE').optional(),
  availability: z.enum(USER_AVAILABILITIES).default('AVAILABLE').optional(),
  roleIds: z.array(z.string()).default([]).optional(),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequest>;

export const UpdateUserRequest = z.object({
  displayName: z.string().min(1).max(100).optional(),
  mobileE164: z
    .string()
    .regex(/^\+[1-9][0-9]{7,14}$/, 'Must be E.164 phone number')
    .nullable()
    .optional(),
  status: z.enum(USER_STATUSES).optional(),
  availability: z.enum(USER_AVAILABILITIES).optional(),
  primaryBranchId: z.string().optional(),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequest>;

export const AssignRoleRequest = z.object({
  roleId: z.string().min(1),
  scopeType: z.enum(SCOPE_TYPES).default('TENANT'),
  scopeBranchIds: z.array(z.string()).default([]),
});
export type AssignRoleRequest = z.infer<typeof AssignRoleRequest>;

// ---- Lifecycle (MOD-USR SUB-USR.01, SUB-USR.02; added 2026-10-19) ----
// Reasons are free text: they reject PAN, Aadhaar and 9–18-digit account-like numbers (Contracts §12).
const NO_S3 = [/[A-Z]{5}[0-9]{4}[A-Z]/i, /\b\d{4}\s?\d{4}\s?\d{4}\b/, /\b\d{9,18}\b/];
const Reason = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .refine((s) => !NO_S3.some((p) => p.test(s)), 'must not contain identity or account numbers');

/** API-USR-001: the user starts INVITED and becomes ACTIVE on first sign-in. */
export const InviteUserRequest = CreateUserRequest.omit({ status: true, availability: true }).strict();
export type InviteUserRequest = z.infer<typeof InviteUserRequest>;

/** API-USR-004: deactivate, handing over open leads, live applications and open tasks in the same transaction. */
export const DeactivateUserRequest = z
  .object({ handoverToUserId: z.string().min(3).max(64), reason: Reason })
  .strict();
export type DeactivateUserRequest = z.infer<typeof DeactivateUserRequest>;

/** API-USR-005: suspend (keeps ownership) or reactivate. */
export const SuspendUserRequest = z
  .object({ action: z.enum(['SUSPEND', 'REACTIVATE']), reason: Reason })
  .strict();
export type SuspendUserRequest = z.infer<typeof SuspendUserRequest>;

/** API-USR-006: the complete set of role assignments; anything not listed is ended. */
export const ReplaceRoleAssignmentsRequest = z
  .object({ assignments: z.array(AssignRoleRequest).max(20) })
  .strict();
export type ReplaceRoleAssignmentsRequest = z.infer<typeof ReplaceRoleAssignmentsRequest>;

/** API-USR-008: move the user's primary branch now, or at effectiveAt. */
export const TransferUserRequest = z
  .object({
    toBranchId: z.string().min(3).max(64),
    effectiveAt: z.string().datetime().optional(),
    reason: Reason,
  })
  .strict();
export type TransferUserRequest = z.infer<typeof TransferUserRequest>;

export const UserTransferResponse = z.object({
  userId: z.string(),
  toBranchId: z.string(),
  effectiveAt: z.string(),
  status: z.enum(['APPLIED', 'SCHEDULED']),
});
export type UserTransferResponse = z.infer<typeof UserTransferResponse>;

export const RoleSummary = z.object({
  id: z.string(),
  tenantId: z.string(),
  code: z.string(),
  name: z.string(),
  isTemplate: z.boolean(),
  version: z.number().int(),
  permissions: z.array(z.string()),
});
export type RoleSummary = z.infer<typeof RoleSummary>;

export const CreateRoleRequest = z.object({
  code: z
    .string()
    .regex(/^ROLE-[A-Z-]+$/, 'Role code must match pattern ^ROLE-[A-Z-]+$, e.g. ROLE-CREDIT-ANALYST'),
  name: z.string().min(1).max(100),
  permissions: z.array(z.string()).default([]),
});
export type CreateRoleRequest = z.infer<typeof CreateRoleRequest>;

export const UpdateRoleRequest = z.object({
  name: z.string().min(1).max(100).optional(),
  permissions: z.array(z.string()).optional(),
});
export type UpdateRoleRequest = z.infer<typeof UpdateRoleRequest>;

export const PermissionSummary = z.object({
  code: z.string(),
  description: z.string(),
  introducedIn: z.string(),
});
export type PermissionSummary = z.infer<typeof PermissionSummary>;

export const UserRoleAssignmentSummary = z.object({
  id: z.string(),
  userId: z.string(),
  roleId: z.string(),
  roleCode: z.string(),
  roleName: z.string(),
  scopeType: z.enum(SCOPE_TYPES),
  scopeBranchIds: z.array(z.string()),
  createdAt: z.string(),
});
export type UserRoleAssignmentSummary = z.infer<typeof UserRoleAssignmentSummary>;

export const UserEffectiveGrants = z.object({
  userId: z.string(),
  grants: z.array(
    z.object({
      code: z.string(),
      scope: z.enum(SCOPE_TYPES),
      branchIds: z.array(z.string()),
    }),
  ),
});
export type UserEffectiveGrants = z.infer<typeof UserEffectiveGrants>;
