import { z } from 'zod';

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
