# Phase 7 — Actuals Ingestion + Variance Module

## What Phase 7 delivers

Phase 7 completes the next stage of the planning loop: **current locked forecast →
actuals → variance**. Actual results are loaded against a locked budget baseline,
validated strictly against existing planning periods, and posted as immutable
versions. Variance then compares posted actuals deterministically against a
**pinned** locked forecast version and the locked baseline. Waterfall bridges,
executive bridge reporting, and AI commentary are explicitly out of scope and
remain placeholder pages, enforced by the phase-boundary contract test.

## Actuals: strict period mapping

Every actuals row must resolve to an existing `planning_periods` id owned by the
organisation inside the selected baseline's fiscal year. Rows are **rejected with
the reason** — never silently re-mapped — when the period does not exist, sits
outside the horizon, the `YYYY-MM` month token cannot be matched exactly to a
period's start month, values are not finite numbers, or the same period appears
twice in a batch. Validation runs three times independently: in the engine
(`validateActualsLines` / `mapCsvRowsToActualsLines`), in the RPC
(`assert_actuals_lines_valid`), and structurally via the
`UNIQUE (organisation_id, actuals_batch_id, planning_period_id)` constraint.

## Actuals lifecycle and corrections

`draft → validated → posted`, with `superseded` and `voided` as terminal states.
Draft batches are editable (manual grid or CSV re-import via
`update_actuals_batch_draft`); validated batches can be posted or reverted;
**posted batches are immutable** — `protect_actuals_batch_update` and
`protect_actuals_line_update` triggers reject every change except the controlled
supersession/void field transitions, and posting sets `is_immutable` on every row.

Corrections are **versioned, never edits**: `supersede_actuals_batch` atomically
creates a new posted batch with `version_number + 1` and `supersedes_batch_id`
lineage, freezes its rows, and marks the old version `superseded` (still
readable). The latest posted version is used for new variance runs; existing
variance reports stay pinned to the version they used. Permissions: planner can
create/edit/validate; posting, superseding and voiding require
owner/admin/finance_admin (voiding a posted batch: owner/admin only).

## Variance: pinned comparators

`create_variance_report` requires a **posted** actuals batch and a forecast in
`locked` or `superseded` status carrying a `lock_version_id` and `checksum`. At
creation the report freezes: `comparator_lock_version_id`, `comparator_checksum`,
`baseline_checksum`, `actuals_checksum`, `actuals_version_number`, and the
planning-period ids in its lines. Variance never re-resolves "current forecast"
at query time, so **later forecast locks do not rewrite existing variance
reports** — the engine test suite proves recalculation against pinned inputs is
byte-identical and that comparing against a newer version requires a new report
with different pins. The lock checksum embeds the pins, so a different forecast
version is by construction a different report.

## Calculation

`lib/variance/variance-engine.ts`, deterministic, two-decimal, no React-side
logic, no AI-generated numbers. Per period: actual/forecast/baseline cost, cost
variance and percentage against both comparators, FTE variance against both,
workload-hours variance against both, plus totals across the covered range.
**Sign convention: variance = actual − comparator; positive cost variance means
actual cost is HIGHER than the comparator** (stated in the UI). A zero
comparator yields a null percentage (`safeVariancePct`), shown as "—", never a
division error.

## Variance lifecycle

`draft → locked`, with `superseded` and `voided`. Draft reports are recalculable
(same pins, deterministic); locked reports are immutable (triggers + frozen
lines + sha256 checksum + `lock_version_id`); locking supersedes the previous
current report for the same baseline+forecast context (partial unique index
guarantees one current). Voiding is admin-controlled: finance roles for drafts,
owner/admin for locked reports; voided reports remain readable but excluded.

## Database and audit

Migration `010_phase7_actuals_variance.sql`: tables `actuals_batches`,
`actuals_lines`, `variance_reports`, `variance_lines` — all tenant-scoped with
RLS select-member policies, direct writes revoked from anon/authenticated,
composite same-org FKs (periods, baselines, forecasts, self-lineage). RPCs
(SECURITY DEFINER, service_role only): `create_actuals_batch`,
`update_actuals_batch_draft`, `transition_actuals_batch_status`,
`supersede_actuals_batch`, `create_variance_report`,
`recalculate_variance_report`, `lock_variance_report`, `void_variance_report`.
Thirteen audit event types written in-transaction.

## Routes

`/actuals` (register, latest posted per baseline, CSV ingestion form),
`/actuals/[actualsBatchId]` (monthly rows, draft editing grid, validate/post/
revert/void, correction supersession grid, lineage, audit), `/variance`
(register with totals and pins, create form), `/variance/[varianceId]` (monthly
variance vs forecast and baseline with percentages, pinned comparator panel,
recalculate/lock/void, lock evidence, audit). All force-dynamic and listed in
the protected-route contract test.

## Live RLS isolation

`scripts/smoke-rls-phase7.mjs` runs cross-tenant isolation checks against a
real test Supabase project: org A cannot read org B actuals/variance, direct
authenticated writes are blocked, and service-role RPCs reject cross-org
actors. It is environment-gated (`RLS_SMOKE_*` vars) and exits 0 with a skip
notice when they are absent, so it never blocks the hermetic gate; it is
deliberately not part of `npm run verify`.

## Known limitations

Actuals and variance are aggregate per period (org level), matching the grain
of baselines and forecasts. Partial-year actuals produce variance for covered
periods only; totals state the covered period count. Baseline pinning uses the
baseline checksum (baselines have no lock_version_id column). The optional
`actuals_upload_errors` and `variance_snapshots` tables were deliberately not
added: rejections are atomic (nothing persists on a failed upload, the error
message carries row references) and variance immutability is row-based with a
checksum rather than JSON snapshots.
