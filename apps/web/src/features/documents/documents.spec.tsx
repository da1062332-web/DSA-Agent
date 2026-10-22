// Documents screen and checklist card (owner: Dev 3, MOD-DOC checklist slice, API-APP-007).
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '../../api/useMe';

const me = vi.hoisted(() => ({ grants: [] as { code: string; scope: string; branchIds: string[] }[] }));
vi.mock('../../api/useMe', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useMe: () => ({ data: { id: 'usr_me', grants: me.grants } as Me }),
}));
vi.mock('../../auth/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));
vi.mock('../../config', () => ({
  readConfig: () => ({ success: true, data: { VITE_API_BASE_URL: 'http://api.test' } }),
}));

import { getChecklist } from './api';
import { DocumentsPage } from './DocumentsPage';
import { groupByParty, itemActions, nextAction, progressText, statusTone, type ChecklistItem } from './model';
import { routes } from './routes';

const item = (over: Partial<ChecklistItem>): ChecklistItem => ({
  id: 'chk_1',
  applicationId: 'app_1',
  partyId: 'pty_1',
  documentTypeCode: 'PAN_CARD',
  ordinal: 1,
  mandatory: true,
  requiredCount: 1,
  periodMonths: null,
  status: 'PENDING',
  rejectReason: null,
  attestationNote: null,
  reviewedBy: null,
  reviewedAt: null,
  documentId: null,
  sourceDecisionId: 'dec_1',
  version: 0,
  ...over,
});

const render = (...codes: string[]) => {
  me.grants = codes.map((code) => ({ code, scope: 'TENANT', branchIds: [] }));
  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <DocumentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Documents screen', () => {
  it('TEST-UI-DOC-01 without application.read the user is told they have no access', () => {
    expect(render('lead.read')).toContain('documents-no-access');
  });

  it('TEST-UI-DOC-02 with application.read the Documents page renders its header and is routed at /documents', () => {
    const html = render('application.read');
    expect(html).not.toContain('documents-no-access');
    expect(html).toContain('Documents');
    expect(routes.map((r) => r.path)).toContain('/documents');
  });
});

describe('checklist rules on the screen', () => {
  it('TEST-UI-DOC-03 items are grouped per applicant and sorted by document type', () => {
    const groups = groupByParty([
      item({ id: 'a', partyId: 'p2', documentTypeCode: 'PAN_CARD' }),
      item({ id: 'b', partyId: 'p1', documentTypeCode: 'SALARY_SLIP' }),
      item({ id: 'c', partyId: 'p1', documentTypeCode: 'BANK_STATEMENT' }),
    ]);
    expect(groups.map((g) => g.partyId)).toEqual(['p2', 'p1']);
    expect(groups[1]!.items.map((i) => i.id)).toEqual(['c', 'b']);
  });

  it('TEST-UI-DOC-04 each state says who acts next, and accepted or waived items need nothing', () => {
    expect(nextAction({ status: 'PENDING' })).toMatch(/customer/);
    expect(nextAction({ status: 'SUBMITTED' })).toMatch(/verifier/);
    expect(nextAction({ status: 'REJECTED' })).toMatch(/again/);
    expect(nextAction({ status: 'ACCEPTED' })).toBeNull();
    expect(nextAction({ status: 'WAIVED' })).toBeNull();
    expect(statusTone('ACCEPTED')).toBe('success');
    expect(statusTone('REJECTED')).toBe('error');
  });

  it('TEST-UI-DOC-05 the progress sentence covers empty, outstanding and complete', () => {
    const base = {
      total: 3,
      mandatory: 3,
      outstandingMandatory: 2,
      accepted: 1,
      rejected: 0,
      expired: 0,
      complete: false,
    };
    expect(progressText({ ...base, total: 0, mandatory: 0, outstandingMandatory: 0 })).toMatch(
      /No documents/,
    );
    expect(progressText(base)).toBe('2 of 3 required documents still outstanding.');
    expect(progressText({ ...base, outstandingMandatory: 0, complete: true })).toMatch(
      /Every required document/,
    );
  });
});

describe('checklist API call', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('TEST-UI-DOC-06 reads /v1/applications/{id}/checklist with the bearer token and encodes the id', async () => {
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ data: [], summary: {} }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await getChecklist('app 1/x');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('http://api.test/v1/applications/app%201%2Fx/checklist');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer test-token');
  });
});

describe('checklist row actions (CMP-DOC.03.1, CMP-DOC.05.1, API-APP-009)', () => {
  const can =
    (...codes: string[]) =>
    (c: string) =>
      codes.includes(c);

  it('TEST-UI-DOC-10 a pending item offers upload and waive to the roles holding them, never review', () => {
    const a = itemActions(
      item({ status: 'PENDING' }),
      can('document.upload', 'document.waive', 'document.review'),
    );
    expect(a).toEqual({ upload: true, view: false, review: false, waive: true });
  });

  it('TEST-UI-DOC-11 a received file can be viewed and reviewed by a verifier, who cannot upload or waive', () => {
    const a = itemActions(
      item({ status: 'SUBMITTED', documentId: 'doc_1' }),
      can('document.view', 'document.review'),
    );
    expect(a).toEqual({ upload: false, view: true, review: true, waive: false });
  });

  it('TEST-UI-DOC-12 an accepted, waived or not-applicable item is closed to upload, review and waiver', () => {
    for (const status of ['ACCEPTED', 'WAIVED', 'NOT_APPLICABLE'] as const) {
      const a = itemActions(
        item({ status, documentId: 'doc_1' }),
        can('document.upload', 'document.view', 'document.review', 'document.waive'),
      );
      expect(a).toEqual({ upload: false, view: true, review: false, waive: false });
    }
  });

  it('TEST-UI-DOC-13 a rejected item can get a new version but not another review until one arrives', () => {
    const a = itemActions(
      item({ status: 'REJECTED', documentId: 'doc_1' }),
      can('document.upload', 'document.review'),
    );
    expect(a.upload).toBe(true);
    expect(a.review).toBe(false);
  });
});
