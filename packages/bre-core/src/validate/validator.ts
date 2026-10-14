// packages/bre-core/src/validate/validator.ts — owner: Dev 2 (pure functions, no I/O)
import type {
  HitPolicy,
  RuleCondition,
  RuleDefinition,
  RuleSetDefinition,
  ValidationIssue,
  ValidationReport,
} from '../ast/types';
import { CONDITION_OPERATORS } from '../ast/types';
import { computeContentHash } from '../canonical-json';

export interface ValidationContext {
  hitPolicy?: HitPolicy;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

const RULE_UID_REGEX = /^RUL-[A-Z0-9-]{2,30}$/;

export function validateRuleSetDefinition(
  definition: unknown,
  ctx: ValidationContext = {}
): ValidationReport {
  const issues: ValidationIssue[] = [];
  const contentHash = computeContentHash(definition);

  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    issues.push({
      code: 'INVALID_ROOT',
      severity: 'ERROR',
      message: 'Rule set definition must be an object with schemaVersion: 1 and a rules array.',
    });
    return { result: 'FAIL', contentHash, issues };
  }

  const def = definition as Partial<RuleSetDefinition>;

  if (def.schemaVersion !== 1) {
    issues.push({
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      severity: 'ERROR',
      message: `schemaVersion must be 1 (received ${String(def.schemaVersion)}).`,
      path: 'schemaVersion',
    });
  }

  if (!Array.isArray(def.rules)) {
    issues.push({
      code: 'MISSING_RULES_ARRAY',
      severity: 'ERROR',
      message: 'Definition must contain a rules array.',
      path: 'rules',
    });
    return { result: 'FAIL', contentHash, issues };
  }

  if (def.rules.length > 200) {
    issues.push({
      code: 'MAX_RULE_COUNT_EXCEEDED',
      severity: 'ERROR',
      message: `Rule set exceeds maximum permitted rule count of 200 (contains ${def.rules.length}).`,
      path: 'rules',
    });
  }

  const effectiveHitPolicy: HitPolicy = def.hitPolicy ?? ctx.hitPolicy ?? 'FIRST';
  const seenUids = new Set<string>();
  const seenPriorities = new Set<number>();
  const seenOrderNos = new Set<number>();

  for (let idx = 0; idx < def.rules.length; idx++) {
    const rule = def.rules[idx];
    const path = `rules[${idx}]`;

    if (!rule || typeof rule !== 'object') {
      issues.push({
        code: 'INVALID_RULE_OBJECT',
        severity: 'ERROR',
        message: `Rule at index ${idx} must be an object.`,
        path,
      });
      continue;
    }

    // UID Validation
    if (!rule.uid || typeof rule.uid !== 'string') {
      issues.push({
        code: 'MISSING_RULE_UID',
        severity: 'ERROR',
        message: `Rule at index ${idx} missing string uid.`,
        path: `${path}.uid`,
      });
    } else {
      if (!RULE_UID_REGEX.test(rule.uid)) {
        issues.push({
          code: 'INVALID_RULE_UID',
          severity: 'ERROR',
          message: `Rule uid '${rule.uid}' must match pattern ^RUL-[A-Z0-9-]{2,30}$.`,
          ruleUid: rule.uid,
          path: `${path}.uid`,
        });
      }
      if (seenUids.has(rule.uid)) {
        issues.push({
          code: 'DUPLICATE_RULE_UID',
          severity: 'ERROR',
          message: `Duplicate rule uid '${rule.uid}' detected.`,
          ruleUid: rule.uid,
          path: `${path}.uid`,
        });
      }
      seenUids.add(rule.uid);
    }

    // Name Validation
    if (!rule.name || typeof rule.name !== 'string' || rule.name.trim().length === 0) {
      issues.push({
        code: 'MISSING_RULE_NAME',
        severity: 'ERROR',
        message: `Rule '${rule.uid || idx}' must have a non-empty name.`,
        ruleUid: rule.uid,
        path: `${path}.name`,
      });
    }

    // Priority / Ordering checks
    if (effectiveHitPolicy === 'PRIORITY') {
      if (rule.priority === undefined || rule.priority === null) {
        issues.push({
          code: 'MISSING_PRIORITY',
          severity: 'ERROR',
          message: `Rule '${rule.uid}' must specify integer priority for PRIORITY hit policy.`,
          ruleUid: rule.uid,
          path: `${path}.priority`,
        });
      } else if (typeof rule.priority !== 'number' || !Number.isInteger(rule.priority) || rule.priority < 0) {
        issues.push({
          code: 'INVALID_PRIORITY',
          severity: 'ERROR',
          message: `Rule '${rule.uid}' priority must be a non-negative integer.`,
          ruleUid: rule.uid,
          path: `${path}.priority`,
        });
      } else {
        if (seenPriorities.has(rule.priority)) {
          issues.push({
            code: 'DUPLICATE_PRIORITY',
            severity: 'WARNING',
            message: `Priority ${rule.priority} is shared by multiple rules. Tie-breaker will use definition order.`,
            ruleUid: rule.uid,
            path: `${path}.priority`,
          });
        }
        seenPriorities.add(rule.priority);
      }
    } else {
      if (rule.orderNo !== undefined && rule.orderNo !== null) {
        if (typeof rule.orderNo !== 'number' || !Number.isInteger(rule.orderNo) || rule.orderNo < 0) {
          issues.push({
            code: 'INVALID_ORDER_NO',
            severity: 'ERROR',
            message: `Rule '${rule.uid}' orderNo must be a non-negative integer.`,
            ruleUid: rule.uid,
            path: `${path}.orderNo`,
          });
        } else {
          if (seenOrderNos.has(rule.orderNo)) {
            issues.push({
              code: 'DUPLICATE_ORDER_NO',
              severity: 'ERROR',
              message: `Duplicate orderNo ${rule.orderNo} on rule '${rule.uid}'.`,
              ruleUid: rule.uid,
              path: `${path}.orderNo`,
            });
          }
          seenOrderNos.add(rule.orderNo);
        }
      }
    }

    // Output Validation
    if (!rule.output || typeof rule.output !== 'object') {
      issues.push({
        code: 'MISSING_RULE_OUTPUT',
        severity: 'ERROR',
        message: `Rule '${rule.uid}' must define an output object.`,
        ruleUid: rule.uid,
        path: `${path}.output`,
      });
    }

    // Conditions Validation
    if (!Array.isArray(rule.conditions)) {
      issues.push({
        code: 'MISSING_CONDITIONS_ARRAY',
        severity: 'ERROR',
        message: `Rule '${rule.uid}' conditions must be an array.`,
        ruleUid: rule.uid,
        path: `${path}.conditions`,
      });
    } else {
      if (rule.conditions.length > 25) {
        issues.push({
          code: 'MAX_CONDITIONS_EXCEEDED',
          severity: 'ERROR',
          message: `Rule '${rule.uid}' has ${rule.conditions.length} conditions (max permitted: 25).`,
          ruleUid: rule.uid,
          path: `${path}.conditions`,
        });
      }

      for (let cIdx = 0; cIdx < rule.conditions.length; cIdx++) {
        const cond = rule.conditions[cIdx];
        const condPath = `${path}.conditions[${cIdx}]`;

        if (!cond || typeof cond !== 'object') {
          issues.push({
            code: 'INVALID_CONDITION',
            severity: 'ERROR',
            message: `Condition at index ${cIdx} in rule '${rule.uid}' must be an object.`,
            ruleUid: rule.uid,
            path: condPath,
          });
          continue;
        }

        if (!cond.field || typeof cond.field !== 'string' || cond.field.trim().length === 0) {
          issues.push({
            code: 'MISSING_CONDITION_FIELD',
            severity: 'ERROR',
            message: `Condition at index ${cIdx} in rule '${rule.uid}' has empty field.`,
            ruleUid: rule.uid,
            path: `${condPath}.field`,
          });
        }

        if (!CONDITION_OPERATORS.includes(cond.operator)) {
          issues.push({
            code: 'INVALID_OPERATOR',
            severity: 'ERROR',
            message: `Condition at index ${cIdx} has invalid operator '${cond.operator}'. Allowed: ${CONDITION_OPERATORS.join(', ')}`,
            ruleUid: rule.uid,
            path: `${condPath}.operator`,
          });
        } else {
          // Operator-value compatibility
          if (cond.operator === 'in' || cond.operator === 'not_in') {
            if (!Array.isArray(cond.value)) {
              issues.push({
                code: 'OPERATOR_VALUE_TYPE_MISMATCH',
                severity: 'ERROR',
                message: `Operator '${cond.operator}' requires an array value.`,
                ruleUid: rule.uid,
                path: `${condPath}.value`,
              });
            }
          } else if (['>', '<', '>=', '<='].includes(cond.operator)) {
            if (typeof cond.value !== 'number' && typeof cond.value !== 'string') {
              issues.push({
                code: 'OPERATOR_VALUE_TYPE_MISMATCH',
                severity: 'ERROR',
                message: `Comparison operator '${cond.operator}' requires a numeric or string value.`,
                ruleUid: rule.uid,
                path: `${condPath}.value`,
              });
            }
          } else if (cond.operator === 'matches') {
            if (typeof cond.value !== 'string') {
              issues.push({
                code: 'OPERATOR_VALUE_TYPE_MISMATCH',
                severity: 'ERROR',
                message: `Operator 'matches' requires a regex string value.`,
                ruleUid: rule.uid,
                path: `${condPath}.value`,
              });
            } else {
              try {
                new RegExp(cond.value);
              } catch {
                issues.push({
                  code: 'INVALID_REGEX',
                  severity: 'ERROR',
                  message: `Invalid regex pattern '${cond.value}'.`,
                  ruleUid: rule.uid,
                  path: `${condPath}.value`,
                });
              }
            }
          }
        }
      }
    }
  }

  // Conflict / Unreachability Analysis
  validateRuleConflicts(def.rules, effectiveHitPolicy, issues);

  const hasErrors = issues.some((i) => i.severity === 'ERROR');
  return {
    result: hasErrors ? 'FAIL' : 'PASS',
    contentHash,
    issues,
  };
}

function conditionsKey(conditions: RuleCondition[]): string {
  const normalized = conditions
    .map((c) => `${c.field}|${c.operator}|${JSON.stringify(c.value)}`)
    .sort()
    .join('&&');
  return normalized || '<EMPTY>';
}

function validateRuleConflicts(
  rules: RuleDefinition[],
  hitPolicy: HitPolicy,
  issues: ValidationIssue[]
): void {
  const conditionMap = new Map<string, RuleDefinition[]>();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const key = conditionsKey(rule.conditions || []);
    const existing = conditionMap.get(key) || [];
    existing.push(rule);
    conditionMap.set(key, existing);
  }

  for (const [key, matchingRules] of conditionMap.entries()) {
    if (matchingRules.length > 1) {
      if (hitPolicy === 'UNIQUE') {
        issues.push({
          code: 'CONFLICTING_RULES',
          severity: 'ERROR',
          message: `Hit policy UNIQUE violated: multiple rules (${matchingRules.map((r) => r.uid).join(', ')}) share identical conditions: ${key}`,
          ruleUid: matchingRules[1]?.uid,
        });
      } else if (hitPolicy === 'FIRST') {
        issues.push({
          code: 'UNREACHABLE_RULE',
          severity: 'WARNING',
          message: `Rule '${matchingRules[1]?.uid}' is shadowed by earlier rule '${matchingRules[0]?.uid}' with identical conditions.`,
          ruleUid: matchingRules[1]?.uid,
        });
      }
    }
  }
}

/**
 * Validates that decision definitions graph does not contain circular dependencies.
 */
export function detectDecisionDependencyCycle(graph: Record<string, string[]>): {
  hasCycle: boolean;
  cyclePath?: string[];
} {
  const visited = new Set<string>();
  const recStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): boolean {
    visited.add(node);
    recStack.add(node);
    path.push(node);

    const neighbors = graph[node] || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recStack.has(neighbor)) {
        path.push(neighbor);
        return true;
      }
    }

    recStack.delete(node);
    path.pop();
    return false;
  }

  for (const node of Object.keys(graph)) {
    if (!visited.has(node)) {
      if (dfs(node)) {
        return { hasCycle: true, cyclePath: path };
      }
    }
  }

  return { hasCycle: false };
}

