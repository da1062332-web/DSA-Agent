// apps/api/src/modules/origination/connectors/connector-service.ts
// Module 27: Connector Management (MOD-CON) — Service Implementation
import crypto from 'node:crypto';
import {
  AppError,
  maskAccountNumber,
  maskMobile,
  maskPan,
  type ActivateConnectorInput,
  type ApproveAttributionChangeRequestInput,
  type ApproveConnectorBankAccountInput,
  type AttributionChangeRequestResource,
  type AttributionDisputeResource,
  type ConnectorAgreementResource,
  type ConnectorBankAccountResource,
  type ConnectorLookupItem,
  type ConnectorLookupQuery,
  type ConnectorPortalAccessInput,
  type ConnectorPortalRevocationInput,
  type ConnectorPortalUser,
  type ConnectorResource,
  type CreateAttributionChangeRequestInput,
  type CreateConnectorAgreementInput,
  type CreateConnectorBankAccountInput,
  type CreateConnectorInput,
  type InviteConnectorUserInput,
  type ListConnectorsQuery,
  type RequestContext,
  type ResolveAttributionDisputeInput,
  type Tx,
  type UpdateConnectorInput,
  type UpdateConnectorStatusInput,
} from '@dsa/contracts';
import { withIdempotency } from '@dsa/kernel';
import { sql, type RawBuilder } from 'kysely';
import { monotonicFactory } from 'ulid';
import type { ApiDeps } from '../../types';
import { invitationExpiry, invitationState, resendRefusal, unboundSubject } from '../../platform/invitations';
import { assertMayBecomeActive } from '../../platform/user-lifecycle';

const nextUlid = monotonicFactory();

/** Holds connector.manage at any scope. Such a reader sees contact details in full; the connectors it may see are set by `visibility`. */
const managesConnectors = (ctx: RequestContext): boolean =>
  ctx.principal.grants.some((g) => g.code === 'connector.manage');

/**
 * The connectors this principal may see and change, as a SQL condition on app.connector (empty when it sees the whole tenant).
 *   - Tenant-wide: connector.manage at TENANT scope (tenant administration) and bank_change_approve at TENANT scope (the approvers).
 *   - Otherwise, the connectors it is the relationship owner of, plus the connectors of each branch it manages (connector.manage at
 *     BRANCH scope). A relationship manager (connector.read only) therefore sees only its own connectors.
 * Permission and scope decide it, not the name of the role. The owner clause is what a relationship manager is left with.
 */
function visibility(ctx: RequestContext): RawBuilder<unknown> {
  const grants = ctx.principal.grants;
  const tenantWide = grants.some(
    (g) =>
      (g.code === 'connector.manage' || g.code === 'connector.bank_change_approve') && g.scope === 'TENANT',
  );
  if (tenantWide) return sql``;
  const branchIds = [
    ...new Set(
      grants.filter((g) => g.code === 'connector.manage' && g.scope === 'BRANCH').flatMap((g) => g.branchIds),
    ),
  ];
  const conditions = [sql`relationship_owner_user_id = ${ctx.principal.id}`];
  if (branchIds.length > 0) conditions.push(sql`primary_branch_id = any(${branchIds}::text[])`);
  return sql`AND (${sql.join(conditions, sql` OR `)})`;
}

/** Another connector, outside what the principal may see, is reported as not found, as an invisible record is everywhere else. */
async function assertVisible(tx: Tx, ctx: RequestContext, id: string): Promise<void> {
  const found = await sql<{ id: string }>`
    SELECT id FROM app.connector
     WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${id} ${visibility(ctx)}`.execute(tx);
  if (found.rows.length === 0) throw AppError.of('NOT_FOUND', `Connector ${id} not found.`);
}

/**
 * Locks a portal login of this connector for a change. The user id comes from the path, so it must be a CONNECTOR login linked to this
 * connector in this tenant; anything else (a staff account, another connector's login) is not found.
 */
async function lockPortalUser(
  tx: Tx,
  ctx: RequestContext,
  connectorId: string,
  userId: string,
): Promise<{ id: string; status: string }> {
  const row = (
    await sql<{ id: string; status: string }>`
      SELECT id, status FROM app.app_user
       WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${userId} AND connector_id = ${connectorId} AND user_type = 'CONNECTOR'
       FOR UPDATE`.execute(tx)
  ).rows[0];
  if (!row) throw AppError.of('NOT_FOUND', 'Portal user not found.');
  return row;
}

/** The permissions that may read the picker list (id, legal name, status, branch). Not the directory: no PAN, mobile, e-mail or bank data. */
const LOOKUP_PERMISSIONS = [
  'connector.read',
  'connector.manage',
  'lead.create',
  'finance.view',
  'share.create',
];

/**
 * Contact details (mobile, e-mail) are shown in full only to whoever manages connectors. A relationship manager reads its own connectors'
 * contact details masked: it needs to recognise the partner, not to hold the partner's private contact data.
 */
const contactValue = (ctx: RequestContext, value: string, mask: (v: string) => string): string =>
  managesConnectors(ctx) ? value : mask(value);
const maskEmailAddress = (email: string): string => email.replace(/^(.).*(@.*)$/, '$1***$2');

/**
 * The write was made against a version the connector no longer has (someone else changed it since it was read). Refused, so no change
 * is lost; the caller reads it again and retries. The check is in the UPDATE itself, so two writers cannot both pass it.
 */
const versionConflict = (): AppError =>
  AppError.of(
    'VERSION_CONFLICT',
    'Precondition failed: the connector changed since it was read. Reload it and try again.',
    [{ field: 'If-Match', issue: 'VERSION_MISMATCH' }],
  );

/** Passes when the principal holds at least one of these codes, at any scope. */
function requireAnyGrant(ctx: RequestContext, codes: readonly string[]): void {
  if (ctx.principal.grants.some((g) => codes.includes(g.code))) return;
  throw AppError.of('FORBIDDEN', 'You do not have permission for this action.', [
    { issue: 'PERMISSION_MISSING', meta: { permission: codes.join(' or ') } },
  ]);
}

const HMAC_SECRET = process.env.HMAC_SECRET || 'dev_dsa_hmac_secret_key_32_bytes_long!!';
const ENCRYPTION_KEY = crypto
  .createHash('sha256')
  .update(process.env.ENCRYPTION_KEY || 'dev_dsa_encryption_key_32_bytes!')
  .digest();

function computeBlindIndex(tenantId: string, value: string): Buffer {
  return crypto.createHmac('sha256', `${HMAC_SECRET}:${tenantId}`).update(value).digest();
}

function encryptData(plaintext: string): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

/**
 * The relationship owner answers for a connector, so it must be an active internal staff account in the same tenant. A connector
 * portal login is never an owner (it would be on both sides of the relationship), and an invited, suspended or missing account is
 * refused. Existing connectors are not checked here: changing an owner is a business decision, not a side effect of saving.
 */
export function assertInternalRelationshipOwner(
  owner: { user_type: string; status: string } | undefined,
): void {
  if (!owner) {
    throw AppError.of('VALIDATION_ERROR', 'The relationship owner was not found in this organization.', [
      { field: 'relationshipOwnerUserId', issue: 'NOT_FOUND' },
    ]);
  }
  if (owner.user_type !== 'STAFF') {
    throw AppError.of(
      'VALIDATION_ERROR',
      'The relationship owner must be an internal staff member, not a connector login.',
      [{ field: 'relationshipOwnerUserId', issue: 'NOT_INTERNAL_STAFF' }],
    );
  }
  if (owner.status !== 'ACTIVE') {
    throw AppError.of('VALIDATION_ERROR', 'The relationship owner must be an active staff member.', [
      { field: 'relationshipOwnerUserId', issue: 'OWNER_NOT_ACTIVE' },
    ]);
  }
}

export class ConnectorService {
  constructor(private readonly deps: ApiDeps) {}

  // =========================================================================
  // SUB-CON.01: Onboarding, Retrieval, Update, Activation & Bank Accounts
  // =========================================================================

  /**
   * API-CON-001: POST /v1/connectors
   */
  async createConnector(
    ctx: RequestContext,
    input: CreateConnectorInput,
    idempotencyKey: string,
  ): Promise<{ connector: ConnectorResource; isReplayed?: boolean }> {
    this.deps.authz.requirePermission(ctx, 'connector.manage');

    const cleanPan = input.pan.trim().toUpperCase();
    const cleanMobile = input.mobileE164.trim();
    const cleanEmail = input.email.trim().toLowerCase();

    const panHash = computeBlindIndex(ctx.principal.tenantId, cleanPan);
    const mobileHash = computeBlindIndex(ctx.principal.tenantId, cleanMobile);
    const emailHash = computeBlindIndex(ctx.principal.tenantId, cleanEmail);

    const encryptedPan = encryptData(cleanPan);
    const panMasked = maskPan(cleanPan);

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const result = await withIdempotency(
        tx,
        ctx,
        {
          key: idempotencyKey,
          method: 'POST',
          path: '/v1/connectors',
          body: input,
        },
        async () => {
          // Check uniqueness of pan_hash in this tenant
          const existingPan = await sql<{ id: string }>`
            SELECT id FROM app.connector
            WHERE tenant_id = ${ctx.principal.tenantId} AND pan_hash = ${panHash}
          `.execute(tx);

          if (existingPan.rows.length > 0) {
            throw AppError.of(
              'VALIDATION_ERROR',
              'A connector with this PAN already exists in this organization.',
              [{ field: 'pan', issue: 'DUPLICATE_PAN' }],
            );
          }

          // Verify branch exists
          const branchCheck = await sql<{ id: string }>`
            SELECT id FROM app.branch
            WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${input.primaryBranchId}
          `.execute(tx);

          if (branchCheck.rows.length === 0) {
            throw AppError.of('VALIDATION_ERROR', 'Specified primary branch does not exist.', [
              { field: 'primaryBranchId', issue: 'INVALID_BRANCH' },
            ]);
          }

          const ownerRes = await sql<{ user_type: string; status: string }>`
            SELECT user_type, status FROM app.app_user
            WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${input.relationshipOwnerUserId}
          `.execute(tx);
          assertInternalRelationshipOwner(ownerRes.rows[0]);

          const connectorId = `con_${nextUlid()}`;
          const now = new Date();

          await sql`
            INSERT INTO app.connector (
              id, tenant_id, connector_type, legal_name, contact_person,
              mobile_e164, mobile_hash, email, email_hash,
              encrypted_pan, pan_hash, pan_masked, gstin,
              primary_branch_id, relationship_owner_user_id, status,
              lock_version, created_at, created_by, updated_at, updated_by
            ) VALUES (
              ${connectorId}, ${ctx.principal.tenantId}, ${input.connectorType},
              ${input.legalName.trim()}, ${input.contactPerson.trim()},
              ${cleanMobile}, ${mobileHash}, ${cleanEmail}, ${emailHash},
              ${encryptedPan}, ${panHash}, ${panMasked}, ${input.gstin ?? null},
              ${input.primaryBranchId}, ${input.relationshipOwnerUserId}, 'DRAFT',
              0, ${now}, ${ctx.principal.id}, ${now}, ${ctx.principal.id}
            )
          `.execute(tx);

          await this.deps.audit.record(tx, ctx, {
            action: 'connector.created',
            entityType: 'connector',
            entityId: connectorId,
            after: {
              connectorType: input.connectorType,
              legalName: input.legalName,
              primaryBranchId: input.primaryBranchId,
              panMasked,
            },
          });

          const created: ConnectorResource = {
            id: connectorId,
            tenantId: ctx.principal.tenantId,
            connectorType: input.connectorType,
            legalName: input.legalName.trim(),
            contactPerson: input.contactPerson.trim(),
            mobileE164: cleanMobile,
            email: cleanEmail,
            panMasked,
            gstin: input.gstin ?? null,
            primaryBranchId: input.primaryBranchId,
            relationshipOwnerUserId: input.relationshipOwnerUserId,
            status: 'DRAFT',
            lockVersion: 0,
            createdAt: now.toISOString(),
            createdBy: ctx.principal.id,
            updatedAt: now.toISOString(),
            updatedBy: ctx.principal.id,
          };

          return { status: 201, body: created };
        },
      );

      return {
        connector: result.body as ConnectorResource,
        isReplayed: result.replayed,
      };
    });
  }

  /**
   * API-CON-002: GET /v1/connectors
   */
  async listConnectors(
    ctx: RequestContext,
    query: ListConnectorsQuery,
  ): Promise<{ items: ConnectorResource[]; nextCursor?: string }> {
    this.deps.authz.requirePermission(ctx, 'connector.read');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      let qb = sql<{
        id: string;
        tenant_id: string;
        connector_type: string;
        legal_name: string;
        contact_person: string;
        mobile_e164: string;
        email: string;
        pan_masked: string;
        gstin: string | null;
        primary_branch_id: string;
        relationship_owner_user_id: string;
        status: string;
        lock_version: number;
        created_at: Date;
        created_by: string;
        updated_at: Date;
        updated_by: string;
      }>`
        SELECT 
          id, tenant_id, connector_type, legal_name, contact_person,
          mobile_e164, email, pan_masked, gstin,
          primary_branch_id, relationship_owner_user_id, status,
          lock_version, created_at, created_by, updated_at, updated_by
        FROM app.connector
        WHERE tenant_id = ${ctx.principal.tenantId}
      `;

      qb = sql`${qb} ${visibility(ctx)}`;
      if (query.status) {
        qb = sql`${qb} AND status = ${query.status}`;
      }
      if (query.branchId) {
        qb = sql`${qb} AND primary_branch_id = ${query.branchId}`;
      }
      if (query.connectorType) {
        qb = sql`${qb} AND connector_type = ${query.connectorType}`;
      }
      if (query.q) {
        const search = `%${query.q.trim()}%`;
        qb = sql`${qb} AND (legal_name ILIKE ${search} OR contact_person ILIKE ${search} OR email ILIKE ${search})`;
      }

      if (query.cursor) {
        try {
          const decoded = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'));
          qb = sql`${qb} AND (created_at, id) < (${new Date(decoded.k)}, ${decoded.id})`;
        } catch {
          // ignore invalid cursor
        }
      }

      qb = sql`${qb} ORDER BY created_at DESC, id DESC LIMIT ${query.limit + 1}`;

      const res = await qb.execute(tx);
      const rows = res.rows;
      const hasMore = rows.length > query.limit;
      const sliced = hasMore ? rows.slice(0, query.limit) : rows;

      let nextCursor: string | undefined;
      if (hasMore && sliced.length > 0) {
        const last = sliced[sliced.length - 1]!;
        nextCursor = Buffer.from(JSON.stringify({ k: last.created_at.toISOString(), id: last.id })).toString(
          'base64url',
        );
      }

      const items: ConnectorResource[] = sliced.map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        connectorType: r.connector_type as any,
        legalName: r.legal_name,
        contactPerson: r.contact_person,
        mobileE164: contactValue(ctx, r.mobile_e164, (v) => maskMobile(v) ?? ''),
        email: contactValue(ctx, r.email, maskEmailAddress),
        panMasked: r.pan_masked,
        gstin: r.gstin,
        primaryBranchId: r.primary_branch_id,
        relationshipOwnerUserId: r.relationship_owner_user_id,
        status: r.status as any,
        lockVersion: r.lock_version,
        createdAt: r.created_at.toISOString(),
        createdBy: r.created_by,
        updatedAt: r.updated_at.toISOString(),
        updatedBy: r.updated_by,
      }));

      return { items, nextCursor };
    });
  }

  /**
   * GET /v1/connectors/lookup: id, legal name, status and branch only, for pickers. Anyone with a permission in LOOKUP_PERMISSIONS
   * may use it. It answers for the whole tenant on purpose: a lead can name any partner of the tenant. Nothing sensitive is returned.
   */
  async lookupConnectors(
    ctx: RequestContext,
    query: ConnectorLookupQuery,
  ): Promise<{ items: ConnectorLookupItem[] }> {
    requireAnyGrant(ctx, LOOKUP_PERMISSIONS);

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const search = query.q ? `%${query.q}%` : null;
      const res = await sql<{ id: string; legal_name: string; status: string; primary_branch_id: string }>`
        SELECT id, legal_name, status, primary_branch_id
          FROM app.connector
         WHERE tenant_id = ${ctx.principal.tenantId}
           AND (${query.status ?? null}::text IS NULL OR status = ${query.status ?? null})
           AND (${search}::text IS NULL OR legal_name ILIKE ${search})
         ORDER BY legal_name, id
         LIMIT 200`.execute(tx);
      return {
        items: res.rows.map((r) => ({
          id: r.id,
          legalName: r.legal_name,
          status: r.status,
          primaryBranchId: r.primary_branch_id,
        })),
      };
    });
  }

  /**
   * GET /v1/connectors/{id}
   */
  async getConnector(ctx: RequestContext, id: string): Promise<ConnectorResource> {
    this.deps.authz.requirePermission(ctx, 'connector.read');

    return this.deps.txRunner.withTenantTx(ctx, (tx) => this.readConnector(tx, ctx, id));
  }

  /**
   * The connector as this transaction sees it. A write answers with this, read inside its own transaction: a read through a second
   * transaction would not see the write, and would answer with the state from before it.
   */
  private async readConnector(
    tx: Tx,
    ctx: RequestContext,
    id: string,
    scoped = true,
  ): Promise<ConnectorResource> {
    const res = await sql<{
      id: string;
      tenant_id: string;
      connector_type: string;
      legal_name: string;
      contact_person: string;
      mobile_e164: string;
      email: string;
      pan_masked: string;
      gstin: string | null;
      primary_branch_id: string;
      relationship_owner_user_id: string;
      status: string;
      lock_version: number;
      created_at: Date;
      created_by: string;
      updated_at: Date;
      updated_by: string;
    }>`
        SELECT 
          id, tenant_id, connector_type, legal_name, contact_person,
          mobile_e164, email, pan_masked, gstin,
          primary_branch_id, relationship_owner_user_id, status,
          lock_version, created_at, created_by, updated_at, updated_by
        FROM app.connector
        WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${id}
          ${scoped ? visibility(ctx) : sql``}
      `.execute(tx);

    // A connector outside what the principal may see is reported as not found, as an invisible record is everywhere else.
    if (res.rows.length === 0) {
      throw AppError.of('NOT_FOUND', `Connector ${id} not found.`);
    }

    const r = res.rows[0]!;
    return {
      id: r.id,
      tenantId: r.tenant_id,
      connectorType: r.connector_type as any,
      legalName: r.legal_name,
      contactPerson: r.contact_person,
      mobileE164: contactValue(ctx, r.mobile_e164, (v) => maskMobile(v) ?? ''),
      email: contactValue(ctx, r.email, maskEmailAddress),
      panMasked: r.pan_masked,
      gstin: r.gstin,
      primaryBranchId: r.primary_branch_id,
      relationshipOwnerUserId: r.relationship_owner_user_id,
      status: r.status as any,
      lockVersion: r.lock_version,
      createdAt: r.created_at.toISOString(),
      createdBy: r.created_by,
      updatedAt: r.updated_at.toISOString(),
      updatedBy: r.updated_by,
    };
  }

  /**
   * API-CON-003: PATCH /v1/connectors/{id}
   */
  async updateConnector(
    ctx: RequestContext,
    id: string,
    input: UpdateConnectorInput,
    ifMatchVersion: number,
  ): Promise<ConnectorResource> {
    this.deps.authz.requirePermission(ctx, 'connector.manage');

    await this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const current = await this.readConnector(tx, ctx, id);

      if (current.lockVersion !== ifMatchVersion) {
        throw AppError.of(
          'VERSION_CONFLICT',
          `Conflict: Connector has version ${current.lockVersion}, but client provided ${ifMatchVersion}.`,
          [{ field: 'If-Match', issue: 'VERSION_MISMATCH' }],
        );
      }

      // Changing the relationship manager is a business decision: it needs a reason, and it is audited on its own below.
      const ownerChanged =
        input.relationshipOwnerUserId !== undefined &&
        input.relationshipOwnerUserId !== current.relationshipOwnerUserId;
      if (ownerChanged && !input.ownerChangeReason) {
        throw AppError.of('VALIDATION_ERROR', 'Give the reason for changing the relationship manager.', [
          { field: 'ownerChangeReason', issue: 'REASON_REQUIRED' },
        ]);
      }

      if (input.relationshipOwnerUserId) {
        const ownerRes = await sql<{ user_type: string; status: string }>`
          SELECT user_type, status FROM app.app_user
          WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${input.relationshipOwnerUserId}
        `.execute(tx);
        assertInternalRelationshipOwner(ownerRes.rows[0]);
      }

      const now = new Date();
      const written = await sql`
        UPDATE app.connector
        SET
          legal_name = COALESCE(${input.legalName ?? null}, legal_name),
          contact_person = COALESCE(${input.contactPerson ?? null}, contact_person),
          mobile_e164 = COALESCE(${input.mobileE164 ?? null}, mobile_e164),
          email = COALESCE(${input.email ?? null}, email),
          gstin = CASE WHEN ${input.gstin !== undefined} THEN ${input.gstin} ELSE gstin END,
          primary_branch_id = COALESCE(${input.primaryBranchId ?? null}, primary_branch_id),
          relationship_owner_user_id = COALESCE(${input.relationshipOwnerUserId ?? null}, relationship_owner_user_id),
          updated_at = ${now},
          updated_by = ${ctx.principal.id}
        WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${id} AND lock_version = ${ifMatchVersion}
        RETURNING id
      `.execute(tx);
      if (written.rows.length === 0) throw versionConflict();

      await this.deps.audit.record(tx, ctx, {
        action: 'connector.updated',
        entityType: 'connector',
        entityId: id,
        after: input,
      });
      if (ownerChanged) {
        await this.deps.audit.record(tx, ctx, {
          action: 'connector.owner_changed',
          entityType: 'connector',
          entityId: id,
          before: { relationshipOwnerUserId: current.relationshipOwnerUserId },
          after: { relationshipOwnerUserId: input.relationshipOwnerUserId, reason: input.ownerChangeReason },
        });
      }
    });

    // Read after the commit: a read inside the transaction does not see the change it just made, so it would return the old owner. The
    // write was authorised before it was made, so the answer is not narrowed to what the principal could see before the change.
    return this.deps.txRunner.withTenantTx(ctx, (tx) => this.readConnector(tx, ctx, id, false));
  }

  /**
   * API-CON-005: POST /v1/connectors/{id}/activation
   */
  async activateConnector(
    ctx: RequestContext,
    id: string,
    input: ActivateConnectorInput,
    ifMatchVersion: number,
    idempotencyKey: string,
  ): Promise<{ connector: ConnectorResource; isReplayed?: boolean }> {
    this.deps.authz.requirePermission(ctx, 'connector.manage');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const result = await withIdempotency(
        tx,
        ctx,
        {
          key: idempotencyKey,
          method: 'POST',
          path: `/v1/connectors/${id}/activation`,
          body: input,
        },
        async () => {
          const current = await this.readConnector(tx, ctx, id);

          if (current.lockVersion !== ifMatchVersion) {
            throw AppError.of('VERSION_CONFLICT', 'Precondition failed: ETag does not match lock version.', [
              { field: 'If-Match', issue: 'VERSION_MISMATCH' },
            ]);
          }

          if (current.status === 'ACTIVE') {
            return { status: 200, body: current };
          }

          if (current.status === 'TERMINATED') {
            throw AppError.of('VALIDATION_ERROR', 'Terminated connectors cannot be activated.');
          }

          // Verify linked verification record in app.verification (ENT-064)
          const verRes = await sql<{ id: string; result: string }>`
            SELECT id, result FROM app.verification
            WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${input.verificationId}
          `.execute(tx);

          if (verRes.rows.length === 0) {
            throw AppError.of('VALIDATION_ERROR', 'Referenced verification record does not exist.', [
              { field: 'verificationId', issue: 'NOT_FOUND' },
            ]);
          }

          const verRow = verRes.rows[0]!;
          if (verRow.result !== 'VERIFIED') {
            throw AppError.of(
              'VALIDATION_ERROR',
              `Connector activation requires a VERIFIED check. Verification ${input.verificationId} has result ${verRow.result}.`,
              [{ field: 'verificationId', issue: 'NOT_VERIFIED' }],
            );
          }

          const now = new Date();
          const activated = await sql`
            UPDATE app.connector
            SET status = 'ACTIVE', updated_at = ${now}, updated_by = ${ctx.principal.id}
            WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${id} AND lock_version = ${ifMatchVersion}
            RETURNING id
          `.execute(tx);
          if (activated.rows.length === 0) throw versionConflict();

          await this.deps.audit.record(tx, ctx, {
            action: 'connector.activated',
            entityType: 'connector',
            entityId: id,
            after: { verificationId: input.verificationId, remarks: input.remarks },
          });

          const updated = await this.readConnector(tx, ctx, id, false);
          return { status: 200, body: updated };
        },
      );

      return {
        connector: result.body as ConnectorResource,
        isReplayed: result.replayed,
      };
    });
  }

  /**
   * API-CON-006: POST /v1/connectors/{id}/status
   */
  async updateConnectorStatus(
    ctx: RequestContext,
    id: string,
    input: UpdateConnectorStatusInput,
    ifMatchVersion: number,
    idempotencyKey: string,
  ): Promise<{ connector: ConnectorResource; isReplayed?: boolean }> {
    this.deps.authz.requirePermission(ctx, 'connector.manage');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const result = await withIdempotency(
        tx,
        ctx,
        {
          key: idempotencyKey,
          method: 'POST',
          path: `/v1/connectors/${id}/status`,
          body: input,
        },
        async () => {
          const current = await this.readConnector(tx, ctx, id);

          if (current.lockVersion !== ifMatchVersion) {
            throw AppError.of('VERSION_CONFLICT', 'Precondition failed: ETag does not match lock version.', [
              { field: 'If-Match', issue: 'VERSION_MISMATCH' },
            ]);
          }

          if (current.status === 'TERMINATED') {
            throw AppError.of(
              'VALIDATION_ERROR',
              'Connector is in terminal TERMINATED state and cannot undergo transitions.',
            );
          }

          const now = new Date();
          const changed = await sql`
            UPDATE app.connector
            SET status = ${input.targetStatus}, updated_at = ${now}, updated_by = ${ctx.principal.id}
            WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${id} AND lock_version = ${ifMatchVersion}
            RETURNING id
          `.execute(tx);
          if (changed.rows.length === 0) throw versionConflict();

          // If transitioning to SUSPENDED or TERMINATED, revoke portal access for linked users
          if (input.targetStatus === 'SUSPENDED' || input.targetStatus === 'TERMINATED') {
            await sql`
              UPDATE app.app_user
              SET status = 'SUSPENDED', updated_at = ${now}, updated_by = ${ctx.principal.id}
              WHERE tenant_id = ${ctx.principal.tenantId} AND connector_id = ${id}
            `.execute(tx);
          }

          await this.deps.audit.record(tx, ctx, {
            action: 'connector.status_changed',
            entityType: 'connector',
            entityId: id,
            after: {
              previousStatus: current.status,
              newStatus: input.targetStatus,
              reason: input.reason,
            },
          });

          const updated = await this.readConnector(tx, ctx, id, false);
          return { status: 200, body: updated };
        },
      );

      return {
        connector: result.body as ConnectorResource,
        isReplayed: result.replayed,
      };
    });
  }

  /**
   * API-CON-007: POST /v1/connectors/{id}/bank-accounts
   */
  async createBankAccount(
    ctx: RequestContext,
    connectorId: string,
    input: CreateConnectorBankAccountInput,
    idempotencyKey: string,
  ): Promise<{ bankAccount: ConnectorBankAccountResource; isReplayed?: boolean }> {
    this.deps.authz.requirePermission(ctx, 'connector.manage');

    const cleanAcc = input.accountNumber.trim();
    const cleanIfsc = input.ifscCode.trim().toUpperCase();
    const accHash = computeBlindIndex(ctx.principal.tenantId, cleanAcc);
    const encryptedAcc = encryptData(cleanAcc);
    const accountMasked = maskAccountNumber(cleanAcc);

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const result = await withIdempotency(
        tx,
        ctx,
        {
          key: idempotencyKey,
          method: 'POST',
          path: `/v1/connectors/${connectorId}/bank-accounts`,
          body: input,
        },
        async () => {
          // Verify connector exists
          await this.getConnector(ctx, connectorId);

          const bankAccountId = `cba_${nextUlid()}`;
          const now = new Date();

          await sql`
            INSERT INTO app.connector_bank_account (
              id, tenant_id, connector_id, account_holder_name,
              encrypted_account_number, account_hash, account_masked,
              ifsc_code, verification_id, status, lock_version,
              created_at, created_by, updated_at, updated_by
            ) VALUES (
              ${bankAccountId}, ${ctx.principal.tenantId}, ${connectorId},
              ${input.accountHolderName.trim()}, ${encryptedAcc}, ${accHash},
              ${accountMasked}, ${cleanIfsc}, ${input.verificationId ?? null},
              'PENDING_APPROVAL', 0, ${now}, ${ctx.principal.id}, ${now}, ${ctx.principal.id}
            )
          `.execute(tx);

          await this.deps.audit.record(tx, ctx, {
            action: 'connector.bank_account_created',
            entityType: 'connector_bank_account',
            entityId: bankAccountId,
            after: {
              connectorId,
              accountHolderName: input.accountHolderName,
              ifscCode: cleanIfsc,
              accountMasked,
            },
          });

          const created: ConnectorBankAccountResource = {
            id: bankAccountId,
            tenantId: ctx.principal.tenantId,
            connectorId,
            accountHolderName: input.accountHolderName.trim(),
            accountMasked,
            ifscCode: cleanIfsc,
            verificationId: input.verificationId ?? null,
            status: 'PENDING_APPROVAL',
            coolingUntil: null,
            lockVersion: 0,
            createdAt: now.toISOString(),
            createdBy: ctx.principal.id,
            approvedAt: null,
            approvedBy: null,
            updatedAt: now.toISOString(),
            updatedBy: ctx.principal.id,
          };

          return { status: 201, body: created };
        },
      );

      return {
        bankAccount: result.body as ConnectorBankAccountResource,
        isReplayed: result.replayed,
      };
    });
  }

  /**
   * Approval for Bank Account (Dual Control SOD)
   */
  async approveBankAccount(
    ctx: RequestContext,
    connectorId: string,
    accountId: string,
    input: ApproveConnectorBankAccountInput,
  ): Promise<ConnectorBankAccountResource> {
    this.deps.authz.requirePermission(ctx, 'connector.bank_change_approve');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const res = await sql<{
        id: string;
        tenant_id: string;
        connector_id: string;
        account_holder_name: string;
        account_masked: string;
        ifsc_code: string;
        verification_id: string | null;
        status: string;
        created_by: string;
        lock_version: number;
        created_at: Date;
      }>`
        SELECT id, tenant_id, connector_id, account_holder_name, account_masked,
               ifsc_code, verification_id, status, created_by, lock_version, created_at
        FROM app.connector_bank_account
        WHERE tenant_id = ${ctx.principal.tenantId} AND connector_id = ${connectorId} AND id = ${accountId}
      `.execute(tx);

      if (res.rows.length === 0) {
        throw AppError.of('NOT_FOUND', `Bank account ${accountId} not found.`);
      }

      const account = res.rows[0]!;

      if (account.status !== 'PENDING_APPROVAL') {
        throw AppError.of('VALIDATION_ERROR', `Bank account is not in PENDING_APPROVAL status.`);
      }

      // SOD Enforcement: Creator cannot approve their own bank account change
      if (account.created_by === ctx.principal.id) {
        throw AppError.of(
          'SOD_VIOLATION',
          'Separation of Duties (SOD): You cannot approve a bank account change you created.',
          [{ field: 'approvedBy', issue: 'SOD_SELF_APPROVAL_PROHIBITED' }],
        );
      }

      const now = new Date();
      const coolingUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24-hour cooling period

      // 1. Disable existing active accounts for this connector
      await sql`
        UPDATE app.connector_bank_account
        SET status = 'DISABLED', updated_at = ${now}, updated_by = ${ctx.principal.id}
        WHERE tenant_id = ${ctx.principal.tenantId} AND connector_id = ${connectorId} AND status = 'ACTIVE'
      `.execute(tx);

      // 2. Activate the new account
      await sql`
        UPDATE app.connector_bank_account
        SET status = 'ACTIVE',
            approved_at = ${now},
            approved_by = ${ctx.principal.id},
            cooling_until = ${coolingUntil},
            updated_at = ${now},
            updated_by = ${ctx.principal.id}
        WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${accountId}
      `.execute(tx);

      await this.deps.audit.record(tx, ctx, {
        action: 'connector.bank_account_approved',
        entityType: 'connector_bank_account',
        entityId: accountId,
        after: {
          connectorId,
          approvedBy: ctx.principal.id,
          coolingUntil: coolingUntil.toISOString(),
          remarks: input.remarks,
        },
      });

      return {
        id: account.id,
        tenantId: account.tenant_id,
        connectorId: account.connector_id,
        accountHolderName: account.account_holder_name,
        accountMasked: account.account_masked,
        ifscCode: account.ifsc_code,
        verificationId: account.verification_id,
        status: 'ACTIVE',
        coolingUntil: coolingUntil.toISOString(),
        lockVersion: account.lock_version + 1,
        createdAt: account.created_at.toISOString(),
        createdBy: account.created_by,
        approvedAt: now.toISOString(),
        approvedBy: ctx.principal.id,
        updatedAt: now.toISOString(),
        updatedBy: ctx.principal.id,
      };
    });
  }

  /**
   * List bank accounts for connector
   */
  async listBankAccounts(ctx: RequestContext, connectorId: string): Promise<ConnectorBankAccountResource[]> {
    // Bank details are read by the people who manage or approve them, not by everyone who can read the directory.
    requireAnyGrant(ctx, ['connector.manage', 'connector.bank_change_approve']);

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      await assertVisible(tx, ctx, connectorId);
      const res = await sql<{
        id: string;
        tenant_id: string;
        connector_id: string;
        account_holder_name: string;
        account_masked: string;
        ifsc_code: string;
        verification_id: string | null;
        status: string;
        cooling_until: Date | null;
        lock_version: number;
        created_at: Date;
        created_by: string;
        approved_at: Date | null;
        approved_by: string | null;
        updated_at: Date;
        updated_by: string;
      }>`
        SELECT id, tenant_id, connector_id, account_holder_name, account_masked,
               ifsc_code, verification_id, status, cooling_until, lock_version,
               created_at, created_by, approved_at, approved_by, updated_at, updated_by
        FROM app.connector_bank_account
        WHERE tenant_id = ${ctx.principal.tenantId} AND connector_id = ${connectorId}
        ORDER BY created_at DESC
      `.execute(tx);

      return res.rows.map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        connectorId: r.connector_id,
        accountHolderName: r.account_holder_name,
        accountMasked: r.account_masked,
        ifscCode: r.ifsc_code,
        verificationId: r.verification_id,
        status: r.status as any,
        coolingUntil: r.cooling_until ? r.cooling_until.toISOString() : null,
        lockVersion: r.lock_version,
        createdAt: r.created_at.toISOString(),
        createdBy: r.created_by,
        approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
        approvedBy: r.approved_by,
        updatedAt: r.updated_at.toISOString(),
        updatedBy: r.updated_by,
      }));
    });
  }

  // =========================================================================
  // SUB-CON.02: Agreements and Rate Cards
  // =========================================================================

  /**
   * API-CON-004: POST /v1/connectors/{id}/agreements
   */
  async createAgreement(
    ctx: RequestContext,
    connectorId: string,
    input: CreateConnectorAgreementInput,
    idempotencyKey: string,
  ): Promise<{ agreement: ConnectorAgreementResource; isReplayed?: boolean }> {
    this.deps.authz.requirePermission(ctx, 'connector.manage');

    const validFrom = new Date(input.validFrom);
    const validTo = new Date(input.validTo);

    if (validTo <= validFrom) {
      throw AppError.of('VALIDATION_ERROR', 'Agreement validTo must be after validFrom.', [
        { field: 'validTo', issue: 'INVALID_RANGE' },
      ]);
    }

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const result = await withIdempotency(
        tx,
        ctx,
        {
          key: idempotencyKey,
          method: 'POST',
          path: `/v1/connectors/${connectorId}/agreements`,
          body: input,
        },
        async () => {
          await this.getConnector(ctx, connectorId);

          // Check overlapping active agreements
          const overlap = await sql<{ id: string }>`
            SELECT id FROM app.connector_agreement
            WHERE tenant_id = ${ctx.principal.tenantId}
              AND connector_id = ${connectorId}
              AND status = 'ACTIVE'
              AND (valid_from, valid_to) OVERLAPS (${validFrom}, ${validTo})
          `.execute(tx);

          if (overlap.rows.length > 0) {
            throw AppError.of(
              'EFFECTIVE_OVERLAP',
              'An active agreement already exists with an overlapping validity range for this connector.',
              [{ field: 'validFrom', issue: 'OVERLAPPING_VALIDITY_RANGE' }],
            );
          }

          const agreementId = `cag_${nextUlid()}`;
          const now = new Date();

          await sql`
            INSERT INTO app.connector_agreement (
              id, tenant_id, connector_id, version,
              valid_from, valid_to, permitted_products,
              share_rule_scope, evidence_ref, status,
              lock_version, created_at, created_by, updated_at, updated_by
            ) VALUES (
              ${agreementId}, ${ctx.principal.tenantId}, ${connectorId}, 1,
              ${validFrom}, ${validTo}, ${input.permittedProducts},
              ${input.shareRuleScope}, ${input.evidenceRef}, 'ACTIVE',
              0, ${now}, ${ctx.principal.id}, ${now}, ${ctx.principal.id}
            )
          `.execute(tx);

          await this.deps.audit.record(tx, ctx, {
            action: 'connector.agreement_created',
            entityType: 'connector_agreement',
            entityId: agreementId,
            after: {
              connectorId,
              validFrom: input.validFrom,
              validTo: input.validTo,
              permittedProducts: input.permittedProducts,
              shareRuleScope: input.shareRuleScope,
            },
          });

          const created: ConnectorAgreementResource = {
            id: agreementId,
            tenantId: ctx.principal.tenantId,
            connectorId,
            version: 1,
            validFrom: validFrom.toISOString(),
            validTo: validTo.toISOString(),
            permittedProducts: input.permittedProducts,
            shareRuleScope: input.shareRuleScope,
            evidenceRef: input.evidenceRef,
            status: 'ACTIVE',
            lockVersion: 0,
            createdAt: now.toISOString(),
            createdBy: ctx.principal.id,
            updatedAt: now.toISOString(),
            updatedBy: ctx.principal.id,
          };

          return { status: 201, body: created };
        },
      );

      return {
        agreement: result.body as ConnectorAgreementResource,
        isReplayed: result.replayed,
      };
    });
  }

  /**
   * List agreements for connector
   */
  async listAgreements(ctx: RequestContext, connectorId: string): Promise<ConnectorAgreementResource[]> {
    // Agreement terms (commission share, evidence references) are managed by tenant administration only.
    this.deps.authz.requirePermission(ctx, 'connector.manage');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      await assertVisible(tx, ctx, connectorId);
      const res = await sql<{
        id: string;
        tenant_id: string;
        connector_id: string;
        version: number;
        valid_from: Date;
        valid_to: Date;
        permitted_products: string[];
        share_rule_scope: string;
        evidence_ref: string;
        status: string;
        lock_version: number;
        created_at: Date;
        created_by: string;
        updated_at: Date;
        updated_by: string;
      }>`
        SELECT id, tenant_id, connector_id, version, valid_from, valid_to,
               permitted_products, share_rule_scope, evidence_ref, status,
               lock_version, created_at, created_by, updated_at, updated_by
        FROM app.connector_agreement
        WHERE tenant_id = ${ctx.principal.tenantId} AND connector_id = ${connectorId}
        ORDER BY valid_from DESC
      `.execute(tx);

      return res.rows.map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        connectorId: r.connector_id,
        version: r.version,
        validFrom: r.valid_from.toISOString(),
        validTo: r.valid_to.toISOString(),
        permittedProducts: r.permitted_products,
        shareRuleScope: r.share_rule_scope,
        evidenceRef: r.evidence_ref,
        status: r.status as any,
        lockVersion: r.lock_version,
        createdAt: r.created_at.toISOString(),
        createdBy: r.created_by,
        updatedAt: r.updated_at.toISOString(),
        updatedBy: r.updated_by,
      }));
    });
  }

  // =========================================================================
  // SUB-CON.01: Portal User Invitations
  // =========================================================================

  /**
   * API-CON-011: POST /v1/connectors/{id}/users. Invites a portal login for the connector through the same pipeline as a staff invitation:
   * the login is created INVITED with the placeholder subject no token can carry, and one PENDING invitation is QUEUED for the
   * provisioning worker. The worker creates or finds the Supabase Auth account, binds its real subject and sends the e-mail; the login
   * becomes ACTIVE only on the invitee's first password sign-in (principal resolver). No role is assigned: portal access comes from the
   * login's identity and its connector. Idempotent on the Idempotency-Key, so a retried request never creates a second login.
   */
  async inviteConnectorUser(
    ctx: RequestContext,
    connectorId: string,
    input: InviteConnectorUserInput,
    idempotencyKey: string,
  ): Promise<{ user: ConnectorPortalUser; isReplayed?: boolean }> {
    this.deps.authz.requirePermission(ctx, 'connector.manage');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const result = await withIdempotency(
        tx,
        ctx,
        { key: idempotencyKey, method: 'POST', path: `/v1/connectors/${connectorId}/users`, body: input },
        async () => {
          const connector = await this.readConnector(tx, ctx, connectorId);
          // A login can be prepared while the connector is being onboarded; the portal itself opens only once the connector is ACTIVE.
          if (connector.status === 'SUSPENDED' || connector.status === 'TERMINATED') {
            throw AppError.of(
              'INVALID_STATE',
              `Portal users cannot be invited for a ${connector.status.toLowerCase()} connector.`,
            );
          }

          const email = input.email.trim().toLowerCase();
          const taken = await sql<{ id: string }>`
            SELECT id FROM app.app_user WHERE tenant_id = ${ctx.principal.tenantId} AND lower(email::text) = ${email}`.execute(
            tx,
          );
          if (taken.rows.length > 0) {
            throw AppError.of(
              'VALIDATION_ERROR',
              'A user with this email address already exists in this organization.',
              [{ field: 'email', issue: 'DUPLICATE_EMAIL' }],
            );
          }

          const userId = this.deps.ids.next('usr');
          await sql`
            INSERT INTO app.app_user (id, tenant_id, idp_subject, email, mobile_e164, display_name, user_type, status, availability,
                                      primary_branch_id, connector_id, created_by, updated_by)
            VALUES (${userId}, ${ctx.principal.tenantId}, ${unboundSubject(userId)}, ${email}, ${input.mobileE164 ?? null},
                    ${input.displayName.trim()}, 'CONNECTOR', 'INVITED', 'OFF_DUTY', ${connector.primaryBranchId}, ${connectorId},
                    ${ctx.principal.id}, ${ctx.principal.id})`.execute(tx);
          // One PENDING invitation, QUEUED for the provisioning worker; it cannot activate anyone until the worker marks it SENT.
          const invitationId = this.deps.ids.next('inv');
          await sql`
            INSERT INTO app.staff_invitation (id, tenant_id, user_id, status, delivery_state, requested_at, next_attempt_at, sent_at,
                                              expires_at, created_by, updated_by)
            VALUES (${invitationId}, ${ctx.principal.tenantId}, ${userId}, 'PENDING', 'QUEUED', ${ctx.now}::timestamptz,
                    ${ctx.now}::timestamptz, ${ctx.now}::timestamptz, ${invitationExpiry(ctx.now)}::timestamptz,
                    ${ctx.principal.id}, ${ctx.principal.id})`.execute(tx);
          await this.deps.audit.record(tx, ctx, {
            action: 'connector.portal_user_invited',
            entityType: 'USER',
            entityId: userId,
            after: { connectorId, status: 'INVITED', invitationId, delivery: 'QUEUED' },
            permissionUsed: 'connector.manage',
          });
          return {
            status: 201,
            body: await this.readPortalUser(tx, ctx, connectorId, userId),
            resourceRef: userId,
          };
        },
      );
      return { user: result.body as ConnectorPortalUser, isReplayed: result.replayed };
    });
  }

  /** GET /v1/connectors/{id}/users: the connector's portal logins and the state of each one's latest invitation. */
  async listPortalUsers(ctx: RequestContext, connectorId: string): Promise<ConnectorPortalUser[]> {
    this.deps.authz.requirePermission(ctx, 'connector.manage');
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      await assertVisible(tx, ctx, connectorId);
      return this.portalUsers(tx, ctx, connectorId);
    });
  }

  /**
   * POST /v1/connectors/{id}/users/{userId}/invitation/resend. Queues a new set-password e-mail for a login that has not set a password,
   * with the same limits as a staff invitation (cooldown, maximum resends, refused while the last one is still being sent).
   */
  async resendPortalInvitation(
    ctx: RequestContext,
    connectorId: string,
    userId: string,
  ): Promise<ConnectorPortalUser> {
    this.deps.authz.requirePermission(ctx, 'connector.manage');
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      await assertVisible(tx, ctx, connectorId);
      const login = await lockPortalUser(tx, ctx, connectorId, userId);
      if (login.status !== 'INVITED') {
        throw AppError.of(
          'INVALID_STATE',
          'Only a portal user who has not yet set a password can be sent a new invitation.',
        );
      }
      const current = (
        await sql<{
          id: string;
          status: string;
          delivery_state: string;
          requested_at: Date;
          expires_at: Date;
          resend_count: number;
        }>`
          SELECT id, status, delivery_state, requested_at, expires_at, resend_count FROM app.staff_invitation
           WHERE user_id = ${userId} AND status IN ('PENDING', 'EXPIRED')
           ORDER BY requested_at DESC LIMIT 1 FOR UPDATE`.execute(tx)
      ).rows[0];
      if (current && (current.delivery_state === 'QUEUED' || current.delivery_state === 'SENDING')) {
        throw AppError.of(
          'INVALID_STATE',
          'The invitation e-mail is still being sent. Check again in a minute.',
        );
      }
      const refusal = resendRefusal(
        current
          ? {
              status: current.status,
              sentAt: current.requested_at,
              expiresAt: current.expires_at,
              resendCount: current.resend_count,
            }
          : undefined,
        ctx.now,
      );
      if (refusal) throw AppError.of('INVALID_STATE', refusal);
      const expiry = invitationExpiry(ctx.now);
      if (current) {
        await sql`
          UPDATE app.staff_invitation
             SET status = 'PENDING', delivery_state = 'QUEUED', requested_at = ${ctx.now}::timestamptz,
                 next_attempt_at = ${ctx.now}::timestamptz, delivery_attempts = 0, expires_at = ${expiry}::timestamptz,
                 resend_count = resend_count + 1, last_failure = null, claimed_at = null, claimed_by = null,
                 updated_by = ${ctx.principal.id}
           WHERE id = ${current.id}`.execute(tx);
      } else {
        await sql`
          INSERT INTO app.staff_invitation (id, tenant_id, user_id, status, delivery_state, requested_at, next_attempt_at, sent_at,
                                            expires_at, created_by, updated_by)
          VALUES (${this.deps.ids.next('inv')}, ${ctx.principal.tenantId}, ${userId}, 'PENDING', 'QUEUED', ${ctx.now}::timestamptz,
                  ${ctx.now}::timestamptz, ${ctx.now}::timestamptz, ${expiry}::timestamptz, ${ctx.principal.id}, ${ctx.principal.id})`.execute(
          tx,
        );
      }
      await this.deps.audit.record(tx, ctx, {
        action: 'connector.portal_invitation_resent',
        entityType: 'USER',
        entityId: userId,
        after: {
          connectorId,
          resent: current ? 'EXISTING_INVITATION' : 'NEW_INVITATION',
          delivery: 'QUEUED',
        },
        permissionUsed: 'connector.manage',
      });
      return this.readPortalUser(tx, ctx, connectorId, userId);
    });
  }

  /**
   * POST /v1/connectors/{id}/users/{userId}/access. SUSPEND an ACTIVE portal login, or REACTIVATE a SUSPENDED one. Reactivation needs an
   * ACTIVE connector and an accepted invitation. The principal resolver reads the status on every request, so a suspended login is refused
   * on its next request; its Supabase sessions are not revoked by this call.
   */
  async setPortalUserAccess(
    ctx: RequestContext,
    connectorId: string,
    userId: string,
    input: ConnectorPortalAccessInput,
  ): Promise<ConnectorPortalUser> {
    this.deps.authz.requirePermission(ctx, 'connector.manage');
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const connector = await this.readConnector(tx, ctx, connectorId);
      const login = await lockPortalUser(tx, ctx, connectorId, userId);
      const [from, to] = input.action === 'SUSPEND' ? ['ACTIVE', 'SUSPENDED'] : ['SUSPENDED', 'ACTIVE'];
      if (login.status !== from) {
        throw AppError.of(
          'INVALID_STATE',
          `Only a ${from.toLowerCase()} portal user can be ${input.action === 'SUSPEND' ? 'suspended' : 'reactivated'}.`,
        );
      }
      if (to === 'ACTIVE') {
        if (connector.status !== 'ACTIVE') {
          throw AppError.of(
            'INVALID_STATE',
            'A portal user can be reactivated only while the connector is active.',
          );
        }
        await assertMayBecomeActive(tx, userId, login.status);
      }
      await sql`
        UPDATE app.app_user SET status = ${to}, updated_by = ${ctx.principal.id}
         WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${userId}`.execute(tx);
      await this.deps.audit.record(tx, ctx, {
        action:
          input.action === 'SUSPEND'
            ? 'connector.portal_user_suspended'
            : 'connector.portal_user_reactivated',
        entityType: 'USER',
        entityId: userId,
        before: { status: from },
        after: { connectorId, status: to },
        reason: input.reason,
        permissionUsed: 'connector.manage',
      });
      return this.readPortalUser(tx, ctx, connectorId, userId);
    });
  }

  /**
   * POST /v1/connectors/{id}/users/{userId}/invitation/revocation. Withdraws the invitation of a login that has not set a password: the
   * invitation is REVOKED (its delivery CANCELLED if not yet sent) and the login DEACTIVATED, so it can never be activated.
   */
  async revokePortalInvitation(
    ctx: RequestContext,
    connectorId: string,
    userId: string,
    input: ConnectorPortalRevocationInput,
  ): Promise<ConnectorPortalUser> {
    this.deps.authz.requirePermission(ctx, 'connector.manage');
    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      await assertVisible(tx, ctx, connectorId);
      const login = await lockPortalUser(tx, ctx, connectorId, userId);
      if (login.status !== 'INVITED') {
        throw AppError.of('INVALID_STATE', 'Only an invitation that has not been accepted can be withdrawn.');
      }
      await sql`
        UPDATE app.staff_invitation
           SET status = 'REVOKED',
               delivery_state = CASE WHEN delivery_state IN ('QUEUED', 'SENDING') THEN 'CANCELLED' ELSE delivery_state END,
               claimed_at = null, claimed_by = null, updated_by = ${ctx.principal.id}
         WHERE user_id = ${userId} AND status IN ('PENDING', 'EXPIRED')`.execute(tx);
      await sql`
        UPDATE app.app_user SET status = 'DEACTIVATED', updated_by = ${ctx.principal.id}
         WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${userId}`.execute(tx);
      await this.deps.audit.record(tx, ctx, {
        action: 'connector.portal_invitation_revoked',
        entityType: 'USER',
        entityId: userId,
        before: { status: 'INVITED' },
        after: { connectorId, status: 'DEACTIVATED' },
        reason: input.reason,
        permissionUsed: 'connector.manage',
      });
      return this.readPortalUser(tx, ctx, connectorId, userId);
    });
  }

  private async readPortalUser(
    tx: Tx,
    ctx: RequestContext,
    connectorId: string,
    userId: string,
  ): Promise<ConnectorPortalUser> {
    const [user] = await this.portalUsers(tx, ctx, connectorId, userId);
    if (!user) throw AppError.of('NOT_FOUND', 'Portal user not found.');
    return user;
  }

  /** The connector's portal logins (or one of them), each with its latest invitation. Only CONNECTOR logins linked to this connector. */
  private async portalUsers(
    tx: Tx,
    ctx: RequestContext,
    connectorId: string,
    userId?: string,
  ): Promise<ConnectorPortalUser[]> {
    const rows = await sql<{
      id: string;
      connector_id: string;
      display_name: string;
      email: string;
      status: string;
      created_at: Date;
      inv_status: string | null;
      delivery_state: string | null;
      last_failure: string | null;
      sent_at: Date | null;
      expires_at: Date | null;
      resend_count: number | null;
      accepted_at: Date | null;
    }>`
      SELECT u.id, u.connector_id, u.display_name, u.email::text AS email, u.status, u.created_at,
             i.status AS inv_status, i.delivery_state, i.last_failure, i.sent_at, i.expires_at, i.resend_count, i.accepted_at
        FROM app.app_user u
        LEFT JOIN LATERAL (
          SELECT si.status, si.delivery_state, si.last_failure, si.sent_at, si.expires_at, si.resend_count, si.accepted_at
            FROM app.staff_invitation si WHERE si.user_id = u.id ORDER BY si.requested_at DESC LIMIT 1
        ) i ON true
       WHERE u.tenant_id = ${ctx.principal.tenantId} AND u.connector_id = ${connectorId} AND u.user_type = 'CONNECTOR'
         ${userId ? sql`AND u.id = ${userId}` : sql``}
       ORDER BY u.created_at, u.id`.execute(tx);
    return rows.rows.map((r) => ({
      id: r.id,
      connectorId: r.connector_id,
      displayName: r.display_name,
      email: r.email,
      status: r.status,
      invitation: {
        state: invitationState(
          r.inv_status && r.sent_at && r.expires_at
            ? {
                status: r.inv_status,
                sentAt: r.sent_at,
                expiresAt: r.expires_at,
                resendCount: r.resend_count ?? 0,
              }
            : undefined,
          ctx.now,
        ),
        deliveryState: r.delivery_state,
        lastFailure: r.last_failure,
        // The send time is shown only once the e-mail has actually gone out.
        sentAt: r.delivery_state === 'SENT' && r.sent_at ? r.sent_at.toISOString() : null,
        expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
        resendCount: r.resend_count ?? 0,
        acceptedAt: r.accepted_at ? r.accepted_at.toISOString() : null,
      },
      createdAt: r.created_at.toISOString(),
    }));
  }

  // =========================================================================
  // SUB-CON.03: Attribution Change Requests & SOD-09 Approval
  // =========================================================================

  /**
   * API-CON-009: POST /v1/attribution-change-requests
   */
  async createAttributionChangeRequest(
    ctx: RequestContext,
    input: CreateAttributionChangeRequestInput,
    idempotencyKey: string,
  ): Promise<{ request: AttributionChangeRequestResource; isReplayed?: boolean }> {
    this.deps.authz.requirePermission(ctx, 'connector.attribution_change');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const result = await withIdempotency(
        tx,
        ctx,
        {
          key: idempotencyKey,
          method: 'POST',
          path: '/v1/attribution-change-requests',
          body: input,
        },
        async () => {
          // Verify lead exists
          const leadRes = await sql<{ id: string; connector_id: string | null }>`
            SELECT id, connector_id FROM app.lead
            WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${input.leadId}
          `.execute(tx);

          if (leadRes.rows.length === 0) {
            throw AppError.of('NOT_FOUND', `Lead ${input.leadId} not found.`);
          }

          const previousConnectorId = leadRes.rows[0]!.connector_id;

          // Verify proposed connector exists and is active
          const propConn = await this.getConnector(ctx, input.proposedConnectorId);
          if (propConn.status !== 'ACTIVE') {
            throw AppError.of(
              'VALIDATION_ERROR',
              `Proposed connector is not in ACTIVE status (status: ${propConn.status}).`,
            );
          }

          const reqId = `car_${nextUlid()}`;
          const now = new Date();

          await sql`
            INSERT INTO app.attribution_change_request (
              id, tenant_id, lead_id, previous_connector_id, proposed_connector_id,
              reason, evidence_ref, recalculation_proposal, status, requester_id,
              lock_version, created_at, created_by, updated_at, updated_by
            ) VALUES (
              ${reqId}, ${ctx.principal.tenantId}, ${input.leadId},
              ${previousConnectorId}, ${input.proposedConnectorId},
              ${input.reason.trim()}, ${input.evidenceRef},
              ${input.recalculationProposal ?? null}, 'PENDING', ${ctx.principal.id},
              0, ${now}, ${ctx.principal.id}, ${now}, ${ctx.principal.id}
            )
          `.execute(tx);

          await this.deps.audit.record(tx, ctx, {
            action: 'connector.attribution_change_requested',
            entityType: 'attribution_change_request',
            entityId: reqId,
            after: {
              leadId: input.leadId,
              previousConnectorId,
              proposedConnectorId: input.proposedConnectorId,
            },
          });

          const created: AttributionChangeRequestResource = {
            id: reqId,
            tenantId: ctx.principal.tenantId,
            leadId: input.leadId,
            previousConnectorId,
            proposedConnectorId: input.proposedConnectorId,
            reason: input.reason.trim(),
            evidenceRef: input.evidenceRef,
            recalculationProposal: input.recalculationProposal ?? null,
            status: 'PENDING',
            requesterId: ctx.principal.id,
            approverId: null,
            approvedAt: null,
            lockVersion: 0,
            createdAt: now.toISOString(),
            createdBy: ctx.principal.id,
            updatedAt: now.toISOString(),
            updatedBy: ctx.principal.id,
          };

          return { status: 201, body: created };
        },
      );

      return {
        request: result.body as AttributionChangeRequestResource,
        isReplayed: result.replayed,
      };
    });
  }

  /**
   * API-CON-010: POST /v1/attribution-change-requests/{id}/approval
   */
  async approveAttributionChangeRequest(
    ctx: RequestContext,
    requestId: string,
    input: ApproveAttributionChangeRequestInput,
    ifMatchVersion: number,
  ): Promise<AttributionChangeRequestResource> {
    this.deps.authz.requirePermission(ctx, 'connector.attribution_change');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const res = await sql<{
        id: string;
        tenant_id: string;
        lead_id: string;
        previous_connector_id: string | null;
        proposed_connector_id: string;
        reason: string;
        evidence_ref: string;
        recalculation_proposal: string | null;
        status: string;
        requester_id: string;
        lock_version: number;
        created_at: Date;
      }>`
        SELECT id, tenant_id, lead_id, previous_connector_id, proposed_connector_id,
               reason, evidence_ref, recalculation_proposal, status, requester_id,
               lock_version, created_at
        FROM app.attribution_change_request
        WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${requestId}
      `.execute(tx);

      if (res.rows.length === 0) {
        throw AppError.of('NOT_FOUND', `Attribution change request ${requestId} not found.`);
      }

      const reqRow = res.rows[0]!;

      if (reqRow.lock_version !== ifMatchVersion) {
        throw AppError.of('VERSION_CONFLICT', 'Precondition failed: ETag does not match lock version.', [
          { field: 'If-Match', issue: 'VERSION_MISMATCH' },
        ]);
      }

      if (reqRow.status !== 'PENDING') {
        throw AppError.of('VALIDATION_ERROR', `Request is not pending (status: ${reqRow.status}).`);
      }

      // SOD-09 Enforcement: Requester cannot approve their own attribution change
      if (reqRow.requester_id === ctx.principal.id) {
        throw AppError.of(
          'SOD_VIOLATION',
          'Separation of Duties (SOD-09): Requester cannot approve their own attribution change request.',
          [{ field: 'approvedBy', issue: 'SOD_09_SELF_APPROVAL_PROHIBITED' }],
        );
      }

      // Execute Security Definer function to safely bypass lead_attribution_guard
      await sql`
        SELECT app.apply_attribution_change(
          ${ctx.principal.tenantId},
          ${requestId},
          ${ctx.principal.id}
        )
      `.execute(tx);

      await this.deps.audit.record(tx, ctx, {
        action: 'connector.attribution_change_approved',
        entityType: 'attribution_change_request',
        entityId: requestId,
        after: {
          leadId: reqRow.lead_id,
          previousConnectorId: reqRow.previous_connector_id,
          proposedConnectorId: reqRow.proposed_connector_id,
          approvedBy: ctx.principal.id,
          remarks: input.remarks,
        },
      });

      const now = new Date();
      return {
        id: reqRow.id,
        tenantId: reqRow.tenant_id,
        leadId: reqRow.lead_id,
        previousConnectorId: reqRow.previous_connector_id,
        proposedConnectorId: reqRow.proposed_connector_id,
        reason: reqRow.reason,
        evidenceRef: reqRow.evidence_ref,
        recalculationProposal: reqRow.recalculation_proposal,
        status: 'APPROVED',
        requesterId: reqRow.requester_id,
        approverId: ctx.principal.id,
        approvedAt: now.toISOString(),
        lockVersion: reqRow.lock_version + 1,
        createdAt: reqRow.created_at.toISOString(),
        createdBy: reqRow.requester_id,
        updatedAt: now.toISOString(),
        updatedBy: ctx.principal.id,
      };
    });
  }

  /**
   * List attribution change requests
   */
  async listAttributionChangeRequests(
    ctx: RequestContext,
    leadId?: string,
  ): Promise<AttributionChangeRequestResource[]> {
    this.deps.authz.requirePermission(ctx, 'connector.attribution_change');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      let qb = sql<{
        id: string;
        tenant_id: string;
        lead_id: string;
        previous_connector_id: string | null;
        proposed_connector_id: string;
        reason: string;
        evidence_ref: string;
        recalculation_proposal: string | null;
        status: string;
        requester_id: string;
        approver_id: string | null;
        approved_at: Date | null;
        lock_version: number;
        created_at: Date;
        created_by: string;
        updated_at: Date;
        updated_by: string;
      }>`
        SELECT id, tenant_id, lead_id, previous_connector_id, proposed_connector_id,
               reason, evidence_ref, recalculation_proposal, status, requester_id,
               approver_id, approved_at, lock_version, created_at, created_by, updated_at, updated_by
        FROM app.attribution_change_request
        WHERE tenant_id = ${ctx.principal.tenantId}
      `;

      if (leadId) {
        qb = sql`${qb} AND lead_id = ${leadId}`;
      }

      qb = sql`${qb} ORDER BY created_at DESC`;

      const res = await qb.execute(tx);
      return res.rows.map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        leadId: r.lead_id,
        previousConnectorId: r.previous_connector_id,
        proposedConnectorId: r.proposed_connector_id,
        reason: r.reason,
        evidenceRef: r.evidence_ref,
        recalculationProposal: r.recalculation_proposal,
        status: r.status as any,
        requesterId: r.requester_id,
        approverId: r.approver_id,
        approvedAt: r.approved_at ? r.approved_at.toISOString() : null,
        lockVersion: r.lock_version,
        createdAt: r.created_at.toISOString(),
        createdBy: r.created_by,
        updatedAt: r.updated_at.toISOString(),
        updatedBy: r.updated_by,
      }));
    });
  }

  // =========================================================================
  // SUB-CON.04: Attribution Disputes & Resolution
  // =========================================================================

  /**
   * API-CON-008: POST /v1/attribution-disputes/{id}/resolution
   */
  async resolveAttributionDispute(
    ctx: RequestContext,
    disputeId: string,
    input: ResolveAttributionDisputeInput,
    ifMatchVersion: number,
  ): Promise<AttributionDisputeResource> {
    this.deps.authz.requirePermission(ctx, 'connector.dispute_resolve');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const res = await sql<{
        id: string;
        tenant_id: string;
        lead_id: string;
        claimant_connector_ids: string[];
        resolved_connector_id: string | null;
        resolution: string | null;
        status: string;
        resolver_user_id: string | null;
        resolution_notes: string | null;
        lock_version: number;
        created_at: Date;
        created_by: string;
      }>`
        SELECT id, tenant_id, lead_id, claimant_connector_ids, resolved_connector_id,
               resolution, status, resolver_user_id, resolution_notes,
               lock_version, created_at, created_by
        FROM app.attribution_dispute
        WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${disputeId}
      `.execute(tx);

      if (res.rows.length === 0) {
        throw AppError.of('NOT_FOUND', `Attribution dispute ${disputeId} not found.`);
      }

      const dispute = res.rows[0]!;

      if (dispute.lock_version !== ifMatchVersion) {
        throw AppError.of('VERSION_CONFLICT', 'Precondition failed: ETag does not match lock version.', [
          { field: 'If-Match', issue: 'VERSION_MISMATCH' },
        ]);
      }

      if (dispute.status === 'RESOLVED' || dispute.status === 'DISMISSED') {
        throw AppError.of('VALIDATION_ERROR', `Dispute is already closed (status: ${dispute.status}).`);
      }

      const now = new Date();

      // If resolving to a specific connector, update the lead's attribution
      if (input.resolvedConnectorId) {
        // Allow session override
        await sql`PERFORM set_config('app.allow_attribution_override', 'on', true)`.execute(tx);

        await sql`
          UPDATE app.lead
          SET connector_id = ${input.resolvedConnectorId},
              duplicate_flag = 'NONE',
              updated_at = ${now},
              updated_by = ${ctx.principal.id}
          WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${dispute.lead_id}
        `.execute(tx);

        await sql`PERFORM set_config('app.allow_attribution_override', 'off', true)`.execute(tx);
      } else {
        // Clears conflict flag if dismissed
        await sql`
          UPDATE app.lead
          SET duplicate_flag = 'NONE',
              updated_at = ${now},
              updated_by = ${ctx.principal.id}
          WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${dispute.lead_id}
        `.execute(tx);
      }

      await sql`
        UPDATE app.attribution_dispute
        SET resolution = ${input.resolution},
            resolved_connector_id = ${input.resolvedConnectorId ?? null},
            status = 'RESOLVED',
            resolver_user_id = ${ctx.principal.id},
            resolution_notes = ${input.resolutionNotes.trim()},
            updated_at = ${now},
            updated_by = ${ctx.principal.id}
        WHERE tenant_id = ${ctx.principal.tenantId} AND id = ${disputeId}
      `.execute(tx);

      await this.deps.audit.record(tx, ctx, {
        action: 'connector.dispute_resolved',
        entityType: 'attribution_dispute',
        entityId: disputeId,
        after: {
          leadId: dispute.lead_id,
          resolution: input.resolution,
          resolvedConnectorId: input.resolvedConnectorId,
          resolverUserId: ctx.principal.id,
        },
      });

      return {
        id: dispute.id,
        tenantId: dispute.tenant_id,
        leadId: dispute.lead_id,
        claimantConnectorIds: dispute.claimant_connector_ids,
        resolvedConnectorId: input.resolvedConnectorId ?? null,
        resolution: input.resolution,
        status: 'RESOLVED',
        resolverUserId: ctx.principal.id,
        resolutionNotes: input.resolutionNotes.trim(),
        lockVersion: dispute.lock_version + 1,
        createdAt: dispute.created_at.toISOString(),
        createdBy: dispute.created_by,
        updatedAt: now.toISOString(),
        updatedBy: ctx.principal.id,
      };
    });
  }

  /**
   * List attribution disputes
   */
  async listAttributionDisputes(ctx: RequestContext, leadId?: string): Promise<AttributionDisputeResource[]> {
    this.deps.authz.requirePermission(ctx, 'connector.dispute_resolve');

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      let qb = sql<{
        id: string;
        tenant_id: string;
        lead_id: string;
        claimant_connector_ids: string[];
        resolved_connector_id: string | null;
        resolution: string | null;
        status: string;
        resolver_user_id: string | null;
        resolution_notes: string | null;
        lock_version: number;
        created_at: Date;
        created_by: string;
        updated_at: Date;
        updated_by: string;
      }>`
        SELECT id, tenant_id, lead_id, claimant_connector_ids, resolved_connector_id,
               resolution, status, resolver_user_id, resolution_notes,
               lock_version, created_at, created_by, updated_at, updated_by
        FROM app.attribution_dispute
        WHERE tenant_id = ${ctx.principal.tenantId}
      `;

      if (leadId) {
        qb = sql`${qb} AND lead_id = ${leadId}`;
      }

      qb = sql`${qb} ORDER BY created_at DESC`;

      const res = await qb.execute(tx);
      return res.rows.map((r) => ({
        id: r.id,
        tenantId: r.tenant_id,
        leadId: r.lead_id,
        claimantConnectorIds: r.claimant_connector_ids,
        resolvedConnectorId: r.resolved_connector_id,
        resolution: r.resolution as any,
        status: r.status as any,
        resolverUserId: r.resolver_user_id,
        resolutionNotes: r.resolution_notes,
        lockVersion: r.lock_version,
        createdAt: r.created_at.toISOString(),
        createdBy: r.created_by,
        updatedAt: r.updated_at.toISOString(),
        updatedBy: r.updated_by,
      }));
    });
  }
}
