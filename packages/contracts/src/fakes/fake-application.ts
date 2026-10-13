// packages/contracts/src/fakes/fake-application.ts — owner: Dev 3 (Gate 1 deliverable)
import type { RequestContext, Tx } from '../kernel';
import type { ApplicationPort, CreateDraftFromConversionCommand } from '../ports/application-port';

export class FakeApplicationPort implements ApplicationPort {
  readonly commands: CreateDraftFromConversionCommand[] = [];

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
}
