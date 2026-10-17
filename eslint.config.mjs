// ESLint flat config (ESLint 9). Owner: Dev 1.
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const MODULES_DIR = 'apps/api/src/modules';

// Module boundary rule (NFR-MNT-001, Contracts §2): a module never imports another module's internals.
// One boundary unit per row of Assignment Matrix §4. Cross-unit calls go through the ports in
// packages/contracts only.
const BOUNDARY_UNITS = {
  'platform (Dev 1)': ['platform'],
  'rules engine (Dev 2)': ['rules/engine'],
  'rules lifecycle (Dev 6)': ['rules/api'],
  'tasks (Dev 6)': ['crm/tasks'],
  'catalogue + applications (Dev 3)': ['origination/catalogue', 'origination/applications'],
  'lender cases (Dev 4)': ['origination/lender-cases'],
  'leads, customers, activity, compliance, finance (Dev 5)': [
    'crm/leads',
    'crm/customers',
    'crm/activities',
    'compliance',
    'finance',
  ],
};

const boundaryZones = Object.entries(BOUNDARY_UNITS).map(([unit, dirs]) => ({
  target: dirs.map((d) => `${MODULES_DIR}/${d}`),
  from: Object.entries(BOUNDARY_UNITS)
    .filter(([other]) => other !== unit)
    .flatMap(([, otherDirs]) => otherDirs.map((d) => `${MODULES_DIR}/${d}`)),
  message: `Module boundary: "${unit}" may not import another module's internals. Use a port from @dsa/contracts.`,
}));

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/scratch/**',
      'scratch/**',
      'openapi/**',
      'supabase/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // No `any` in packages/* (Contracts §14).
    files: ['packages/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    files: [
      'apps/api/**/*.{ts,js,mjs,cjs}',
      'tools/**/*.{ts,js,mjs,cjs}',
      'packages/**/*.ts',
      'tests/**/*.ts',
      '**/*.cjs',
      '**/*.mjs',
    ],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-redeclare': 'off',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: [`${MODULES_DIR}/**/*.ts`],
    plugins: { import: importPlugin },
    settings: { 'import/resolver': { node: { extensions: ['.ts', '.tsx', '.js'] } } },
    rules: {
      'import/no-restricted-paths': ['error', { basePath: import.meta.dirname, zones: boundaryZones }],
    },
  },
);
