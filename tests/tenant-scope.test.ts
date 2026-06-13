import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTenantMatch, filterTenantRows } from '../lib/tenant/tenant-scope';

test('filters records by organisation id', () => {
  const rows = [
    { id: 'a', organisation_id: 'org-1' },
    { id: 'b', organisation_id: 'org-2' }
  ];
  assert.deepEqual(filterTenantRows(rows, 'org-1'), [{ id: 'a', organisation_id: 'org-1' }]);
});

test('throws when record belongs to another tenant', () => {
  assert.throws(() => assertTenantMatch({ organisation_id: 'org-2' }, 'org-1'), /Tenant access denied/);
});


test('filters Layer 1 records by organisation id before calculation use', () => {
  const demandInputs = [
    { id: 'demand-1', organisation_id: 'org-1', plan_id: 'plan-1', demand_volume: 100 },
    { id: 'demand-2', organisation_id: 'org-2', plan_id: 'plan-2', demand_volume: 999 }
  ];
  assert.deepEqual(filterTenantRows(demandInputs, 'org-1'), [{ id: 'demand-1', organisation_id: 'org-1', plan_id: 'plan-1', demand_volume: 100 }]);
});
