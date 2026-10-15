// packages/contracts/src/ports/crm-ports.ts — frozen at Gate 1 (Contracts §4.4)
// Owners (v1.2 Assignment Matrix §2): ConsentPort, PartyPort, DataSharingPort — Dev 5; UserDirectoryPort — Dev 1.
// Fakes: fakes/fake-{consent,party,data-sharing,user-directory}.ts (Contracts §4.5).
import type { RequestContext, Tx } from '../kernel';

export type ConsentPurpose =
  'CONTACT' | 'LOAN_PROCESSING' | 'SHARE_WITH_LENDER' | 'VERIFICATION_CHECK' | 'MARKETING';

export interface ConsentPort {
  /** ACTIVE consent on the customer OR on any lead whose customer_id = customerId (consents captured pre-conversion stay valid). */
  findActive(
    tx: Tx,
    q: { customerId: string; purpose: ConsentPurpose; purposeTarget?: string },
  ): Promise<{ consentId: string } | null>;
}

export interface Party {
  customerId: string;
  partyType: 'INDIVIDUAL' | 'ENTITY';
  displayNameMasked: string;
  homeBranchId: string;
}

export interface PartyPort {
  getParty(tx: Tx, customerId: string): Promise<Party | null>;
}

export interface DataSharingRecordInput {
  subjectType: 'LOAN_APPLICATION';
  subjectId: string;
  recipientType: 'LENDER' | 'CO_LENDER' | 'PARTNER' | 'AUDITOR';
  recipientId: string;
  purpose: 'LENDER_SUBMISSION' | 'PORTFOLIO_REVIEW' | 'AUDIT_INSPECTION';
  consentIds: string[];
  items: { fields: string[]; checklistItemIds: string[] };
  channel: 'PORTAL' | 'EMAIL' | 'API' | 'PHYSICAL';
  sourceRef: string;
}

export interface DataSharingPort {
  // FR-PRV-007 sharing inventory
  record(tx: Tx, ctx: RequestContext, r: DataSharingRecordInput): Promise<{ dataSharingRecordId: string }>;
}

export interface DirectoryUser {
  userId: string;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
  availability: 'AVAILABLE' | 'BUSY' | 'OFF_DUTY' | 'ON_LEAVE';
  primaryBranchId: string;
  branchIds: string[];
}

export interface DirectoryQueue {
  queueId: string;
  kind: string;
  branchId: string | null;
  active: boolean;
  recordTypes: string[];
}

export interface UserDirectoryPort {
  getUser(tx: Tx, userId: string): Promise<DirectoryUser | null>;
  getQueue(tx: Tx, queueId: string): Promise<DirectoryQueue | null>;
  findBranchQueue(tx: Tx, branchId: string, kind: 'INTAKE' | 'UNASSIGNED'): Promise<{ queueId: string }>;
  /** Round-robin among ACTIVE + AVAILABLE can_pick members (effective now); SELECT … FOR UPDATE on work_queue; advances cursor. */
  pickRoundRobin(tx: Tx, queueId: string): Promise<{ userId: string } | null>;
}
