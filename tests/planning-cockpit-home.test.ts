import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const cockpitRepo = readFileSync(new URL('../lib/repositories/cockpit-summary.ts', import.meta.url), 'utf8');
const homePage = readFileSync(new URL('../app/workspace/page.tsx', import.meta.url), 'utf8');
const advisoryEngine = readFileSync(new URL('../lib/advisory/advisory-engine.ts', import.meta.url), 'utf8');
const advisoryRepo = readFileSync(new URL('../lib/repositories/advisory.ts', import.meta.url), 'utf8');

test('the cockpit Home renders a four-job status strip and a single next action', () => {
  // Jobs come from the cockpit summary data model; the page maps over them.
  for (const job of ['Inputs', 'Assumptions', 'Forecast & Budget', 'Track']) {
    assert.ok(cockpitRepo.includes(`'${job}'`), `cockpit summary defines ${job}`);
  }
  assert.match(homePage, /summary\.jobs\.map/);
  assert.match(homePage, /nextAction/);
  assert.match(homePage, /getCockpitSummary/);
});

test('the cockpit summary is read-only: no inserts, updates, deletes, RPCs or admin client', () => {
  for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc(', 'createAdminClient']) {
    assert.ok(!cockpitRepo.includes(forbidden), `cockpit summary must not ${forbidden}`);
  }
});

test('the cockpit summary surfaces errors as a controlled unavailable state, not a false empty plan', () => {
  // Uses rows() (error-surfacing) and returns an explicit unavailable state.
  assert.match(cockpitRepo, /from '\.\/read-result'/);
  assert.match(cockpitRepo, /unavailable: true/);
  assert.match(cockpitRepo, /emptyUnavailable/);
});

test('the cockpit summary composes existing governed tables only (no new source of truth)', () => {
  // It reads existing tables; it must not reference any new cockpit/* table.
  assert.ok(!/from\('cockpit/.test(cockpitRepo), 'no new cockpit table');
  for (const tbl of ['plans', 'demand_inputs', 'capacity_assumptions', 'budget_baselines', 'reforecasts', 'actuals_batches', 'variance_reports']) {
    assert.ok(cockpitRepo.includes(`from('${tbl}')`), `reads existing ${tbl}`);
  }
});

test('Planning Advisor disclaimer is present, clear, and not weakened', () => {
  assert.match(advisoryEngine, /Planning Advisor explains figures already calculated by the deterministic planning engine/);
  assert.match(advisoryEngine, /does not calculate, change, approve, override, or write/);
  assert.match(advisoryEngine, /Governed records remain the source of truth/);
});

test('advisory remains read-only (carried forward): no writes/RPC/admin client', () => {
  for (const source of [advisoryEngine, advisoryRepo]) {
    for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(', '.rpc(', 'createAdminClient']) {
      assert.ok(!source.includes(forbidden), `advisory must not ${forbidden}`);
    }
  }
});

test('UX 1.0 adds no migration of its own (013 is the separate Phase 7 read-grant fix)', () => {
  const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
  // 001-012 are the pre-existing engine/governance migrations; 013 is the
  // authorized read-grant fix (grants authenticated SELECT on the Phase 7 read
  // tables). The UX 1.0 presentation refactor itself still adds no migration.
  assert.equal(files.length, 13, 'exactly 13 migrations: 001-012 plus the 013 read-grant fix');
  const thirteen = files.filter((f) => /^013/.test(f));
  assert.equal(thirteen.length, 1, 'exactly one 013 migration');
  assert.match(thirteen[0], /read_grant|grant/, '013 is the read-grant fix, not a feature migration');
});

test('no pages/ directory exists (App Router preserved)', () => {
  assert.ok(!existsSync(new URL('../pages', import.meta.url)), 'pages/ must remain absent');
});

test('build hardening preserved: layout force-dynamic + nodejs runtime, build.mjs telemetry off', () => {
  const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /export const dynamic = 'force-dynamic'/);
  assert.match(layout, /export const runtime = 'nodejs'/);
  const build = readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.match(build, /NEXT_TELEMETRY_DISABLED/);
});

test('the cockpit Home and breadcrumb both rely on the shared route-to-tab mapping', () => {
  const breadcrumbs = readFileSync(new URL('../components/app-shell/breadcrumbs.tsx', import.meta.url), 'utf8');
  assert.match(breadcrumbs, /breadcrumbsForRoute/);
  const nav = readFileSync(new URL('../components/app-shell/navigation.tsx', import.meta.url), 'utf8');
  assert.match(nav, /from '\.\.\/\.\.\/lib\/navigation\/planning-cockpit'/);
});
