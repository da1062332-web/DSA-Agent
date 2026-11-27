// apps/web/src/features/workforce/types.ts — Module 26: Workforce Types

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
