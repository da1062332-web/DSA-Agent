// Customer status link (task P3-05, checklist section 6). Staff with application.read create a link to one application. The customer
// opens it without signing in and sees the application reference, loan type and application date, the stage, the progress along the
// customer's path, the mandatory documents still needed, and the date of the last change. The link is a signed token with no table
// behind it: it carries the tenant, the application and an expiry of seven days. A link signed with the document-link key is never
// accepted here, and the reverse. Every creation and every view is audited.
//   POST /v1/applications/{id}/status-link   application.read; returns { url: '/status/<token>', expiresAt, reference }
//   GET  /public/v1/status/{token}           unauthenticated; rate-limited; returns the view below
import crypto from 'node:crypto';
import { AppError, type RequestContext, type Tx } from '@dsa/contracts';
import express, { type Router } from 'express';
import { sql } from 'kysely';
import { requireCtx } from '../../../http/request';
import { rateLimit } from '../../../http/rate-limit';
import type { ApiDeps } from '../../types';
import { applicationScope } from './applications';
import { iso, type Row } from './db';
import { documentDeps } from './documents';

export const STATUS_LINK_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface StatusLinkClaims {
  /** tenant */
  t: string;
  /** application id */
  a: string;
  /** expiry, epoch seconds */
  e: number;
}

/** Signs and verifies status links. The key is derived from the deployment secret with a purpose of its own. */
export class StatusLinkSigner {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = crypto.createHmac('sha256', secret).update('dsa:status-links:v1').digest();
  }

  sign(claims: StatusLinkClaims): string {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const sig = crypto.createHmac('sha256', this.key).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  verify(token: string, nowSeconds: number): StatusLinkClaims | null {
    // Exactly two segments, and only the canonical spelling of the signature, so one link has one spelling.
    const [body, sig, extra] = token.split('.');
    if (!body || !sig || extra !== undefined) return null;
    const expected = crypto.createHmac('sha256', this.key).update(body).digest();
    const given = Buffer.from(sig, 'base64url');
    if (given.toString('base64url') !== sig) return null;
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    try {
      const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<StatusLinkClaims>;
      if (typeof claims.t !== 'string' || typeof claims.a !== 'string' || typeof claims.e !== 'number') return null;
      return claims.e > nowSeconds ? (claims as StatusLinkClaims) : null;
    } catch {
      return null;
    }
  }
}

const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0, O, 1 or I, so a reference can be read aloud

/**
 * The reference a customer quotes, such as DSA-7K2MQ-9XHTR. It is derived from the tenant and the application with a key of its own, so it
 * is stable, the same for staff and for the customer, and cannot be reversed to the internal id. Ten characters give about 2^50 values.
 */
export function applicationReference(secret: string, tenantId: string, applicationId: string): string {
  const key = crypto.createHmac('sha256', secret).update('dsa:application-reference:v1').digest();
  const digest = crypto.createHmac('sha256', key).update(`${tenantId}:${applicationId}`).digest();
  const chars = Array.from(digest.subarray(0, 10), (byte) => REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length]).join('');
  return `DSA-${chars.slice(0, 5)}-${chars.slice(5)}`;
}

/**
 * The customer's path through an application, in order. Each step is the customer's label for one or more internal states. These are
 * proposed labels: the partner labels in partner-view are a separate list, and these need the owner's approval before they go live.
 */
export const CUSTOMER_PROGRESS_STEPS: { label: string; states: readonly string[] }[] = [
  { label: 'Application started', states: ['DRAFT'] },
  { label: 'Under processing', states: ['DOCUMENTS_PENDING', 'READY_FOR_SUBMISSION'] },
  { label: 'Under review', states: ['UNDER_REVIEW'] },
  { label: 'Submitted to lender', states: ['SUBMITTED'] },
  { label: 'Approved', states: ['SANCTIONED'] },
  { label: 'Disbursed', states: ['PARTIALLY_DISBURSED', 'DISBURSED'] },
];

/** States that end the application off the path. REJECTED, WITHDRAWN and CANCELLED show as Closed, as the partner proposal does. */
export const CUSTOMER_CLOSED_STATES: readonly string[] = ['CLOSED', 'REJECTED', 'WITHDRAWN', 'CANCELLED'];

/** The customer's words for each application state, derived from the path above. */
export const CUSTOMER_STAGE_LABEL: Record<string, string> = {
  ...Object.fromEntries(CUSTOMER_PROGRESS_STEPS.flatMap((step) => step.states.map((s) => [s, step.label]))),
  ...Object.fromEntries(CUSTOMER_CLOSED_STATES.map((s) => [s, 'Closed'])),
};

/** A state with no label shows as In progress, the generic label, rather than the internal state name. */
export const customerStageLabel = (status: string): string => CUSTOMER_STAGE_LABEL[status] ?? 'In progress';

/**
 * Where the application stands on the customer's path. `currentIndex` is the step it is on, or null when it is off the path (closed, or a
 * state with no label). Steps before the current one are completed; the page never guesses a step the backend has not reached.
 */
export interface CustomerProgress {
  steps: string[];
  currentIndex: number | null;
  closed: boolean;
}

export function customerProgress(status: string): CustomerProgress {
  const steps = CUSTOMER_PROGRESS_STEPS.map((step) => step.label);
  const index = CUSTOMER_PROGRESS_STEPS.findIndex((step) => step.states.includes(status));
  return {
    steps,
    currentIndex: index >= 0 ? index : null,
    closed: CUSTOMER_CLOSED_STATES.includes(status),
  };
}

/** The loan type in the words the web app uses for product categories. */
export const CUSTOMER_LOAN_TYPE_LABEL: Record<string, string> = {
  PL: 'Personal loan',
  BL: 'Business loan',
  MSME: 'MSME loan',
  LAP: 'Loan against property',
  HL: 'Home loan',
  VL: 'Vehicle loan',
  GL: 'Gold loan',
  EL: 'Education loan',
  OTHER: 'Other',
};

export const loanTypeLabel = (category: string): string => CUSTOMER_LOAN_TYPE_LABEL[category] ?? 'Loan';

/** The checklist statuses a customer can be asked to act on. Each has the customer's words for it. */
export type CustomerDocumentStatus = 'PENDING' | 'REJECTED' | 'EXPIRED';

export const CUSTOMER_DOCUMENT_STATUS_LABEL: Record<CustomerDocumentStatus, string> = {
  PENDING: 'Pending',
  REJECTED: 'Resubmit required',
  EXPIRED: 'Renewal required',
};

/** Co-applicants and guarantors are named by their role, so two people's documents of the same type can be told apart. */
const PARTY_ROLE_LABEL: Record<string, string> = { CO_APPLICANT: 'Co-applicant', GUARANTOR: 'Guarantor' };

export interface PendingDocument {
  name: string;
  status: CustomerDocumentStatus;
}

export interface StatusLinkApplication {
  id: string;
  status: string;
  productCategory: string;
  /** YYYY-MM-DD, the day the application was created. */
  appliedOn: string;
  /** ISO time of the latest change to the application or to its checklist. */
  lastChangedAt: string;
}

/**
 * The reads the status link needs. The Postgres implementation runs inside the caller's tenant transaction (RLS is the backstop); the
 * in-memory one is for tests of the route rules only.
 */
export interface StatusLinkRepository {
  /** The application, when the caller's scope includes it (staff route, same scope as the application read). */
  findInScope(tx: Tx, ctx: RequestContext, applicationId: string): Promise<StatusLinkApplication | null>;
  /** The application a verified link names, inside the link's tenant. No staff scope applies to a customer. */
  findForLink(tx: Tx, tenantId: string, applicationId: string): Promise<StatusLinkApplication | null>;
  /** The mandatory documents the customer still has to send or fix, with their status. */
  pendingDocuments(tx: Tx, tenantId: string, applicationId: string): Promise<PendingDocument[]>;
}

const toApplication = (r: Row): StatusLinkApplication => ({
  id: String(r.id),
  status: String(r.status),
  productCategory: String(r.product_category),
  appliedOn: iso(r.created_at).slice(0, 10),
  lastChangedAt: iso(r.last_changed_at),
});

export const pgStatusLinkRepository: StatusLinkRepository = {
  async findInScope(tx, ctx, applicationId) {
    const r = await sql<Row>`
      select id, status, product_category, created_at,
             greatest(updated_at, (select max(c.updated_at) from checklist_item c where c.application_id = loan_application.id)) as last_changed_at
        from loan_application
       where id = ${applicationId} and ${applicationScope(ctx, 'application.read')}`.execute(tx);
    return r.rows[0] ? toApplication(r.rows[0]) : null;
  },
  async findForLink(tx, tenantId, applicationId) {
    const r = await sql<Row>`
      select id, status, product_category, created_at,
             greatest(updated_at, (select max(c.updated_at) from checklist_item c where c.application_id = loan_application.id)) as last_changed_at
        from loan_application
       where tenant_id = ${tenantId} and id = ${applicationId}`.execute(tx);
    return r.rows[0] ? toApplication(r.rows[0]) : null;
  },
  async pendingDocuments(tx, tenantId, applicationId) {
    // Only mandatory items count, as the completeness check does. Waived, accepted and not-applicable items need nothing, and a
    // submitted item is with the reviewer, not with the customer.
    const r = await sql<{ name: string; status: string; role: string }>`
      select t.name, c.status, p.role
        from checklist_item c
        join document_type t on t.tenant_id = c.tenant_id and t.code = c.document_type_code
        join application_party p on p.tenant_id = c.tenant_id and p.id = c.party_id
       where c.tenant_id = ${tenantId} and c.application_id = ${applicationId}
         and c.mandatory = true and c.status in ('PENDING', 'REJECTED', 'EXPIRED')
       order by case when p.role = 'PRIMARY' then 0 else 1 end, c.ordinal, c.id`.execute(tx);
    return r.rows.map((row) => ({
      name: row.role === 'PRIMARY' ? row.name : `${row.name} (${PARTY_ROLE_LABEL[row.role] ?? 'Other applicant'})`,
      status: row.status as CustomerDocumentStatus,
    }));
  },
};

/** In-memory repository for the route tests. It keeps the tenant rule; the branch and owner scope is tested in the integration suite. */
export class InMemoryStatusLinkRepository implements StatusLinkRepository {
  private readonly apps = new Map<string, { tenantId: string; app: StatusLinkApplication; pending: PendingDocument[] }>();

  add(tenantId: string, app: StatusLinkApplication, pending: PendingDocument[] = []): void {
    this.apps.set(app.id, { tenantId, app, pending });
  }

  async findInScope(_tx: Tx, ctx: RequestContext, applicationId: string) {
    const row = this.apps.get(applicationId);
    return row && row.tenantId === ctx.principal.tenantId ? row.app : null;
  }

  async findForLink(_tx: Tx, tenantId: string, applicationId: string) {
    const row = this.apps.get(applicationId);
    return row && row.tenantId === tenantId ? row.app : null;
  }

  async pendingDocuments(_tx: Tx, tenantId: string, applicationId: string) {
    const row = this.apps.get(applicationId);
    return row && row.tenantId === tenantId ? row.pending : [];
  }
}

function repositoryOf(deps: ApiDeps): StatusLinkRepository {
  return (deps.statusLinkRepository as StatusLinkRepository | undefined) ?? pgStatusLinkRepository;
}

/** The signer for this deployment: the same secret as the document links, with a key of its own. */
function signerOf(deps: ApiDeps): StatusLinkSigner {
  return new StatusLinkSigner(documentDeps(deps).secret);
}

/** The context a customer's view runs in: a system principal for one tenant, with no permissions. */
const linkContext = (tenantId: string, correlationId: string): RequestContext => ({
  principal: {
    kind: 'SERVICE',
    id: 'SYSTEM:status-link',
    tenantId,
    primaryBranchId: null,
    managedTeamMemberIds: [],
    queueIds: [],
    grants: [],
    authTime: null,
  },
  correlationId,
  now: new Date(),
});

/** The staff route: POST /v1/applications/{id}/status-link. Mounted on the application router. */
export function registerStatusLinkRoutes(router: Router, deps: ApiDeps): void {
  const signer = signerOf(deps);
  const secret = documentDeps(deps).secret;
  const repo = repositoryOf(deps);
  router.post('/applications/:id/status-link', async (req, res) => {
    const ctx = requireCtx(req);
    deps.authz.requirePermission(ctx, 'application.read');
    const body = await deps.txRunner.withTenantTx(ctx, async (tx) => {
      const app = await repo.findInScope(tx, ctx, String(req.params.id));
      if (!app) throw AppError.of('NOT_FOUND', 'Application not found.');
      const exp = Math.floor(ctx.now.getTime() / 1000) + STATUS_LINK_TTL_SECONDS;
      const token = signer.sign({ t: ctx.principal.tenantId, a: app.id, e: exp });
      const expiresAt = new Date(exp * 1000).toISOString();
      await deps.audit.record(tx, ctx, {
        action: 'status_link.created',
        entityType: 'LOAN_APPLICATION',
        entityId: app.id,
        after: { expiresAt },
        permissionUsed: 'application.read',
      });
      return {
        url: `/status/${token}`,
        expiresAt,
        reference: applicationReference(secret, ctx.principal.tenantId, app.id),
      };
    });
    res.status(201).json(body);
  });
}

export interface PublicStatusRouterOptions {
  /** Requests per minute per caller address. Default 30. */
  perMinute?: number;
}

/** The customer's route: GET /public/v1/status/{token}. Mounted on the public router, so it needs no sign-in. */
export function createPublicStatusRouter(deps: ApiDeps, opts: PublicStatusRouterOptions = {}): Router {
  const router = express.Router();
  const signer = signerOf(deps);
  const secret = documentDeps(deps).secret;
  const repo = repositoryOf(deps);
  router.use(rateLimit({ perMinute: opts.perMinute ?? 30 }));

  router.get('/status/:token', async (req, res, next) => {
    try {
      const claims = signer.verify(String(req.params.token), Math.floor(Date.now() / 1000));
      // A bad signature, an expired link and a link whose application is gone all get the same answer.
      if (!claims) throw AppError.of('LINK_EXPIRED', 'This link is invalid or has expired.');
      const ctx = linkContext(claims.t, req.correlationId);
      const view = await deps.txRunner.withTenantTx(ctx, async (tx) => {
        const app = await repo.findForLink(tx, claims.t, claims.a);
        if (!app) throw AppError.of('LINK_EXPIRED', 'This link is invalid or has expired.');
        const pending = await repo.pendingDocuments(tx, claims.t, claims.a);
        const stage = customerStageLabel(app.status);
        await deps.audit.record(tx, ctx, {
          action: 'status_link.viewed',
          entityType: 'LOAN_APPLICATION',
          entityId: app.id,
          after: { stage },
        });
        return {
          application: {
            reference: applicationReference(secret, claims.t, app.id),
            loanType: loanTypeLabel(app.productCategory),
            appliedOn: app.appliedOn,
          },
          stage,
          progress: customerProgress(app.status),
          pendingDocuments: pending.map((d) => ({
            name: d.name,
            status: d.status,
            label: CUSTOMER_DOCUMENT_STATUS_LABEL[d.status],
          })),
          lastUpdated: app.lastChangedAt.slice(0, 10),
          expiresAt: new Date(claims.e * 1000).toISOString(),
        };
      });
      res.set('Cache-Control', 'no-store');
      res.json(view);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
