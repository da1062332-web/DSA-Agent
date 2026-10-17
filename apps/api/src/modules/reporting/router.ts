// apps/api/src/modules/reporting/router.ts — Reporting Engine Router
import {
  AppError,
  CreateExportDtoSchema,
  CreateReportRunDtoSchema,
  CreateReportScheduleDtoSchema,
  DashboardQuerySchema,
  MetricsQuerySchema,
  type DashboardQuery,
  type MetricsQuery,
} from '@dsa/contracts';
import { Router, type Request, type Response } from 'express';
import { ZodError, z } from 'zod';
import { requireCtx } from '../../http/request';
import type { ApiDeps } from '../types';
import { SqlReportingRepository, type ReportingRepository } from './repository';
import { ReportingService } from './service';

function handleZodError(err: ZodError): never {
  const details = err.issues.map((i) => ({
    field: i.path.join('.'),
    issue: i.message,
  }));
  throw AppError.of('VALIDATION_ERROR', 'Request validation failed', details);
}

function getParam(req: Request, paramName: string): string {
  const raw = req.params[paramName];
  if (!raw) return '';
  return Array.isArray(raw) ? raw[0]! : raw;
}

const RefreshProjectionsRequestSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
});

export function createRouter(deps: ApiDeps): Router {
  const repo = (deps.reportingRepository as ReportingRepository) ?? new SqlReportingRepository();
  const service = new ReportingService(repo, deps.audit, deps.authz);

  const router = Router();

  // ==========================================
  // SUB-RPT.01: Metrics & Metric Registry
  // ==========================================
  router.get('/metrics', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);

    let query: MetricsQuery;
    try {
      query = MetricsQuerySchema.parse(req.query);
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const result = await deps.txRunner.withTenantTx(ctx, (tx) => service.queryMetrics(tx, ctx, query));

    res.json(result);
  });

  router.get('/metrics/definitions', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);

    const definitions = await deps.txRunner.withTenantTx(ctx, (tx) => service.listMetricDefinitions(tx, ctx));

    res.json({ data: definitions });
  });

  router.get('/metric-definitions', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);

    const definitions = await deps.txRunner.withTenantTx(ctx, (tx) => service.listMetricDefinitions(tx, ctx));

    res.json({ data: definitions });
  });

  router.get('/metric-definitions/:code', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const code = getParam(req, 'code');

    const definition = await deps.txRunner.withTenantTx(ctx, (tx) =>
      service.getMetricDefinition(tx, ctx, code),
    );

    res.json(definition);
  });

  // ==========================================
  // SUB-RPT.02: Control Totals & Projections
  // ==========================================
  router.get('/reporting/control-totals', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const dateParam =
      typeof req.query.summaryDate === 'string'
        ? req.query.summaryDate
        : new Date().toISOString().split('T')[0]!;

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      service.getControlTotals(tx, ctx, dateParam),
    );

    res.json(result);
  });

  router.post('/reporting/refresh', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);

    let body: z.infer<typeof RefreshProjectionsRequestSchema>;
    try {
      body = RefreshProjectionsRequestSchema.parse(req.body);
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const result = await deps.txRunner.withTenantTx(ctx, (tx) =>
      service.refreshProjections(tx, ctx, body.startDate, body.endDate),
    );

    res.json(result);
  });

  // ==========================================
  // SUB-RPT.03: Dashboards Framework
  // ==========================================
  router.get('/dashboards/:code', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const code = getParam(req, 'code');

    let query: DashboardQuery;
    try {
      query = DashboardQuerySchema.parse(req.query);
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const dashboard = await deps.txRunner.withTenantTx(ctx, (tx) =>
      service.getDashboard(tx, ctx, code, query),
    );

    res.json(dashboard);
  });

  // ==========================================
  // SUB-RPT.04: Report Catalogue & Runs
  // ==========================================
  router.get('/reports', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const reports = service.listReportCatalogue(ctx);
    res.json({ data: reports });
  });

  router.post('/reports/:code/runs', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const code = getParam(req, 'code');

    let body;
    try {
      body = CreateReportRunDtoSchema.parse(req.body ?? {});
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const run = await deps.txRunner.withTenantTx(ctx, (tx) => service.startReportRun(tx, ctx, code, body));

    res.status(202).json(run);
  });

  router.get('/report-runs/:id', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParam(req, 'id');

    const run = await deps.txRunner.withTenantTx(ctx, (tx) => service.getReportRun(tx, ctx, id));

    res.json(run);
  });

  router.get('/report-runs/:id/download', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParam(req, 'id');

    const { buffer, filename, contentType } = await deps.txRunner.withTenantTx(ctx, (tx) =>
      service.downloadReportRun(tx, ctx, id),
    );

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  });

  router.get('/report-runs', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);

    const runs = await deps.txRunner.withTenantTx(ctx, (tx) => service.listReportRuns(tx, ctx));

    res.json({ data: runs });
  });

  // ==========================================
  // SUB-RPT.05: Exports & Schedules
  // ==========================================
  router.post('/exports', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);

    let body;
    try {
      body = CreateExportDtoSchema.parse(req.body);
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const job = await deps.txRunner.withTenantTx(ctx, (tx) => service.createExportJob(tx, ctx, body));

    res.status(201).json(job);
  });

  router.get('/exports/:id', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParam(req, 'id');

    const job = await deps.txRunner.withTenantTx(ctx, (tx) => service.getExportJob(tx, ctx, id));

    res.json(job);
  });

  router.get('/exports/:id/download', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParam(req, 'id');

    const { buffer, filename, contentType } = await deps.txRunner.withTenantTx(ctx, (tx) =>
      service.downloadExport(tx, ctx, id),
    );

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  });

  router.get('/exports', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);

    const jobs = await deps.txRunner.withTenantTx(ctx, (tx) => service.listExportJobs(tx, ctx));

    res.json({ data: jobs });
  });

  router.post('/report-schedules', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);

    let body;
    try {
      body = CreateReportScheduleDtoSchema.parse(req.body);
    } catch (err: unknown) {
      if (err instanceof ZodError) return handleZodError(err);
      throw err;
    }

    const schedule = await deps.txRunner.withTenantTx(ctx, (tx) =>
      service.createReportSchedule(tx, ctx, body),
    );

    res.status(201).json(schedule);
  });

  router.get('/report-schedules', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);

    const schedules = await deps.txRunner.withTenantTx(ctx, (tx) => service.listReportSchedules(tx, ctx));

    res.json({ data: schedules });
  });

  router.delete('/report-schedules/:id', async (req: Request, res: Response) => {
    const ctx = requireCtx(req);
    const id = getParam(req, 'id');

    await deps.txRunner.withTenantTx(ctx, (tx) => service.deleteReportSchedule(tx, ctx, id));

    res.status(204).send();
  });

  return router;
}
