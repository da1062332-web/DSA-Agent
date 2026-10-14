// apps/web/src/features/targets/types.ts — owner: Dev 5 (MOD-PERF Targets)
import type {
  ApproveTargetRequest,
  CreateTargetRequest,
  DimensionType,
  MetricCode,
  TargetDto,
  TargetListQuery,
  TargetListResponse,
  TargetStatus,
  TargetUnit,
} from '@dsa/contracts';

export type {
  ApproveTargetRequest,
  CreateTargetRequest,
  DimensionType,
  MetricCode,
  TargetDto,
  TargetListQuery,
  TargetListResponse,
  TargetStatus,
  TargetUnit,
};

export const METRIC_LABELS: Record<MetricCode, string> = {
  DISBURSEMENT_AMOUNT: 'Disbursement Amount (₹)',
  LEAD_COUNT: 'Lead Generation Count',
  SANCTION_COUNT: 'Sanction Approval Count',
};

export const DIMENSION_LABELS: Record<DimensionType, string> = {
  BRANCH: 'Branch',
  USER: 'User / Individual',
  PRODUCT: 'Loan Product',
};

export function formatTargetValue(value: number, unit: TargetUnit): string {
  if (unit === 'INR') {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(value);
  }
  return new Intl.NumberFormat('en-IN').format(value);
}
