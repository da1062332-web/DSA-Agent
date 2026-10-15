// apps/api/src/modules/crm/targets/types.ts — owner: Dev 5 (MOD-PERF Targets, ENT-037)
import type {
  DimensionType,
  MetricCode,
  TargetDto,
  TargetStatus,
  TargetUnit,
} from '@dsa/contracts';

export interface TargetRow {
  id: string;
  tenant_id: string;
  period: string;
  dimension_type: DimensionType;
  dimension_id: string;
  metric_code: MetricCode;
  target_value: string | number;
  unit: TargetUnit;
  version: number;
  status: TargetStatus;
  lock_version: number;
  created_by: string;
  created_at: Date | string;
  updated_by: string;
  updated_at: Date | string;
  approved_by: string | null;
  approved_at: Date | string | null;
  rejection_reason: string | null;
}

export interface TargetSlice {
  period: string;
  dimensionType: DimensionType;
  dimensionId: string;
  metricCode: MetricCode;
}

export function toTargetDto(row: TargetRow): TargetDto {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    period: row.period,
    dimensionType: row.dimension_type,
    dimensionId: row.dimension_id,
    metricCode: row.metric_code,
    targetValue: Number(row.target_value),
    unit: row.unit,
    version: Number(row.version),
    status: row.status,
    createdBy: row.created_by,
    createdAt:
      typeof row.created_at === 'string' ? row.created_at : row.created_at.toISOString(),
    updatedBy: row.updated_by,
    updatedAt:
      typeof row.updated_at === 'string' ? row.updated_at : row.updated_at.toISOString(),
    approvedBy: row.approved_by ?? null,
    approvedAt: row.approved_at
      ? typeof row.approved_at === 'string'
        ? row.approved_at
        : row.approved_at.toISOString()
      : null,
    rejectionReason: row.rejection_reason ?? null,
    lockVersion: Number(row.lock_version),
    actualValue: null,
    achievementPercentage: null,
  };
}
