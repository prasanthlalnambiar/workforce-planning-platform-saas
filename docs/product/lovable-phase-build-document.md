# Lovable Phase Build Document
## Workforce Planning and Labour Budget Governance Platform

### Purpose

Build a secure, modular SaaS MVP from the uploaded Workforce Planning Loop package.

This is not a simple WFM calculator and not a generic dashboard. It is a two-layer planning product:

Layer 1:
Messy demand -> workload -> required FTE -> supply gap -> labour budget -> approved locked handoff

Layer 2:
Budget baseline -> growth drivers -> efficiency plans -> reforecast locks -> actuals -> variance -> waterfall -> AI advisory

The build must preserve this architecture.

---

## Non-negotiable Product Rules

1. Deterministic calculations are authoritative.
2. AI is advisory only.
3. AI must never calculate official FTE, cost, budget or variance numbers.
4. AI must never approve or apply changes to plan data.
5. No AI provider key, integration secret or database credential may be exposed in the browser.
6. Actuals must never overwrite forecast values.
7. Locked baselines must be immutable.
8. Locked reforecasts must be immutable.
9. Only the latest locked forecast is the valid current forecast.
10. All historical forecast locks must be preserved.
11. Every material action must create an audit event.
12. Every business table must be scoped by organisation_id.
13. Only approved and version-locked Layer 1 outputs can feed Layer 2.
14. Proposed drivers feed scenarios only. Approved drivers feed the official forecast.
15. The system must support multi-tenant SaaS architecture from the start.

---

## Files to Read First

When building from the original handoff package, read these in order:

1. `loop-config.json`
2. `docs/lovable-build-instructions.md`
3. `docs/database-schema.sql`
4. `docs/security-architecture.md`
5. `docs/backend-requirements.md`
6. `docs/phase-build-plan.md`
7. `docs/acceptance-checklist.md`
8. `layer1-demand-engine/README.md` when building Layer 1 demand-to-budget capability

---

## Recommended Build Sequence

### Phase 1 — SaaS Foundation

Scope:

- Next.js / React / TypeScript app shell
- Supabase/Postgres backend
- Auth
- Organisations
- Organisation memberships
- RBAC roles
- Workspace shell
- Fiscal year setup
- Planning periods
- Audit event foundation
- RLS on tenant-scoped tables

Do not build the full planning loop in Phase 1. Do not add AI.

### Phase 2 — Layer 1 Demand-to-Budget Engine

Scope:

- Planning brief
- Source inventory
- Demand inputs
- Capacity assumptions
- Cost assumptions
- Deterministic calculation engine
- Required FTE
- Supply gap
- Labour cost and budget output
- Scenarios

Layer 1 exists to convert messy operational demand into an approved, version-locked budget handoff.

### Phase 3 — Layer 1 Approval, Lock and Handoff

Scope:

- Approval workflow
- Version lock
- Immutable Layer 1 snapshot
- Controlled handoff object
- Handoff readiness for Layer 2
- Audit events

Only locked/approved Layer 1 outputs can feed Layer 2.

### Phase 4 — Budget Baseline Module

Scope:

- Import ready Layer 1 handoff
- Create budget baseline draft
- Monthly phasing
- Review checkpoint
- Immutable locked baseline
- Baseline snapshot and checksum
- Audit trail

Phase 4 stops at locked budget baseline. Do not build drivers yet.

### Phase 5 — Driver Layer

Scope:

- Growth drivers
- Efficiency plans
- Cost-change drivers
- Supply-change drivers
- Management adjustments
- Driver status: draft, proposed, approved
- Driver phasing: straight-line, ramp-up, ramp-down, one-off
- Only approved drivers feed official forecast
- Proposed drivers feed scenarios only

Phase 5 should not include reforecast locks, actuals, variance, waterfall or AI unless explicitly approved as a later phase.

### Phase 6 — Reforecast Module

Scope:

- Baseline + approved drivers
- Forecast recalculation
- Monthly working forecast
- Reforecast review
- Immutable forecast lock
- Latest locked forecast = current valid forecast

### Phase 7 — Actuals and Variance

Scope:

- Actuals upload/staging
- Validation and approval
- Actuals stored separately from forecasts
- Forecast vs actuals variance
- Baseline vs forecast variance
- Prior forecast vs current forecast variance

### Phase 8 — Waterfall and Executive Story

Scope:

- Baseline to latest forecast bridge
- Forecast to actuals bridge
- Driver waterfall
- Executive summary output

### Phase 9 — AI Advisory

Scope:

- Backend-only AI calls
- AI commentary on deterministic outputs
- Variance explanation
- Risk flags
- Suggested questions/actions
- AI outputs labelled advisory

AI must never calculate official numbers.

---

## Development Rules

### Calculations

- Keep deterministic calculation logic in `lib/`.
- Do not place business logic inside UI components.
- AI must not be allowed to calculate official FTE, cost, budget or variance.

### Data and Governance

- All business data must include `organisation_id`.
- Locked records are immutable.
- Actuals are separate from forecasts.
- Every lock, approval, handoff, actuals posting and AI action should create an audit event.
- Version IDs and checksums should be generated server-side.

### Security

- No secrets in browser code.
- All server-only code must remain server-only.
- RLS must protect tenant data.
- Admin/service role operations must never be exposed to client components.

### Build Process

- Build one phase at a time.
- Each phase must pass tests, typecheck, lint, production build, audit and external ZIP review.
- Do not continue to the next phase until the current phase passes.

---

## Phase 5 Boundary

Phase 5 should begin only after Phase 4.1 quality gate passes externally.

Phase 5 should build the driver layer only:

- driver register
- driver types
- driver phasing
- driver approval status
- deterministic driver impact calculation
- scenario-only proposed drivers
- official approved drivers
- audit and governance around driver changes

Phase 5 should not build:

- reforecast locks
- actuals ingestion
- variance analysis
- waterfall reporting
- AI advisory

Those are later phases.
