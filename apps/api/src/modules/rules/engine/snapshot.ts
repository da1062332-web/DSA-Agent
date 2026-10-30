// What a decision record keeps of the facts it used (owner: Dev 2, the rules module; changed for MOD-ELG on 2026-10-28).
// For the decision keys that carry personal financial data, the record shows which facts were used, not their values. The decision
// itself still runs on the real values, and the record's input hash is still computed over them, so the record stays verifiable.
export const REDACTED = '[redacted]';

/** Fact paths whose values are kept out of the stored input snapshot, per decision key. */
export const REDACTED_FACT_PATHS: Readonly<Record<string, readonly string[]>> = {
  'DK-application.eligibility': ['applicant.credit_score', 'applicant.monthly_income'],
};

/** The snapshot to store. Facts for other decision keys, and any key without redacted paths, are stored unchanged. */
export function snapshotForRecord(
  decisionKey: string,
  facts: Record<string, unknown>,
): Record<string, unknown> {
  const paths = REDACTED_FACT_PATHS[decisionKey];
  if (!paths || paths.length === 0) return facts;
  const copy = structuredClone(facts) as Record<string, unknown>;
  for (const path of paths) {
    const parts = path.split('.');
    const leaf = parts.pop()!;
    let node: Record<string, unknown> | undefined = copy;
    for (const part of parts) {
      const next: unknown = node?.[part];
      node = next !== null && typeof next === 'object' ? (next as Record<string, unknown>) : undefined;
    }
    if (node && leaf in node) node[leaf] = REDACTED;
  }
  return copy;
}
