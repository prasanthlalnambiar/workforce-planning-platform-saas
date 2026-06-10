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

### Not implemented yet

The following are deliberately not built yet:

- Layer 2 baseline import from the approved Layer 1 handoff
- Layer 2 budget baseline module
- driver layer
- reforecast engine
- actuals ingestion
- variance reporting
- waterfall reporting
- AI advisory module

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
- AI is not implemented in Phase 3
- Calculation logic is isolated in testable modules and not buried in UI components
- Locked Layer 1 snapshots and handoff payloads are immutable
- Phase 3 stops at `ready_for_layer2`; Layer 2 baseline import is not implemented yet

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
├── tests/                       # Unit tests for foundation and Layer 1 deterministic logic
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

## GitHub safety notes

Before pushing, confirm the repository does not include:

- `.env`, `.env.local` or other secret files
- Supabase service-role keys
- `node_modules/`
- `.next/`
- build artefacts
- local Supabase state
