// TEST-KRN-003: the module boundary rule rejects a cross-module import (eslint.config.mjs at the repo root).
import { ESLint } from 'eslint';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const fixturePath = path.join(repoRoot, 'apps/api/src/modules/crm/leads/__boundary_fixture__.ts');

async function lint(code: string) {
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(code, { filePath: fixturePath });
  return result?.messages ?? [];
}

describe('module boundary lint', () => {
  it('TEST-KRN-003 crm importing origination internals is an ESLint boundary error', async () => {
    const messages = await lint(
      "import { createRouter } from '../../origination/applications/router';\nexport const r = createRouter;\n",
    );
    expect(messages.some((m) => m.ruleId === 'import/no-restricted-paths' && m.severity === 2)).toBe(true);
  });

  it('allows imports from @dsa/contracts and within the same boundary unit', async () => {
    const messages = await lint(
      "import type { Principal } from '@dsa/contracts';\nimport { createRouter } from '../customers/router';\nexport type P = Principal;\nexport const r = createRouter;\n",
    );
    expect(messages.filter((m) => m.ruleId === 'import/no-restricted-paths')).toEqual([]);
  });
});
