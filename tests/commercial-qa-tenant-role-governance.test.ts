import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hasPermission } from '../lib/permissions/permissions';
import { assertTenantMatch, filterTenantRows } from '../lib/tenant/tenant-scope';
import type { RoleName } from '../types/roles';

const layer1Repository = readFileSync(new URL('../lib/repositories/layer1.ts', import.meta.url), 'utf8');
const baselineRepository = readFileSync(new URL('../lib/repositories/budget-baselines.ts', import.meta.url), 'utf8');
const driverRepository = readFileSync(new URL('../lib/repositories/budget-drivers.ts', import.meta.url), 'utf8');
const migrations = readFileSync(new URL('../supabase/migrations/008_phase5_driver_layer.sql', import.meta.url), 'utf8')
  + readFileSync(new URL('../supabase/migrations/007_phase4_1_commercial_qa_hardening.sql', import.meta.url), 'utf8')
  + readFileSync(new URL('../supabase/migrations/006_phase4_budget_baseline_module.sql', import.meta.url), 'utf8')
  + readFileSync(new URL('../supabase/migrations/005_phase3_1_layer1_governance_hardening.sql', import.meta.url), 'utf8')
  + readFileSync(new URL('../supabase/migrations/004_phase3_layer1_approval_lock_handoff.sql', import.meta.url), 'utf8');

const roleMatrix: Record<RoleName, Record<string, boolean>> = {
  owner: { view: true, create: true, edit: true, submit: true, approve: true, lockLayer1: true, readyForLayer2: true, importBaseline: true, lockBaseline: true, driverCreate: true, driverWrite: true, driverReview: true, audit: true },
  admin: { view: true, create: true, edit: true, submit: true, approve: true, lockLayer1: true, readyForLayer2: true, importBaseline: true, lockBaseline: true, driverCreate: true, driverWrite: true, driverReview: true, audit: true },
  finance_admin: { view: true, create: false, edit: false, submit: false, approve: true, lockLayer1: true, readyForLayer2: true, importBaseline: true, lockBaseline: true, driverCreate: true, driverWrite: true, driverReview: true, audit: true },
  planner: { view: true, create: true, edit: true, submit: true, approve: false, lockLayer1: false, readyForLayer2: false, importBaseline: true, lockBaseline: false, driverCreate: true, driverWrite: true, driverReview: false, audit: false },
  reviewer: { view: true, create: false, edit: false, submit: false, approve: true, lockLayer1: false, readyForLayer2: false, importBaseline: false, lockBaseline: false, driverCreate: false, driverWrite: false, driverReview: true, audit: false },
  viewer: { view: true, create: false, edit: false, submit: false, approve: false, lockLayer1: false, readyForLayer2: false, importBaseline: false, lockBaseline: false, driverCreate: false, driverWrite: false, driverReview: false, audit: false },
  auditor: { view: true, create: false, edit: false, submit: false, approve: false, lockLayer1: false, readyForLayer2: false, importBaseline: false, lockBaseline: false, driverCreate: false, driverWrite: false, driverReview: false, audit: true },
  integration_admin: { view: true, create: false, edit: false, submit: false, approve: false, lockLayer1: false, readyForLayer2: false, importBaseline: false, lockBaseline: false, driverCreate: false, driverWrite: false, driverReview: false, audit: false },
  ai_admin: { view: true, create: false, edit: false, submit: false, approve: false, lockLayer1: false, readyForLayer2: false, importBaseline: false, lockBaseline: false, driverCreate: false, driverWrite: false, driverReview: false, audit: false }
};

test('commercial role matrix is explicit for governed Phase 1 to Phase 5 actions', () => {
  for (const [role, expected] of Object.entries(roleMatrix) as Array<[RoleName, Record<string, boolean>]>) {
    assert.equal(hasPermission([role], 'workspace:read'), expected.view, `${role} view`);
    assert.equal(hasPermission([role], 'layer1:write'), expected.edit, `${role} Layer 1 edit`);
    assert.equal(hasPermission([role], 'layer1:submit_review'), expected.submit, `${role} Layer 1 submit`);
    assert.equal(hasPermission([role], 'layer1:approve'), expected.approve, `${role} Layer 1 approve`);
    assert.equal(hasPermission([role], 'layer1:lock'), expected.lockLayer1, `${role} Layer 1 lock`);
    assert.equal(hasPermission([role], 'baseline:create'), expected.importBaseline, `${role} baseline create/import`);
    assert.equal(hasPermission([role], 'baseline:lock'), expected.lockBaseline, `${role} baseline lock`);
    assert.equal(hasPermission([role], 'driver:create'), expected.driverCreate, `${role} driver set create`);
    assert.equal(hasPermission([role], 'driver:write'), expected.driverWrite, `${role} driver write`);
    assert.equal(hasPermission([role], 'driver:review'), expected.driverReview, `${role} driver review`);
    assert.equal(hasPermission([role], 'audit:read'), expected.audit, `${role} audit read`);
  }
});

test('tenant helper blocks guessed UUID and cross-organisation record use', () => {
  const rows = [
    { organisation_id: 'org-a', id: 'plan-a' },
    { organisation_id: 'org-b', id: 'plan-b' }
  ];
  assert.deepEqual(filterTenantRows(rows, 'org-a'), [{ organisation_id: 'org-a', id: 'plan-a' }]);
  assert.throws(() => assertTenantMatch({ organisation_id: 'org-b' }, 'org-a'), /Tenant access denied/);
});

test('Layer 1, baseline and driver repositories scope data access by organisation_id', () => {
  for (const source of [layer1Repository, baselineRepository, driverRepository]) {
    assert.match(source, /\.eq\('organisation_id', context\.organisationId\)/);
  }
  assert.match(layer1Repository, /\.eq\('plan_id', plan\.id\)/);
  assert.match(layer1Repository, /\.eq\('plan_id', planId\)/);
  assert.match(baselineRepository, /target_organisation_id: context\.organisationId/);
  assert.match(baselineRepository, /target_actor_user_id: context\.userId/);
  assert.match(driverRepository, /target_organisation_id: context\.organisationId/);
  assert.match(driverRepository, /target_actor_user_id: context\.userId/);
});

test('governance attack paths are blocked by database triggers and service-only RPCs', () => {
  assert.match(migrations, /Governed Layer 1 calculation runs cannot be deleted/);
  assert.match(migrations, /Governed Layer 1 calculation payload cannot be changed/);
  assert.match(migrations, /Layer 1 version locks cannot be deleted/);
  assert.match(migrations, /Approved handoff snapshot JSON cannot be changed/);
  assert.match(migrations, /Locked budget baseline header cannot be changed/);
  assert.match(migrations, /Locked budget baseline lines cannot be edited/);
  assert.match(migrations, /Budget baseline snapshots are immutable and cannot be updated or deleted/);
  assert.match(migrations, /Only draft budget drivers can be edited directly; approved drivers must be superseded/);
  assert.match(migrations, /Only proposed budget drivers can be approved/);
  assert.match(migrations, /Approved budget drivers must be superseded, not voided/);
  assert.match(migrations, /GRANT EXECUTE ON FUNCTION public\.create_layer1_lock_and_handoff[\s\S]*TO service_role/);
  assert.match(migrations, /GRANT EXECUTE ON FUNCTION public\.lock_budget_baseline[\s\S]*TO service_role/);
  assert.match(migrations, /GRANT EXECUTE ON FUNCTION public\.create_budget_driver[\s\S]*TO service_role/);
  assert.match(migrations, /GRANT EXECUTE ON FUNCTION public\.transition_budget_driver_lifecycle[\s\S]*TO service_role/);
});
