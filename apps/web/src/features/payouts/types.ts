export type PayoutRequestStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED'
  | 'PAYMENT_RECORDED'
  | 'PAYMENT_FAILED'
  | 'RECONCILED';

export interface PayoutLine {
  id: string;
  payoutId: string;
  payableId: string;
  amount: string;
  currency: string;
  status: string;
  createdAt: string;
}

export interface PayoutRequest {
  id: string;
  tenantId: string;
  connectorId: string;
  origin: 'CONNECTOR' | 'FINANCE';
  status: PayoutRequestStatus;
  total: string;
  currency: string;
  paymentRefMasked: string | null;
  paidOn: string | null;
  failureReason: string | null;
  submittedBy: string;
  submittedAt: string;
  lockVersion: number;
  lines?: PayoutLine[];
  createdAt: string;
  updatedAt: string;
}

export interface PayoutBatch {
  id: string;
  tenantId: string;
  payoutIds: string[];
  fileObjectKey: string;
  fileSha256: string;
  status: string;
  generatedBy: string;
  createdAt: string;
}

export interface CreatePayoutRequestInput {
  connectorId: string;
  origin?: 'CONNECTOR' | 'FINANCE';
  payableIds: string[];
}

export interface ApprovePayoutRequestInput {
  decision: 'APPROVED' | 'REJECTED';
  comment?: string;
}

export interface RecordPayoutPaymentInput {
  paymentRef: string;
  paidOn?: string;
}

export interface RecordPayoutFailureInput {
  failureReason: string;
}

export interface CreatePayoutBatchInput {
  payoutIds: string[];
}
