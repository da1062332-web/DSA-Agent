import type { Tx } from '@dsa/contracts';
import type { DisbursementTrancheRow, SanctionRow } from './types';

export interface OutboxEventRecord {
  id: string;
  tenantId: string;
  eventName: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  occurredAt?: string;
}

export interface LenderCaseSummary {
  id: string;
  tenant_id: string;
  application_id: string;
  lender_id: string;
  status: string;
  lock_version: number;
}

export interface ApplicationSummary {
  id: string;
  tenant_id: string;
  status: string;
  sub_status: string | null;
  lock_version: number;
}

export interface SanctionRepository {
  findLenderCase(tx: Tx, tenantId: string, caseId: string): Promise<LenderCaseSummary | null>;
  findApplication(tx: Tx, tenantId: string, appId: string): Promise<ApplicationSummary | null>;
  findSanctionById(tx: Tx, tenantId: string, id: string): Promise<SanctionRow | null>;
  listSanctionsByCase(tx: Tx, tenantId: string, lenderCaseId: string): Promise<SanctionRow[]>;
  insertSanction(tx: Tx, row: SanctionRow): Promise<SanctionRow>;
  updateSanction(tx: Tx, row: SanctionRow): Promise<SanctionRow>;
  findTrancheById(tx: Tx, tenantId: string, id: string): Promise<DisbursementTrancheRow | null>;
  listTranchesBySanction(tx: Tx, tenantId: string, sanctionId: string): Promise<DisbursementTrancheRow[]>;
  insertTranche(tx: Tx, row: DisbursementTrancheRow): Promise<DisbursementTrancheRow>;
  updateTranche(tx: Tx, row: DisbursementTrancheRow): Promise<DisbursementTrancheRow>;
  updateLenderCaseStatus(
    tx: Tx,
    tenantId: string,
    caseId: string,
    newStatus: string,
    actor: string,
    reasonText?: string | null,
  ): Promise<void>;
  updateApplicationStatus(
    tx: Tx,
    tenantId: string,
    appId: string,
    newStatus: string,
    subStatus: string | null,
    transitionCode: string,
    actor: string,
    causedByCaseId?: string,
  ): Promise<void>;
  findExpiringSanctions(tx: Tx, tenantId: string, currentDate: string): Promise<SanctionRow[]>;
  emitOutboxEvent(tx: Tx, event: OutboxEventRecord): Promise<void>;
}

export class SqlSanctionRepository implements SanctionRepository {
  async findLenderCase(tx: Tx, tenantId: string, caseId: string): Promise<LenderCaseSummary | null> {
    const res = await (tx as any).query(
      `SELECT id, tenant_id, application_id, lender_id, status, lock_version
       FROM app.lender_case
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, caseId],
    );
    return res.rows[0] ?? null;
  }

  async findApplication(tx: Tx, tenantId: string, appId: string): Promise<ApplicationSummary | null> {
    const res = await (tx as any).query(
      `SELECT id, tenant_id, status, sub_status, lock_version
       FROM app.loan_application
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, appId],
    );
    return res.rows[0] ?? null;
  }

  async findSanctionById(tx: Tx, tenantId: string, id: string): Promise<SanctionRow | null> {
    const res = await (tx as any).query(
      `SELECT * FROM app.sanction WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows[0] ?? null;
  }

  async listSanctionsByCase(tx: Tx, tenantId: string, lenderCaseId: string): Promise<SanctionRow[]> {
    const res = await (tx as any).query(
      `SELECT * FROM app.sanction
       WHERE tenant_id = $1 AND lender_case_id = $2
       ORDER BY version ASC`,
      [tenantId, lenderCaseId],
    );
    return res.rows;
  }

  async insertSanction(tx: Tx, row: SanctionRow): Promise<SanctionRow> {
    const res = await (tx as any).query(
      `INSERT INTO app.sanction (
        id, tenant_id, lender_case_id, version, amount, tenure_months, rate_value,
        rate_type, benchmark_text, fees_text, conditions, sanction_date, valid_until,
        letter_document_id, status, source, cancel_reason, lock_version,
        created_at, created_by, updated_at, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18,
        $19, $20, $21, $22
      ) RETURNING *`,
      [
        row.id,
        row.tenant_id,
        row.lender_case_id,
        row.version,
        row.amount,
        row.tenure_months,
        row.rate_value,
        row.rate_type,
        row.benchmark_text,
        row.fees_text,
        row.conditions,
        row.sanction_date,
        row.valid_until,
        row.letter_document_id,
        row.status,
        row.source,
        row.cancel_reason,
        row.lock_version,
        row.created_at,
        row.created_by,
        row.updated_at,
        row.updated_by,
      ],
    );
    return res.rows[0];
  }

  async updateSanction(tx: Tx, row: SanctionRow): Promise<SanctionRow> {
    const res = await (tx as any).query(
      `UPDATE app.sanction SET
        status = $3,
        cancel_reason = $4,
        lock_version = lock_version + 1,
        updated_at = now(),
        updated_by = $5
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [row.tenant_id, row.id, row.status, row.cancel_reason, row.updated_by],
    );
    return res.rows[0];
  }

  async findTrancheById(tx: Tx, tenantId: string, id: string): Promise<DisbursementTrancheRow | null> {
    const res = await (tx as any).query(
      `SELECT * FROM app.disbursement_tranche WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );
    return res.rows[0] ?? null;
  }

  async listTranchesBySanction(tx: Tx, tenantId: string, sanctionId: string): Promise<DisbursementTrancheRow[]> {
    const res = await (tx as any).query(
      `SELECT * FROM app.disbursement_tranche
       WHERE tenant_id = $1 AND sanction_id = $2
       ORDER BY tranche_no ASC`,
      [tenantId, sanctionId],
    );
    return res.rows;
  }

  async insertTranche(tx: Tx, row: DisbursementTrancheRow): Promise<DisbursementTrancheRow> {
    const res = await (tx as any).query(
      `INSERT INTO app.disbursement_tranche (
        id, tenant_id, sanction_id, tranche_no, amount, currency, disbursed_on,
        utr_ciphertext, utr_masked, loan_account_ciphertext, loan_account_masked,
        evidence_document_id, status, recorded_by, verified_by, verified_at,
        verification_comment, exception_approval_id, voided_by, void_reason,
        replaced_by_tranche_id, lock_version, created_at, created_by, updated_at, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15, $16,
        $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26
      ) RETURNING *`,
      [
        row.id,
        row.tenant_id,
        row.sanction_id,
        row.tranche_no,
        row.amount,
        row.currency,
        row.disbursed_on,
        row.utr_ciphertext,
        row.utr_masked,
        row.loan_account_ciphertext,
        row.loan_account_masked,
        row.evidence_document_id,
        row.status,
        row.recorded_by,
        row.verified_by,
        row.verified_at,
        row.verification_comment,
        row.exception_approval_id,
        row.voided_by,
        row.void_reason,
        row.replaced_by_tranche_id,
        row.lock_version,
        row.created_at,
        row.created_by,
        row.updated_at,
        row.updated_by,
      ],
    );
    return res.rows[0];
  }

  async updateTranche(tx: Tx, row: DisbursementTrancheRow): Promise<DisbursementTrancheRow> {
    const res = await (tx as any).query(
      `UPDATE app.disbursement_tranche SET
        status = $3,
        verified_by = $4,
        verified_at = $5,
        verification_comment = $6,
        exception_approval_id = $7,
        voided_by = $8,
        void_reason = $9,
        replaced_by_tranche_id = $10,
        lock_version = lock_version + 1,
        updated_at = now(),
        updated_by = $11
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [
        row.tenant_id,
        row.id,
        row.status,
        row.verified_by,
        row.verified_at,
        row.verification_comment,
        row.exception_approval_id,
        row.voided_by,
        row.void_reason,
        row.replaced_by_tranche_id,
        row.updated_by,
      ],
    );
    return res.rows[0];
  }

  async updateLenderCaseStatus(
    tx: Tx,
    tenantId: string,
    caseId: string,
    newStatus: string,
    actor: string,
    reasonText?: string | null,
  ): Promise<void> {
    const oldCase = await this.findLenderCase(tx, tenantId, caseId);
    if (!oldCase) return;

    await (tx as any).query(
      `UPDATE app.lender_case SET
        status = $3,
        last_status_at = now(),
        lock_version = lock_version + 1,
        updated_at = now(),
        updated_by = $4
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, caseId, newStatus, actor],
    );

    const histId = `lcsh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await (tx as any).query(
      `INSERT INTO app.lender_case_status_history (
        id, tenant_id, lender_case_id, from_status, to_status, status_source, reason_text, actor, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, 'MANUAL', $6, $7, now())`,
      [histId, tenantId, caseId, oldCase.status, newStatus, reasonText ?? null, actor],
    );
  }

  async updateApplicationStatus(
    tx: Tx,
    tenantId: string,
    appId: string,
    newStatus: string,
    subStatus: string | null,
    transitionCode: string,
    actor: string,
    causedByCaseId?: string,
  ): Promise<void> {
    const oldApp = await this.findApplication(tx, tenantId, appId);
    if (!oldApp) return;

    await (tx as any).query(
      `UPDATE app.loan_application SET
        status = $3,
        sub_status = $4,
        lock_version = lock_version + 1,
        updated_at = now(),
        updated_by = $5
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, appId, newStatus, subStatus, actor],
    );

    const histId = `ash_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await (tx as any).query(
      `INSERT INTO app.application_status_history (
        id, tenant_id, application_id, from_status, to_status, from_sub_status, to_sub_status,
        transition_code, caused_by_lender_case_id, actor, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
      [
        histId,
        tenantId,
        appId,
        oldApp.status,
        newStatus,
        oldApp.sub_status,
        subStatus,
        transitionCode,
        causedByCaseId ?? null,
        actor,
      ],
    );
  }

  async findExpiringSanctions(tx: Tx, tenantId: string, currentDate: string): Promise<SanctionRow[]> {
    const res = await (tx as any).query(
      `SELECT * FROM app.sanction
       WHERE tenant_id = $1 AND status = 'ACTIVE' AND valid_until < $2
       ORDER BY valid_until ASC`,
      [tenantId, currentDate],
    );
    return res.rows;
  }

  async emitOutboxEvent(tx: Tx, event: OutboxEventRecord): Promise<void> {
    await (tx as any).query(
      `INSERT INTO app.outbox_event (
        id, tenant_id, event_name, aggregate_type, aggregate_id, payload, occurred_at
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())`,
      [event.id, event.tenantId, event.eventName, event.aggregateType, event.aggregateId, JSON.stringify(event.payload)],
    );
  }
}

export class InMemorySanctionRepository implements SanctionRepository {
  readonly sanctions = new Map<string, SanctionRow>();
  readonly tranches = new Map<string, DisbursementTrancheRow>();
  readonly lenderCases = new Map<string, LenderCaseSummary>();
  readonly applications = new Map<string, ApplicationSummary>();
  readonly outboxEvents: OutboxEventRecord[] = [];

  async findLenderCase(_tx: Tx, tenantId: string, caseId: string): Promise<LenderCaseSummary | null> {
    const k = `${tenantId}:${caseId}`;
    return this.lenderCases.get(k) ?? null;
  }

  async findApplication(_tx: Tx, tenantId: string, appId: string): Promise<ApplicationSummary | null> {
    const k = `${tenantId}:${appId}`;
    return this.applications.get(k) ?? null;
  }

  async findSanctionById(_tx: Tx, tenantId: string, id: string): Promise<SanctionRow | null> {
    const k = `${tenantId}:${id}`;
    return this.sanctions.get(k) ?? null;
  }

  async listSanctionsByCase(_tx: Tx, tenantId: string, lenderCaseId: string): Promise<SanctionRow[]> {
    return Array.from(this.sanctions.values())
      .filter((s) => s.tenant_id === tenantId && s.lender_case_id === lenderCaseId)
      .sort((a, b) => a.version - b.version);
  }

  async insertSanction(_tx: Tx, row: SanctionRow): Promise<SanctionRow> {
    const k = `${row.tenant_id}:${row.id}`;
    this.sanctions.set(k, { ...row });
    return { ...row };
  }

  async updateSanction(_tx: Tx, row: SanctionRow): Promise<SanctionRow> {
    const k = `${row.tenant_id}:${row.id}`;
    const updated = { ...row, lock_version: row.lock_version + 1, updated_at: new Date().toISOString() };
    this.sanctions.set(k, updated);
    return updated;
  }

  async findTrancheById(_tx: Tx, tenantId: string, id: string): Promise<DisbursementTrancheRow | null> {
    const k = `${tenantId}:${id}`;
    return this.tranches.get(k) ?? null;
  }

  async listTranchesBySanction(_tx: Tx, tenantId: string, sanctionId: string): Promise<DisbursementTrancheRow[]> {
    return Array.from(this.tranches.values())
      .filter((t) => t.tenant_id === tenantId && t.sanction_id === sanctionId)
      .sort((a, b) => a.tranche_no - b.tranche_no);
  }

  async insertTranche(_tx: Tx, row: DisbursementTrancheRow): Promise<DisbursementTrancheRow> {
    const k = `${row.tenant_id}:${row.id}`;
    this.tranches.set(k, { ...row });
    return { ...row };
  }

  async updateTranche(_tx: Tx, row: DisbursementTrancheRow): Promise<DisbursementTrancheRow> {
    const k = `${row.tenant_id}:${row.id}`;
    const updated = { ...row, lock_version: row.lock_version + 1, updated_at: new Date().toISOString() };
    this.tranches.set(k, updated);
    return updated;
  }

  async updateLenderCaseStatus(
    _tx: Tx,
    tenantId: string,
    caseId: string,
    newStatus: string,
    _actor: string,
    _reasonText?: string | null,
  ): Promise<void> {
    const k = `${tenantId}:${caseId}`;
    const existing = this.lenderCases.get(k);
    if (existing) {
      existing.status = newStatus;
      existing.lock_version++;
    }
  }

  async updateApplicationStatus(
    _tx: Tx,
    tenantId: string,
    appId: string,
    newStatus: string,
    subStatus: string | null,
    _transitionCode: string,
    _actor: string,
    _causedByCaseId?: string,
  ): Promise<void> {
    const k = `${tenantId}:${appId}`;
    const existing = this.applications.get(k);
    if (existing) {
      existing.status = newStatus;
      existing.sub_status = subStatus;
      existing.lock_version++;
    }
  }

  async findExpiringSanctions(_tx: Tx, tenantId: string, currentDate: string): Promise<SanctionRow[]> {
    return Array.from(this.sanctions.values())
      .filter((s) => s.tenant_id === tenantId && s.status === 'ACTIVE' && s.valid_until < currentDate)
      .sort((a, b) => a.valid_until.localeCompare(b.valid_until));
  }

  async emitOutboxEvent(_tx: Tx, event: OutboxEventRecord): Promise<void> {
    this.outboxEvents.push(event);
  }
}
