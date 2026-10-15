// packages/bre-core/src/evaluate/evaluator.ts — owner: Dev 2 (pure functions, no I/O)
import type { CompiledCondition, CompiledRule, CompiledRuleSet } from '../compile/compiler';
import type { EvaluationResult } from '../ast/types';

export interface EvaluationOptions {
  fallbackPolicy?: 'DEFAULT_OUTPUT' | 'FAIL_CLOSED' | 'MANUAL_REVIEW';
  fallbackOutput?: Record<string, unknown> | null;
  unknownPolicy?: 'IGNORE' | 'UNDETERMINED';
  stepBudget?: number;
}

function getFactValue(facts: unknown, parts: string[]): { found: boolean; value: unknown } {
  let curr = facts;
  for (const part of parts) {
    if (curr === null || typeof curr !== 'object') {
      return { found: false, value: undefined };
    }
    if (!(part in (curr as Record<string, unknown>))) {
      return { found: false, value: undefined };
    }
    curr = (curr as Record<string, unknown>)[part];
  }
  return { found: true, value: curr };
}

function matchCondition(
  cond: CompiledCondition,
  facts: Record<string, unknown>,
  unknownPolicy: 'IGNORE' | 'UNDETERMINED',
  missingFields: Set<string>
): boolean {
  const { found, value } = getFactValue(facts, cond.fieldParts);

  if (!found) {
    missingFields.add(cond.field);
    if (unknownPolicy === 'UNDETERMINED') {
      return false;
    }
    // IGNORE policy: Treat missing as null for is_null
    if (cond.operator === 'is_null') return true;
    if (cond.operator === 'is_not_null') return false;
    return false;
  }

  const actual = value;
  const target = cond.value;

  switch (cond.operator) {
    case '==':
      if (typeof actual === 'object' && typeof target === 'object') {
        return JSON.stringify(actual) === JSON.stringify(target);
      }
      return actual === target;

    case '!=':
      if (typeof actual === 'object' && typeof target === 'object') {
        return JSON.stringify(actual) !== JSON.stringify(target);
      }
      return actual !== target;

    case '>':
      return Number(actual) > Number(target);

    case '<':
      return Number(actual) < Number(target);

    case '>=':
      return Number(actual) >= Number(target);

    case '<=':
      return Number(actual) <= Number(target);

    case 'in':
      return Array.isArray(target) && target.some((t) => t === actual);

    case 'not_in':
      return Array.isArray(target) && !target.some((t) => t === actual);

    case 'contains':
      if (Array.isArray(actual)) {
        return actual.includes(target);
      }
      if (typeof actual === 'string' && typeof target === 'string') {
        return actual.includes(target);
      }
      return false;

    case 'matches':
      if (typeof actual !== 'string') return false;
      return cond.regex ? cond.regex.test(actual) : false;

    case 'is_null':
      return actual === null || actual === undefined;

    case 'is_not_null':
      return actual !== null && actual !== undefined;

    default:
      return false;
  }
}

export function evaluateRuleSet(
  compiled: CompiledRuleSet,
  facts: Record<string, unknown>,
  options: EvaluationOptions = {}
): EvaluationResult {
  const startTime = Date.now();
  const fallbackPolicy = options.fallbackPolicy ?? 'DEFAULT_OUTPUT';
  const defaultFallback = options.fallbackOutput ?? compiled.defaultOutput ?? null;
  const unknownPolicy = options.unknownPolicy ?? 'IGNORE';
  const stepBudget = options.stepBudget ?? 1000;

  const missingFields = new Set<string>();
  const evaluatedRuleUids: string[] = [];
  const matchedRules: CompiledRule[] = [];
  let conditionsEvaluated = 0;

  for (const rule of compiled.rules) {
    if (!rule.enabled) continue;

    evaluatedRuleUids.push(rule.uid);
    let allConditionsMet = true;

    for (const cond of rule.conditions) {
      conditionsEvaluated++;
      if (conditionsEvaluated > stepBudget) {
        const durationUs = (Date.now() - startTime) * 1000;
        return {
          status: 'ERROR',
          outputs: null,
          fallbackApplied: false,
          fallbackPolicy,
          errorCode: 'STEP_BUDGET_EXCEEDED',
          missingFields: Array.from(missingFields),
          matchedRuleUids: [],
          durationUs,
          trace: {
            evaluatedRuleUids,
            hitPolicy: compiled.hitPolicy,
            conditionsEvaluatedCount: conditionsEvaluated,
          },
        };
      }

      const passed = matchCondition(cond, facts, unknownPolicy, missingFields);
      if (!passed) {
        allConditionsMet = false;
        break;
      }
    }

    if (allConditionsMet) {
      matchedRules.push(rule);
      // For FIRST hit policy, early break
      if (compiled.hitPolicy === 'FIRST') {
        break;
      }
    }
  }

  const durationUs = Math.max((Date.now() - startTime) * 1000, 10);
  const trace = {
    evaluatedRuleUids,
    hitPolicy: compiled.hitPolicy,
    conditionsEvaluatedCount: conditionsEvaluated,
  };

  // Hit Policy Application
  if (matchedRules.length === 0) {
    // NO MATCH
    if (fallbackPolicy === 'DEFAULT_OUTPUT' && defaultFallback) {
      return {
        status: 'OK',
        outputs: defaultFallback,
        fallbackApplied: true,
        fallbackPolicy: 'DEFAULT_OUTPUT',
        errorCode: null,
        missingFields: Array.from(missingFields),
        matchedRuleUids: [],
        durationUs,
        trace,
      };
    } else if (fallbackPolicy === 'FAIL_CLOSED') {
      return {
        status: 'NO_MATCH',
        outputs: null,
        fallbackApplied: true,
        fallbackPolicy: 'FAIL_CLOSED',
        errorCode: null,
        missingFields: Array.from(missingFields),
        matchedRuleUids: [],
        durationUs,
        trace,
      };
    } else {
      return {
        status: 'NO_MATCH',
        outputs: defaultFallback,
        fallbackApplied: true,
        fallbackPolicy,
        errorCode: null,
        missingFields: Array.from(missingFields),
        matchedRuleUids: [],
        durationUs,
        trace,
      };
    }
  }

  switch (compiled.hitPolicy) {
    case 'UNIQUE': {
      if (matchedRules.length > 1) {
        return {
          status: 'ERROR',
          outputs: null,
          fallbackApplied: false,
          fallbackPolicy,
          errorCode: 'MULTIPLE_MATCH',
          missingFields: Array.from(missingFields),
          matchedRuleUids: matchedRules.map((r) => r.uid),
          durationUs,
          trace,
        };
      }
      return {
        status: 'OK',
        outputs: matchedRules[0]!.output,
        fallbackApplied: false,
        fallbackPolicy: null,
        errorCode: null,
        missingFields: Array.from(missingFields),
        matchedRuleUids: [matchedRules[0]!.uid],
        durationUs,
        trace,
      };
    }

    case 'FIRST': {
      const selected = matchedRules[0]!;
      return {
        status: 'OK',
        outputs: selected.output,
        fallbackApplied: false,
        fallbackPolicy: null,
        errorCode: null,
        missingFields: Array.from(missingFields),
        matchedRuleUids: [selected.uid],
        durationUs,
        trace,
      };
    }

    case 'PRIORITY': {
      // Sort by priority descending, then definition order ascending
      const sorted = [...matchedRules].sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.orderNo - b.orderNo;
      });
      const selected = sorted[0]!;
      return {
        status: 'OK',
        outputs: selected.output,
        fallbackApplied: false,
        fallbackPolicy: null,
        errorCode: null,
        missingFields: Array.from(missingFields),
        matchedRuleUids: [selected.uid],
        durationUs,
        trace,
      };
    }

    case 'COLLECT': {
      // Merge all outputs
      const merged: Record<string, unknown> = {};
      for (const r of matchedRules) {
        for (const [k, v] of Object.entries(r.output)) {
          if (Array.isArray(v)) {
            const existing = Array.isArray(merged[k]) ? (merged[k] as unknown[]) : [];
            merged[k] = [...existing, ...v];
          } else if (typeof v === 'number' && typeof merged[k] === 'number') {
            merged[k] = (merged[k] as number) + v;
          } else {
            merged[k] = v;
          }
        }
      }
      return {
        status: 'OK',
        outputs: merged,
        fallbackApplied: false,
        fallbackPolicy: null,
        errorCode: null,
        missingFields: Array.from(missingFields),
        matchedRuleUids: matchedRules.map((r) => r.uid),
        durationUs,
        trace,
      };
    }

    case 'RULE_ORDER': {
      // Collect in rule order
      const sorted = [...matchedRules].sort((a, b) => a.orderNo - b.orderNo);
      const merged: Record<string, unknown> = {
        rules: sorted.map((r) => ({ uid: r.uid, output: r.output })),
      };
      return {
        status: 'OK',
        outputs: merged,
        fallbackApplied: false,
        fallbackPolicy: null,
        errorCode: null,
        missingFields: Array.from(missingFields),
        matchedRuleUids: sorted.map((r) => r.uid),
        durationUs,
        trace,
      };
    }

    default: {
      return {
        status: 'OK',
        outputs: matchedRules[0]!.output,
        fallbackApplied: false,
        fallbackPolicy: null,
        errorCode: null,
        missingFields: Array.from(missingFields),
        matchedRuleUids: [matchedRules[0]!.uid],
        durationUs,
        trace,
      };
    }
  }
}
