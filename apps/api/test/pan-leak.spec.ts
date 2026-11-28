// TEST-SECRETS-04 (task P1-01, checklist 4.3): an unmasked PAN or Aadhaar number never reaches an HTTP response, an audit payload, an
// outbox payload, an export or a log. Routes run in-process with the shared redaction (http/redact.ts) and free-text validator
// (@dsa/contracts freeTextNoS3). No database: the routes under test refuse or fail before any tenant transaction, except the import,
// which uses the in-memory repositories the import suite already uses.
import type { AuditPort, OutboxPort, PermissionCode } from '@dsa/contracts';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { ActivityService } from '../src/modules/crm/activities/activity-service';
import { InMemoryCustomerRepository } from '../src/modules/crm/customers/repository';
import { type CreateInvoiceData, InMemoryInvoiceRepository } from '../src/modules/invoices/repository';
import { InMemoryImportRepository } from '../src/modules/platform/imports/repository';
import { InMemoryReportingRepository } from '../src/modules/reporting/repository';
import { createTestApp, fakeAuth, testPrincipal } from './support/fake-auth';

const PAN = 'ABCDE1234F';
const PAN_LOWER = 'abcde1234f';
const AADHAAR = '2345 6789 0123';
const TENANT = 'ten_01JTESTTENANT00000000000000';
const USER = 'usr_01JTESTUSER0000000000000000';
const BRANCH = 'br_01JMUMBAI000000000000000000';
const LEAD = 'lead_01JTESTLEAD000000000000001';
const ELG = 'elg_01HZX0000000000000000000AA';

/** Runs the callback with a transaction stub for the tenant, for routes that reach the repository after validation. */
const passThroughTx = {
  withTenantTx: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({ tenantId: TENANT }),
};

/** Fails the test, naming the place, when an unmasked PAN or Aadhaar number is in the text. */
function assertNoUnmasked(place: string, text: string): void {
  for (const raw of [PAN, PAN_LOWER, AADHAAR, '234567890123']) {
    if (text.includes(raw)) throw new Error(`${place} carries an unmasked identity number`);
  }
}

/** Records every audit and outbox payload the app writes, so the test can read them back. */
function sinks() {
  const audit: unknown[] = [];
  const outbox: unknown[] = [];
  const auditPort: AuditPort = {
    record: async (_tx, _ctx, e) => {
      audit.push(e);
      return 'aud_test';
    },
  };
  const outboxPort: OutboxPort = {
    emit: async (_tx, _ctx, e) => {
      outbox.push(e);
      return 'evt_test';
    },
  };
  return { audit, outbox, auditPort, outboxPort };
}

const grant = (...codes: PermissionCode[]) =>
  testPrincipal({ tenantId: TENANT, grants: codes.map((code) => ({ code, scope: 'TENANT' as const, branchIds: [] })) });

const IDEM = { 'Idempotency-Key': 'pan-leak-key-0001' };
const complaint = {
  complainantType: 'APPLICATION',
  complainantId: 'app_01HZX0000000000000000000AA',
  channel: 'PHONE',
  category: 'SERVICE',
  description: 'Customer waited three weeks for a callback',
};

describe('TEST-SECRETS-04 identity numbers never leave the API unmasked', () => {
  it('TEST-SECRETS-04 the leak check fails when an unmasked PAN is present (negative control)', () => {
    expect(() => assertNoUnmasked('negative control', `pan ${PAN}`)).toThrow(/unmasked identity number/);
    expect(() => assertNoUnmasked('negative control', `aadhaar ${AADHAAR}`)).toThrow(/unmasked identity number/);
    expect(() => assertNoUnmasked('negative control', 'pan ABCDE****F')).not.toThrow();
  });

  it('TEST-SECRETS-04 a PAN typed into a complaint is refused (422) and appears in no response, audit or outbox payload', async () => {
    const s = sinks();
    const app = createTestApp({
      auth: fakeAuth(grant('complaint.create')),
      deps: { audit: s.auditPort, outboxPort: s.outboxPort },
    });
    const res = await request(app)
      .post('/v1/complaints')
      .set(IDEM)
      .send({ ...complaint, description: `PAN is ${PAN} for this customer` });
    expect(res.status).toBe(422);
    assertNoUnmasked('complaint 422 response', JSON.stringify(res.body));
    assertNoUnmasked('audit payloads', JSON.stringify(s.audit));
    assertNoUnmasked('outbox payloads', JSON.stringify(s.outbox));
    expect(s.audit).toEqual([]);
    expect(s.outbox).toEqual([]);
  });

  it('TEST-SECRETS-04 an Aadhaar-shaped number typed into a complaint is refused (422) with no echo of the number', async () => {
    const s = sinks();
    const app = createTestApp({
      auth: fakeAuth(grant('complaint.create')),
      deps: { audit: s.auditPort, outboxPort: s.outboxPort },
    });
    const res = await request(app)
      .post('/v1/complaints')
      .set(IDEM)
      .send({ ...complaint, description: `Aadhaar ${AADHAAR} was shared on the call` });
    expect(res.status).toBe(422);
    assertNoUnmasked('complaint 422 response', JSON.stringify(res.body));
  });

  it('TEST-SECRETS-04 a PAN in an import row is masked in the error report export and in every audit and outbox payload', async () => {
    const s = sinks();
    const repository = new InMemoryImportRepository();
    const reportingRepository = new InMemoryReportingRepository();
    const importer = testPrincipal({
      tenantId: TENANT,
      id: 'usr_importer_pan',
      primaryBranchId: 'brn_a1',
      authTime: new Date().toISOString(),
      grants: [
        { code: 'lead.create', scope: 'TENANT', branchIds: [] },
        { code: 'customer.create', scope: 'TENANT', branchIds: [] },
        { code: 'import.run', scope: 'TENANT', branchIds: [] },
        { code: 'export.run', scope: 'TENANT', branchIds: [] },
      ],
    });
    const txRunner = {
      async withTenantTx<T>(_ctx: unknown, fn: (tx: unknown) => Promise<T>): Promise<T> {
        return fn({ tenantId: TENANT } as never);
      },
    };
    const app = createTestApp({
      auth: fakeAuth(importer),
      deps: {
        txRunner: txRunner as never,
        importRepository: repository,
        reportingRepository,
        audit: s.auditPort,
        outboxPort: s.outboxPort,
      },
    });

    // Row 1: the PAN is typed into the mobile column. Row 2: a PAN in lower case is typed into the email column.
    const csv = Buffer.from(
      'Full Name,Phone Number,Email Address\n' +
        `Valid Person,${PAN},valid@example.com\n` +
        `Second Person,9876543210,${PAN_LOWER}\n`,
    ).toString('base64');
    const created = await request(app).post('/v1/imports').send({
      targetEntity: 'LEAD',
      fileFormat: 'CSV',
      filename: 'pan-rows.csv',
      contentBase64: csv,
    });
    expect(created.status).toBe(201);
    const batchId: string = created.body.id;
    await request(app)
      .post(`/v1/imports/${batchId}/mapping`)
      .send({
        columnMapping: { 'Full Name': 'fullName', 'Phone Number': 'mobile', 'Email Address': 'email' },
      });
    const commit = await request(app).post(`/v1/imports/${batchId}/commit`).send({});
    expect(commit.status).toBe(200);
    expect(commit.body.invalidRows).toBe(2);

    const report = await request(app).get(`/v1/imports/${batchId}/report`);
    expect(report.status).toBe(200);
    expect(report.text).toContain('INVALID_MOBILE');
    expect(report.text).toContain('INVALID_EMAIL');
    assertNoUnmasked('import error report (export)', report.text);
    assertNoUnmasked('import commit response', JSON.stringify(commit.body));
    assertNoUnmasked('audit payloads', JSON.stringify(s.audit));
    assertNoUnmasked('outbox payloads', JSON.stringify(s.outbox));
  });

  it('TEST-SECRETS-04 a PAN, Aadhaar number or account number typed into an activity note is refused (422) with no trace in the response or payloads', async () => {
    const s = sinks();
    ActivityService.resetMemoryStore();
    ActivityService.seedSubject({ id: LEAD, tenantId: TENANT, branchId: BRANCH, ownerUserId: USER });
    const app = createTestApp({
      auth: fakeAuth(
        testPrincipal({
          tenantId: TENANT,
          id: USER,
          grants: [{ code: 'activity.create', scope: 'TENANT', branchIds: [] }],
        }),
      ),
      deps: { audit: s.auditPort, outboxPort: s.outboxPort },
    });
    const notes = [`Customer PAN is ${PAN}`, `Aadhaar ${AADHAAR} collected`, 'Account 123456789012 debited'];
    for (const [i, note] of notes.entries()) {
      const res = await request(app)
        .post('/v1/activities')
        .set('Idempotency-Key', `pan-leak-activity-${i}`)
        .send({ kind: 'NOTE', subjectType: 'LEAD', subjectId: LEAD, occurredAt: '2026-10-12T10:00:00.000Z', note });
      expect(res.status, note).toBe(422);
      assertNoUnmasked('activity 422 response', JSON.stringify(res.body));
    }
    assertNoUnmasked('audit payloads', JSON.stringify(s.audit));
    assertNoUnmasked('outbox payloads', JSON.stringify(s.outbox));
    expect(s.audit).toEqual([]);
    expect(s.outbox).toEqual([]);
  });

  it('TEST-SECRETS-04 a PAN typed into an eligibility override reason is refused (422) with no trace in the response or payloads', async () => {
    const s = sinks();
    const app = createTestApp({
      auth: fakeAuth(testPrincipal({ tenantId: TENANT, grants: [{ code: 'eligibility.override', scope: 'TENANT', branchIds: [] }] })),
      deps: { audit: s.auditPort, outboxPort: s.outboxPort },
    });
    const res = await request(app)
      .post(`/v1/eligibility-assessments/${ELG}/overrides`)
      .set({ 'Idempotency-Key': 'pan-leak-eligibility-1' })
      .send({ productVersionId: 'prv_x_1', reason: `Reviewed with PAN ${PAN} and the file` });
    expect(res.status).toBe(422);
    assertNoUnmasked('eligibility 422 response', JSON.stringify(res.body));
    assertNoUnmasked('audit payloads', JSON.stringify(s.audit));
    assertNoUnmasked('outbox payloads', JSON.stringify(s.outbox));
  });

  it('TEST-SECRETS-04 a PAN typed into a sensitive-field reveal reason is refused (422) before any value is shown', async () => {
    const s = sinks();
    const app = createTestApp({
      auth: fakeAuth(
        testPrincipal({
          tenantId: TENANT,
          grants: [
            { code: 'customer.create', scope: 'TENANT', branchIds: [] },
            { code: 'customer.read', scope: 'TENANT', branchIds: [] },
            { code: 'customer.reveal_sensitive', scope: 'TENANT', branchIds: [] },
          ],
        }),
      ),
      deps: {
        txRunner: passThroughTx as never,
        customerRepository: new InMemoryCustomerRepository(),
        audit: s.auditPort,
        outboxPort: s.outboxPort,
      },
    });
    const res = await request(app)
      .post('/v1/customers/cust_001/reveal')
      .send({ field: 'PAN', reason: `lender asked for ${PAN}` });
    expect(res.status).toBe(422);
    assertNoUnmasked('reveal 422 response', JSON.stringify(res.body));
    assertNoUnmasked('audit payloads', JSON.stringify(s.audit));
    assertNoUnmasked('outbox payloads', JSON.stringify(s.outbox));
  });

  it('TEST-SECRETS-04 a PAN stored as an invoice party name is masked in every cell of the accounting export', async () => {
    const s = sinks();
    const repository = new InMemoryInvoiceRepository();
    const invoice: CreateInvoiceData = {
      id: 'inv_01JTESTPAN000000000000001',
      direction: 'FROM_CONNECTOR',
      number: 'INV-2026-11-901',
      date: '2026-11-10',
      amount: 1000,
      currency: 'INR',
      partyId: 'con_01JTESTCONNECTOR0000001',
      partyName: `Agency ${PAN}`,
      createdBy: USER,
    };
    await repository.createInvoice({} as never, TENANT, invoice);
    const app = createTestApp({
      auth: fakeAuth(
        testPrincipal({
          tenantId: TENANT,
          grants: [
            { code: 'invoice.view', scope: 'TENANT', branchIds: [] },
            { code: 'export.run', scope: 'TENANT', branchIds: [] },
          ],
        }),
      ),
      deps: { txRunner: passThroughTx as never, invoiceRepository: repository, audit: s.auditPort },
    });
    const res = await request(app).get('/v1/invoices/accounting-export?month=2026-11');
    expect(res.status).toBe(200);
    expect(res.text).toContain('INV-2026-11-901');
    expect(res.text).toContain('ABCDE****F');
    assertNoUnmasked('accounting export', res.text);
    assertNoUnmasked('audit payloads', JSON.stringify(s.audit));
  });

  it('TEST-SECRETS-04 a server error that names a PAN is logged with the PAN masked, and the response carries no PAN', async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
    try {
      const app = createTestApp({
        auth: fakeAuth(grant('complaint.create')),
        deps: {
          txRunner: {
            withTenantTx: () => Promise.reject(new Error(`lookup failed for ${PAN}`)),
          } as never,
        },
      });
      const res = await request(app).post('/v1/complaints').set(IDEM).send(complaint);
      expect(res.status).toBe(500);
      assertNoUnmasked('500 response', JSON.stringify(res.body));
      const log = logged.join('\n');
      assertNoUnmasked('server log', log);
      expect(log).toContain('ABCDE****F');
    } finally {
      spy.mockRestore();
    }
  });
});
