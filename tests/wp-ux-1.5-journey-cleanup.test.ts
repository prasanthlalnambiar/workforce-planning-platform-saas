import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { TAB_SUBNAV, subnavForRoute, PRIMARY_NAV } from '../lib/navigation/planning-cockpit';

const shared = readFileSync(new URL('../app/layer1/_components/layer1-shared.tsx', import.meta.url), 'utf8');
const cockpit = readFileSync(new URL('../lib/repositories/cockpit-summary.ts', import.meta.url), 'utf8');

// --- The old mixed Layer 1 subnav is gone ----------------------------------

test('the old mixed layer1Links subnav is removed', () => {
  assert.ok(!shared.includes('layer1Links'), 'layer1Links array must be gone');
  // The tell-tale mixed set (Dashboard + Output + Review together) must not exist.
  assert.ok(!/Dashboard['"]\s*,\s*['"]\/layer1/.test(shared), 'no Dashboard subnav link');
  // Subnav now comes from the single nav source of truth.
  assert.match(shared, /TAB_SUBNAV/);
});

// --- Per-tab subnav contains only that job's steps -------------------------

test('each tab subnav contains only steps for that job', () => {
  // Inputs: only input steps, no Assumptions/Output/Scenarios/Review.
  const inputsLabels = TAB_SUBNAV.Inputs.map((s) => s.label);
  assert.ok(inputsLabels.includes('Operational Demand Data'));
  assert.ok(inputsLabels.includes('Advanced Manual Input'));
  for (const forbidden of ['Assumptions', 'Output', 'Scenarios', 'Review & handoff']) {
    assert.ok(!inputsLabels.includes(forbidden), `Inputs subnav must not include ${forbidden}`);
  }
  // Forecast & Budget owns Scenarios + Review & Lock now.
  const fbLabels = TAB_SUBNAV['Forecast & Budget'].map((s) => s.label);
  assert.ok(fbLabels.includes('Forecast Output'));
  assert.ok(fbLabels.includes('Scenarios'));
  assert.ok(fbLabels.includes('Review & Lock'));
  assert.ok(fbLabels.includes('Visuals'));
  // Assumptions owns capacity/cost/drivers/dimensions + WP-3 placeholders.
  const aLabels = TAB_SUBNAV.Assumptions.map((s) => s.label);
  for (const l of ['Capacity Rules', 'Cost Rules', 'Change Drivers', 'Locations & Segments', 'Workflow Mapping', 'Location & Vendor Split']) {
    assert.ok(aLabels.includes(l), `Assumptions subnav includes ${l}`);
  }
  // Track owns overview + tracking chain.
  const tLabels = TAB_SUBNAV.Track.map((s) => s.label);
  assert.deepEqual(tLabels, ['Track Overview', 'Actuals', 'Variance', 'Waterfall', 'Planning Advisor']);
});

test('subnavForRoute returns the owning tab\'s steps', () => {
  assert.equal(subnavForRoute('/layer1/input-sources'), TAB_SUBNAV.Inputs);
  assert.equal(subnavForRoute('/layer1/scenarios'), TAB_SUBNAV['Forecast & Budget']);
  assert.equal(subnavForRoute('/track'), TAB_SUBNAV.Track);
});

test('WP-3 mapping steps are placeholders, flagged as later steps', () => {
  const wf = TAB_SUBNAV.Assumptions.find((s) => s.label === 'Workflow Mapping');
  const lv = TAB_SUBNAV.Assumptions.find((s) => s.label === 'Location & Vendor Split');
  assert.equal(wf?.note, 'Later step');
  assert.equal(lv?.note, 'Later step');
});

// --- Landings ---------------------------------------------------------------

test('Forecast & Budget lands on Forecast Output, Track lands on Track Overview', () => {
  const fb = PRIMARY_NAV.find((p) => p.tab === 'Forecast & Budget');
  const tr = PRIMARY_NAV.find((p) => p.tab === 'Track');
  assert.equal(fb?.href, '/layer1/output');
  assert.equal(tr?.href, '/track');
});

// --- Home next-action ladder points at the modern flow ---------------------

test('Home next action points to the flexible-input flow, not old manual demand', () => {
  // The old bug: "Enter demand inputs" -> /layer1/demand. Must be gone.
  assert.ok(!/Enter demand inputs/.test(cockpit), 'old next-action label gone');
  assert.ok(!/label: 'Enter demand inputs', href: '\/layer1\/demand'/.test(cockpit), 'old manual-demand next action gone');
  // New ladder mentions uploading/pasting demand data via input-sources.
  assert.match(cockpit, /Upload or paste demand data/);
  assert.match(cockpit, /\/layer1\/input-sources/);
  assert.match(cockpit, /Map your demand columns/);
});

test('Home reads flexible-source signals for guidance only (no calc wiring)', () => {
  assert.match(cockpit, /input_sources/);
  assert.match(cockpit, /field_mapping_versions/);
  assert.match(cockpit, /guidance only/i);
});

// --- New pages exist (read-only) and old routes remain ---------------------

test('new UX-1.5 pages exist', () => {
  for (const p of ['track', 'forecast/visuals', 'assumptions/workflow-mapping', 'assumptions/location-vendor-split']) {
    assert.ok(existsSync(new URL(`../app/${p}/page.tsx`, import.meta.url)), `/${p} page exists`);
  }
});

test('old routes remain accessible (nothing deleted)', () => {
  for (const p of ['layer1', 'layer1/demand', 'layer1/sources', 'layer1/scenarios', 'baseline', 'actuals']) {
    assert.ok(existsSync(new URL(`../app/${p}/page.tsx`, import.meta.url)), `/${p} still exists`);
  }
});

test('visuals repository reads deterministic runs only (no calc, no writes)', () => {
  const repo = readFileSync(new URL('../lib/repositories/forecast-visuals.ts', import.meta.url), 'utf8');
  assert.match(repo, /calculation_runs/);
  for (const forbidden of ['.insert(', '.update(', '.delete(', '.rpc(', 'createAdminClient']) {
    assert.ok(!repo.includes(forbidden), `visuals repo must not ${forbidden}`);
  }
  assert.match(repo, /requirePermission\(context\.roles, 'layer1:read'\)/);
});

// --- Review fixes (candidate cleanup) --------------------------------------

test('unavailable fallback landings match the new cockpit landings', () => {
  // Issue 1: the emptyUnavailable() fallback must not point at old landings.
  assert.ok(!/href: '\/layer1'\s*}/.test(cockpit), 'Inputs fallback not /layer1');
  assert.ok(!/'Forecast & Budget', status: 'Waiting', href: '\/baseline'/.test(cockpit), 'F&B fallback not /baseline');
  assert.ok(!/'Track', status: 'Waiting', href: '\/actuals'/.test(cockpit), 'Track fallback not /actuals');
  assert.match(cockpit, /'Inputs', status: 'Waiting', href: '\/layer1\/input-sources'/);
  assert.match(cockpit, /'Forecast & Budget', status: 'Waiting', href: '\/layer1\/output'/);
  assert.match(cockpit, /'Track', status: 'Waiting', href: '\/track'/);
});

test('Home mapping next-action deep-links to the specific source when one exists', () => {
  // Issue 3: prefer /layer1/input-sources/[id] over the generic list.
  assert.match(cockpit, /latestSourceId/);
  assert.match(cockpit, /\/layer1\/input-sources\/\$\{latestSourceId\}/);
});

test('assumptions page exposes the #cost anchor referenced by the subnav', () => {
  // Issue 2: Cost Rules links to /layer1/assumptions#cost — the anchor must exist.
  const page = readFileSync(new URL('../app/layer1/assumptions/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /id="cost"/);
  // And the stale "Demand" badge is corrected.
  assert.ok(!/badge="Demand"/.test(page), 'stale Demand badge removed');
});

test('visuals chart copy does not overclaim period-level demand', () => {
  // Issue 5: label reflects per-run data, not a weekly/monthly demand curve.
  const page = readFileSync(new URL('../app/forecast/visuals/page.tsx', import.meta.url), 'utf8');
  assert.ok(!/>Workload trend</.test(page), 'no bare "Workload trend" heading');
  assert.match(page, /by forecast run|successive forecast runs|forecast runs/i);
});

// --- v2.1 live-UAT polish --------------------------------------------------

import { displayEventType, displayReason } from '../lib/display/audit-labels';

test('Track Overview does not surface the global upstream next action', () => {
  const page = readFileSync(new URL('../app/track/page.tsx', import.meta.url), 'utf8');
  // Must NOT render summary.nextAction directly (that leaks upstream steps like
  // "Set change drivers" into Track).
  assert.ok(!/summary\.nextAction/.test(page), 'Track must not render the global nextAction');
  // Must derive Track-scoped guidance instead.
  assert.match(page, /trackGuidance/);
  assert.match(page, /waiting until Forecast & Budget is locked/);
});

test('audit build terminology is display-translated for users', () => {
  // Issue 2: the stored reason contains build wording; the display layer cleans it.
  assert.equal(displayReason('Layer 1 deterministic calculation run created'), 'Forecast calculated');
  assert.equal(displayEventType('layer1.calculation_run.created'), 'Forecast calculated');
  // Stored value itself is not what users see; the helper never returns the raw build phrase.
  assert.ok(!/Layer 1 deterministic/.test(displayReason('Layer 1 deterministic calculation run created')));
});

test('Review & Lock renders translated audit labels, not raw event types/reasons', () => {
  const page = readFileSync(new URL('../app/layer1/review/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /displayEventType\(String\(event\.event_type\)\)/);
  assert.match(page, /displayReason\(event\.reason/);
  // The old raw render is gone.
  assert.ok(!/<strong>\{String\(event\.event_type\)\}<\/strong>/.test(page), 'raw event_type render removed');
});

test('display translation does not mutate stored audit data (render-only helper)', () => {
  const repo = readFileSync(new URL('../lib/repositories/layer1.ts', import.meta.url), 'utf8');
  // The stored audit reason is unchanged — we translate at render, not at write.
  assert.match(repo, /Layer 1 deterministic calculation run created/);
});

// --- WP-2 live-UAT blocker: stale draft must not override accepted mapping --

import { resolveCandidateMapping, type StoredMapping } from '../lib/intake/intake-engine';

const HEADERS_M = ['Week commencing', 'Workflow', 'Volume', 'AHT', 'AHT unit', 'Channel'];
function mapping(versionNumber: number, extra: Record<string, string> = {}): StoredMapping {
  return {
    mappings: {
      'Week commencing': 'week_commencing', 'Workflow': 'workflow_name', 'Volume': 'weekly_volume',
      'AHT': 'weekly_aht', 'AHT unit': 'aht_unit', ...extra
    },
    aggregation_decision: { default_aht_unit: 'minutes', date_format: 'iso' },
    mapping_version_number: versionNumber
  };
}

test('REGRESSION: after accept, a stale older draft does NOT override the accepted mapping', () => {
  // The exact UAT state: v1 = draft (older), v2 = accepted (newer).
  const olderDraft = mapping(1, { 'Channel': 'reporting' });
  const acceptedNewer = mapping(2, { 'Channel': 'calc_dimension' });
  const candidate = resolveCandidateMapping({ draft: olderDraft, accepted: acceptedNewer, headers: HEADERS_M });
  assert.equal(candidate.source, 'accepted', 'accepted (newer) wins over the stale older draft');
  assert.equal(candidate.mapping.roleByHeader['Channel'], 'calc_dimension');
});

test('a draft NEWER than the accepted mapping still wins (active editing continues)', () => {
  const acceptedOlder = mapping(2, { 'Channel': 'reporting' });
  const newerDraft = mapping(3, { 'Channel': 'calc_dimension' });
  const candidate = resolveCandidateMapping({ draft: newerDraft, accepted: acceptedOlder, headers: HEADERS_M });
  assert.equal(candidate.source, 'draft', 'a genuinely newer draft is still the editing candidate');
});

test('draft with no accepted mapping is shown; accepted with no draft is shown', () => {
  const draftOnly = resolveCandidateMapping({ draft: mapping(1), accepted: null, headers: HEADERS_M });
  assert.equal(draftOnly.source, 'draft');
  const acceptedOnly = resolveCandidateMapping({ draft: null, accepted: mapping(1), headers: HEADERS_M });
  assert.equal(acceptedOnly.source, 'accepted');
});

test('equal version numbers do not let a draft override accepted (defensive)', () => {
  const candidate = resolveCandidateMapping({ draft: mapping(2, { 'Channel': 'reporting' }), accepted: mapping(2, { 'Channel': 'calc_dimension' }), headers: HEADERS_M });
  assert.equal(candidate.source, 'accepted');
});

// --- WP-2 C5: accepted source version is read-only (no blocked actions) -----

test('accepted source version forces the accepted mapping candidate (draft suppressed)', () => {
  const page = readFileSync(new URL('../app/layer1/input-sources/[sourceId]/page.tsx', import.meta.url), 'utf8');
  // versionAccepted is computed from the current version status.
  assert.match(page, /const versionAccepted = String\(data\.currentVersion\?\.version_status\) === 'accepted'/);
  // When accepted, the draft input to the resolver is suppressed (null), so a
  // newer draft can never be the visible candidate on an immutable version.
  assert.match(page, /draft: versionAccepted \? null : \(data\.latestDraftMapping as StoredMapping \| null\)/);
});

test('accepted version shows the accepted mapping state label, not a draft/suggestion', () => {
  // With the draft suppressed, resolveCandidateMapping returns source 'accepted',
  // so stateLabel becomes "Viewing latest accepted mapping".
  const accepted: StoredMapping = {
    mappings: { 'Week commencing': 'week_commencing', 'Workflow': 'workflow_name', 'Volume': 'weekly_volume', 'AHT': 'weekly_aht' },
    aggregation_decision: { default_aht_unit: 'minutes', date_format: 'iso' },
    mapping_version_number: 2
  };
  // Simulate the page's suppression: accepted version => draft passed as null.
  const candidate = resolveCandidateMapping({ draft: null, accepted, headers: ['Week commencing', 'Workflow', 'Volume', 'AHT'] });
  assert.equal(candidate.source, 'accepted');
});

test('MappingGrid is read-only on an accepted source version (no action buttons)', () => {
  const grid = readFileSync(new URL('../app/layer1/input-sources/_components/mapping-grid.tsx', import.meta.url), 'utf8');
  // The grid takes a versionAccepted prop and computes an editable gate from it.
  assert.match(grid, /versionAccepted/);
  assert.match(grid, /editable = canWrite && !versionAccepted/);
  // Action buttons and the form action are gated on `editable`, not just canWrite.
  assert.match(grid, /editable \? acceptMappingAction : undefined/);
  assert.match(grid, /\{editable && \(/);
  // The required immutability copy is present (text wraps across lines in JSX).
  assert.match(grid, /This source version is accepted and immutable\./);
  assert.match(grid, /Import a new source version to change the/);
});

test('detail page passes accepted-version status to the grid', () => {
  const page = readFileSync(new URL('../app/layer1/input-sources/[sourceId]/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /versionAccepted=\{versionAccepted\}/);
});

test('mapping write actions guard accepted versions gracefully (no module crash)', () => {
  const actions = readFileSync(new URL('../app/layer1/input-sources/actions.ts', import.meta.url), 'utf8');
  // Both actions read version status and redirect instead of throwing into the boundary.
  assert.match(actions, /getInputSourceVersionStatus/);
  assert.match(actions, /versionStatus === 'accepted'/);
  assert.match(actions, /redirect\(`\/layer1\/input-sources\/\$\{sourceId\}`\)/);
  // The guard appears for BOTH accept and saveDraft (two occurrences).
  const occurrences = (actions.match(/versionStatus === 'accepted'/g) ?? []).length;
  assert.equal(occurrences, 2, 'both accept and saveDraft guard accepted versions');
});

test('accepted-version guard does NOT throw a raw immutability error into the boundary', () => {
  const actions = readFileSync(new URL('../app/layer1/input-sources/actions.ts', import.meta.url), 'utf8');
  // The guard (redirect) precedes the createFieldMappingVersion call in accept.
  const guardIdx = actions.indexOf("versionStatus === 'accepted'");
  const acceptWriteIdx = actions.indexOf('accept: true');
  assert.ok(guardIdx > -1 && acceptWriteIdx > -1 && guardIdx < acceptWriteIdx, 'guard runs before the accept write');
});

test('DB immutability guard remains intact (migration unchanged)', () => {
  const migration = readFileSync(new URL('../supabase/migrations/014_wp2_flexible_input_foundation.sql', import.meta.url), 'utf8');
  // The frozen-version guard the DB enforces is still present.
  assert.match(migration, /Accepted input source versions are immutable/);
});
