import test from 'node:test';
import assert from 'node:assert/strict';
import { dimensionTables, isDimensionTable } from '../lib/repositories/dimension-tables';

test('dimension table allowlist accepts only known shared dimensions', () => {
  assert.deepEqual([...dimensionTables], ['regions', 'locations', 'channels', 'work_types', 'workforce_groups']);
  assert.equal(isDimensionTable('regions'), true);
  assert.equal(isDimensionTable('work_types'), true);
  assert.equal(isDimensionTable('audit_events'), false);
  assert.equal(isDimensionTable('organisations'), false);
});
