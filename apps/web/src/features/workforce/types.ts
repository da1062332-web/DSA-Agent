// apps/web/src/features/workforce/types.ts — Module 26: Workforce Types

export type AvailabilityStatus = 'AVAILABLE' | 'BUSY' | 'OFF_DUTY' | 'ON_LEAVE';

export interface AgentWorkforceSummary {
  id: string;
  displayName: string;
  email: string;
  availability: AvailabilityStatus;
  capacity: number;
  activeLeadCount: number;
  activeApplicationCount: number;
  primaryBranchId: string | null;
  status: string;
}

export interface DelegationRecord {
  id: string;
  tenantId: string;
  delegatorId: string;
  delegateId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  status: 'ACTIVE' | 'ENDED' | 'CANCELLED';
  lockVersion: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  delegatorName?: string;
  delegateName?: string;
}

export interface CreateDelegationInput {
  delegatorId: string;
  delegateId: string;
  startsAt: string;
  endsAt: string;
  reason?: string;
}

export interface AttendanceRecord {
  id: string;
  tenantId: string;
  userId: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
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
