// Where a partner portal login stands (MOD-CPT). Read on the server from the login and its connector, in the caller's tenant only.
// ELIGIBLE needs an ACTIVE partner login linked to an ACTIVE connector. An invitation does not activate a connector, and nothing in the
// portal can. The connector portal's routes and the partner upload routes both read it here, so both refuse with the same state.
import { AppError, type RequestContext, type Tx } from '@dsa/contracts';
import { sql } from 'kysely';

type Row = Record<string, unknown>;

/** Where a portal login stands. Only ELIGIBLE opens the portal's data. Each refused state has one message the user may read. */
export type PortalState = 'ELIGIBLE' | 'CONNECTOR_PENDING' | 'ACCESS_SUSPENDED' | 'NOT_LINKED';

export const PORTAL_STATE_MESSAGE: Record<Exclude<PortalState, 'ELIGIBLE'>, string> = {
  CONNECTOR_PENDING:
    'Your portal account is active, but your connector onboarding is awaiting verification and activation.',
  ACCESS_SUSPENDED: 'Your portal access has been suspended. Please contact your DSA administrator.',
  NOT_LINKED:
    'This portal login is not linked to an active connector. Please contact your DSA administrator.',
};

export interface Standing {
  state: PortalState;
  /** For the server log only: a code from the enum-like values in the database, never a name, a mobile or a token. */
  reason: string;
  userId: string;
  connectorId: string | null;
  branchId: string | null;
}

/**
 * The state of the caller's portal login, read on the server from the login and its connector, in this tenant only. ELIGIBLE needs an
 * ACTIVE partner login linked to an ACTIVE connector. An invitation does not activate a connector, and nothing in the portal can.
 */
export async function standing(tx: Tx, ctx: RequestContext): Promise<Standing> {
  const userId = ctx.principal.id;
  const refuse = (state: Exclude<PortalState, 'ELIGIBLE'>, reason: string): Standing => ({
    state,
    reason,
    userId,
    connectorId: null,
    branchId: null,
  });
  const r = await sql<Row>`
    select u.user_type, u.status as user_status, u.connector_id, c.status as connector_status, c.primary_branch_id
      from app_user u left join connector c on c.id = u.connector_id and c.tenant_id = u.tenant_id
     where u.id = ${userId}`.execute(tx);
  const row = r.rows[0];
  if (!row || row.user_type !== 'CONNECTOR') return refuse('NOT_LINKED', 'NOT_A_PARTNER_LOGIN');
  if (row.user_status === 'SUSPENDED') return refuse('ACCESS_SUSPENDED', 'LOGIN_SUSPENDED');
  if (row.user_status !== 'ACTIVE') return refuse('NOT_LINKED', `LOGIN_${String(row.user_status)}`);
  if (!row.connector_id || !row.connector_status) return refuse('NOT_LINKED', 'NO_CONNECTOR_LINK');
  const connectorStatus = String(row.connector_status);
  if (connectorStatus === 'ACTIVE') {
    return {
      state: 'ELIGIBLE',
      reason: 'OK',
      userId,
      connectorId: String(row.connector_id),
      branchId: String(row.primary_branch_id),
    };
  }
  if (connectorStatus === 'SUSPENDED' || connectorStatus === 'TERMINATED') {
    return refuse('ACCESS_SUSPENDED', `CONNECTOR_${connectorStatus}`);
  }
  return refuse('CONNECTOR_PENDING', `CONNECTOR_${connectorStatus}`);
}

export interface PortalMe {
  userId: string;
  connectorId: string;
  branchId: string;
}

/** The connector behind the caller; 403 for anyone else (staff use /v1). The refusal names the state, never the connector. */
export async function portalMe(tx: Tx, ctx: RequestContext): Promise<PortalMe> {
  const s = await standing(tx, ctx);
  if (s.state !== 'ELIGIBLE' || !s.connectorId || !s.branchId) {
    const state = s.state === 'ELIGIBLE' ? 'NOT_LINKED' : s.state;
    throw AppError.of('FORBIDDEN', PORTAL_STATE_MESSAGE[state], [{ issue: s.reason }]);
  }
  return { userId: s.userId, connectorId: s.connectorId, branchId: s.branchId };
}
