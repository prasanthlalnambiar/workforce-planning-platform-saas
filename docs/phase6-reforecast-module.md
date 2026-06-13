# Phase 6 — Reforecast Module

## What Phase 6 delivers

Phase 6 converts **Locked Budget Baseline + Approved Drivers = Working Forecast**, then
governs that forecast through controlled review and an immutable lock. The latest locked
forecast is the single current valid forecast per baseline context. Phase 6 deliberately
excludes actuals ingestion, variance analysis, waterfall reporting and AI advisory —
those are future phases.

## Calculation model

All calculation is deterministic and lives in `lib/reforecast/reforecast-engine.ts`.
No calculation logic exists in React components and no AI generates official numbers.

Per monthly period:

```
forecast amount = baseline amount + sum(approved driver impacts for that period)
```

- Cost-impact drivers are broken down by category per line: growth, efficiency,
  cost change, supply change and management adjustment, plus a total approved impact
  column, so every forecast line shows baseline → impacts → final forecast.
- FTE-delta and workload-hours-delta drivers move the forecast FTE and workload
  measures without touching the budget amounts.
- `buildReforecastLines` throws if any non-approved driver is passed; proposed and
  draft drivers can never feed the official forecast.
- `reconcileReforecastLines` proves forecast = baseline + total impact per line and
  that category impacts sum to the total.
- `computeReforecastChecksum` produces a deterministic sha256 over the canonical
  line and driver-inclusion state: stable across identical recalculations, changed
  by any value or inclusion change. Stored at creation, recalculation and lock.

Proposed drivers appear only in a **scenario overlay** (`buildScenarioOverlay`),
computed on read and never persisted as forecast data. The overlay accepts proposed
drivers only and the official lines are untouched.

## Lifecycle and governance

`draft → in_review → locked`, with `superseded` and `voided` as governed terminal states.

- **draft** — recalculable working forecast.
- **in_review** — controlled; cannot be recalculated; can be locked, reverted to
  draft, or voided.
- **locked** — immutable; the lock captures `locked_by`, `locked_at`,
  `lock_version_id`, a checksum and an append-only snapshot row. Locking supersedes
  the previous current locked forecast in the same baseline context (audited), so a
  partial unique index guarantees only one `is_current_locked` forecast per
  organisation + baseline.
- **superseded** — remains readable for forecast history; business values frozen.
- **voided** — admin-controlled withdrawal (owner/admin/finance_admin for unlocked
  forecasts, owner/admin only for locked ones), preserved for audit.

Immutability is enforced in the database by `protect_reforecast_update`,
`protect_reforecast_child_update` and `protect_reforecast_snapshot_update` triggers:
locked forecasts admit only the controlled supersession/void field changes, locked
lines and driver inclusions reject all updates and deletes, and snapshots are
append-only. Direct table writes are revoked from `anon`/`authenticated`; every
mutation flows through SECURITY DEFINER RPCs granted to `service_role` only
(`create_reforecast`, `recalculate_reforecast`, `transition_reforecast_status`,
`lock_reforecast`), each performing role checks and writing audit events in the
same transaction.

## Audit events

`reforecast.created`, `reforecast.recalculated`, `reforecast.submitted_for_review`,
`reforecast.reverted_to_draft`, `reforecast.locked`, `reforecast.superseded`,
`reforecast.voided`, `reforecast.driver_inclusion_snapshot_created`,
`reforecast.lock_snapshot_created` — all with organisation, actor, entity, before/after
payloads and reason.

## Permissions

`reforecast:read | create | write | submit | lock | void` added to the existing model:
owner/admin/finance_admin hold all six; planner holds read/create/write/submit;
reviewer, viewer and auditor are read-only. Database RPCs re-check roles server-side.

## Routes

- `/reforecasts` — register, current valid forecast, create-draft form.
- `/reforecasts/[reforecastId]` — monthly forecast table with category breakdown,
  driver inclusion snapshot, scenario-only proposed overlay, lifecycle actions,
  lock evidence and audit trail.
- `/reforecast` (legacy placeholder) now redirects to `/reforecasts`.

Both pages are `force-dynamic` and listed in the protected-route contract test.

## Phase boundary

`tests/reforecast-governance.test.ts` fails the suite if any migration creates
actuals/variance/waterfall/AI database objects or if the actuals, variance,
waterfall or AI pages stop being placeholders. Phase 5 driver governance is
untouched: proposed drivers remain scenario-only, approved drivers remain immutable
and supersede-only, and the driver audit trail is preserved.
