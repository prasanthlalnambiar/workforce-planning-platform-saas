import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { roleDefinitions } from '../lib/permissions/roles';
import { hasPermission } from '../lib/permissions/permissions';
import type { RoleName } from '../types/roles';

function rolesOf(name: RoleName) {
  return [name];
}

test('driver permissions follow the Phase 5 governance model per role', () => {
  const expectations: Array<[RoleName, { read: boolean; write: boolean; propose: boolean; approve: boolean; supersede: boolean }]> = [
    ['owner', { read: true, write: true, propose: true, approve: true, supersede: true }],
    ['admin', { read: true, write: true, propose: true, approve: true, supersede: true }],
    ['finance_admin', { read: true, write: true, propose: true, approve: true, supersede: true }],
    ['planner', { read: true, write: true, propose: true, approve: false, supersede: false }],
    ['reviewer', { read: true, write: false, propose: false, approve: true, supersede: false }],
    ['viewer', { read: true, write: false, propose: false, approve: false, supersede: false }],
    ['auditor', { read: true, write: false, propose: false, approve: false, supersede: false }]
  ];

  for (const [role, expected] of expectations) {
    assert.equal(hasPermission(rolesOf(role), 'driver:read'), expected.read, `${role} driver:read`);
    assert.equal(hasPermission(rolesOf(role), 'driver:write'), expected.write, `${role} driver:write`);
    assert.equal(hasPermission(rolesOf(role), 'driver:propose'), expected.propose, `${role} driver:propose`);
    assert.equal(hasPermission(rolesOf(role), 'driver:approve'), expected.approve, `${role} driver:approve`);
    assert.equal(hasPermission(rolesOf(role), 'driver:supersede'), expected.supersede, `${role} driver:supersede`);
  }
});

test('every role definition that can approve drivers can also read them', () => {
  for (const role of roleDefinitions) {
    if (role.permissions.includes('driver:approve')) {
      assert.ok(role.permissions.includes('driver:read'), `${role.name} approves drivers but cannot read them`);
    }
  }
});

const migrationSql = readFileSync(new URL('../supabase/migrations/008_phase5_driver_layer.sql', import.meta.url), 'utf8');

test('Phase 5 migration scopes driver tables to the organisation with composite tenant FKs and RLS', () => {
  for (const table of ['forecast_drivers', 'forecast_driver_lines']) {
    assert.match(migrationSql, new RegExp(`CREATE TABLE public\\.${table}[\\s\\S]*organisation_id uuid NOT NULL`), `${table} tenant scope`);
    assert.match(migrationSql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`), `${table} RLS`);
    assert.match(migrationSql, new RegExp(`REVOKE INSERT, UPDATE, DELETE ON public\\.${table} FROM anon, authenticated;`), `${table} direct writes revoked`);
  }
  assert.match(migrationSql, /FOREIGN KEY \(organisation_id, budget_baseline_id\) REFERENCES public\.budget_baselines\(organisation_id, id\)/);
  assert.match(migrationSql, /FOREIGN KEY \(organisation_id, forecast_driver_id\) REFERENCES public\.forecast_drivers\(organisation_id, id\)/);
});

test('Phase 5 migration enforces driver immutability and terminal states with protection triggers', () => {
  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION public\.protect_forecast_driver_update\(\)/);
  assert.match(migrationSql, /CREATE OR REPLACE FUNCTION public\.protect_forecast_driver_line_update\(\)/);
  assert.match(migrationSql, /BEFORE UPDATE OR DELETE ON public\.forecast_drivers/);
  assert.match(migrationSql, /BEFORE UPDATE OR DELETE ON public\.forecast_driver_lines/);
  assert.match(migrationSql, /Approved forecast drivers are immutable/);
  assert.match(migrationSql, /terminal state and cannot be changed/);
  assert.match(migrationSql, /Only draft forecast drivers can be deleted/);
});

test('Phase 5 driver governance RPCs are service-role-only and audit every transition', () => {
  const signatures = [
    'create_forecast_driver\\(uuid, uuid, jsonb, jsonb, text\\)',
    'update_forecast_driver_draft\\(uuid, uuid, uuid, jsonb, jsonb, text\\)',
    'transition_forecast_driver_status\\(uuid, uuid, uuid, text, text\\)',
    'supersede_forecast_driver\\(uuid, uuid, uuid, jsonb, jsonb, text\\)'
  ];
  for (const signature of signatures) {
    assert.match(migrationSql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature} FROM anon, authenticated;`));
    assert.match(migrationSql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO service_role;`));
  }
  for (const eventName of ['driver.created', 'driver.updated', 'driver.proposed', 'driver.approved', 'driver.reverted_to_draft', 'driver.voided', 'driver.superseded']) {
    assert.ok(migrationSql.includes(`'${eventName}'`), `audit event ${eventName} must be written by the RPC layer`);
  }
});

test('Phase 5 migration only allows drivers against a locked budget baseline and requires phasing reconciliation', () => {
  assert.match(migrationSql, /Forecast drivers can only be registered against a locked budget baseline/);
  assert.match(migrationSql, /assert_forecast_driver_lines_reconcile/);
  assert.match(migrationSql, /does not reconcile to the annual impact amount/);
});

test('Phase 5 migration stays inside the phase boundary', () => {
  const sqlWithoutComments = migrationSql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .toLowerCase();
  const createdObjects = sqlWithoutComments.match(/create (?:table|or replace function|index|trigger|policy)[^(\n]*/g) ?? [];
  for (const forbidden of ['reforecast', 'actual', 'variance', 'waterfall', '_ai', 'ai_']) {
    for (const statement of createdObjects) {
      assert.ok(!statement.includes(forbidden), `Phase 5 migration must not create ${forbidden} objects: ${statement}`);
    }
  }
});
