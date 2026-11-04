// apps/api/src/modules/finance/payment-gateway.ts
// Payment-rail gateway for payouts (MOD-PAY). No payment-rail integration is configured, so every disbursement is refused and nothing is
// recorded. The earlier version generated its own bank reference and bank acknowledgement and so recorded payments that never moved money
// (AUD-P0-02, docs/CONNECTOR_COMPREHENSIVE_AUDIT.md). A real integration must take its reference from the bank, and that is the only
// reference the system may record.
import { AppError } from '@dsa/contracts';

export interface GatewayBeneficiary {
  accountNumber: string;
  ifsc: string;
  beneficiaryName: string;
}

export interface GatewayDisbursementRequest {
  payoutId: string;
  amount: number | string;
  currency: string;
  mode: 'IMPS' | 'NEFT' | 'RTGS';
  beneficiary?: GatewayBeneficiary;
  narration?: string;
}

export interface GatewayDisbursementResult {
  transferId: string;
  payoutId: string;
  utrNumber: string;
  gatewayMode: 'IMPS' | 'NEFT' | 'RTGS';
  status: 'SUCCESS' | 'PROCESSING';
  amount: string;
  currency: string;
  disbursedAt: string;
  bankAckSignature: string;
}

export class PaymentGatewayService {
  /**
   * Refused until a payment-rail integration exists. The request is still validated first, so a bad amount or an RTGS below the threshold
   * gets its own message. No reference is generated, no signature is made, and no payment is recorded. The caller's transaction is rolled back.
   */
  async disburse(req: GatewayDisbursementRequest): Promise<GatewayDisbursementResult> {
    const numAmount = Number(req.amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw AppError.of('VALIDATION_ERROR', `Invalid disbursement amount: ${req.amount}`);
    }

    // RTGS minimum threshold validation (standard RBI rule: minimum 2,00,000 INR for RTGS)
    if (req.mode === 'RTGS' && numAmount < 200000) {
      throw AppError.of(
        'VALIDATION_ERROR',
        'RTGS requires a minimum transfer amount of ₹2,00,000. Use IMPS or NEFT.',
      );
    }

    throw AppError.of(
      'DEPENDENCY_UNAVAILABLE',
      'Gateway disbursement is not available: no payment-rail integration is configured. Pay the payout through a bank-file batch and record the bank reference.',
      [{ issue: 'GATEWAY_NOT_CONFIGURED' }],
    );
  }

  /**
   * Disburse a batch of payouts through payment gateway. Refused at the first payout, so no result is produced.
   */
  async disburseBatch(
    batchId: string,
    payouts: Array<{ id: string; amount: string; currency: string }>,
    mode: 'IMPS' | 'NEFT' | 'RTGS' = 'IMPS',
  ): Promise<{
    batchId: string;
    mode: string;
    results: GatewayDisbursementResult[];
    totalDisbursed: number;
  }> {
    const results: GatewayDisbursementResult[] = [];
    let total = 0;

    for (const p of payouts) {
      const res = await this.disburse({
        payoutId: p.id,
        amount: p.amount,
        currency: p.currency,
        mode,
        narration: `Batch payout ${batchId}`,
      });
      results.push(res);
      total += Number(p.amount);
    }

    return {
      batchId,
      mode,
      results,
      totalDisbursed: Math.round(total * 100) / 100,
    };
  }
}

export const paymentGatewayService = new PaymentGatewayService();
