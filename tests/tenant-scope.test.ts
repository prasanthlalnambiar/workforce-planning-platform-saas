import test from 'node:test';
import assert from 'node:assert/strict';
import { assertTenantMatch, filterTenantRows } from '../lib/tenant/tenant-scope.ts';

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
