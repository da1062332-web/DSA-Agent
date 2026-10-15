// apps/api/src/modules/security/types.ts — Module 39: Security (MOD-SEC)
import type { IncidentNotifications } from '@dsa/contracts';

export interface SecurityEventRow {
  id: string;
  tenant_id: string;
  type: string;
  principal: string;
  ip: string;
  severity: string;
  details: Record<string, unknown>;
  created_at: string;
}

export interface IncidentRecordRow {
  id: string;
  tenant_id: string;
  type: string;
  severity: string;
  detected_at: string;
  personal_data_involved: boolean;
  affected_tenants: string[];
  notifications: IncidentNotifications;
  status: string;
  post_mortem_ref: string | null;
  lock_version: number;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}
