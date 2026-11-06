// Commission plan lifecycle (containment report 5.7, P0): a plan becomes ACTIVE only through the approval route, a plan's terms change only
// while it is a DRAFT, and every change is audited. The real FinanceService runs against an in-memory repository that applies the same
// conditions as the SQL in repository.ts (tenant, lock version, state). The database-backed half, with step-up and cross-tenant HTTP
// access, is commission-plan-approval.int.spec.ts.
import type { AuditEventInput, AuditPort, RequestContext, Tx } from '@dsa/contracts';
import { AppError } from '@dsa/contracts';
import { describe, expect, it } from 'vitest';
import type { CommissionPlanRow, FinanceRepository } from '../src/modules/finance/repository';
import { FinanceService } from '../src/modules/finance/finance-service';
import { testPrincipal } from './support/fake-auth';

const TENANT = 'ten_plan_state_a';
const OTHER_TENANT = 'ten_plan_state_b';
const LENDER = 'lnd_01J00000000000000000000001';

function fakeRepository() {
  const rows = new Map<string, CommissionPlanRow>();
  let seq = 0;
  const repo = {
    rows,
    async insertCommissionPlan(_tx: Tx, row: CommissionPlanRow) {
      rows.set(row.id, { ...row });
    },
    async findCommissionPlanById(_tx: Tx, tenantId: string, id: string) {
      const r = rows.get(id);
      return r && r.tenant_id === tenantId ? { ...r } : null;
    },
    async findActiveCommissionPlan() {
      return null;
    },
    async listCommissionPlans() {
      return [...rows.values()];
    },
    // Mirrors repository.ts: tenant, lock version, and the DRAFT condition are all part of the write.
    async updateCommissionPlan(
      _tx: Tx,
      tenantId: string,
      id: string,
      lock: number,
      updates: Partial<CommissionPlanRow>,
    ) {
      const r = rows.get(id);
      if (!r || r.tenant_id !== tenantId || r.lock_version !== lock || r.status !== 'DRAFT') return null;
      const defined = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      const next = { ...r, ...defined, lock_version: r.lock_version + 1 } as CommissionPlanRow;
      rows.set(id, next);
      return { ...next };
    },
    // Mirrors repository.ts: only a plan awaiting approval is approved.
    async approveCommissionPlan(_tx: Tx, tenantId: string, id: string, lock: number, approverId: string) {
      const r = rows.get(id);
      if (!r || r.tenant_id !== tenantId || r.lock_version !== lock) return null;
      if (r.status !== 'DRAFT' && r.status !== 'PENDING_APPROVAL') return null;
      const next = {
        ...r,
        status: 'ACTIVE',
        lock_version: r.lock_version + 1,
        updated_by: approverId,
      } as CommissionPlanRow;
      rows.set(id, next);
      return { ...next };
    },
    nextSeq: () => ++seq,
  };
  return repo;
}

function setup() {
  const repo = fakeRepository();
  const audits: AuditEventInput[] = [];
  const audit: AuditPort = {
    async record(_tx, _ctx, e) {
      audits.push(e);
      return `aud_${audits.length}`;
    },
  };
  const service = new FinanceService({ repository: repo as unknown as FinanceRepository, audit });
  return { service, repo, audits };
}

const tx = {} as Tx;
const ctxOf = (principal: ReturnType<typeof testPrincipal>): RequestContext => ({
  principal,
  correlationId: 'corr-plan-state',
  now: new Date(),
});
const editor = testPrincipal({
  id: 'usr_plan_editor',
  tenantId: TENANT,
  grants: [{ code: 'commission.plan.edit', scope: 'TENANT', branchIds: [] }],
});
const checker = testPrincipal({
  id: 'usr_plan_checker',
  tenantId: TENANT,
  grants: [{ code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] }],
});
const outsider = testPrincipal({
  id: 'usr_plan_outsider',
  tenantId: OTHER_TENANT,
  grants: [
    { code: 'commission.view', scope: 'TENANT', branchIds: [] },
    { code: 'commission.plan.edit', scope: 'TENANT', branchIds: [] },
    { code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] },
  ],
});

async function createDraft(service: FinanceService, principal = editor) {
  const plan = await service.createCommissionPlan(tx, ctxOf(principal), { lenderId: LENDER } as never);
  return plan;
}

describe('commission plan lifecycle (TEST-COMSTATE)', () => {
  it('TEST-COMSTATE-001 a new plan is a DRAFT, and its creation is audited', async () => {
    const { service, audits } = setup();
    const plan = await createDraft(service);
    expect(plan.status).toBe('DRAFT');
    expect(audits.map((a) => a.action)).toEqual(['commission_plan.created']);
  });

  it('TEST-COMSTATE-002 an editor changes the terms of a DRAFT plan, and the change is audited with before and after', async () => {
    const { service, audits } = setup();
    const plan = await createDraft(service);
    const updated = await service.updateCommissionPlan(tx, ctxOf(editor), plan.id, plan.lockVersion, {
      basis: 'NET_LOAN',
    } as never);
    expect(updated.basis).toBe('NET_LOAN');
    expect(updated.status).toBe('DRAFT');
    expect(updated.lockVersion).toBe(plan.lockVersion + 1);
    const event = audits.find((a) => a.action === 'commission_plan.updated');
    expect(event).toBeDefined();
    expect(event!.entityId).toBe(plan.id);
    expect(event!.before).toMatchObject({ status: 'DRAFT' });
    expect(event!.after).toMatchObject({ status: 'DRAFT', basis: 'NET_LOAN' });
  });

  it('TEST-COMSTATE-003 a PATCH that names ACTIVE is refused, even from an editor, and the plan stays a DRAFT', async () => {
    const { service, repo, audits } = setup();
    const plan = await createDraft(service);
    const auditsBefore = audits.length;
    const err = await service
      .updateCommissionPlan(tx, ctxOf(editor), plan.id, plan.lockVersion, { status: 'ACTIVE' } as never)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((err as AppError).details[0]).toMatchObject({ field: 'status', issue: 'USE_APPROVAL_ROUTE' });
    expect(repo.rows.get(plan.id)!.status).toBe('DRAFT');
    expect(audits.length).toBe(auditsBefore);
  });

  it('TEST-COMSTATE-004 a PATCH that names any status is refused, DRAFT included: status is not an edit field', async () => {
    const { service, repo } = setup();
    const plan = await createDraft(service);
    for (const status of ['DRAFT', 'PENDING_APPROVAL', 'RETIRED']) {
      await expect(
        service.updateCommissionPlan(tx, ctxOf(editor), plan.id, plan.lockVersion, { status } as never),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(repo.rows.get(plan.id)!.status).toBe('DRAFT');
  });

  it('TEST-COMSTATE-005 an ACTIVE plan cannot be edited: its terms and version do not change', async () => {
    const { service, repo } = setup();
    const plan = await createDraft(service);
    const active = await service.approveCommissionPlan(
      tx,
      ctxOf(checker),
      plan.id,
      plan.lockVersion,
      {} as never,
    );
    expect(active.status).toBe('ACTIVE');
    const before = { ...repo.rows.get(plan.id)! };
    const err = await service
      .updateCommissionPlan(tx, ctxOf(editor), plan.id, active.lockVersion, { basis: 'NET_LOAN' } as never)
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'INVALID_STATE' });
    expect((err as AppError).details[0]).toMatchObject({ issue: 'PLAN_NOT_DRAFT' });
    expect(repo.rows.get(plan.id)).toEqual(before);
  });

  it('TEST-COMSTATE-006 a plan cannot be created as ACTIVE, and nothing is stored', async () => {
    const { service, repo } = setup();
    await expect(
      service.createCommissionPlan(tx, ctxOf(editor), { lenderId: LENDER, status: 'ACTIVE' } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(repo.rows.size).toBe(0);
  });

  it('TEST-COMSTATE-007 another user with the approval permission activates a DRAFT, and the approval is audited', async () => {
    const { service, audits } = setup();
    const plan = await createDraft(service);
    const approved = await service.approveCommissionPlan(
      tx,
      ctxOf(checker),
      plan.id,
      plan.lockVersion,
      {} as never,
    );
    expect(approved.status).toBe('ACTIVE');
    const event = audits.find((a) => a.action === 'commission_plan.approved');
    expect(event).toBeDefined();
    expect(event!.entityId).toBe(plan.id);
    expect(event!.before).toMatchObject({ status: 'DRAFT' });
    expect(event!.after).toMatchObject({ status: 'ACTIVE' });
    expect(event!.permissionUsed).toBe('commission.plan.approve');
  });

  it('TEST-COMSTATE-008 the creator cannot approve their own plan (SOD-02), and the plan stays a DRAFT', async () => {
    const { service, repo } = setup();
    const plan = await createDraft(service);
    const creatorWithApproval = testPrincipal({
      id: editor.id,
      tenantId: TENANT,
      grants: [...editor.grants, { code: 'commission.plan.approve', scope: 'TENANT', branchIds: [] }],
    });
    await expect(
      service.approveCommissionPlan(tx, ctxOf(creatorWithApproval), plan.id, plan.lockVersion, {} as never),
    ).rejects.toMatchObject({ code: 'SOD_VIOLATION' });
    expect(repo.rows.get(plan.id)!.status).toBe('DRAFT');
  });

  it('TEST-COMSTATE-009 an ACTIVE or RETIRED plan is not approved again (invalid state transition)', async () => {
    const { service, repo } = setup();
    const plan = await createDraft(service);
    const active = await service.approveCommissionPlan(
      tx,
      ctxOf(checker),
      plan.id,
      plan.lockVersion,
      {} as never,
    );
    await expect(
      service.approveCommissionPlan(tx, ctxOf(checker), plan.id, active.lockVersion, {} as never),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    repo.rows.get(plan.id)!.status = 'RETIRED';
    await expect(
      service.approveCommissionPlan(tx, ctxOf(checker), plan.id, active.lockVersion, {} as never),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(repo.rows.get(plan.id)!.status).toBe('RETIRED');
  });

  it('TEST-COMSTATE-010 a user without the approval permission cannot approve, and the plan stays a DRAFT', async () => {
    const { service, repo } = setup();
    const plan = await createDraft(service);
    await expect(
      service.approveCommissionPlan(tx, ctxOf(editor), plan.id, plan.lockVersion, {} as never),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(repo.rows.get(plan.id)!.status).toBe('DRAFT');
  });

  it('TEST-COMSTATE-011 another tenant cannot read, edit or approve a plan, and the plan is unchanged', async () => {
    const { service, repo, audits } = setup();
    const plan = await createDraft(service);
    const before = { ...repo.rows.get(plan.id)! };
    const auditCount = audits.length;
    await expect(service.getCommissionPlan(tx, ctxOf(outsider), plan.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service.updateCommissionPlan(tx, ctxOf(outsider), plan.id, plan.lockVersion, {
        basis: 'NET_LOAN',
      } as never),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      service.approveCommissionPlan(tx, ctxOf(outsider), plan.id, plan.lockVersion, {} as never),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(repo.rows.get(plan.id)).toEqual(before);
    expect(audits.length).toBe(auditCount);
  });

  it('TEST-COMSTATE-012 an edit or approval against a stale version is refused, and the plan is unchanged', async () => {
    const { service, repo } = setup();
    const plan = await createDraft(service);
    const before = { ...repo.rows.get(plan.id)! };
    await expect(
      service.updateCommissionPlan(tx, ctxOf(editor), plan.id, plan.lockVersion + 5, {
        basis: 'NET_LOAN',
      } as never),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(
      service.approveCommissionPlan(tx, ctxOf(checker), plan.id, plan.lockVersion + 5, {} as never),
    ).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(repo.rows.get(plan.id)).toEqual(before);
  });
});
