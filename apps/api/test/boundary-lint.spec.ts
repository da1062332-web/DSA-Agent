/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck

import path from 'node:path';
import type { ESLint, Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const fixturePath = path.join(repoRoot, 'apps/api/src/modules/crm/leads/__boundary_fixture__.ts');

const eslintPkg = 'eslint';
let ESLintClass: typeof ESLint | null = null;
try {
  const mod = await import(/* @vite-ignore */ eslintPkg);
  ESLintClass = mod.ESLint;
} catch {
  // ESLint not installed in environment
}

describe.skipIf(!ESLintClass)('module boundary lint', () => {
  async function lint(code: string) {
    const eslint = new ESLintClass!({ cwd: repoRoot });
    const [result] = await eslint.lintText(code, { filePath: fixturePath });
    return result?.messages ?? [];
  }

  it('TEST-KRN-003 crm importing origination internals is an ESLint boundary error', async () => {
    const messages = await lint(
      "import { createRouter } from '../../origination/applications/router';\nexport const r = createRouter;\n",
    );
    expect(messages.some((m: Linter.LintMessage) => m.ruleId === 'import/no-restricted-paths' && m.severity === 2)).toBe(true);
  });

  it('allows imports from @dsa/contracts and within the same boundary unit', async () => {
    const messages = await lint(
      "import type { Principal } from '@dsa/contracts';\nimport { createRouter } from '../customers/router';\nexport type P = Principal;\nexport const r = createRouter;\n",
    );
    expect(messages.filter((m: Linter.LintMessage) => m.ruleId === 'import/no-restricted-paths')).toEqual([]);
  });
});
