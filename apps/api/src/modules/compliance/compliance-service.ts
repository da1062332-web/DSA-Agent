// apps/api/src/modules/compliance/compliance-service.ts
// Module 29: Privacy and Consent (MOD-PRV)
import {
  AppError,
  type DataSharingRecord,
  type ListDataSharingRecordsQuery,
  type ListDataSharingRecordsResponse,
  type PrivacyStats,
  type RequestContext,
  type VerifyConsentInput,
  type VerifyConsentResult,
} from '@dsa/contracts';
import { sql } from 'kysely';
import type { ApiDeps } from '../types';

export class ComplianceService {
  constructor(protected readonly deps: ApiDeps) {}

  protected checkAuthz(ctx: RequestContext): void {
    if (!ctx || !ctx.principal) {
      throw AppError.of('UNAUTHENTICATED', 'Authentication required.');
    }
    const hasAuditOrCustomer = ctx.principal.grants.some(
      (g) => g.code === 'audit.read' || g.code === 'customer.read',
    );
    if (!hasAuditOrCustomer) {
      this.deps.authz.requirePermission(ctx, 'audit.read');
    }
  }

  /**
   * List data sharing records with tenant isolation and audit filtering (SUB-PRV.05)
   */
  async listDataSharingRecords(
    ctx: RequestContext,
    query: ListDataSharingRecordsQuery,
  ): Promise<ListDataSharingRecordsResponse> {
    this.checkAuthz(ctx);

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const tenantId = ctx.principal.tenantId;
      const limit = query.limit;
      const offset = query.offset;

      const countResult = await sql<{ count: string }>`
        SELECT count(*)::text as count
        FROM app.data_sharing_record
        WHERE tenant_id = ${tenantId}
          ${query.subjectId ? sql`AND subject_id = ${query.subjectId}` : sql``}
          ${query.recipientType ? sql`AND recipient_type = ${query.recipientType}` : sql``}
          ${query.purpose ? sql`AND purpose = ${query.purpose}` : sql``}
      `.execute(tx);

      const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

      const rowsResult = await sql<{
        id: string;
        tenant_id: string;
        subject_type: 'LOAN_APPLICATION';
        subject_id: string;
        recipient_type: 'LENDER' | 'CO_LENDER' | 'PARTNER' | 'AUDITOR';
        recipient_id: string;
        purpose: 'LENDER_SUBMISSION' | 'PORTFOLIO_REVIEW' | 'AUDIT_INSPECTION';
        consent_ids: string[];
        items: { fields: string[]; checklistItemIds: string[] };
        channel: 'PORTAL' | 'EMAIL' | 'API' | 'PHYSICAL';
        source_ref: string;
        actor_id: string;
        shared_at: Date;
      }>`
        SELECT id, tenant_id, subject_type, subject_id, recipient_type, recipient_id,
               purpose, consent_ids, items, channel, source_ref, actor_id, shared_at
        FROM app.data_sharing_record
        WHERE tenant_id = ${tenantId}
          ${query.subjectId ? sql`AND subject_id = ${query.subjectId}` : sql``}
          ${query.recipientType ? sql`AND recipient_type = ${query.recipientType}` : sql``}
          ${query.purpose ? sql`AND purpose = ${query.purpose}` : sql``}
        ORDER BY shared_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `.execute(tx);

      const items: DataSharingRecord[] = rowsResult.rows.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        recipientType: row.recipient_type,
        recipientId: row.recipient_id,
        purpose: row.purpose,
        consentIds: row.consent_ids,
        items: typeof row.items === 'string' ? JSON.parse(row.items) : row.items,
        channel: row.channel,
        sourceRef: row.source_ref,
        actorId: row.actor_id,
        sharedAt: new Date(row.shared_at).toISOString(),
      }));

      return {
        items,
        total,
        limit,
        offset,
      };
    });
  }

  /**
   * Aggregate privacy and consent statistics for tenant governance dashboard (SUB-PRV.01, SUB-PRV.02)
   */
  async getPrivacyStats(ctx: RequestContext): Promise<PrivacyStats> {
    this.checkAuthz(ctx);

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const tenantId = ctx.principal.tenantId;

      const [activeResult, withdrawnResult, sharingCountResult, consentPurposeResult, recipientResult] =
        await Promise.all([
          sql<{ count: string }>`
            SELECT count(*)::text as count
            FROM app.consent_record
            WHERE tenant_id = ${tenantId} AND status = 'ACTIVE'
          `.execute(tx),
          sql<{ count: string }>`
            SELECT count(*)::text as count
            FROM app.consent_record
            WHERE tenant_id = ${tenantId} AND status = 'WITHDRAWN'
          `.execute(tx),
          sql<{ count: string }>`
            SELECT count(*)::text as count
            FROM app.data_sharing_record
            WHERE tenant_id = ${tenantId}
          `.execute(tx),
          sql<{ purpose: string; count: string }>`
            SELECT purpose, count(*)::text as count
            FROM app.consent_record
            WHERE tenant_id = ${tenantId}
            GROUP BY purpose
          `.execute(tx),
          sql<{ recipient_type: string; count: string }>`
            SELECT recipient_type, count(*)::text as count
            FROM app.data_sharing_record
            WHERE tenant_id = ${tenantId}
            GROUP BY recipient_type
          `.execute(tx),
        ]);

      const consentsByPurpose: Record<string, number> = {};
      for (const row of consentPurposeResult.rows) {
        consentsByPurpose[row.purpose] = parseInt(row.count, 10);
      }

      const sharingByRecipientType: Record<string, number> = {};
      for (const row of recipientResult.rows) {
        sharingByRecipientType[row.recipient_type] = parseInt(row.count, 10);
      }

      return {
        activeConsentsCount: parseInt(activeResult.rows[0]?.count ?? '0', 10),
        withdrawnConsentsCount: parseInt(withdrawnResult.rows[0]?.count ?? '0', 10),
        totalSharingRecordsCount: parseInt(sharingCountResult.rows[0]?.count ?? '0', 10),
        consentsByPurpose,
        sharingByRecipientType,
        protectionPolicies: [
          {
            field: 'auth_credentials',
            tier: 'S4',
            strategy: 'ENCRYPTION_AT_REST_AND_VAULT',
            description: 'Passwords, API keys, and session secrets encrypted at rest; never exposed.',
          },
          {
            field: 'government_id_aadhaar',
            tier: 'S3',
            strategy: 'STRICT_LEAK_DETECTION_REGEX',
            description: 'Automated 12-digit Aadhaar regex leak prevention on note free-text fields.',
          },
          {
            field: 'government_id_pan',
            tier: 'S3',
            strategy: 'PARTIAL_MASKING_AND_BLIND_INDEX',
            description: 'Masked as ABCDE****F with HMAC-SHA256 blind indexing for query lookups.',
          },
          {
            field: 'bank_account_number',
            tier: 'S2',
            strategy: 'LAST_4_DIGITS_ONLY',
            description: 'Financial accounts masked as ****1234; verified via penny-drop.',
          },
          {
            field: 'primary_phone_mobile',
            tier: 'S1',
            strategy: 'E164_PARTIAL_MASKING',
            description: 'Mobile numbers masked as +91 ******1234; unmasked access requires step-up MFA.',
          },
          {
            field: 'primary_email_address',
            tier: 'S1',
            strategy: 'USERNAME_PREFIX_MASKING',
            description: 'Email masked as j***@example.com for all general operational views.',
          },
          {
            field: 'system_identifiers',
            tier: 'S0',
            strategy: 'TENANT_ISOLATED_PLAINTEXT',
            description: 'Platform ULIDs, timestamps, and application statuses with strict RLS.',
          },
        ],
      };
    });
  }

  /**
   * Verify whether valid active consent exists for a subject and purpose (SUB-PRV.01)
   */
  async verifyConsent(
    ctx: RequestContext,
    input: VerifyConsentInput,
  ): Promise<VerifyConsentResult> {
    this.checkAuthz(ctx);

    return this.deps.txRunner.withTenantTx(ctx, async (tx) => {
      const tenantId = ctx.principal.tenantId;

      // 1. Check direct customer consent if customerId provided
      if (input.customerId) {
        const customerConsent = await sql<{
          id: string;
          purpose: string;
          purpose_target: string | null;
          channel: string;
          notice_version: string;
          status: 'ACTIVE' | 'WITHDRAWN';
          created_at: Date;
        }>`
          SELECT id, purpose, purpose_target, channel, notice_version, status, created_at
          FROM app.consent_record
          WHERE tenant_id = ${tenantId}
            AND subject_type = 'CUSTOMER'
            AND subject_id = ${input.customerId}
            AND purpose = ${input.purpose}
            ${input.purposeTarget ? sql`AND purpose_target = ${input.purposeTarget}` : sql``}
          ORDER BY (status = 'ACTIVE') DESC, created_at DESC
          LIMIT 1
        `.execute(tx);

        const rec = customerConsent.rows[0];
        if (rec && rec.status === 'ACTIVE') {
          return {
            hasConsent: true,
            consentId: rec.id,
            source: 'CUSTOMER',
            purpose: rec.purpose,
            purposeTarget: rec.purpose_target,
            status: 'ACTIVE',
            channel: rec.channel,
            noticeVersion: rec.notice_version,
            createdAt: new Date(rec.created_at).toISOString(),
          };
        }

        // 2. Also check if consent was captured pre-conversion on lead
        const leadConsent = await sql<{
          id: string;
          purpose: string;
          purpose_target: string | null;
          channel: string;
          notice_version: string;
          status: 'ACTIVE' | 'WITHDRAWN';
          created_at: Date;
        }>`
          SELECT cr.id, cr.purpose, cr.purpose_target, cr.channel, cr.notice_version, cr.status, cr.created_at
          FROM app.consent_record cr
          JOIN app.lead l ON l.id = cr.subject_id AND l.tenant_id = cr.tenant_id
          WHERE cr.tenant_id = ${tenantId}
            AND cr.subject_type = 'LEAD'
            AND l.customer_id = ${input.customerId}
            AND cr.purpose = ${input.purpose}
            ${input.purposeTarget ? sql`AND cr.purpose_target = ${input.purposeTarget}` : sql``}
          ORDER BY (cr.status = 'ACTIVE') DESC, cr.created_at DESC
          LIMIT 1
        `.execute(tx);

        const lRec = leadConsent.rows[0];
        if (lRec && lRec.status === 'ACTIVE') {
          return {
            hasConsent: true,
            consentId: lRec.id,
            source: 'LEAD',
            purpose: lRec.purpose,
            purposeTarget: lRec.purpose_target,
            status: 'ACTIVE',
            channel: lRec.channel,
            noticeVersion: lRec.notice_version,
            createdAt: new Date(lRec.created_at).toISOString(),
          };
        }

        if (rec?.status === 'WITHDRAWN' || lRec?.status === 'WITHDRAWN') {
          const wRec = rec?.status === 'WITHDRAWN' ? rec : lRec!;
          return {
            hasConsent: false,
            consentId: wRec.id,
            source: rec?.status === 'WITHDRAWN' ? 'CUSTOMER' : 'LEAD',
            purpose: wRec.purpose,
            purposeTarget: wRec.purpose_target,
            status: 'WITHDRAWN',
            channel: wRec.channel,
            noticeVersion: wRec.notice_version,
            createdAt: new Date(wRec.created_at).toISOString(),
          };
        }
      }

      // 3. Direct lead consent query if leadId provided
      if (input.leadId) {
        const leadConsent = await sql<{
          id: string;
          purpose: string;
          purpose_target: string | null;
          channel: string;
          notice_version: string;
          status: 'ACTIVE' | 'WITHDRAWN';
          created_at: Date;
        }>`
          SELECT id, purpose, purpose_target, channel, notice_version, status, created_at
          FROM app.consent_record
          WHERE tenant_id = ${tenantId}
            AND subject_type = 'LEAD'
            AND subject_id = ${input.leadId}
            AND purpose = ${input.purpose}
            ${input.purposeTarget ? sql`AND purpose_target = ${input.purposeTarget}` : sql``}
          ORDER BY (status = 'ACTIVE') DESC, created_at DESC
          LIMIT 1
        `.execute(tx);

        const rec = leadConsent.rows[0];
        if (rec) {
          return {
            hasConsent: rec.status === 'ACTIVE',
            consentId: rec.id,
            source: 'LEAD',
            purpose: rec.purpose,
            purposeTarget: rec.purpose_target,
            status: rec.status,
            channel: rec.channel,
            noticeVersion: rec.notice_version,
            createdAt: new Date(rec.created_at).toISOString(),
          };
        }
      }

      return {
        hasConsent: false,
        consentId: null,
        source: null,
        purpose: input.purpose,
        purposeTarget: input.purposeTarget ?? null,
        status: 'MISSING',
        channel: null,
        noticeVersion: null,
        createdAt: null,
      };
    });
  }
}
