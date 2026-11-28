// The lender MIS status import (P1-07 / TASK-140), through the real routes with in-memory ports.
// What these pin down: a status sheet moves cases through the same door a person's click uses, one bad row never
// costs the other rows, and a sheet re-sent tomorrow changes nothing.
import type {
  LenderCaseByReference,
  LenderCaseStatus,
  LenderCaseStatusPort,
  RequestContext,
  SanctionTranchePort,
  Tx,
  TxRunner,
} from '@dsa/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryImportRepository } from '../src/modules/platform/imports/repository';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const inMemoryTxRunner: TxRunner = {
  async withTenantTx<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const tx = {} as any;
    tx.tenantId = ctx.principal.tenantId;
    return fn(tx as Tx);
  },
};

const LENDER = 'lnd_hdfc';

/** The mapping an operator saved once for this bank. */
const mapping = {
  id: 'mism_1',
  tenant_id: 'ten_a',
  lender_id: LENDER,
  column_map: {
    'App No': 'lenderReference',
    Stage: 'status',
    Remarks: 'reasonText',
    'Disb Amt': 'disbursedAmount',
    'Disb Date': 'disbursedOn',
  },
  status_map: { 'Disb Done': 'DISBURSED', Sanctioned: 'SANCTIONED', 'In Process': 'UNDER_PROCESSING' },
  date_format: 'DD-MM-YYYY' as const,
  version: 3,
  last_import_at: null,
  lock_version: 0,
  created_at: new Date(),
  created_by: 'usr_ops',
  updated_at: new Date(),
  updated_by: 'usr_ops',
};

class FakeMisMappingRepository {
  public marked: string[] = [];
  constructor(private readonly row: typeof mapping | null = mapping) {}
  async findByLender() {
    return this.row;
  }
  async upsert() {
    return mapping;
  }
  async markImported(_tx: Tx, lenderId: string) {
    this.marked.push(lenderId);
  }
}

interface FakeCase {
  id: string;
  status: LenderCaseStatus;
  lockVersion: number;
}

function buildPorts(cases: Record<string, FakeCase>, opts: { sanction?: boolean; trancheThrows?: string } = {}) {
  const applied: Array<{ caseId: string; toStatus: string; source: string }> = [];
  const tranches: Array<{ sanctionId: string; amount: number; disbursedOn: string }> = [];
  let sweepBooked = 0;

  const statusPort: LenderCaseStatusPort = {
    async findByReference(_tx, lenderId, reference) {
      if (lenderId !== LENDER) return null;
      const found = cases[reference];
      if (!found) return null;
      return {
        id: found.id,
        lenderId,
        status: found.status,
        lockVersion: found.lockVersion,
      } satisfies LenderCaseByReference;
    },
    async applyStatus(_tx, _ctx, caseId, input) {
      // The real port refuses a move out of a terminal status; the fake refuses the same one, so the test exercises
      // the importer's handling of a refusal rather than a shape only the fake has.
      const entry = Object.values(cases).find((c) => c.id === caseId)!;
      if (entry.status === 'CLOSED') {
        throw new Error('CLOSED is terminal');
      }
      applied.push({ caseId, toStatus: input.toStatus, source: input.statusSource });
      entry.status = input.toStatus;
      entry.lockVersion += 1;
      return { status: input.toStatus, lockVersion: entry.lockVersion };
    },
    async ensureStalenessSweepScheduled() {
      sweepBooked += 1;
      return true;
    },
  };

  const tranchePort: SanctionTranchePort = {
    async findActiveSanctionForCase() {
      return opts.sanction === false ? null : { sanctionId: 'snc_1' };
    },
    async recordTranche(_tx, _ctx, sanctionId, input) {
      if (opts.trancheThrows) throw new Error(opts.trancheThrows);
      tranches.push({ sanctionId, amount: input.amount, disbursedOn: input.disbursedOn });
      return { trancheId: 'trn_1' };
    },
  };

  return { statusPort, tranchePort, applied, tranches, sweeps: () => sweepBooked };
}

describe('P1-07 lender MIS status import', () => {
  let repository: InMemoryImportRepository;

  const opsUser = testPrincipal({
    tenantId: 'ten_a',
    id: 'usr_ops',
    primaryBranchId: 'brn_a1',
    authTime: new Date().toISOString(),
    grants: [
      { code: 'import.run', scope: 'TENANT', branchIds: [] },
      { code: 'lender_case.update_status', scope: 'TENANT', branchIds: [] },
    ],
  });

  beforeEach(() => {
    repository = new InMemoryImportRepository();
  });

  function getApp(ports: ReturnType<typeof buildPorts>, misRepo: FakeMisMappingRepository, principal = opsUser) {
    return createTestApp({
      auth: fakeAuth(principal),
      deps: {
        txRunner: inMemoryTxRunner,
        importRepository: repository,
        misMappingRepository: misRepo,
        lenderCaseStatusPort: ports.statusPort,
        sanctionTranchePort: ports.tranchePort,
        audit: { record: async () => 'aud_test' },
      },
    });
  }

  const sheet = (rows: string[]) =>
    Buffer.from(['App No,Stage,Remarks,Disb Amt,Disb Date', ...rows].join('\n')).toString('base64');

  async function runImport(app: ReturnType<typeof getApp>, contentBase64: string) {
    const created = await request(app).post('/v1/imports').send({
      targetEntity: 'LENDER_CASE_STATUS',
      fileFormat: 'CSV',
      filename: 'hdfc_status.csv',
      contentBase64,
      importOptions: { lenderId: LENDER },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const id = created.body.id as string;
    await request(app)
      .post(`/v1/imports/${id}/mapping`)
      .send({
        columnMapping: {
          'App No': 'lenderReference',
          Stage: 'status',
          Remarks: 'reasonText',
          'Disb Amt': 'disbursedAmount',
          'Disb Date': 'disbursedOn',
        },
      });

    return request(app).post(`/v1/imports/${id}/commit`).send({});
  }

  it('TEST-MIS-IMP-01 moves a matched case through the port, tagged LENDER_FILE', async () => {
    const ports = buildPorts({ 'HDFC-1': { id: 'lcs_1', status: 'SUBMITTED', lockVersion: 4 } });
    const res = await runImport(getApp(ports, new FakeMisMappingRepository()), sheet(['HDFC-1,Sanctioned,,,']));

    expect(res.status).toBe(200);
    // LENDER_FILE is what tells an auditor months later that a spreadsheet moved this case, not a person.
    expect(ports.applied).toEqual([{ caseId: 'lcs_1', toStatus: 'SANCTIONED', source: 'LENDER_FILE' }]);
    expect(res.body.importedRows).toBe(1);
  });

  it('TEST-MIS-IMP-02 records a disbursement tranche, reading the lender\'s date format', async () => {
    const ports = buildPorts({ 'HDFC-1': { id: 'lcs_1', status: 'SANCTIONED', lockVersion: 1 } });
    const res = await runImport(
      getApp(ports, new FakeMisMappingRepository()),
      sheet(['HDFC-1,Disb Done,,"4,00,000.00",03-04-2026']),
    );

    expect(res.status).toBe(200);
    // 03-04-2026 under DD-MM-YYYY is 3 April. Read the other way it would be 4 March, which is a real date in a
    // different month and nothing downstream could catch it.
    expect(ports.tranches).toEqual([{ sanctionId: 'snc_1', amount: 400000, disbursedOn: '2026-04-03' }]);
  });

  it('TEST-MIS-IMP-03 one bad row does not cost the good ones', async () => {
    const ports = buildPorts({
      'HDFC-1': { id: 'lcs_1', status: 'SUBMITTED', lockVersion: 1 },
      'HDFC-3': { id: 'lcs_3', status: 'SUBMITTED', lockVersion: 1 },
    });
    const res = await runImport(
      getApp(ports, new FakeMisMappingRepository()),
      sheet(['HDFC-1,Sanctioned,,,', 'HDFC-2,Sanctioned,,,', 'HDFC-3,In Process,,,']),
    );

    expect(res.status).toBe(200);
    expect(res.body.importedRows).toBe(2);
    expect(res.body.invalidRows).toBe(1);
    expect(ports.applied).toHaveLength(2);
    const issues = (res.body.errorSummary as Array<{ issue: string }>).map((e) => e.issue);
    expect(issues).toEqual(['UNMATCHED_REFERENCE']);
  });

  it('TEST-MIS-IMP-04 an unmapped status word names itself in the exception', async () => {
    const ports = buildPorts({ 'HDFC-1': { id: 'lcs_1', status: 'SUBMITTED', lockVersion: 1 } });
    const res = await runImport(
      getApp(ports, new FakeMisMappingRepository()),
      sheet(['HDFC-1,Pending With Credit,,,']),
    );

    const first = (res.body.errorSummary as Array<{ issue: string; rawValue: string }>)[0]!;
    expect(first.issue).toBe('UNKNOWN_STATUS_WORD');
    // The operator has to know which word to add to the mapping; an exception that does not say is useless.
    expect(first.rawValue).toBe('Pending With Credit');
    expect(ports.applied).toHaveLength(0);
  });

  it('TEST-MIS-IMP-05 a refused move is an exception, not a failed batch', async () => {
    const ports = buildPorts({ 'HDFC-1': { id: 'lcs_1', status: 'CLOSED', lockVersion: 1 } });
    const res = await runImport(getApp(ports, new FakeMisMappingRepository()), sheet(['HDFC-1,Sanctioned,,,']));

    expect(res.status).toBe(200);
    expect((res.body.errorSummary as Array<{ issue: string }>)[0]!.issue).toBe('ILLEGAL_TRANSITION');
  });

  it('TEST-MIS-IMP-06 re-sending yesterday\'s sheet changes nothing', async () => {
    // Operations really do re-upload: two people, one email thread, the same attachment. A case already in the
    // status the row asks for must not get a fresh history entry and outbox event every morning.
    const ports = buildPorts({ 'HDFC-1': { id: 'lcs_1', status: 'SANCTIONED', lockVersion: 1 } });
    const app = getApp(ports, new FakeMisMappingRepository());
    const res = await runImport(app, sheet(['HDFC-1,Sanctioned,,,']));

    expect(res.status).toBe(200);
    expect(ports.applied).toHaveLength(0);
    expect(res.body.invalidRows).toBe(0);
  });

  it('TEST-MIS-IMP-07 a disbursed row with no active sanction is an exception, not a tranche', async () => {
    const ports = buildPorts({ 'HDFC-1': { id: 'lcs_1', status: 'SANCTIONED', lockVersion: 1 } }, { sanction: false });
    const res = await runImport(
      getApp(ports, new FakeMisMappingRepository()),
      sheet(['HDFC-1,Disb Done,,400000,03-04-2026']),
    );

    expect((res.body.errorSummary as Array<{ issue: string }>)[0]!.issue).toBe('NO_ACTIVE_SANCTION');
    expect(ports.tranches).toHaveLength(0);
  });

  it('TEST-MIS-IMP-08 a refused tranche is an exception naming why', async () => {
    const ports = buildPorts(
      { 'HDFC-1': { id: 'lcs_1', status: 'SANCTIONED', lockVersion: 1 } },
      { trancheThrows: 'Missing required permission: disbursement.record' },
    );
    const res = await runImport(
      getApp(ports, new FakeMisMappingRepository()),
      sheet(['HDFC-1,Disb Done,,400000,03-04-2026']),
    );

    const first = (res.body.errorSummary as Array<{ issue: string; message: string }>)[0]!;
    expect(first.issue).toBe('TRANCHE_REFUSED');
    // Recording money is a different authority from moving a status: the operator is told which permission is
    // missing rather than the tranche appearing anyway.
    expect(first.message).toContain('disbursement.record');
  });

  it('TEST-MIS-IMP-09 a bad date is an exception, never a guessed date', async () => {
    const ports = buildPorts({ 'HDFC-1': { id: 'lcs_1', status: 'SANCTIONED', lockVersion: 1 } });
    const res = await runImport(
      getApp(ports, new FakeMisMappingRepository()),
      sheet(['HDFC-1,Disb Done,,400000,31-02-2026']),
    );

    expect((res.body.errorSummary as Array<{ issue: string }>)[0]!.issue).toBe('INVALID_DATE');
    expect(ports.tranches).toHaveLength(0);
  });

  it('TEST-MIS-IMP-10 a batch with no saved mapping is refused whole', async () => {
    // Not 2,000 identical exceptions: the report would hide the single action the operator has to take.
    const ports = buildPorts({ 'HDFC-1': { id: 'lcs_1', status: 'SUBMITTED', lockVersion: 1 } });
    const res = await runImport(getApp(ports, new FakeMisMappingRepository(null)), sheet(['HDFC-1,Sanctioned,,,']));

    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe('VALIDATION_ERROR');
    expect(res.body.error?.message).toContain('mapping');
  });

  it('TEST-MIS-IMP-11 the batch stamps the mapping and books the staleness sweep', async () => {
    const ports = buildPorts({ 'HDFC-1': { id: 'lcs_1', status: 'SUBMITTED', lockVersion: 1 } });
    const misRepo = new FakeMisMappingRepository();
    await runImport(getApp(ports, misRepo), sheet(['HDFC-1,Sanctioned,,,']));

    expect(misRepo.marked).toEqual([LENDER]);
    expect(ports.sweeps()).toBe(1);
  });

  it('TEST-MIS-IMP-13 a status batch with no lender named is refused at upload', async () => {
    // At upload, not at commit: by commit the operator has already mapped every column, and being sent back to
    // the start for a field the first screen could have asked for is how people stop using a tool.
    const ports = buildPorts({});
    const app = getApp(ports, new FakeMisMappingRepository());

    const res = await request(app).post('/v1/imports').send({
      targetEntity: 'LENDER_CASE_STATUS',
      fileFormat: 'CSV',
      filename: 'hdfc.csv',
      contentBase64: sheet(['HDFC-1,Sanctioned,,,']),
    });

    expect(res.status).toBe(422);
    expect(res.body.error?.message).toContain('lenderId');
  });

  it('TEST-MIS-IMP-12 a user without lender_case.update_status cannot run one', async () => {
    const leadOnly = testPrincipal({
      tenantId: 'ten_a',
      id: 'usr_lead',
      primaryBranchId: 'brn_a1',
      authTime: new Date().toISOString(),
      grants: [{ code: 'lead.create', scope: 'TENANT', branchIds: [] }],
    });
    const ports = buildPorts({});
    const app = getApp(ports, new FakeMisMappingRepository(), leadOnly);

    const res = await request(app).post('/v1/imports').send({
      targetEntity: 'LENDER_CASE_STATUS',
      fileFormat: 'CSV',
      filename: 'hdfc.csv',
      contentBase64: sheet(['HDFC-1,Sanctioned,,,']),
      importOptions: { lenderId: LENDER },
    });

    // lead.create used to satisfy this, because the permission was chosen by a two-way ternary.
    expect(res.status).toBe(403);
  });
});
