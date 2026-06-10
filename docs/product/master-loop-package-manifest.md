# Master Loop Package Manifest

This document records the original planning-loop source package referenced during the product design work.

Original package name:

`planning-agent-loop-v4-3-with-layer1.zip`

The ZIP itself is not committed to the repository because it is a prototype/source package and may contain generated artefacts. Instead, the product rules and phase boundaries that matter for future development are captured in this `/docs/product/` folder.

## Purpose of the original package

The package represented the planning-agent loop prototype and Layer 1 handoff concept used to shape the SaaS architecture.

The product architecture is a two-layer loop:

Layer 1:

`Messy demand -> workload -> required FTE -> supply gap -> labour budget -> approved locked handoff`

Layer 2:

`Budget baseline -> growth drivers -> efficiency plans -> reforecast locks -> actuals -> variance -> waterfall -> AI advisory`

## Key source-of-truth rules extracted from the package

- Deterministic calculations are authoritative.
- AI advisory is downstream only and must never calculate official numbers.
- Locked baselines and locked reforecasts are immutable.
- Actuals never overwrite forecasts.
- Latest locked forecast is the current valid forecast.
- Historical locks are preserved.
- Every material action creates an audit event.
- Every business object is scoped by `organisation_id`.
- Only approved, version-locked Layer 1 outputs can feed Layer 2.
- Proposed drivers feed scenarios only; approved drivers feed official forecast.

## Phase boundary

The current product is at Phase 4 / Phase 4.1:

- Phase 1: SaaS foundation
- Phase 2: Layer 1 demand-to-budget engine
- Phase 3: Layer 1 approval, lock and handoff
- Phase 3.1: governance hardening
- Phase 4: Budget Baseline module
- Phase 4.1: commercial QA/build hardening

Phase 5 should not start until Phase 4.1 quality gate passes externally.

## Phase 5 intended boundary

Phase 5 should build the driver layer only:

- growth drivers
- efficiency plans
- cost-change drivers
- supply-change drivers
- management adjustments
- driver status workflow
- driver phasing
- deterministic driver impact calculation
- proposed-vs-approved driver separation
- audit and governance around driver changes

Phase 5 should not include:

- reforecast locks
- actuals ingestion
- variance analysis
- waterfall reporting
- AI advisory

Those are later phases.
