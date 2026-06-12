import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = new URL('../supabase/migrations', import.meta.url);
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();
const migrationSqlByFile = Object.fromEntries(
  migrationFiles.map((file) => [file, readFileSync(join(migrationsDir.pathname, file), 'utf8')])
);
const allSql = migrationFiles.map((file) => migrationSqlByFile[file]).join('\n');

const governedBusinessTables = [
  'plans',
  'fiscal_years',
  'planning_periods',
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
  'forecast_drivers',
  'forecast_driver_lines',
  'reforecasts',
  'reforecast_lines',
  'reforecast_driver_impacts',
  'reforecast_snapshots',
  'audit_events'
];

test('Phase 4.1 migrations are ordered and cumulative from zero', () => {
  assert.deepEqual(migrationFiles, [
    '001_phase1_foundation.sql',
    '002_phase1_1_hardening.sql',
    '003_phase2_layer1_engine_fields.sql',
    '004_phase3_layer1_approval_lock_handoff.sql',
    '005_phase3_1_layer1_governance_hardening.sql',
    '006_phase4_budget_baseline_module.sql',
    '007_phase4_1_commercial_qa_hardening.sql',
    '008_phase5_driver_layer.sql',
    '009_phase6_reforecast_module.sql'
  ]);
});

test('all governed business tables are tenant scoped and RLS enabled', () => {
  for (const table of governedBusinessTables) {
    assert.match(allSql, new RegExp(`(?:CREATE TABLE public\\.${table}|ALTER TABLE public\\.${table})[\\s\\S]*organisation_id`, 'm'), `${table} must be tenant scoped`);
    assert.match(allSql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`), `${table} must enable RLS`);
  }
});

test('service-role-only governance RPCs are not executable by anon or authenticated', () => {
  const serviceOnlyFunctions = [
    'create_layer1_lock_and_handoff\\(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, text\\)',
    'transition_layer1_handoff_status_controlled\\(uuid, uuid, uuid, uuid, text, text\\)',
    'create_budget_baseline_draft\\(uuid, uuid, jsonb, jsonb, text\\)',
    'lock_budget_baseline\\(uuid, uuid, uuid, uuid, uuid, jsonb, text, text\\)',
    'create_forecast_driver\\(uuid, uuid, jsonb, jsonb, text\\)',
    'update_forecast_driver_draft\\(uuid, uuid, uuid, jsonb, jsonb, text\\)',
    'transition_forecast_driver_status\\(uuid, uuid, uuid, text, text\\)',
    'supersede_forecast_driver\\(uuid, uuid, uuid, jsonb, jsonb, text\\)',
    'create_reforecast\\(uuid, uuid, jsonb, jsonb, jsonb, text\\)',
    'recalculate_reforecast\\(uuid, uuid, uuid, jsonb, jsonb, jsonb, text\\)',
    'transition_reforecast_status\\(uuid, uuid, uuid, text, text\\)',
    'lock_reforecast\\(uuid, uuid, uuid, jsonb, text, text\\)'
  ];

  for (const signature of serviceOnlyFunctions) {
    assert.match(allSql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature} FROM anon, authenticated;`));
    assert.match(allSql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO service_role;`));
  }
});

test('Phase 4.1 removes older direct Layer 1 lock and handoff insert policies', () => {
  const firstPolicyIndex = allSql.indexOf('CREATE POLICY layer1_version_locks_finance_insert');
  const dropPolicyIndex = allSql.indexOf('DROP POLICY IF EXISTS layer1_version_locks_finance_insert');
  assert.ok(firstPolicyIndex >= 0, 'initial scaffold policy should exist so the hardening test is meaningful');
  assert.ok(dropPolicyIndex > firstPolicyIndex, 'Phase 4.1 must drop the older direct lock insert policy');
  assert.match(allSql, /DROP POLICY IF EXISTS layer1_handoff_objects_finance_insert ON public\.layer1_handoff_objects;/);
  assert.match(allSql, /REVOKE INSERT, UPDATE, DELETE ON public\.layer1_version_locks FROM anon, authenticated;/);
  assert.match(allSql, /REVOKE INSERT, UPDATE, DELETE ON public\.layer1_handoff_objects FROM anon, authenticated;/);
});

test('tenant consistency guardrails cover guessed UUID cross-organisation references', () => {
  const requiredCompositeGuards = [
    /FOREIGN KEY \(organisation_id, plan_id\) REFERENCES public\.plans\(organisation_id, id\)/,
    /FOREIGN KEY \(organisation_id, fiscal_year_id\) REFERENCES public\.fiscal_years\(organisation_id, id\)/,
    /FOREIGN KEY \(organisation_id, period_id\) REFERENCES public\.planning_periods\(organisation_id, id\)/,
    /FOREIGN KEY \(organisation_id, source_id\) REFERENCES public\.source_inventory\(organisation_id, id\)/,
    /FOREIGN KEY \(organisation_id, approved_calculation_run_id\) REFERENCES public\.calculation_runs\(organisation_id, id\)/,
    /FOREIGN KEY \(organisation_id, source_layer1_handoff_id\) REFERENCES public\.layer1_handoff_objects\(organisation_id, id\)/,
    /FOREIGN KEY \(organisation_id, budget_baseline_id\) REFERENCES public\.budget_baselines\(organisation_id, id\)/
  ];

  for (const guard of requiredCompositeGuards) {
    assert.match(allSql, guard);
  }
});

test('Budget Baseline lock RPC rejects pre-lock or mismatched snapshots', () => {
  const phase41 = migrationSqlByFile['007_phase4_1_commercial_qa_hardening.sql'];
  assert.match(phase41, /Budget baseline snapshot must represent the final locked baseline status/);
  assert.match(phase41, /Budget baseline snapshot locked_by does not match actor/);
  assert.match(phase41, /Budget baseline snapshot must mark the final baseline header immutable/);
  assert.match(phase41, /Budget baseline snapshot checksum does not match target checksum/);
  assert.match(phase41, /locked_at = lock_time/);
});
