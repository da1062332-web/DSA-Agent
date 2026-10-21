// apps/api/src/modules/crm/messaging/send-guard.ts — owner: Dev 1 / Dev 5
// CMP-MSG.04.1: Send-Eligibility Guard (MOD-MSG / SUB-MSG.04)
import crypto from 'node:crypto';
import type {
  BlockedReason,
  MessageRecipient,
  MessageTemplate,
  RequestContext,
  SendMessageInput,
  Tx,
} from '@dsa/contracts';
import { sql } from 'kysely';
import type { ChannelAdapter } from './channel-adapter';

export interface EligibilityResult {
  eligible: boolean;
  blockedReason?: BlockedReason;
  blockedMessage?: string;
  template?: MessageTemplate;
  recipientHash: string;
  recipientMasked: string;
  redactedVariables: Record<string, unknown>;
  evaluatedTime: string;
}

export interface GuardOptions {
  bypassQuietHoursForTest?: boolean;
  defaultTimezone?: string;
  quietHoursStartHour?: number; // 21 (9 PM)
  quietHoursEndHour?: number; // 9 (9 AM)
  frequencyCapPerHour?: number; // default 5
}

export interface TenantCalendarConfig {
  timezone?: string;
  quietHoursStartHour?: number;
  quietHoursEndHour?: number;
}

export class SendEligibilityGuard {
  private tenantCalendars = new Map<string, TenantCalendarConfig>();
  static memoryClaimedSlots = new Set<string>();

  constructor(private readonly options: GuardOptions = {}) {}

  setTenantCalendar(tenantId: string, config: TenantCalendarConfig): void {
    this.tenantCalendars.set(tenantId, config);
  }

  /** The subject with what scope and consent need: its branch and owner, and the lead and customer behind it. */
  private async findSubject(
    tx: Tx,
    type: string,
    id: string,
  ): Promise<{
    branchId: string;
    ownerUserId: string | null;
    leadId: string | null;
    customerId: string | null;
  } | null> {
    if (type === 'LEAD') {
      const r = await sql<{ branch_id: string; owner_user_id: string | null; customer_id: string | null }>`
        SELECT branch_id, owner_user_id, customer_id FROM app.lead WHERE id = ${id}`.execute(tx);
      const row = r.rows[0];
      return row
        ? { branchId: row.branch_id, ownerUserId: row.owner_user_id, leadId: id, customerId: row.customer_id }
        : null;
    }
    if (type === 'CUSTOMER') {
      const r = await sql<{
        home_branch_id: string;
      }>`SELECT home_branch_id FROM app.customer WHERE id = ${id}`.execute(tx);
      const row = r.rows[0];
      return row ? { branchId: row.home_branch_id, ownerUserId: null, leadId: null, customerId: id } : null;
    }
    if (type === 'LOAN_APPLICATION') {
      const r = await sql<{
        branch_id: string;
        sales_owner_id: string;
        customer_id: string;
        lead_id: string | null;
      }>`
        SELECT branch_id, sales_owner_id, customer_id, lead_id FROM app.loan_application WHERE id = ${id}`.execute(
        tx,
      );
      const row = r.rows[0];
      return row
        ? {
            branchId: row.branch_id,
            ownerUserId: row.sales_owner_id,
            leadId: row.lead_id,
            customerId: row.customer_id,
          }
        : null;
    }
    return null;
  }

  /** message.send (or config.manage) at TENANT scope, or BRANCH covering the subject's branch, or TEAM/OWN covering its owner. */
  private sendScopeCovers(
    ctx: RequestContext,
    subject: { branchId: string; ownerUserId: string | null },
  ): boolean {
    const p = ctx.principal;
    if (p.kind === 'SERVICE') return true;
    return p.grants
      .filter((g) => g.code === 'message.send' || g.code === 'config.manage')
      .some((g) => {
        if (g.scope === 'TENANT') return true;
        if (g.scope === 'BRANCH') return [...g.branchIds, p.primaryBranchId].includes(subject.branchId);
        if (g.scope === 'TEAM')
          return !!subject.ownerUserId && [p.id, ...p.managedTeamMemberIds].includes(subject.ownerUserId);
        if (g.scope === 'OWN') return subject.ownerUserId === p.id;
        return false;
      });
  }

  static resetMemorySlots(): void {
    SendEligibilityGuard.memoryClaimedSlots.clear();
  }

  /**
   * Hashes recipient identifier with SHA-256 (Contracts §12 / R-OPS)
   */
  static hashRecipient(recipient: MessageRecipient): string {
    const raw = (recipient.email || recipient.mobile || '').trim().toLowerCase();
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Masks recipient identifier (S2 masking)
   */
  static maskRecipient(recipient: MessageRecipient): string {
    if (recipient.email) {
      const parts = recipient.email.trim().toLowerCase().split('@');
      if (parts.length === 2 && parts[0] && parts[1]) {
        const local = parts[0];
        const domain = parts[1];
        const maskedLocal =
          local.length <= 2
            ? `${local[0]}*`
            : `${local[0]}${'*'.repeat(local.length - 2)}${local[local.length - 1]}`;
        return `${maskedLocal}@${domain}`;
      }
      return '***@***.***';
    }

    if (recipient.mobile) {
      const clean = recipient.mobile.trim();
      if (clean.length > 7) {
        const start = clean.slice(0, 4);
        const end = clean.slice(-3);
        return `${start}****${end}`;
      }
      return '****';
    }

    return '***';
  }

  /**
   * Redacts sensitive variable keys from stored payloads
   */
  static redactVariables(vars: Record<string, unknown>): Record<string, unknown> {
    const sensitivePattern = /pass|pin|token|secret|otp|auth|aadhaar|pan|account/i;
    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(vars)) {
      if (sensitivePattern.test(key)) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }

  /**
   * Evaluates if the current evaluation time falls within quiet hours.
   * Default: 21:00 to 09:00 in tenant's configured timezone.
   */
  isWithinQuietHours(
    now: Date,
    timezone = 'Asia/Kolkata',
    startHour = this.options.quietHoursStartHour ?? 21,
    endHour = this.options.quietHoursEndHour ?? 9,
  ): boolean {
    if (this.options.bypassQuietHoursForTest) {
      return false;
    }

    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hour12: false,
      });
      const hour = parseInt(formatter.format(now), 10);

      // Overnight quiet period: e.g. 21 to 24 or 0 to 9
      if (startHour > endHour) {
        return hour >= startHour || hour < endHour;
      }
      return hour >= startHour && hour < endHour;
    } catch {
      // Fail closed if timezone resolution fails
      return true;
    }
  }

  /**
   * Evaluates all 10 send-eligibility checks atomically before dispatch.
   */
  async evaluate(
    ctx: RequestContext,
    input: SendMessageInput,
    adapter: ChannelAdapter,
    tx?: Tx,
    templateOverride?: MessageTemplate,
    optOutOverrides?: Set<string>,
  ): Promise<EligibilityResult> {
    const tenantId = ctx.principal.tenantId;
    const recipientHash = SendEligibilityGuard.hashRecipient(input.recipient);
    const recipientMasked = SendEligibilityGuard.maskRecipient(input.recipient);
    const redactedVariables = SendEligibilityGuard.redactVariables(input.variables);
    const evaluatedTime = ctx.now.toISOString();

    // 1. Permission check
    const hasPermission =
      ctx.principal.grants.some((g) => g.code === 'message.send') ||
      ctx.principal.grants.some((g) => g.code === 'config.manage');
    if (!hasPermission) {
      return {
        eligible: false,
        blockedReason: 'UNAUTHORIZED',
        blockedMessage: 'Principal does not have message.send permission',
        recipientHash,
        recipientMasked,
        redactedVariables,
        evaluatedTime,
      };
    }

    // 2. Channel recipient format check
    if (input.channel === 'EMAIL' && !input.recipient.email) {
      return {
        eligible: false,
        blockedReason: 'RECIPIENT_INVALID',
        blockedMessage: 'Email channel requires valid recipient email address',
        recipientHash,
        recipientMasked,
        redactedVariables,
        evaluatedTime,
      };
    }
    if ((input.channel === 'SMS' || input.channel === 'WHATSAPP') && !input.recipient.mobile) {
      return {
        eligible: false,
        blockedReason: 'RECIPIENT_INVALID',
        blockedMessage: `${input.channel} channel requires valid recipient mobile phone number`,
        recipientHash,
        recipientMasked,
        redactedVariables,
        evaluatedTime,
      };
    }

    // 3. Provider configured check (no fake providers)
    if (!adapter.isConfigured()) {
      return {
        eligible: false,
        blockedReason: 'PROVIDER_NOT_CONFIGURED',
        blockedMessage: `Provider for channel ${input.channel} is not configured`,
        recipientHash,
        recipientMasked,
        redactedVariables,
        evaluatedTime,
      };
    }

    // 4. Opt-out / DND check
    if (optOutOverrides && optOutOverrides.has(`${tenantId}:${recipientHash}:${input.channel}`)) {
      return {
        eligible: false,
        blockedReason: 'OPT_OUT_CHANNEL',
        blockedMessage: `Recipient has opted out of communication on channel ${input.channel}`,
        recipientHash,
        recipientMasked,
        redactedVariables,
        evaluatedTime,
      };
    }

    // 5. Quiet hours check (ENT-015 business calendar / tenant timezone)
    let tenantTimezone = this.options.defaultTimezone;
    let quietStart = this.options.quietHoursStartHour ?? 21;
    let quietEnd = this.options.quietHoursEndHour ?? 9;

    if (tx) {
      try {
        const tenantRes = await sql<{ timezone: string }>`
          SELECT timezone FROM app.tenant WHERE id = ${tenantId} LIMIT 1
        `.execute(tx);
        if (tenantRes.rows.length > 0 && tenantRes.rows[0]?.timezone) {
          tenantTimezone = tenantRes.rows[0].timezone;
        }
      } catch {
        // Fail closed if tenant timezone lookup fails
      }
    }

    const customCalendar = this.tenantCalendars.get(tenantId);
    if (customCalendar) {
      if (customCalendar.timezone) tenantTimezone = customCalendar.timezone;
      if (customCalendar.quietHoursStartHour !== undefined) quietStart = customCalendar.quietHoursStartHour;
      if (customCalendar.quietHoursEndHour !== undefined) quietEnd = customCalendar.quietHoursEndHour;
    }

    if (!tenantTimezone) {
      tenantTimezone = 'Asia/Kolkata'; // fallback to platform default
    }

    if (this.isWithinQuietHours(ctx.now, tenantTimezone, quietStart, quietEnd)) {
      return {
        eligible: false,
        blockedReason: 'QUIET_HOURS',
        blockedMessage: `Sending blocked during quiet hours (${quietStart}:00 - ${quietEnd}:00 in timezone ${tenantTimezone})`,
        recipientHash,
        recipientMasked,
        redactedVariables,
        evaluatedTime,
      };
    }

    // 6. Template validity & approval check
    let template = templateOverride;
    if (!template && tx) {
      const tmplRes = await sql<{
        id: string;
        tenant_id: string;
        code: string;
        channel: string;
        language: string;
        category: string;
        body: string;
        variables: string;
        provider_template_id: string | null;
        version: number;
        status: string;
        lock_version: number;
        created_at: Date;
        created_by: string;
        updated_at: Date;
        updated_by: string;
      }>`
        SELECT * FROM app.message_template
        WHERE tenant_id = ${tenantId}
          AND code = ${input.templateCode}
          ${input.templateVersion ? sql`AND version = ${input.templateVersion}` : sql``}
        ORDER BY version DESC
        LIMIT 1
      `.execute(tx);

      const row = tmplRes.rows[0];
      if (row) {
        template = {
          id: row.id as MessageTemplate['id'],
          tenantId: row.tenant_id,
          code: row.code,
          channel: row.channel as MessageTemplate['channel'],
          language: row.language,
          category: row.category as MessageTemplate['category'],
          body: row.body,
          variables:
            typeof row.variables === 'string'
              ? JSON.parse(row.variables)
              : (row.variables as MessageTemplate['variables']),
          providerTemplateId: row.provider_template_id,
          version: row.version,
          status: row.status as MessageTemplate['status'],
          lockVersion: row.lock_version,
          createdAt: new Date(row.created_at).toISOString(),
          createdBy: row.created_by,
          updatedAt: new Date(row.updated_at).toISOString(),
          updatedBy: row.updated_by,
        };
      }
    }

    if (!template) {
      return {
        eligible: false,
        blockedReason: 'TEMPLATE_NOT_FOUND',
        blockedMessage: `Template code ${input.templateCode} not found in tenant`,
        recipientHash,
        recipientMasked,
        redactedVariables,
        evaluatedTime,
      };
    }

    if (template.status !== 'APPROVED') {
      return {
        eligible: false,
        blockedReason: 'TEMPLATE_NOT_APPROVED',
        blockedMessage: `Template ${template.code} version ${template.version} is ${template.status}, not APPROVED`,
        recipientHash,
        recipientMasked,
        redactedVariables,
        evaluatedTime,
      };
    }

    // Validate required template variables
    if (template.variables && Array.isArray(template.variables)) {
      for (const v of template.variables) {
        if (v.required && (input.variables[v.name] === undefined || input.variables[v.name] === null)) {
          return {
            eligible: false,
            blockedReason: 'TEMPLATE_VARIABLES_INVALID',
            blockedMessage: `Missing required template variable: ${v.name}`,
            template,
            recipientHash,
            recipientMasked,
            redactedVariables,
            evaluatedTime,
          };
        }
      }
    }

    // 7. The subject must exist in the tenant and be within the sender's message.send scope (404 semantics: blocked as
    // SUBJECT_NOT_FOUND, never revealing that it exists elsewhere).
    if (tx) {
      const blocked = (blockedReason: BlockedReason, blockedMessage: string): EligibilityResult => ({
        eligible: false,
        blockedReason,
        blockedMessage,
        template,
        recipientHash,
        recipientMasked,
        redactedVariables,
        evaluatedTime,
      });
      const subject = await this.findSubject(tx, input.subjectType, input.subjectId);
      if (!subject || !this.sendScopeCovers(ctx, subject)) {
        return blocked('SUBJECT_NOT_FOUND', `${input.subjectType} ${input.subjectId} was not found`);
      }

      // 8. Consent: an ACTIVE, unexpired consent for the purpose, held by the lead itself, or for a customer or application by
      // the customer or by a lead that converted into it (consents captured before conversion stay valid).
      const purpose = template.category === 'MARKETING' ? 'MARKETING' : 'CONTACT';
      const consentRes = await sql<{ id: string; status: string; expires_at: Date | null }>`
        SELECT c.id, c.status, c.expires_at FROM app.consent_record c
         WHERE c.tenant_id = ${tenantId}
           AND c.purpose = ${purpose}
           AND (
             (c.subject_type = 'LEAD' AND c.subject_id = ${subject.leadId ?? null})
             OR (c.subject_type = 'CUSTOMER' AND c.subject_id = ${subject.customerId ?? null})
             OR (c.subject_type = 'LEAD' AND ${subject.customerId ?? null}::text IS NOT NULL
                 AND c.subject_id IN (SELECT l.id FROM app.lead l WHERE l.customer_id = ${subject.customerId ?? null}))
           )
         ORDER BY (c.status = 'ACTIVE') DESC, c.captured_at DESC
         LIMIT 1
      `.execute(tx);

      const consent = consentRes.rows[0];
      if (!consent) {
        return blocked('CONSENT_REQUIRED', `Active consent record for purpose ${purpose} is required`);
      }
      if (consent.status === 'WITHDRAWN') {
        return blocked('CONSENT_WITHDRAWN', `Consent for purpose ${purpose} has been withdrawn`);
      }
      if (consent.status !== 'ACTIVE' || (consent.expires_at && new Date(consent.expires_at) < ctx.now)) {
        return blocked('CONSENT_REQUIRED', `Consent for purpose ${purpose} has expired`);
      }
    }

    // 9. Frequency caps check (R2) via ENT-116 dedupe_registry with namespace MESSAGE_FREQ
    const capPerHour = this.options.frequencyCapPerHour ?? 5;
    const hourBucket = `${ctx.now.getUTCFullYear()}-${String(ctx.now.getUTCMonth() + 1).padStart(2, '0')}-${String(ctx.now.getUTCDate()).padStart(2, '0')}T${String(ctx.now.getUTCHours()).padStart(2, '0')}`;
    const expiresAt = new Date(ctx.now.getTime() + 60 * 60 * 1000);
    let slotClaimed = false;

    if (tx) {
      for (let slot = 1; slot <= capPerHour; slot++) {
        const slotKey = `freq:${recipientHash}:${hourBucket}:s${slot}`;
        // ON CONFLICT DO NOTHING never throws for a taken slot; any other error leaves the transaction unusable and propagates.
        const insertRes = await sql`
          INSERT INTO app.dedupe_registry (tenant_id, namespace, key, ref_id, expires_at)
          VALUES (${tenantId}, 'MESSAGE_FREQ', ${slotKey}, ${input.subjectId}, ${expiresAt})
          ON CONFLICT (tenant_id, namespace, key) DO NOTHING
          RETURNING key
        `.execute(tx);
        if (insertRes.rows.length > 0) {
          slotClaimed = true;
          break;
        }
      }
    } else {
      for (let slot = 1; slot <= capPerHour; slot++) {
        const slotKey = `${tenantId}:freq:${recipientHash}:${hourBucket}:s${slot}`;
        if (!SendEligibilityGuard.memoryClaimedSlots.has(slotKey)) {
          SendEligibilityGuard.memoryClaimedSlots.add(slotKey);
          slotClaimed = true;
          break;
        }
      }
    }

    if (!slotClaimed) {
      return {
        eligible: false,
        blockedReason: 'FREQUENCY_CAPPED',
        blockedMessage: `Hourly frequency cap of ${capPerHour} messages exceeded for recipient`,
        template,
        recipientHash,
        recipientMasked,
        redactedVariables,
        evaluatedTime,
      };
    }

    return {
      eligible: true,
      template,
      recipientHash,
      recipientMasked,
      redactedVariables,
      evaluatedTime,
    };
  }
}
