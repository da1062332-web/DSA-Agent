// GET /v1/me (API-USR-010) and GET /v1/tenant — owner: Dev 1.
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { apiFetch } from './client';

export interface Me {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  primaryBranchId: string | null;
  queueIds: string[];
  grants: { code: string; scope: string; branchIds: string[] }[];
  mfaVerifiedAt: string | null;
}

export interface Tenant {
  id: string;
  slug: string;
  legalName: string;
  tenantType: string;
  dataRegion: string;
  timezone: string;
  status: string;
  createdAt: string;
}

export function useMe() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['me', session?.user.id],
    queryFn: () => apiFetch<Me>('/v1/me'),
    enabled: !!session,
    retry: false,
    staleTime: 60_000,
  });
}

export function useTenant() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['tenant', session?.user.id],
    queryFn: () => apiFetch<Tenant>('/v1/tenant'),
    enabled: !!session,
    staleTime: 300_000,
  });
}

export const hasPermission = (me: Me | undefined, code: string) => !!me?.grants.some((g) => g.code === code);

/** Doc 03 §5.1: MFA is mandatory for admin, owner, branch manager, loan ops, verifier, compliance, finance,
 *  rule roles and auditors. In the MVP these are the users holding any of these permissions. */
const MFA_REQUIRED = [
  'config.manage',
  'user.manage',
  'audit.read',
  'document.review',
  'lender_case.submit',
  'lender_case.update_status',
  'application.review',
  'rule.author',
  'rule.approve',
  'rule.publish',
  'rule.suspend',
];
export const mfaRequired = (me: Me | undefined) => !!me?.grants.some((g) => MFA_REQUIRED.includes(g.code));
