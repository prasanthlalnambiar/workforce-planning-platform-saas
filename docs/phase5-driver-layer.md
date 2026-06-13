# Phase 5 — Driver Layer

## Scope delivered

Phase 5 builds the governed driver register described in `docs/product/lovable-phase-build-document.md` and the vision document §6.3, and nothing beyond it:

- Driver register attached to a **locked** budget baseline (drivers explain movement away from the baseline; no locked baseline → no drivers).
- Five categories: growth, efficiency, cost_change, supply_change, management_adjustment.
- Three impact types: `fte_delta`, `cost_delta`, `workload_hours_delta`, with an explicit signed annual amount.
- Four deterministic phasing models computed server-side in `lib/drivers/driver-engine.ts`: straight_line (even split, residual rounding into the final active period — same convention as Phase 4 baseline phasing), ramp_up (linear weights 1..n), ramp_down (reverse), one_off (full amount in one named period). Every driver carries one line per planning period, with explicit zeros outside its window, and lines always reconcile to the annual amount (enforced in the engine **and** re-checked inside the database RPC).
- Status governance: `draft → proposed → approved`, with `proposed → draft` revert, `draft/proposed → voided` withdrawal, and `approved → superseded` only through the controlled supersede workflow. Approved drivers are immutable at the database level (protection triggers), exactly like Phase 3.1/4 locks.
- **Only approved drivers feed the official forecast position. Proposed drivers feed scenarios only.** The drivers page shows a deterministic, read-only *indicative impact preview* (baseline + approved = official position; baseline + approved + proposed = scenario). No forecast object is created and nothing is locked — the governed reforecast is Phase 6.
- Every transition (create, update, propose, revert, approve, void, supersede) writes an audit event in the same database transaction via SECURITY DEFINER RPCs that are executable by the service role only.

## Explicitly out of scope (later phases)

Reforecast locks (Phase 6), actuals ingestion and variance (Phase 7), waterfall reporting (Phase 8), AI advisory (Phase 9). A contract test asserts the Phase 5 migration creates no objects in those domains.

## Data model (migration `008_phase5_driver_layer.sql`)

- `forecast_drivers` — tenant-scoped register row per driver with composite same-organisation foreign keys to plans, fiscal years, the locked baseline, planning periods, and supersede linkage to other drivers. Driver codes (`DRV-0001`…) are generated server-side under an advisory lock per organisation/plan/fiscal year.
- `forecast_driver_lines` — one phased monthly impact line per planning period per driver, flipped immutable on approval.
- RLS: members can SELECT; INSERT/UPDATE/DELETE are revoked from `anon` and `authenticated` — all writes go through the four governed RPCs (`create_forecast_driver`, `update_forecast_driver_draft`, `transition_forecast_driver_status`, `supersede_forecast_driver`), granted to `service_role` only.

## Permission model

New permissions wired into the existing role definitions: `driver:read` (all business roles), `driver:write` and `driver:propose` (owner, admin, finance_admin, planner), `driver:approve` (owner, admin, finance_admin, reviewer — mirroring Layer 1 approval semantics), `driver:supersede`/void (owner, admin, finance_admin). The database RPCs enforce the same role arrays independently of the TypeScript checks.

## Determinism statement

All driver phasing, reconciliation, aggregation and impact-preview numbers are produced by the deterministic engine in `lib/`, server-side. AI is not involved anywhere in this phase and AI never calculates official FTE, cost, budget or variance numbers.
