import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = new URL('../supabase/migrations', import.meta.url);
const sql = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(join(migrationsDir.pathname, file), 'utf8'))
  .join('\n');
const phase5Sql = readFileSync(new URL('../supabase/migrations/008_phase5_driver_layer.sql', import.meta.url), 'utf8');
const repository = readFileSync(new URL('../lib/repositories/budget-drivers.ts', import.meta.url), 'utf8');
const readRepository = readFileSync(new URL('../lib/repositories/budget-drivers-read.ts', import.meta.url), 'utf8');
const mutationRepository = readFileSync(new URL('../lib/repositories/budget-drivers-mutations.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../app/drivers/page.tsx', import.meta.url), 'utf8');
const detailPage = readFileSync(new URL('../app/drivers/[driverId]/page.tsx', import.meta.url), 'utf8');
const actions = readFileSync(new URL('../app/drivers/actions.ts', import.meta.url), 'utf8');

test('Phase 5 driver layer schema is present and tenant scoped', () => {
  for (const table of ['budget_driver_sets', 'budget_drivers', 'budget_driver_monthly_impacts']) {
    assert.match(sql, new RegExp(`CREATE TABLE public\\.${table}`));
    assert.match(sql, new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?organisation_id uuid NOT NULL`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
  }
  assert.match(sql, /CONSTRAINT budget_driver_sets_baseline_same_org_fk FOREIGN KEY \(organisation_id, budget_baseline_id\)/);
  assert.match(sql, /CONSTRAINT budget_drivers_set_same_org_fk FOREIGN KEY \(organisation_id, driver_set_id\)/);
  assert.match(sql, /CONSTRAINT budget_drivers_confidence_score_range CHECK \(confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100\)/);
  assert.match(sql, /CONSTRAINT budget_drivers_evidence_quality_score_range CHECK \(evidence_quality_score IS NULL OR evidence_quality_score BETWEEN 0 AND 100\)/);
  assert.match(sql, /CONSTRAINT budget_driver_impacts_baseline_line_same_org_fk FOREIGN KEY \(organisation_id, budget_baseline_line_id\)/);
  assert.match(sql, /CONSTRAINT budget_driver_impacts_period_same_org_fk FOREIGN KEY \(organisation_id, period_id\)/);
  assert.match(phase5Sql, /driver_category text NOT NULL CHECK \(driver_category IN \(\s*'growth',\s*'efficiency',\s*'cost_change',\s*'supply_change',\s*'management_adjustment'/s);
  assert.match(phase5Sql, /status text NOT NULL DEFAULT 'draft' CHECK \(status IN \('draft', 'proposed', 'approved', 'superseded', 'voided'\)\)/);
  assert.match(phase5Sql, /phasing_method text NOT NULL DEFAULT 'straight_line' CHECK \(phasing_method IN \('straight_line', 'ramp_up', 'ramp_down', 'one_off'\)\)/);
});

test('driver sets can only be sourced from locked immutable budget baselines', () => {
  assert.match(phase5Sql, /source_baseline\.status <> 'locked'/);
  assert.match(phase5Sql, /source_baseline\.is_immutable IS DISTINCT FROM true/);
  assert.match(phase5Sql, /Only locked immutable budget baselines can source budget driver sets/);
  assert.match(mutationRepository, /\.rpc\('create_budget_driver_set_from_baseline'/);
});

test('driver writes are controlled service-role RPCs with 12 monthly impacts', () => {
  for (const signature of [
    'create_budget_driver_set_from_baseline\\(uuid, uuid, uuid, jsonb, text\\)',
    'create_budget_driver\\(uuid, uuid, uuid, jsonb, jsonb, text\\)',
    'review_budget_driver_set\\(uuid, uuid, uuid, text\\)',
    'transition_budget_driver_lifecycle\\(uuid, uuid, uuid, text, jsonb, text\\)'
  ]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature} FROM anon, authenticated;`));
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO service_role;`));
  }
  assert.match(phase5Sql, /impact_count <> 12/);
  assert.match(phase5Sql, /Budget drivers require 12 monthly impact rows/);
  assert.match(phase5Sql, /baseline_line\.budget_baseline_id = target_set\.budget_baseline_id/);
  assert.match(phase5Sql, /Budget driver impact row does not match the locked baseline period/);
  assert.match(mutationRepository, /\.rpc\('create_budget_driver'/);
  assert.match(mutationRepository, /phaseDriverImpact/);
});

test('driver lifecycle governs proposed scenario-only and approved official impact', () => {
  assert.match(phase5Sql, /transition_budget_driver_lifecycle/);
  assert.match(phase5Sql, /Only draft budget drivers can be proposed/);
  assert.match(phase5Sql, /Only proposed budget drivers can be approved/);
  assert.match(phase5Sql, /Only approved budget drivers can be superseded/);
  assert.match(phase5Sql, /Approved budget drivers must be superseded, not voided/);
  assert.match(phase5Sql, /impact_treatment = 'official_impact'/);
  assert.match(phase5Sql, /impact_treatment = 'scenario_preview'/);
  assert.match(phase5Sql, /drivers\.status = 'approved'/);
  assert.match(phase5Sql, /drivers\.status = 'proposed'/);
  assert.match(phase5Sql, /Only draft budget drivers can be edited directly; approved drivers must be superseded/);
  for (const event of ['budget_driver.proposed', 'budget_driver.approved', 'budget_driver.superseded', 'budget_driver.voided']) {
    assert.match(phase5Sql, new RegExp(event.replace('.', '\\.')));
  }
  assert.doesNotMatch(phase5Sql, /CREATE TABLE public\.(reforecast|actuals|variance|waterfall|ai)/);
  assert.match(page, /does not create reforecast locks, actuals, variance, waterfall or AI outputs/);
  assert.match(page, /Proposed drivers are scenario-only until approved/);
  assert.match(detailPage, /Proposed drivers are scenario-only and do not feed official impact/);
  assert.match(detailPage, /Approved drivers feed official driver impact/);
});

test('driver pages keep mutation RPC modules out of the static App Router import graph', () => {
  assert.match(repository, /export \* from '\.\/budget-drivers-read'/);
  assert.match(repository, /export \* from '\.\/budget-drivers-mutations'/);
  assert.match(readRepository, /getBudgetDriverDashboard/);
  assert.match(readRepository, /getBudgetDriverDetail/);
  assert.doesNotMatch(readRepository, /createAdminClient|\.rpc\('/);
  assert.match(mutationRepository, /createAdminClient/);
  assert.match(mutationRepository, /transition_budget_driver_lifecycle/);
  assert.match(page, /lib\/repositories\/budget-drivers-read/);
  assert.match(detailPage, /lib\/repositories\/budget-drivers-read/);
  assert.doesNotMatch(page, /lib\/repositories\/budget-drivers-mutations|lib\/repositories\/budget-drivers'/);
  assert.doesNotMatch(detailPage, /lib\/repositories\/budget-drivers-mutations|lib\/repositories\/budget-drivers'/);
  assert.match(actions, /await import\('\.\.\/\.\.\/lib\/repositories\/budget-drivers-mutations'\)/);
  assert.doesNotMatch(actions, /^import .*budget-drivers/m);
});

test('driver layer keeps browser writes out of business tables', () => {
  assert.match(phase5Sql, /Driver writes are routed through server-side services and controlled RPCs/);
  assert.doesNotMatch(phase5Sql, /CREATE POLICY budget_driver_sets_.*INSERT/);
  assert.doesNotMatch(phase5Sql, /CREATE POLICY budget_drivers_.*INSERT/);
  assert.doesNotMatch(phase5Sql, /CREATE POLICY budget_driver_monthly_impacts_.*INSERT/);
  assert.match(phase5Sql, /REVOKE INSERT, UPDATE, DELETE ON public\.budget_driver_sets FROM anon, authenticated/);
  assert.match(phase5Sql, /REVOKE INSERT, UPDATE, DELETE ON public\.budget_drivers FROM anon, authenticated/);
  assert.match(phase5Sql, /REVOKE INSERT, UPDATE, DELETE ON public\.budget_driver_monthly_impacts FROM anon, authenticated/);
});
