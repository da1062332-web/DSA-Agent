// packages/contracts/src/rules.spec.ts — owner: Developer 2 & 6
import { describe, expect, it } from 'vitest';
import {
  CreateRuleSetRequestSchema,
  DecisionRecordResponseSchema,
  ReviewVersionRequestSchema,
  RuleDefinitionSchema,
  RuleSetDefinitionSchema,
  RuleSetResponseSchema,
  RuleSetVersionResponseSchema,
} from './rules';

describe('Module 23 — Rules & Business Rule Engine Contracts', () => {
  it('validates a valid RuleDefinition', () => {
    const input = {
      uid: 'RUL-LEAD-ASSIGN-01',
      name: 'Assign Mumbai PL leads',
      orderNo: 1,
      enabled: true,
      conditions: [
        { field: 'lead.branch_id', operator: '==', value: 'br_mumbai' },
        { field: 'lead.product_category', operator: '==', value: 'PL' },
      ],
      output: {
        pool: { queueId: 'wq_mumbai_pl' },
        strategy: 'ROUND_ROBIN',
        reasonText: 'Branch Mumbai PL routing rule',
      },
    };

    const parsed = RuleDefinitionSchema.parse(input);
    expect(parsed.uid).toBe('RUL-LEAD-ASSIGN-01');
    expect(parsed.conditions).toHaveLength(2);
  });

  it('rejects RuleDefinition with invalid UID format', () => {
    const input = {
      uid: 'invalid_uid_format',
      name: 'Bad rule',
      conditions: [],
      output: {},
    };
    expect(() => RuleDefinitionSchema.parse(input)).toThrow(/UID must match pattern/);
  });

  it('validates a complete RuleSetDefinition with schemaVersion: 1', () => {
    const input = {
      schemaVersion: 1,
      hitPolicy: 'FIRST',
      rules: [
        {
          uid: 'RUL-DEFAULT',
          name: 'Fallback rule',
          conditions: [],
          output: { fallback: true },
        },
      ],
    };
    const parsed = RuleSetDefinitionSchema.parse(input);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.rules).toHaveLength(1);
  });

  it('validates CreateRuleSetRequestSchema with TENANT_DEFAULT and null scopeRef', () => {
    const input = {
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      name: 'Tenant Default Lead Assignment',
    };
    const parsed = CreateRuleSetRequestSchema.parse(input);
    expect(parsed.scopeType).toBe('TENANT_DEFAULT');
  });

  it('rejects CreateRuleSetRequestSchema with BRANCH scope and missing scopeRef', () => {
    const input = {
      decisionKey: 'DK-lead.assignment',
      scopeType: 'BRANCH',
      name: 'Mumbai Branch Rules',
    };
    expect(() => CreateRuleSetRequestSchema.parse(input)).toThrow(
      /scopeRef must be null if and only if scopeType is TENANT_DEFAULT/
    );
  });

  it('validates ReviewVersionRequest with comment and valid content hash', () => {
    const input = {
      seat: 'RULE_APPROVER',
      action: 'APPROVE',
      comment: 'Reviewed logic against lending policy v2.1',
      reviewedContentHash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    };
    const parsed = ReviewVersionRequestSchema.parse(input);
    expect(parsed.action).toBe('APPROVE');
  });

  it('rejects ReviewVersionRequest with comment shorter than 3 characters', () => {
    const input = {
      seat: 'RULE_APPROVER',
      action: 'APPROVE',
      comment: 'ok',
      reviewedContentHash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    };
    expect(() => ReviewVersionRequestSchema.parse(input)).toThrow(
      /Comment must be between 3 and 2000 characters/
    );
  });

  it('validates RuleSetResponse with rs_ prefix', () => {
    const input = {
      id: 'rs_01JTESTVRF0000000000000001',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      decisionKey: 'DK-lead.assignment',
      scopeType: 'TENANT_DEFAULT',
      scopeRef: null,
      name: 'Default Lead Routing',
      ownerUserId: null,
      origin: 'TENANT',
      status: 'ACTIVE',
      lockVersion: 0,
      createdAt: '2026-10-14T00:00:00Z',
      createdBy: 'usr_staff_01',
      updatedAt: '2026-10-14T00:00:00Z',
      updatedBy: 'usr_staff_01',
    };
    const parsed = RuleSetResponseSchema.parse(input);
    expect(parsed.id).toBe(input.id);
  });

  it('validates RuleSetVersionResponse with rsv_ prefix', () => {
    const input = {
      id: 'rsv_01JTESTVRF0000000000000001',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      ruleSetId: 'rs_01JTESTVRF0000000000000001',
      versionNo: 1,
      status: 'DRAFT',
      hitPolicy: 'FIRST',
      definition: {
        schemaVersion: 1,
        rules: [],
      },
      contentHash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      editors: ['usr_staff_01'],
      createdBy: 'usr_staff_01',
      createdAt: '2026-10-14T00:00:00Z',
      lockVersion: 0,
    };
    const parsed = RuleSetVersionResponseSchema.parse(input);
    expect(parsed.id).toBe(input.id);
    expect(parsed.status).toBe('DRAFT');
  });

  it('validates DecisionRecordResponse with dr_ prefix', () => {
    const input = {
      id: 'dr_01JTESTVRF0000000000000001',
      tenantId: 'ten_01JTESTTENANT00000000000000',
      decisionKey: 'DK-lead.assignment',
      ruleSetVersionId: 'rsv_01JTESTVRF0000000000000001',
      subjectType: 'LEAD',
      subjectId: 'lead_01JTESTLEAD00000000000001',
      evaluationTime: '2026-10-14T00:00:00Z',
      idempotencyKey: 'lead_01:assign:1',
      inputHash: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      inputSnapshot: { lead: { branch_id: 'br_mumbai' } },
      outputs: { pool: 'queue_1' },
      matchedRuleUids: ['RUL-01'],
      missingFields: [],
      status: 'OK',
      fallbackApplied: false,
      durationUs: 150,
      correlationId: 'req_01',
      createdAt: '2026-10-14T00:00:00Z',
    };
    const parsed = DecisionRecordResponseSchema.parse(input);
    expect(parsed.id).toBe(input.id);
    expect(parsed.status).toBe('OK');
  });
});
