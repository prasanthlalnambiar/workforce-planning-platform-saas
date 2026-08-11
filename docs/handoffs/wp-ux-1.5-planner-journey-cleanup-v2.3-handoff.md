# WP-UX-1.5 v2.3 — Accepted-Version Read-Only Mapping (WP-2 C5 blocker)

Fixes the C5 live-UAT blocker: on an accepted (frozen) source version, the UI still
offered "Save draft mapping" / "Accept mapping & set canonical grain", and clicking
accept surfaced the DB immutability rejection as "Module Unavailable". WP-2 only;
no WP-3; **migration 014 is byte-identical to the accepted WP-2** (UI/action fix,
the DB guard was already correct and stays intact).

## What was wrong

- The mapping grid rendered its action buttons whenever the user could write,
  without checking whether the source *version* was accepted/frozen.
- The candidate resolver still preferred a newer draft (e.g. the v3 draft left from
  the C4 test), so an accepted version could display the draft rather than the
  official accepted mapping.
- When the blocked write hit the DB immutability guard, the server action threw,
  and the route `error.tsx` boundary rendered "Module Unavailable".

## The fix (accepted-version behaviour)

On an accepted source version the mapping panel is now read-only and shows the
**official accepted mapping**:
- The detail page computes `versionAccepted` from the current version status and
  **suppresses the draft** input to `resolveCandidateMapping` (passes `draft: null`),
  so a newer draft can never become the visible candidate. The resolver returns the
  accepted mapping → state label "Viewing latest accepted mapping".
- The grid receives `versionAccepted` and gates editing on
  `editable = canWrite && !versionAccepted`: selects are disabled, and BOTH
  "Save draft mapping" and "Accept mapping & set canonical grain" are absent.
- Copy: "This source version is accepted and immutable. Import a new source version
  to change the mapping. The accepted mapping is shown read-only."

Graceful write handling (no Module Unavailable):
- A new `getInputSourceVersionStatus` repository read lets both write actions detect
  an accepted version and `redirect` back to the source detail page instead of
  throwing the DB error into the boundary. This defends the direct/forged/stale POST
  path too — the UI already hides the buttons, and the action no longer crashes the
  module if a submit reaches it anyway.

## Tests added (all passing)

1. Accepted source version forces the accepted mapping candidate (draft suppressed).
2. A newer draft does not become the visible candidate when the version is accepted
   (resolver returns `accepted`).
3. Save/Accept buttons are gated on `editable` (absent for accepted versions); the
   immutability copy is present.
4. Both write actions guard accepted versions and `redirect` (no route error
   boundary / Module Unavailable); guard runs before the write.
5. DB immutability guard remains intact (migration 014 still contains the
   "Accepted input source versions are immutable" guard).

## Confirmations

- Accepted version shows "Viewing latest accepted mapping", read-only. ✓
- The official accepted mapping is shown, not a newer draft. ✓
- Save/Accept hidden/disabled on accepted versions. ✓
- Blocked writes redirect gracefully, never "Module Unavailable". ✓
- DB immutability guard unchanged and intact; migration 014 byte-identical. ✓
- No WP-3; no migration; no engine/governance change; no `pages/`. ✓

## Changed files (vs v2.2) — 5 files, no migration change

`app/layer1/input-sources/[sourceId]/page.tsx` (versionAccepted, draft suppression),
`app/layer1/input-sources/_components/mapping-grid.tsx` (read-only gating + copy),
`app/layer1/input-sources/actions.ts` (graceful accepted-version guard),
`lib/repositories/input-sources.ts` (getInputSourceVersionStatus),
`tests/wp-ux-1.5-journey-cleanup.test.ts` (+7 C5 tests).

## Clean gate (fresh npm ci, TypeScript 5.9.3, run sequentially)

```
npm test:          385 pass / 0 fail   (was 378; +7)
typecheck:         0
lint:              0
inspect:           0  (zero static-risk routes; pages/ absent)
build:             BUILD_RETURNED:0
audit:             0 vulnerabilities
verify:            exit 0  ([verify] all steps passed)
dummy-env build:   BUILD_RETURNED:0   (0 config warnings)
```
Run strictly sequentially (never verify + build against the same `.next`).

## ZIP

`workforce-planning-platform-saas-ux1.5-planner-journey-cleanup-v2.3.zip` — clean tree.

## Re-test note

C5 was a browser finding. Migration 014 does not need reapplying (unchanged); just
redeploy the app build and re-walk C5 on the accepted source: the panel should show
"Viewing latest accepted mapping" read-only with no Save/Accept buttons, and no
"Module Unavailable". Then continue to C6 (importing a source must not change any
official forecast/budget number).
