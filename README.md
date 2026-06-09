# Workforce Planning and Labour Budget Governance Platform

Production Phase 1 foundation for a two-layer workforce planning and labour budget governance platform.

This codebase is separate from the public consulting website. It is the SaaS application foundation for the planning product.

## Product model

The platform is designed around two governed planning layers:

1. **Layer 1: Demand to budget**  
   Messy demand → workload → required FTE → supply gap → labour budget → approved locked handoff

2. **Layer 2: Budget governance**  
   Budget baseline → growth drivers → efficiency plans → reforecast locks → actuals → variance → waterfall → AI advisory

Phase 1 only builds the shared SaaS foundation. Layer 1 calculations, Layer 2 logic, AI, actuals ingestion, variance and waterfall reporting are intentionally not implemented yet.

## Phase 1 scope

Implemented foundation areas:

- Next.js app structure
- React and TypeScript
- Supabase client and server setup
- Supabase Auth foundation
- Organisation and membership model
- Role and permission helpers
- Plans, fiscal years and planning periods
- Shared dimensions foundation
- Audit event infrastructure
- Tenant-scoped database design
- Supabase/PostgreSQL migrations
- Row Level Security policies
- Placeholder navigation for future modules
- Layer 1 database scaffolding tables
- Unit tests for period generation, permissions, audit payloads and tenant isolation assumptions

## Non-negotiable product rules preserved

- No browser local storage as source of truth
- No demo authentication as production foundation
- No service-role key in browser code
- Every business table includes `organisation_id`
- Tenant scoping is enforced through repository helpers and Supabase RLS policies
- Material actions are designed to create audit events
- Locked planning artefacts are prepared for immutability in the database schema
- AI is not implemented in Phase 1
- Calculation logic is not buried in UI components

## Tech stack

- Next.js
- React
- TypeScript
- Supabase Auth
- Supabase/PostgreSQL
- PostgreSQL Row Level Security
- Node test runner

## Folder structure

```text
workforce-planning-platform-saas/
├── app/                         # Next.js app routes, protected screens and server actions
├── components/                  # Shared app shell and navigation components
├── docs/                        # Phase documentation
├── lib/                         # Supabase clients, repositories, audit, tenant and permission services
├── supabase/migrations/         # Database schema, functions, triggers and RLS policies
├── tests/                       # Unit tests for foundation logic
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
```

Never commit `.env.local` or any file containing real secrets. Do not expose a Supabase service-role key in browser code.

## Database setup

Apply the migration in:

```text
supabase/migrations/001_phase1_foundation.sql
```

The migration creates:

- core SaaS tables
- shared dimensions
- audit events
- Layer 1 scaffolding tables
- RLS helper functions
- RLS policies
- immutability triggers for locked Layer 1 artefacts

## Local development

Install dependencies:

```bash
npm install
```

Run the development server:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Run linting:

```bash
npm run lint
```

## Current limitations

This is Phase 1 only. It does not yet include:

- Layer 1 calculation engine
- Layer 1 approval UI beyond scaffolding
- Layer 2 budget baseline logic
- driver layer logic
- reforecast locks
- actuals ingestion
- variance and waterfall reporting
- AI advisory features
- production Supabase deployment configuration

## GitHub safety notes

Before pushing, confirm the repository does not include:

- `.env`, `.env.local` or other secret files
- Supabase service-role keys
- `node_modules/`
- `.next/`
- build artefacts
- local Supabase state
