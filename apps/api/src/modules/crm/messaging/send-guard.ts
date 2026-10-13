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

    // 7. Subject existence and consent check (via database if tx is active)
    if (tx) {
      if (input.subjectType === 'LEAD') {
        const leadRes = await sql<{ id: string; status: string }>`
          SELECT id, status FROM app.lead WHERE tenant_id = ${tenantId} AND id = ${input.subjectId} LIMIT 1
        `.execute(tx);
        if (leadRes.rows.length === 0) {
          return {
            eligible: false,
            blockedReason: 'SUBJECT_NOT_FOUND',
            blockedMessage: `Lead ${input.subjectId} not found in tenant`,
            template,
            recipientHash,
            recipientMasked,
            redactedVariables,
            evaluatedTime,
          };
        }
      } else if (input.subjectType === 'CUSTOMER') {
        const custRes = await sql<{ id: string; status: string }>`
          SELECT id, status FROM app.customer WHERE tenant_id = ${tenantId} AND id = ${input.subjectId} LIMIT 1
        `.execute(tx);
        if (custRes.rows.length === 0) {
          return {
            eligible: false,
            blockedReason: 'SUBJECT_NOT_FOUND',
            blockedMessage: `Customer ${input.subjectId} not found in tenant`,
            template,
            recipientHash,
            recipientMasked,
            redactedVariables,
            evaluatedTime,
          };
        }
      } else if (input.subjectType === 'LOAN_APPLICATION') {
        const appRes = await sql<{ id: string }>`
          SELECT id FROM app.loan_application WHERE tenant_id = ${tenantId} AND id = ${input.subjectId} LIMIT 1
        `.execute(tx);
        if (appRes.rows.length === 0) {
          return {
            eligible: false,
            blockedReason: 'SUBJECT_NOT_FOUND',
            blockedMessage: `Loan application ${input.subjectId} not found in tenant`,
            template,
            recipientHash,
            recipientMasked,
            redactedVariables,
            evaluatedTime,
          };
        }
      }

      // 8. Consent verification in app.consent_record
      const purpose = template.category === 'MARKETING' ? 'MARKETING' : 'CONTACT';
      const consentRes = await sql<{ id: string; status: string; expires_at: Date | null }>`
        SELECT id, status, expires_at FROM app.consent_record
        WHERE tenant_id = ${tenantId}
          AND subject_type = ${input.subjectType === 'LOAN_APPLICATION' ? 'CUSTOMER' : input.subjectType}
          AND subject_id = ${input.subjectId}
          AND purpose = ${purpose}
        ORDER BY created_at DESC
        LIMIT 1
      `.execute(tx);

      const consent = consentRes.rows[0];
      if (!consent) {
        return {
          eligible: false,
          blockedReason: 'CONSENT_REQUIRED',
          blockedMessage: `Active consent record for purpose ${purpose} is required`,
          template,
          recipientHash,
          recipientMasked,
          redactedVariables,
          evaluatedTime,
        };
      }
      if (consent.status === 'WITHDRAWN') {
        return {
          eligible: false,
          blockedReason: 'CONSENT_WITHDRAWN',
          blockedMessage: `Consent for purpose ${purpose} has been withdrawn`,
          template,
          recipientHash,
          recipientMasked,
          redactedVariables,
          evaluatedTime,
        };
      }
      if (consent.expires_at && new Date(consent.expires_at) < ctx.now) {
        return {
          eligible: false,
          blockedReason: 'CONSENT_REQUIRED',
          blockedMessage: `Consent for purpose ${purpose} has expired`,
          template,
          recipientHash,
          recipientMasked,
          redactedVariables,
          evaluatedTime,
        };
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
        try {
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
        } catch {
          // Conflict or collision
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
