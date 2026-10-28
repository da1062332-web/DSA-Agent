// packages/contracts/src/fakes/fake-application.ts — owner: Dev 3 (Gate 1 deliverable)
import type { RequestContext, Tx } from '../kernel';
import type {
  ApplicationPort,
  ApplicationRollUpCommand,
  ApplicationRollUpResult,
  ApplicationSummary,
  CreateDraftFromConversionCommand,
  SubmissionDocuments,
} from '../ports/application-port';

export class FakeApplicationPort implements ApplicationPort {
  readonly commands: CreateDraftFromConversionCommand[] = [];
  /** Keyed by applicationId; tests seed it. An application without an entry has a complete, empty checklist. */
  readonly submissionDocuments = new Map<string, SubmissionDocuments>();
  /** Keyed by `${tenantId}:${applicationId}`; tests seed it with seedApplication. */
  readonly applications = new Map<string, ApplicationSummary>();
  /** Every roll-up applied, in order, with the tenant it ran in. */
  readonly rollUps: (ApplicationRollUpCommand & { tenantId: string })[] = [];

  seedApplication(tenantId: string, application: ApplicationSummary): void {
    this.applications.set(`${tenantId}:${application.id}`, { ...application });
  }

  async createDraftFromConversion(
    _tx: Tx,
    _ctx: RequestContext,
    cmd: CreateDraftFromConversionCommand,
  ): Promise<{ applicationId: string; status: 'DRAFT' }> {
    this.commands.push(cmd);
    return {
      applicationId: `app_${cmd.leadId.replace(/^lead_/, '')}`,
      status: 'DRAFT',
    };
  }

  async getSubmissionDocuments(_tx: Tx, _ctx: RequestContext, applicationId: string): Promise<SubmissionDocuments> {
    return this.submissionDocuments.get(applicationId) ?? { complete: true, documents: [] };
  }

  async getApplicationSummary(
    _tx: Tx,
    ctx: RequestContext,
    applicationId: string,
  ): Promise<ApplicationSummary | null> {
    const a = this.applications.get(`${ctx.principal.tenantId}:${applicationId}`);
    return a ? { ...a } : null;
  }

  async rollUpStatus(
    _tx: Tx,
    ctx: RequestContext,
    cmd: ApplicationRollUpCommand,
  ): Promise<ApplicationRollUpResult | null> {
    const key = `${ctx.principal.tenantId}:${cmd.applicationId}`;
    const a = this.applications.get(key);
    if (!a) return null;
    const fromStatus = a.status;
    const changed = a.status !== cmd.toStatus || a.subStatus !== cmd.toSubStatus;
    if (changed) {
      this.rollUps.push({ ...cmd, tenantId: ctx.principal.tenantId });
      this.applications.set(key, { ...a, status: cmd.toStatus, subStatus: cmd.toSubStatus, version: a.version + 1 });
    }
    return { applicationId: a.id, fromStatus, toStatus: cmd.toStatus, changed };
  }
}
