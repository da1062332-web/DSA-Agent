// packages/contracts/src/target.ts — owner: Dev 5 (MOD-PERF Targets)
import { z } from 'zod';

export const DimensionTypeEnum = z.enum(['BRANCH', 'USER', 'PRODUCT']);
export type DimensionType = z.infer<typeof DimensionTypeEnum>;

export const MetricCodeEnum = z.enum(['DISBURSEMENT_AMOUNT', 'LEAD_COUNT', 'SANCTION_COUNT']);
export type MetricCode = z.infer<typeof MetricCodeEnum>;

export const TargetUnitEnum = z.enum(['INR', 'COUNT']);
export type TargetUnit = z.infer<typeof TargetUnitEnum>;

export const TargetStatusEnum = z.enum(['PENDING_APPROVAL', 'APPROVED', 'SUPERSEDED', 'REJECTED']);
export type TargetStatus = z.infer<typeof TargetStatusEnum>;

export const TargetDecisionEnum = z.enum(['APPROVE', 'REJECT']);
export type TargetDecision = z.infer<typeof TargetDecisionEnum>;

export const TARGET_PERIOD_REGEX = /^(\d{4}-(?:0[1-9]|1[0-2])|\d{4}-Q[1-4])$/;

export const CreateTargetRequestSchema = z
  .object({
    period: z
      .string()
      .regex(
        TARGET_PERIOD_REGEX,
        'Period must be in YYYY-MM (e.g. 2026-10) or YYYY-Q# (e.g. 2026-Q4) format',
      ),
    dimensionType: DimensionTypeEnum,
    dimensionId: z.string().min(1, 'dimensionId is required').max(64),
    metricCode: MetricCodeEnum,
    targetValue: z.number().nonnegative('targetValue must be non-negative'),
    unit: TargetUnitEnum,
  })
  .refine(
    (data) => {
      if (data.metricCode === 'DISBURSEMENT_AMOUNT') {
        return data.unit === 'INR';
      }
      return data.unit === 'COUNT';
    },
    {
      message: 'unit must be INR for DISBURSEMENT_AMOUNT, or COUNT for LEAD_COUNT / SANCTION_COUNT',
      path: ['unit'],
    },
  );

export type CreateTargetRequest = z.infer<typeof CreateTargetRequestSchema>;

export const ApproveTargetRequestSchema = z
  .object({
    decision: TargetDecisionEnum,
    rejectionReason: z.string().max(500).nullish(),
  })
  .refine(
    (data) => {
      if (data.decision === 'REJECT') {
        return Boolean(data.rejectionReason && data.rejectionReason.trim().length >= 3);
      }
      return true;
    },
    {
      message: 'rejectionReason of at least 3 characters is required when rejecting a target',
      path: ['rejectionReason'],
    },
  );

export type ApproveTargetRequest = z.infer<typeof ApproveTargetRequestSchema>;

export const TargetListQuerySchema = z.object({
  period: z.string().optional(),
  dimensionType: DimensionTypeEnum.optional(),
  dimensionId: z.string().optional(),
  metricCode: MetricCodeEnum.optional(),
  status: TargetStatusEnum.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type TargetListQuery = z.infer<typeof TargetListQuerySchema>;

export const TargetDtoSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  period: z.string(),
  dimensionType: DimensionTypeEnum,
  dimensionId: z.string(),
  metricCode: MetricCodeEnum,
  targetValue: z.number(),
  unit: TargetUnitEnum,
  version: z.number(),
  status: TargetStatusEnum,
  createdBy: z.string(),
  createdAt: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  lockVersion: z.number(),
  actualValue: z.number().nullable(),
  achievementPercentage: z.number().nullable(),
});

export type TargetDto = z.infer<typeof TargetDtoSchema>;

export const TargetListResponseSchema = z.object({
  items: z.array(TargetDtoSchema),
  nextCursor: z.string().nullish(),
});

export type TargetListResponse = z.infer<typeof TargetListResponseSchema>;
