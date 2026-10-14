// packages/bre-core/test/bre-core.spec.ts — owner: Dev 2
import { describe, expect, it } from 'vitest';
import {
  canonicalJsonStringify,
  computeContentHash,
  compileRuleSet,
  detectDecisionDependencyCycle,
  evaluateRuleSet,
  validateRuleSetDefinition,
  type RuleSetDefinition,
} from '../src';

describe('Module 23: @dsa/bre-core Unit Test Suite', () => {
  describe('Canonical JSON & SHA-256 Hashing', () => {
    it('canonicalJsonStringify sorts keys lexicographically and strips whitespace', () => {
      const obj1 = { b: 2, a: 1, c: { y: 20, x: 10 } };
      const obj2 = { a: 1, c: { x: 10, y: 20 }, b: 2 };
      expect(canonicalJsonStringify(obj1)).toBe(canonicalJsonStringify(obj2));
      expect(canonicalJsonStringify(obj1)).toBe('{"a":1,"b":2,"c":{"x":10,"y":20}}');
    });

    it('computeContentHash produces valid sha256: hash with 64 hex characters', () => {
      const hash = computeContentHash({ schemaVersion: 1, rules: [] });
      expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('computeContentHash is deterministic across equivalent objects with different key order', () => {
      const hash1 = computeContentHash({ z: 'foo', a: 'bar' });
      const hash2 = computeContentHash({ a: 'bar', z: 'foo' });
      expect(hash1).toBe(hash2);
    });
  });

  describe('Rule Validation', () => {
    it('validates a valid RuleSetDefinition with PASS result', () => {
      const validDef: RuleSetDefinition = {
        schemaVersion: 1,
        hitPolicy: 'FIRST',
        rules: [
          {
            uid: 'RUL-ASSIGN-01',
            name: 'High value lead to senior pool',
            enabled: true,
            orderNo: 0,
            conditions: [
              { field: 'lead.indicative_amount.amount', operator: '>=', value: 500000 },
              { field: 'lead.product_category', operator: '==', value: 'PL' },
            ],
            output: { pool: 'senior_queue', strategy: 'SPECIFIC_USER' },
          },
        ],
      };

      const report = validateRuleSetDefinition(validDef);
      expect(report.result).toBe('PASS');
      expect(report.issues.filter((i) => i.severity === 'ERROR')).toHaveLength(0);
      expect(report.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it('rejects unsupported schemaVersion', () => {
      const invalidDef = { schemaVersion: 2, rules: [] };
      const report = validateRuleSetDefinition(invalidDef);
      expect(report.result).toBe('FAIL');
      expect(report.issues.some((i) => i.code === 'UNSUPPORTED_SCHEMA_VERSION')).toBe(true);
    });

    it('rejects duplicate rule UIDs', () => {
      const def: RuleSetDefinition = {
        schemaVersion: 1,
        hitPolicy: 'FIRST',
        rules: [
          {
            uid: 'RUL-DUP-01',
            name: 'Rule A',
            enabled: true,
            conditions: [],
            output: {},
          },
          {
            uid: 'RUL-DUP-01',
            name: 'Rule B',
            enabled: true,
            conditions: [],
            output: {},
          },
        ],
      };

      const report = validateRuleSetDefinition(def);
      expect(report.result).toBe('FAIL');
      expect(report.issues.some((i) => i.code === 'DUPLICATE_RULE_UID')).toBe(true);
    });

    it('rejects invalid condition operator and regex pattern', () => {
      const def = {
        schemaVersion: 1,
        hitPolicy: 'FIRST',
        rules: [
          {
            uid: 'RUL-BAD-01',
            name: 'Bad rule',
            enabled: true,
            conditions: [
              { field: 'lead.email', operator: 'invalid_op', value: 'test' },
              { field: 'lead.email', operator: 'matches', value: '[unclosed regex' },
            ],
            output: {},
          },
        ],
      };

      const report = validateRuleSetDefinition(def);
      expect(report.result).toBe('FAIL');
      expect(report.issues.some((i) => i.code === 'INVALID_OPERATOR')).toBe(true);
      expect(report.issues.some((i) => i.code === 'INVALID_REGEX')).toBe(true);
    });

    it('detects conflicting rules in UNIQUE hit policy', () => {
      const def: RuleSetDefinition = {
        schemaVersion: 1,
        hitPolicy: 'UNIQUE',
        rules: [
          {
            uid: 'RUL-U-01',
            name: 'Rule 1',
            enabled: true,
            conditions: [{ field: 'category', operator: '==', value: 'PL' }],
            output: { result: 'A' },
          },
          {
            uid: 'RUL-U-02',
            name: 'Rule 2',
            enabled: true,
            conditions: [{ field: 'category', operator: '==', value: 'PL' }],
            output: { result: 'B' },
          },
        ],
      };

      const report = validateRuleSetDefinition(def);
      expect(report.result).toBe('FAIL');
      expect(report.issues.some((i) => i.code === 'CONFLICTING_RULES')).toBe(true);
    });
  });

  describe('Rule Evaluation Engine & Hit Policies', () => {
    const sampleDef: RuleSetDefinition = {
      schemaVersion: 1,
      hitPolicy: 'FIRST',
      defaultOutput: { default: true },
      rules: [
        {
          uid: 'RUL-01',
          name: 'Tier 1 Salaried Mumbai',
          orderNo: 0,
          enabled: true,
          conditions: [
            { field: 'party.applicant_type', operator: '==', value: 'SALARIED' },
            { field: 'lead.branch_id', operator: '==', value: 'br_mumbai' },
            { field: 'lead.amount', operator: '>', value: 200000 },
          ],
          output: { tier: 'GOLD', autoApprove: true },
        },
        {
          uid: 'RUL-02',
          name: 'General Salaried',
          orderNo: 1,
          enabled: true,
          conditions: [{ field: 'party.applicant_type', operator: '==', value: 'SALARIED' }],
          output: { tier: 'SILVER', autoApprove: false },
        },
      ],
    };

    it('evaluates FIRST hit policy selecting first matching rule', () => {
      const compiled = compileRuleSet(sampleDef);
      const facts = {
        party: { applicant_type: 'SALARIED' },
        lead: { branch_id: 'br_mumbai', amount: 350000 },
      };

      const result = evaluateRuleSet(compiled, facts);
      expect(result.status).toBe('OK');
      expect(result.outputs).toEqual({ tier: 'GOLD', autoApprove: true });
      expect(result.matchedRuleUids).toEqual(['RUL-01']);
      expect(result.fallbackApplied).toBe(false);
    });

    it('falls through to second rule when first rule conditions fail', () => {
      const compiled = compileRuleSet(sampleDef);
      const facts = {
        party: { applicant_type: 'SALARIED' },
        lead: { branch_id: 'br_pune', amount: 350000 }, // branch mismatch for RUL-01
      };

      const result = evaluateRuleSet(compiled, facts);
      expect(result.status).toBe('OK');
      expect(result.outputs).toEqual({ tier: 'SILVER', autoApprove: false });
      expect(result.matchedRuleUids).toEqual(['RUL-02']);
    });

    it('applies default output fallback when NO_MATCH occurs', () => {
      const compiled = compileRuleSet(sampleDef);
      const facts = {
        party: { applicant_type: 'SELF_EMPLOYED_BUSINESS' },
      };

      const result = evaluateRuleSet(compiled, facts, { fallbackPolicy: 'DEFAULT_OUTPUT' });
      expect(result.status).toBe('OK');
      expect(result.outputs).toEqual({ default: true });
      expect(result.fallbackApplied).toBe(true);
      expect(result.fallbackPolicy).toBe('DEFAULT_OUTPUT');
    });

    it('applies FAIL_CLOSED fallback returning null outputs when configured', () => {
      const compiled = compileRuleSet(sampleDef);
      const facts = {
        party: { applicant_type: 'NON_INDIVIDUAL' },
      };

      const result = evaluateRuleSet(compiled, facts, { fallbackPolicy: 'FAIL_CLOSED' });
      expect(result.status).toBe('NO_MATCH');
      expect(result.outputs).toBeNull();
      expect(result.fallbackApplied).toBe(true);
      expect(result.fallbackPolicy).toBe('FAIL_CLOSED');
    });

    it('evaluates PRIORITY hit policy respecting numeric priority descending', () => {
      const priorityDef: RuleSetDefinition = {
        schemaVersion: 1,
        hitPolicy: 'PRIORITY',
        rules: [
          {
            uid: 'RUL-LOW',
            name: 'Low Priority match',
            priority: 10,
            enabled: true,
            conditions: [{ field: 'active', operator: '==', value: true }],
            output: { level: 'LOW' },
          },
          {
            uid: 'RUL-HIGH',
            name: 'High Priority match',
            priority: 90,
            enabled: true,
            conditions: [{ field: 'active', operator: '==', value: true }],
            output: { level: 'HIGH' },
          },
        ],
      };

      const compiled = compileRuleSet(priorityDef);
      const result = evaluateRuleSet(compiled, { active: true });
      expect(result.status).toBe('OK');
      expect(result.outputs).toEqual({ level: 'HIGH' });
      expect(result.matchedRuleUids).toEqual(['RUL-HIGH']);
    });

    it('evaluates UNIQUE hit policy returning MULTIPLE_MATCH error on conflict', () => {
      const uniqueDef: RuleSetDefinition = {
        schemaVersion: 1,
        hitPolicy: 'UNIQUE',
        rules: [
          {
            uid: 'RUL-A',
            name: 'Rule A',
            enabled: true,
            conditions: [{ field: 'score', operator: '>', value: 50 }],
            output: { passed: true },
          },
          {
            uid: 'RUL-B',
            name: 'Rule B',
            enabled: true,
            conditions: [{ field: 'score', operator: '>', value: 70 }],
            output: { distinction: true },
          },
        ],
      };

      const compiled = compileRuleSet(uniqueDef);
      const result = evaluateRuleSet(compiled, { score: 85 });
      expect(result.status).toBe('ERROR');
      expect(result.errorCode).toBe('MULTIPLE_MATCH');
      expect(result.matchedRuleUids).toEqual(['RUL-A', 'RUL-B']);
    });

    it('evaluates COLLECT hit policy merging matched outputs and numbers/arrays', () => {
      const collectDef: RuleSetDefinition = {
        schemaVersion: 1,
        hitPolicy: 'COLLECT',
        rules: [
          {
            uid: 'RUL-DOC-01',
            name: 'Require PAN',
            enabled: true,
            conditions: [{ field: 'product', operator: '==', value: 'PL' }],
            output: { docs: ['PAN'], fee: 500 },
          },
          {
            uid: 'RUL-DOC-02',
            name: 'Require Salary Slip',
            enabled: true,
            conditions: [{ field: 'applicant', operator: '==', value: 'SALARIED' }],
            output: { docs: ['SALARY_SLIP'], fee: 200 },
          },
        ],
      };

      const compiled = compileRuleSet(collectDef);
      const result = evaluateRuleSet(compiled, { product: 'PL', applicant: 'SALARIED' });
      expect(result.status).toBe('OK');
      expect(result.outputs).toEqual({
        docs: ['PAN', 'SALARY_SLIP'],
        fee: 700,
      });
      expect(result.matchedRuleUids).toEqual(['RUL-DOC-01', 'RUL-DOC-02']);
    });

    it('evaluates various operators: in, not_in, contains, matches, is_null, is_not_null', () => {
      const opsDef: RuleSetDefinition = {
        schemaVersion: 1,
        hitPolicy: 'FIRST',
        rules: [
          {
            uid: 'RUL-OPS',
            name: 'Operators test',
            enabled: true,
            conditions: [
              { field: 'day', operator: 'in', value: ['MON', 'TUE', 'WED'] },
              { field: 'role', operator: 'not_in', value: ['BLOCKED', 'RESTRICTED'] },
              { field: 'tags', operator: 'contains', value: 'VIP' },
              { field: 'mobile', operator: 'matches', value: '^[6-9]\\d{9}$' },
              { field: 'secondaryEmail', operator: 'is_null' },
              { field: 'primaryEmail', operator: 'is_not_null' },
            ],
            output: { match: true },
          },
        ],
      };

      const compiled = compileRuleSet(opsDef);
      const validFacts = {
        day: 'TUE',
        role: 'STAFF',
        tags: ['VIP', 'PREFERRED'],
        mobile: '9876543210',
        secondaryEmail: null,
        primaryEmail: 'user@example.com',
      };

      const res = evaluateRuleSet(compiled, validFacts);
      expect(res.status).toBe('OK');
      expect(res.outputs).toEqual({ match: true });

      // Invalid mobile fails regex
      const invalidFacts = { ...validFacts, mobile: '12345' };
      const failRes = evaluateRuleSet(compiled, invalidFacts);
      expect(failRes.status).toBe('NO_MATCH');
    });

    it('enforces step budget and halts with TIMEOUT_BUDGET error when budget is exceeded', () => {
      const budgetDef: RuleSetDefinition = {
        schemaVersion: 1,
        hitPolicy: 'FIRST',
        rules: [
          {
            uid: 'RUL-01',
            name: 'Rule 1',
            enabled: true,
            conditions: [
              { field: 'a', operator: '==', value: 1 },
              { field: 'b', operator: '==', value: 2 },
              { field: 'c', operator: '==', value: 3 },
            ],
            output: { res: 1 },
          },
        ],
      };

      const compiled = compileRuleSet(budgetDef);
      // stepBudget of 1 condition evaluation halts before finishing all conditions
      const result = evaluateRuleSet(compiled, { a: 1, b: 2, c: 3 }, { stepBudget: 1 });
      expect(result.status).toBe('ERROR');
      expect(result.errorCode).toBe('STEP_BUDGET_EXCEEDED');
    });
  });

  describe('Decision Dependencies & Cycle Detection', () => {
    it('detects circular dependencies in decision dependency graphs', () => {
      const cyclicGraph = {
        'DK-app.eligibility': ['DK-credit.score'],
        'DK-credit.score': ['DK-income.verification'],
        'DK-income.verification': ['DK-app.eligibility'], // cycle!
      };

      const res = detectDecisionDependencyCycle(cyclicGraph);
      expect(res.hasCycle).toBe(true);
      expect(res.cyclePath).toBeDefined();
    });

    it('confirms acyclic decision dependency DAG is valid', () => {
      const acyclicGraph = {
        'DK-lead.assignment': ['DK-lead.duplicate'],
        'DK-lead.duplicate': [],
        'DK-sla.target': [],
      };

      const res = detectDecisionDependencyCycle(acyclicGraph);
      expect(res.hasCycle).toBe(false);
    });
  });
});

