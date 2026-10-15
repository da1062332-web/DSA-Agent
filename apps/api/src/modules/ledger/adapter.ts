// apps/api/src/modules/ledger/adapter.ts — Concrete Ledger Adapters for MOD-PAY and MOD-REC
import type { RequestContext, Tx } from '@dsa/contracts';
import type { SettlementJournalPort } from '../finance/finance-service';
import type { LedgerService } from './ledger-service';

export class LedgerSettlementJournalAdapter implements SettlementJournalPort {
  constructor(private readonly ledgerService: LedgerService) {}

  async postSettlementJournal(
    tx: Tx,
    tenantId: string,
    entry: {
      sourceRef?: string;
      payoutId?: string;
      amount?: string | number;
      currency?: string;
      paidOn?: Date;
      referenceId?: string;
      referenceType?: 'PAYOUT_RECORDING';
      narration?: string;
      lines: Array<{
        accountCode: string;
        entryType: 'DEBIT' | 'CREDIT';
        amount: string | number;
        narration?: string;
      }>;
    },
  ): Promise<{ entryId: string }> {
    const period = (entry.paidOn ?? new Date()).toISOString().substring(0, 7); // YYYY-MM
    const refId = entry.payoutId ?? entry.sourceRef ?? entry.referenceId ?? `pay_${Date.now()}`;
    const ctx: RequestContext = {
      principal: {
        id: 'SYSTEM:ledger-adapter',
        tenantId,
        kind: 'SERVICE',
        primaryBranchId: null,
        managedTeamMemberIds: [],
        queueIds: [],
        grants: [
          { code: 'finance.view', scope: 'TENANT', branchIds: [] },
          { code: 'payout.record_payment', scope: 'TENANT', branchIds: [] },
        ],
        authTime: null,
      },
      correlationId: `corr-settle-${refId}`,
      now: new Date(),
    };

    const journal = await this.ledgerService.postJournal(tx, ctx, {
      referenceType: 'PAYOUT_RECORDING',
      referenceId: refId,
      idempotencyKey: `idem_payout_${refId}`,
      period,
      currency: entry.currency ?? 'INR',
      narration: entry.narration ?? `Settlement payout ${refId}`,
      lines: entry.lines.map((l) => ({
        accountCode: l.accountCode,
        entryType: l.entryType,
        amount: String(l.amount),
        narration: l.narration,
      })),
    });

    return { entryId: journal.id };
  }
}
