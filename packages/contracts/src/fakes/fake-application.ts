// packages/contracts/src/fakes/fake-application.ts — owner: Dev 3 (Gate 1 deliverable)
import type { RequestContext, Tx } from '../kernel';
import type {
  ApplicationPort,
  CreateDraftFromConversionCommand,
  SubmissionDocuments,
} from '../ports/application-port';

export class FakeApplicationPort implements ApplicationPort {
  readonly commands: CreateDraftFromConversionCommand[] = [];
  /** Keyed by applicationId; tests seed it. An application without an entry has a complete, empty checklist. */
  readonly submissionDocuments = new Map<string, SubmissionDocuments>();
  /** The checklist items reported through onChecklistItemChanged, in order. */
  readonly checklistChanges: string[] = [];

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

  async onChecklistItemChanged(_tx: Tx, _ctx: RequestContext, checklistItemId: string): Promise<{ advanced: boolean }> {
    this.checklistChanges.push(checklistItemId);
    return { advanced: false };
  }
}
