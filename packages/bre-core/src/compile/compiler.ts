// packages/bre-core/src/compile/compiler.ts — owner: Dev 2 (pure functions, no I/O)
import type { HitPolicy, RuleCondition, RuleSetDefinition } from '../ast/types';

export interface CompiledCondition {
  field: string;
  fieldParts: string[];
  operator: RuleCondition['operator'];
  value: unknown;
  regex?: RegExp;
}

export interface CompiledRule {
  uid: string;
  name: string;
  orderNo: number;
  priority: number;
  enabled: boolean;
  conditions: CompiledCondition[];
  output: Record<string, unknown>;
  explanation?: string;
}

export interface CompiledRuleSet {
  schemaVersion: 1;
  hitPolicy: HitPolicy;
  defaultOutput: Record<string, unknown> | null;
  rules: CompiledRule[];
}

export function compileRuleSet(
  definition: RuleSetDefinition,
  fallbackHitPolicy: HitPolicy = 'FIRST',
): CompiledRuleSet {
  const hitPolicy = definition.hitPolicy ?? fallbackHitPolicy;

  const rules: CompiledRule[] = (definition.rules || []).map((r, index) => {
    const compiledConditions: CompiledCondition[] = (r.conditions || []).map((c) => {
      let regex: RegExp | undefined;
      if (c.operator === 'matches' && typeof c.value === 'string') {
        try {
          regex = new RegExp(c.value);
        } catch {
          // handled in validation
        }
      }
      return {
        field: c.field,
        fieldParts: c.field.split('.'),
        operator: c.operator,
        value: c.value,
        regex,
      };
    });

    return {
      uid: r.uid,
      name: r.name,
      orderNo: r.orderNo ?? index,
      priority: r.priority ?? 0,
      enabled: r.enabled ?? true,
      conditions: compiledConditions,
      output: r.output || {},
      explanation: r.explanation,
    };
  });

  return {
    schemaVersion: 1,
    hitPolicy,
    defaultOutput: definition.defaultOutput ?? null,
    rules,
  };
}
