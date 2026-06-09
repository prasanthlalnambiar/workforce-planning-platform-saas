import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPermission, requirePermission } from '../lib/permissions/permissions';

test('owner has broad foundation permissions', () => {
  assert.equal(hasPermission(['owner'], 'workspace:create_plan'), true);
  assert.equal(hasPermission(['owner'], 'audit:read'), true);
  assert.equal(hasPermission(['owner'], 'layer1:approve_lock'), true);
});

test('viewer cannot create plans or write fiscal years', () => {
  assert.equal(hasPermission(['viewer'], 'workspace:read'), true);
  assert.equal(hasPermission(['viewer'], 'workspace:create_plan'), false);
  assert.equal(hasPermission(['viewer'], 'fiscal_year:write'), false);
});

test('permission guard throws when role lacks access', () => {
  assert.throws(() => requirePermission(['viewer'], 'audit:read'), /Permission denied/);
});


test('planner can write Layer 1 records while reviewer and viewer cannot', () => {
  assert.equal(hasPermission(['planner'], 'layer1:write'), true);
  assert.equal(hasPermission(['admin'], 'layer1:write'), true);
  assert.equal(hasPermission(['reviewer'], 'layer1:write'), false);
  assert.equal(hasPermission(['viewer'], 'layer1:write'), false);
  assert.equal(hasPermission(['reviewer'], 'layer1:read'), true);
  assert.equal(hasPermission(['viewer'], 'layer1:read'), true);
});
