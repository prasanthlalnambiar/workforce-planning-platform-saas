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

const businessTables = [
  'organisation_memberships',
  'roles',
  'user_roles',
  'plans',
  'fiscal_years',
  'planning_periods',
  'regions',
  'locations',
  'channels',
  'work_types',
  'workforce_groups',
  'planning_briefs',
  'source_inventory',
  'demand_inputs',
  'capacity_assumptions',
  'cost_assumptions',
  'scenario_definitions',
  'calculation_runs',
  'layer1_version_locks',
  'layer1_handoff_objects',
  'budget_baselines',
  'budget_baseline_lines',
  'budget_baseline_snapshots',
  'audit_events'
];

test('business tables include organisation_id', () => {
  for (const table of businessTables) {
    const pattern = new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?organisation_id uuid NOT NULL`, 'm');
    assert.match(sql, pattern, `${table} must include organisation_id`);
  }
});

test('RLS is enabled on tenant-scoped business tables', () => {
  for (const table of businessTables) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`), `${table} must enable RLS`);
  }
});

test('Layer 1 scaffolding and lock/handoff tables exist', () => {
  for (const table of ['planning_briefs', 'source_inventory', 'demand_inputs', 'capacity_assumptions', 'cost_assumptions', 'scenario_definitions', 'calculation_runs', 'layer1_version_locks', 'layer1_handoff_objects']) {
    assert.match(sql, new RegExp(`CREATE TABLE public\\.${table}`));
  }
});

test('direct audit event inserts are removed by the hardening migration', () => {
  const createIndex = sql.indexOf('CREATE POLICY audit_events_insert_member');
  const dropIndex = sql.indexOf('DROP POLICY IF EXISTS audit_events_insert_member ON public.audit_events;');
  assert.notEqual(createIndex, -1, 'initial migration should show the policy being superseded');
  assert.notEqual(dropIndex, -1, 'hardening migration must drop the direct insert policy');
  assert.ok(dropIndex > createIndex, 'drop must happen after the initial policy creation');
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON public\.audit_events FROM anon, authenticated;/);
});

test('tenant consistency guardrails include composite organisation foreign keys', () => {
  assert.match(sql, /FOREIGN KEY \(organisation_id, plan_id\) REFERENCES public\.plans\(organisation_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(organisation_id, period_id\) REFERENCES public\.planning_periods\(organisation_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(organisation_id, work_type_id\) REFERENCES public\.work_types\(organisation_id, id\)/);
});

test('Layer 1 immutable payload guards allow only controlled status movement', () => {
  assert.match(sql, /protect_layer1_version_lock_update/);
  assert.match(sql, /protect_layer1_handoff_update/);
  assert.match(sql, /locked calculation references cannot be changed/i);
});

test('Phase 3 Layer 1 approval, lock and handoff schema is present', () => {
  assert.match(sql, /submitted_for_review/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES public\.profiles\(id\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public\.profiles\(id\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS approved_snapshot_json jsonb NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS approved_calculation_run_id uuid/);
  assert.match(sql, /ready_for_layer2/);
});

test('Phase 3 protects governed Layer 1 calculation and handoff payloads', () => {
  assert.match(sql, /protect_calculation_run_governance_update/);
  assert.match(sql, /Governed Layer 1 calculation payload cannot be changed/);
  assert.match(sql, /Governed Layer 1 calculation runs cannot be deleted/);
  assert.match(sql, /Approved handoff snapshot JSON cannot be changed/);
  assert.match(sql, /Layer 1 handoff status transition is not allowed/);
});

test('Phase 3 lock and handoff tables enforce tenant-consistent references', () => {
  assert.match(sql, /FOREIGN KEY \(organisation_id, fiscal_year_id\) REFERENCES public\.fiscal_years\(organisation_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(organisation_id, approved_calculation_run_id\) REFERENCES public\.calculation_runs\(organisation_id, id\)/);
});


test('Phase 2 Layer 1 engine fields are added to scaffolding tables', () => {
  assert.match(sql, /ADD COLUMN IF NOT EXISTS demand_category text NOT NULL DEFAULT 'measured_contact'/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS work_type_label text/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS weeks_per_month numeric\(8,2\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS current_supply_fte numeric\(12,2\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS annual_budget_target numeric\(18,2\)/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS risk_flags_json jsonb/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS scenario_summary_json jsonb/);
});


test('Phase 4 Budget Baseline schema is present and tenant-scoped', () => {
  for (const table of ['budget_baselines', 'budget_baseline_lines', 'budget_baseline_snapshots']) {
    assert.match(sql, new RegExp(`CREATE TABLE public\\.${table}`));
    assert.match(sql, new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?organisation_id uuid NOT NULL`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`));
  }
  assert.match(sql, /CONSTRAINT budget_baselines_handoff_same_org_fk FOREIGN KEY \(organisation_id, source_layer1_handoff_id\)/);
  assert.match(sql, /CONSTRAINT budget_baseline_lines_period_same_org_fk FOREIGN KEY \(organisation_id, period_id\)/);
  assert.match(sql, /CONSTRAINT budget_baseline_snapshots_baseline_same_org_fk FOREIGN KEY \(organisation_id, budget_baseline_id\)/);
});
