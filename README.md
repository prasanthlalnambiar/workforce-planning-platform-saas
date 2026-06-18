# Workforce Planning and Labour Budget Governance Platform

Production SaaS codebase for a two-layer workforce planning and labour budget governance platform.

This codebase is separate from the public consulting website. It is the application foundation for the planning product.

## Product model

The platform is designed around two governed planning layers:

1. **Layer 1: Demand to budget**  
   Messy demand → workload → required FTE → supply gap → labour budget → approved locked handoff

2. **Layer 2: Budget governance**  
   Budget baseline → growth drivers → efficiency plans → reforecast locks → actuals → variance → waterfall → AI advisory

## Current implementation status

### Accepted foundation

Phase 1.2 SaaS foundation has been implemented and accepted:

- Next.js app structure
- React and TypeScript
- Supabase client and server setup
- Supabase Auth foundation
- organisation and membership model
- role and permission helpers
- plans, fiscal years and planning periods
- shared dimensions foundation
- audit event infrastructure
- tenant-scoped database design
- Supabase/PostgreSQL migrations
- Row Level Security policies
- protected routes and onboarding foundation
- placeholder navigation for future modules

### Implemented in Phase 2

Phase 2 implements the deterministic Layer 1 demand-to-budget engine:

- Layer 1 cockpit/dashboard
- planning brief page
- source inventory page
- demand input page
- capacity and cost assumptions page
- calculation output page
- deterministic scenario comparison page
- isolated calculation modules outside UI components
- monthly frequency normalisation for monthly, weekly, daily and one-off inputs
- measured workload hours
- estimated/project workload hours
- hidden/internal workload hours
- total monthly workload hours
- required FTE
- current supply FTE
- FTE gap
- annual labour cost
- budget variance
- source quality score
- confidence score
- deterministic risk flags
- audit events for material Layer 1 create/run actions

### Implemented in Phase 3

Phase 3 converts the Layer 1 engine from a calculator into a governed planning input:

- Layer 1 review and approval screen
- submit-for-review workflow
- approval workflow for authorised reviewer, finance admin, admin and owner roles
- immutable Layer 1 version lock
- approved snapshot JSON containing calculation outputs, assumptions, sources, demand inputs, risk flags and scenario summary
- checksum for locked Layer 1 snapshots
- Layer 1 handoff object for future Layer 2 baseline setup
- handoff status management through `ready_for_layer2`
- database immutability guards for governed calculation runs, version locks and handoff payloads
- audit events for submit, approval request, approval, lock, handoff creation and handoff readiness

### Implemented in Phase 3.1

Phase 3.1 hardens Layer 1 governance before Layer 2 depends on it:

- atomic database RPC for Layer 1 version lock and handoff creation
- transaction-safe supersede, lock, calculation-run update and handoff creation
- database-backed, plan-scoped Layer 1 version ID generation
- plan/version uniqueness guard for `version_id`
- advisory transaction lock to protect concurrent Layer 1 lock creation
- controlled database function for handoff status transitions such as `ready_for_layer2`
- database-level permission checks for lock and handoff transitions
- audit events written inside the governance database transaction


### Implemented in Phase 4

Phase 4 builds the Budget Baseline Module and stops at the locked annual baseline:

- Budget Baseline dashboard
- creation from a `ready_for_layer2` Layer 1 handoff only
- manual baseline creation as a clearly separate path
- monthly phasing over 12 planning periods
- straight-line phasing with residual rounding handled in the final period
- custom manual phasing edits before lock
- deterministic reconciliation checks for annual budget, labour cost and workload hours
- baseline review checkpoint
- immutable budget baseline lock
- immutable budget baseline snapshot with checksum
- one active locked baseline rule per organisation, plan and fiscal year
- controlled handoff transition to `imported_to_baseline` after successful Layer 1 handoff import
- audit events for create, phasing, review, lock, snapshot and handoff import
- database-level immutability protection for locked baseline headers, lines and snapshots

Phase 4 does not build drivers, reforecasting, actuals, variance, waterfall or AI.



### Implemented in Phase 4.1

Phase 4.1 is a commercial QA hardening gate for the cumulative Phase 1 to Phase 4 product. It does not add Phase 5 capability.

This phase adds or strengthens:

- GitHub Actions quality gate
- permanent quality-gate documentation
- cumulative migration contract verification
- tenant isolation contract tests
- expanded role permission matrix tests
- governance and immutability attack-surface tests
- full Layer 1 to Budget Baseline workflow contract test
- Budget Baseline locked snapshot accuracy so the immutable snapshot reflects final locked state
- service-role-only governance boundaries for Layer 1 lock and handoff creation

The current environment does not include Supabase CLI, Docker or `psql`, so Phase 4.1 uses the strongest practical SQL/repository/service contract harness available here. A live Supabase/Postgres migration reset and RLS attack test should be added before commercial pilot use.

### Build hardening after Phase 4

Protected App Router pages explicitly opt into dynamic rendering with `export const dynamic = 'force-dynamic'`.
This prevents production builds from trying to statically collect page data for routes that require Supabase auth, tenant context, cookies or server-only repositories.

The middleware remains intentionally lightweight and does not import Supabase client packages.
Auth and tenant checks remain inside the protected pages and server-side repository layer.

### Not implemented yet

The following are deliberately not built yet:

- driver layer
- reforecast engine
- actuals ingestion
- variance reporting
- waterfall reporting
- AI advisory module

## Budget Baseline notes

Phase 4 converts a governed Layer 1 handoff, or a manual Finance baseline, into the fixed annual OPEX/labour reference.

Layer 1 import rules:

- the handoff must belong to the same organisation and plan
- the handoff must have `handoff_status = ready_for_layer2`
- imported values come from immutable handoff JSON
- the system does not recalculate current Layer 1 inputs during baseline import
- after successful import, the handoff moves to `imported_to_baseline` through a controlled database function

Monthly phasing rules:

- `straight_line` is implemented and required
- `custom_manual` edits are supported before lock
- budget, labour cost and workload hours must reconcile back to annual totals within a small rounding tolerance
- once locked, the baseline header, monthly lines and snapshot are immutable
- Phase 4 prevents locking a second baseline for the same organisation, plan and fiscal year. Controlled baseline supersession is a later enhancement.

## Layer 1 calculation notes

Phase 2 normalises all demand inputs into monthly workload hours before calculating required FTE.

Frequency handling:

- `monthly`: volume × effort minutes ÷ 60
- `weekly`: volume × weeks per month × effort minutes ÷ 60
- `daily`: volume × working days × effort minutes ÷ 60
- `one_off`: volume × effort minutes ÷ 60, treated as workload inside the selected model period

Hidden/internal work and project/ad hoc work can also use direct workload hours. Those hours are normalised using the same frequency rules.

Required FTE formula:

```text
required_fte = total_workload_hours / (working_days × hours_per_day × utilisation × (1 - shrinkage))
```

Annual labour cost is calculated as:

```text
required_fte × annual_loaded_cost_per_fte
```

Important: if one-off work is included, Phase 2 shows it inside the selected model period. The annual labour cost output represents the run-rate if that modelled workload level were sustained. True one-off work should be removed or separately phased before treating it as permanent budget.

## Non-negotiable product rules preserved

- No browser local storage as source of truth
- No demo authentication as production foundation
- No service-role key in browser code
- Every business table includes `organisation_id`
- Tenant scoping is enforced through repository queries, database guardrails and Supabase RLS policies
- Material actions write audit events through controlled server-side services
- Deterministic calculations are authoritative
- AI is not implemented in Phase 4
- Calculation logic is isolated in testable modules and not buried in UI components
- Locked Layer 1 snapshots and handoff payloads are immutable
- Locked budget baseline headers, lines and snapshots are immutable
- Phase 4 stops at locked budget baseline; drivers and reforecasting are not implemented yet
- Phase 4.1 adds proof and hardening only; no Phase 5 features are implemented


## External build timeout fix

The production build is intentionally separated from TypeScript and ESLint validation. The quality gate runs `npm run typecheck` and `npm run lint` before `npm run build`; Next's duplicate internal validation is disabled in `next.config.mjs` to avoid external build timeouts during the integrated `Linting and checking validity of types ...` stage.

The app also forces the root layout, root redirect page and login page to dynamic Node.js rendering so build-time page data collection does not execute runtime-adjacent auth/login paths. Protected pages remain dynamic as well.

## Tech stack

- Next.js
- React
- TypeScript
- Supabase Auth
- Supabase/PostgreSQL
- PostgreSQL Row Level Security
- Node test runner with `tsx`

## Folder structure

```text
workforce-planning-platform-saas/
├── app/                         # Next.js app routes, protected screens and server actions
├── components/                  # Shared app shell and navigation components
├── docs/                        # Phase documentation
├── lib/                         # Supabase clients, repositories, audit, tenant, permission and calculation services
├── supabase/migrations/         # Database schema, functions, triggers and RLS policies
├── tests/                       # Unit tests for foundation, Layer 1 and Budget Baseline logic
├── types/                       # TypeScript domain and database types
├── .env.example                 # Safe environment variable template
├── .gitignore                   # Git exclusions for secrets and build artefacts
├── package.json
├── tsconfig.json
└── next.config.mjs
```

## Environment variables

Copy the example file and fill in your Supabase project values:

```bash
cp .env.example .env.local
```

Required values:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Server-only. Required for controlled audit writes and onboarding bootstrap.
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
```

Never commit `.env.local` or any file containing real secrets. Do not expose a Supabase service-role key in browser code.

## Database setup

Apply migrations in order:

```text
supabase/migrations/001_phase1_foundation.sql
supabase/migrations/002_phase1_1_hardening.sql
supabase/migrations/003_phase2_layer1_engine_fields.sql
supabase/migrations/004_phase3_layer1_approval_lock_handoff.sql
supabase/migrations/005_phase3_1_layer1_governance_hardening.sql
supabase/migrations/006_phase4_budget_baseline_module.sql
supabase/migrations/007_phase4_1_commercial_qa_hardening.sql
```

The migrations create and harden:

- core SaaS tables
- shared dimensions
- audit events
- Layer 1 scaffolding tables
- RLS helper functions
- RLS policies
- tenant-consistency foreign key guardrails
- Layer 1 Phase 2 calculation support fields
- Layer 1 Phase 3 approval, lock, snapshot and handoff support
- Layer 1 Phase 3.1 transaction-safe lock/handoff RPC and controlled handoff transitions
- Phase 4 budget baseline tables, monthly lines, immutable snapshots, controlled baseline RPCs and lock guards

## Local development

Install dependencies:

```bash
npm ci
```

Run the development server:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Run typecheck, lint and build:

```bash
npm run typecheck
npm run lint
npm run build
```

Run audit:

```bash
npm audit
```

Run the full verification sequence:

```bash
npm run verify
```

For clean ZIP/check-out verification, see `BUILD_VERIFICATION.md`.

## GitHub safety notes

Before pushing, confirm the repository does not include:

- `.env`, `.env.local` or other secret files
- Supabase service-role keys
- `node_modules/`
- `.next/`
- build artefacts
- local Supabase state
