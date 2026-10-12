## Task

<!-- One task or subtask per PR, about 400 changed lines or fewer. Branch: d<N>/TASK-nnn-short-name -->

- Task: TASK-___ (link to the 4-Day Task Register page)
- Lane / owner: Dev _
- Tests added (IDs): TC-___ / TEST-___

## What changed

## Checklist

- [ ] CI is green (lint, typecheck, unit, web-build, migrate, secrets)
- [ ] Commit messages follow Conventional Commits with the task ID, e.g. `feat(leads): TASK-107 create lead with routing`
- [ ] No import of another module's internals; cross-module calls go through a port in `@dsa/contracts`
- [ ] State-changing commands write audit (and outbox where listed) **in the same transaction**
- [ ] No S3-class data stored; logs and error messages contain no mobile, email, names, tokens or fact values
- [ ] New list/detail endpoints: out-of-scope or other-tenant IDs return 404; isolation case added in `tests/isolation/cases/<module>.spec.ts`
- [ ] `openapi/openapi.yaml` regenerated (`npm run gen:openapi`) if the API changed
- [ ] Synthetic data only in fixtures

## Contract or shared-file changes

<!-- Changes to packages/contracts, supabase/migrations or shared config need approval from both other owners
     affected, plus a line in the Contracts §15 change log. Delete this section if not applicable. -->

- [ ] Contracts change log updated
- [ ] Affected owners requested as reviewers
