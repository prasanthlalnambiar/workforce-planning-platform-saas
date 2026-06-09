import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/001_phase1_foundation.sql', import.meta.url), 'utf8');

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

test('no service role key is referenced in browser-facing code by migration', () => {
  assert.equal(sql.includes('SERVICE_ROLE'), false);
  assert.equal(sql.includes('service_role'), false);
});
