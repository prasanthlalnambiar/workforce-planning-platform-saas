# Commercial Quality Gate

This repository uses a mandatory quality gate before any future product phase can be approved.

The rule is simple:

> No future phase is approved until the cumulative product passes clean verification, migration checks, tenant isolation checks, role permission checks, governance/immutability checks, workflow checks and external ZIP testing.

This applies before Phase 5 and before every later phase.

## Permanent phase-gate checklist

Every future phase must pass all of the following from a clean checkout or extracted ZIP:

1. Clean install
2. Unit and contract tests
3. TypeScript typecheck
4. ESLint
5. Production build that fully exits
6. Dependency audit
7. Migration verification
8. Tenant isolation tests
9. Role permission tests
10. Governance and immutability attack tests
11. Workflow/E2E or integration workflow checks
12. External ZIP testing

A phase is not accepted if `npm run build` hangs at any point, including:

```text
Linting and checking validity of types ...
Collecting page data ...
Collecting build traces ...
```

The build is only accepted when it exits successfully back to the terminal.

## Required commands

```bash
rm -rf .next
rm -rf node_modules
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm audit --audit-level=low
npm run verify
```

## CI gate

GitHub Actions runs `.github/workflows/quality-gate.yml` on pushes and pull requests.

The CI gate runs:

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm audit --audit-level=low
```

The production build step has a timeout so a build hang fails the workflow instead of appearing successful.

## Database verification scope

Phase 4.1 includes a practical migration verification harness that checks:

- all migrations are present and ordered from zero
- required business tables are tenant-scoped
- RLS is enabled on governed tables
- service-role-only RPCs are not executable by anon or authenticated users
- same-organisation foreign key guards exist
- Layer 1 lock/handoff creation is routed through controlled RPCs
- locked records have database immutability triggers
- Budget Baseline locked snapshots must represent final locked state

## Current limitation

This development environment does not currently include the Supabase CLI, Docker or `psql`, so the Phase 4.1 database verification is a strong SQL contract and repository/service test harness rather than a live Supabase reset.

Before commercial pilot use, add a live Supabase/Postgres verification job that executes the migrations against an empty database and runs RLS/RPC attack tests with real users and JWT contexts.

## External ZIP rule

External review ZIPs must exclude:

- `node_modules/`
- `.next/`
- `.git/`
- `.env`
- `.env.*`
- `coverage/`
- `test-results/`
- `playwright-report/`
- `supabase/.temp/`
- `supabase/.branches/`
- `*.tsbuildinfo`

After extraction, the reviewer should run the clean verification commands above.

## Product boundary rule

Quality-gate phases must not add new product capability.

For this Phase 4.1 gate, the allowed work is limited to:

- build stability proof
- CI quality gate
- migration verification
- tenant isolation proof
- role permission proof
- governance and immutability proof
- Budget Baseline snapshot accuracy fix
- workflow contract proof
- documentation and external ZIP preparation

Phase 5 driver/reforecast work remains out of scope until this gate passes external testing.
