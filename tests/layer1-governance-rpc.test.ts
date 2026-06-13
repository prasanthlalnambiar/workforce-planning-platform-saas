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
const repository = readFileSync(new URL('../lib/repositories/layer1.ts', import.meta.url), 'utf8');

test('Phase 3.1 creates an atomic database RPC for Layer 1 lock and handoff', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.create_layer1_lock_and_handoff/);
  assert.match(sql, /RETURNS TABLE\(version_lock jsonb, handoff jsonb\)/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /SELECT \* INTO target_run[\s\S]*FOR UPDATE/);
  assert.match(sql, /INSERT INTO public\.layer1_version_locks/);
  assert.match(sql, /UPDATE public\.calculation_runs\s+SET run_status = 'locked'/);
  assert.match(sql, /INSERT INTO public\.layer1_handoff_objects/);
  assert.match(repository, /\.rpc\('create_layer1_lock_and_handoff'/);
});

test('Phase 3.1 version ID generation is database-backed and concurrency-safe', () => {
  assert.match(sql, /layer1_version_locks_plan_version_unique UNIQUE \(organisation_id, plan_id, version_id\)/);
  assert.match(sql, /MAX\(\(substring\(version_id from '\^L1-V\(\[0-9\]\+\)\$'\)\)::int\), 0\) \+ 1/);
  assert.match(sql, /new_version_id := 'L1-V' \|\| lpad\(new_version_number::text, 3, '0'\)/);
  assert.doesNotMatch(repository, /nextLayer1VersionId\(data\.versionLocks\.length\)/);
});

test('Phase 3.1 supersedes active prior locks and handoffs inside the RPC', () => {
  assert.match(sql, /UPDATE public\.layer1_version_locks[\s\S]*approval_status = 'superseded'[\s\S]*approval_status IN \('approved', 'locked'\)/);
  assert.match(sql, /UPDATE public\.layer1_handoff_objects[\s\S]*handoff_status = 'superseded'[\s\S]*handoff_status IN \('approved', 'locked', 'ready_for_layer2'\)/);
  assert.match(sql, /layer1\.version\.superseded/);
  assert.match(sql, /layer1\.handoff\.superseded/);
});

test('Phase 3.1 uses controlled handoff transition RPC instead of generic admin update', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.transition_layer1_handoff_status_controlled/);
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /layer1\.handoff\.ready_for_layer2/);
  assert.match(repository, /\.rpc\('transition_layer1_handoff_status_controlled'/);
  assert.doesNotMatch(repository, /from\('layer1_handoff_objects'\)\.update\(\{ handoff_status: 'ready_for_layer2' \}\)/);
});

test('Phase 3.1 database functions validate actor role and tenant ownership', () => {
  assert.match(sql, /public\.user_has_any_org_role/);
  assert.match(sql, /ARRAY\['owner', 'admin', 'finance_admin'\]/);
  assert.match(sql, /Plan not found for organisation/);
  assert.match(sql, /Calculation run not found for organisation and plan/);
  assert.match(sql, /Approved snapshot does not match requested organisation, plan and calculation run/);
});

test('Phase 3.1 governance RPCs are server-side only', () => {
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_layer1_lock_and_handoff\(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, text\) FROM anon, authenticated/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.transition_layer1_handoff_status_controlled\(uuid, uuid, uuid, uuid, text, text\) FROM anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_layer1_lock_and_handoff\(uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, text, text\) TO service_role/);
});
