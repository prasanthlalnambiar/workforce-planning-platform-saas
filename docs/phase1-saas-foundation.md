# Phase 1 SaaS Foundation Handoff

## Source of truth

Use these current files as product source of truth:

- `planning-agent-loop-v4-3-with-layer1.zip`
- `lovable_phase_build_document.md`
- `workforce-planning-vision-revised.docx`

The older `messy-demand-to-budget-loop.zip` and static `workforce-planning-platform/` folder are reference only.

## Architecture decision

This folder is the production-oriented SaaS foundation. It replaces the static local-storage prototype as the build target.

## Phase 1 includes

- Next.js app structure
- React + TypeScript
- Supabase client setup
- Supabase Auth foundation
- Supabase/Postgres migration
- tenant-scoped RLS policies
- role/permission helpers
- audit event service
- protected app shell and navigation
- placeholder pages for future modules
- unit/schema tests

## Phase 1 excludes

- Layer 1 calculator
- Layer 2 planning logic
- AI
- actuals ingestion
- variance
- waterfall

## Phase 2 readiness

Layer 1 scaffolding tables exist in the migration:

- planning_briefs
- source_inventory
- demand_inputs
- capacity_assumptions
- cost_assumptions
- scenario_definitions
- calculation_runs
- layer1_version_locks
- layer1_handoff_objects

Phase 2 should add deterministic calculation services and UI on top of these tables without moving calculation logic into React components.
