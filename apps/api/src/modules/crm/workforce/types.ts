import { z } from 'zod';

export const AvailabilityStatusSchema = z.enum(['AVAILABLE', 'BUSY', 'OFF_DUTY', 'ON_LEAVE']);
export type AvailabilityStatus = z.infer<typeof AvailabilityStatusSchema>;

export const UpdateAvailabilityInputSchema = z.object({
  availability: AvailabilityStatusSchema,
});
export type UpdateAvailabilityInput = z.infer<typeof UpdateAvailabilityInputSchema>;

export const UpdateCapacityInputSchema = z.object({
  capacity: z.number().int().min(0).max(100),
});
export type UpdateCapacityInput = z.infer<typeof UpdateCapacityInputSchema>;

export const CreateDelegationInputSchema = z
  .object({
    delegatorId: z.string().min(1),
    delegateId: z.string().min(1),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    reason: z.string().max(500).optional(),
  })
  .refine((data) => data.delegatorId !== data.delegateId, {
    message: 'Delegator and delegate cannot be the same user',
    path: ['delegateId'],
  })
  .refine((data) => new Date(data.startsAt) < new Date(data.endsAt), {
    message: 'Start date must be before end date',
    path: ['endsAt'],
  });
export type CreateDelegationInput = z.infer<typeof CreateDelegationInputSchema>;

export const DelegationStatusSchema = z.enum(['ACTIVE', 'ENDED', 'CANCELLED']);
export type DelegationStatus = z.infer<typeof DelegationStatusSchema>;

export interface DelegationRecord {
  id: string;
  tenantId: string;
  delegatorId: string;
  delegateId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  status: DelegationStatus;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  delegatorName?: string;
  delegateName?: string;
}

export const AttendanceStatusSchema = z.enum(['PRESENT', 'HALF_DAY', 'ON_LEAVE', 'ABSENT']);
export type AttendanceStatus = z.infer<typeof AttendanceStatusSchema>;

export const CheckInInputSchema = z.object({
  notes: z.string().max(500).optional(),
});
export type CheckInInput = z.infer<typeof CheckInInputSchema>;

export const CheckOutInputSchema = z.object({
  notes: z.string().max(500).optional(),
});
export type CheckOutInput = z.infer<typeof CheckOutInputSchema>;

export interface AttendanceRecord {
  id: string;
  tenantId: string;
  userId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  status: AttendanceStatus;
  notes: string | null;
  correctionOf: string | null;
  approvedBy: string | null;
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  userName?: string;
}

export interface AgentWorkforceSummary {
  id: string;
  displayName: string;
  email: string;
  primaryBranchId: string;
  availability: AvailabilityStatus;
  capacity: number;
  activeLeadCount: number;
  activeApplicationCount?: number;
  status?: string;
  activeDelegation?: {
    id: string;
    delegateId: string;
    delegateName: string;
    endsAt: string;
  } | null;
}
