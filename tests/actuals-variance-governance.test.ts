import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { hasPermission } from '../lib/permissions/permissions';
import type { RoleName } from '../types/roles';

test('actuals permissions follow the Phase 7 governance model per role', () => {
  const expectations: Array<[RoleName, { create: boolean; validate: boolean; post: boolean; supersede: boolean; voidIt: boolean }]> = [
    ['owner', { create: true, validate: true, post: true, supersede: true, voidIt: true }],
    ['admin', { create: true, validate: true, post: true, supersede: true, voidIt: true }],
    ['finance_admin', { create: true, validate: true, post: true, supersede: true, voidIt: true }],
    ['planner', { create: true, validate: true, post: false, supersede: false, voidIt: false }],
    ['reviewer', { create: false, validate: false, post: false, supersede: false, voidIt: false }],
    ['viewer', { create: false, validate: false, post: false, supersede: false, voidIt: false }],
    ['auditor', { create: false, validate: false, post: false, supersede: false, voidIt: false }]
  ];
  for (const [role, expected] of expectations) {
    assert.equal(hasPermission([role], 'actuals:read'), true, `${role} actuals:read (all roles can read)`);
    assert.equal(hasPermission([role], 'actuals:create'), expected.create, `${role} actuals:create`);
    assert.equal(hasPermission([role], 'actuals:validate'), expected.validate, `${role} actuals:validate`);
    assert.equal(hasPermission([role], 'actuals:post'), expected.post, `${role} actuals:post`);
    assert.equal(hasPermission([role], 'actuals:supersede'), expected.supersede, `${role} actuals:supersede`);
    assert.equal(hasPermission([role], 'actuals:void'), expected.voidIt, `${role} actuals:void`);
  }
});

test('variance permissions follow the Phase 7 governance model per role', () => {
  const expectations: Array<[RoleName, { create: boolean; write: boolean; lock: boolean; voidIt: boolean }]> = [
    ['owner', { create: true, write: true, lock: true, voidIt: true }],
    ['admin', { create: true, write: true, lock: true, voidIt: true }],
    ['finance_admin', { create: true, write: true, lock: true, voidIt: true }],
    ['planner', { create: true, write: true, lock: false, voidIt: false }],
    ['reviewer', { create: false, write: false, lock: false, voidIt: false }],
    ['viewer', { create: false, write: false, lock: false, voidIt: false }],
    ['auditor', { create: false, write: false, lock: false, voidIt: false }]
  ];
  for (const [role, expected] of expectations) {
    assert.equal(hasPermission([role], 'variance:read'), true, `${role} variance:read (all roles can read)`);
    assert.equal(hasPermission([role], 'variance:create'), expected.create, `${role} variance:create`);
    assert.equal(hasPermission([role], 'variance:write'), expected.write, `${role} variance:write`);
    assert.equal(hasPermission([role], 'variance:lock'), expected.lock, `${role} variance:lock`);
    assert.equal(hasPermission([role], 'variance:void'), expected.voidIt, `${role} variance:void`);
  }
});

const migrationSql = readFileSync(new URL('../supabase/migrations/010_phase7_actuals_variance.sql', import.meta.url), 'utf8');

test('Phase 7 migration scopes actuals and variance tables to the organisation with RLS and same-org guards', () => {
  for (const table of ['actuals_batches', 'actuals_lines', 'variance_reports', 'variance_lines']) {
    assert.match(migrationSql, new RegExp(`CREATE TABLE public\\.${table}[\\s\\S]*?organisation_id uuid NOT NULL`), `${table} tenant scope`);
    assert.match(migrationSql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`), `${table} RLS`);
    assert.match(migrationSql, new RegExp(`REVOKE INSERT, UPDATE, DELETE ON public\\.${table} FROM anon, authenticated;`), `${table} direct writes revoked`);
  }
  assert.match(migrationSql, /FOREIGN KEY \(organisation_id, planning_period_id\) REFERENCES public\.planning_periods\(organisation_id, id\)/, 'same-org period guard');
  assert.match(migrationSql, /FOREIGN KEY \(organisation_id, actuals_batch_id\) REFERENCES public\.actuals_batches\(organisation_id, id\)/, 'same-org batch guard');
  assert.match(migrationSql, /FOREIGN KEY \(organisation_id, reforecast_id\) REFERENCES public\.reforecasts\(organisation_id, id\)/, 'same-org forecast guard');
});

test('actuals rows must map to existing planning periods and duplicates are rejected at the database level', () => {
  assert.match(migrationSql, /UNIQUE \(organisation_id, actuals_batch_id, planning_period_id\)/, 'duplicate period rows blocked by unique constraint');
  assert.match(migrationSql, /period does not exist for this organisation within the baseline horizon/);
  assert.match(migrationSql, /duplicate planning period in batch/);
  assert.match(migrationSql, /Actuals can only be loaded against a locked budget baseline/);
});

test('posted actuals are immutable and corrections are versioned supersessions', () => {
  assert.match(migrationSql, /Posted actuals are immutable\. Corrections must create a new superseding batch version\./);
  assert.match(migrationSql, /Actuals rows are immutable once the batch is posted/);
  assert.match(migrationSql, /Only posted actuals batches can be superseded by a correction/);
  assert.match(migrationSql, /version_number \+ 1/, 'correction increments the version');
  assert.match(migrationSql, /supersedes_batch_id/, 'correction lineage recorded');
  assert.match(migrationSql, /Only draft actuals batches can be edited/);
  assert.match(migrationSql, /BEFORE UPDATE OR DELETE ON public\.actuals_batches/);
  assert.match(migrationSql, /BEFORE UPDATE OR DELETE ON public\.actuals_lines/);
});

test('variance is pinned to a locked forecast version and checksum at creation', () => {
  assert.match(migrationSql, /comparator_lock_version_id text NOT NULL/);
  assert.match(migrationSql, /comparator_checksum text NOT NULL/);
  assert.match(migrationSql, /actuals_checksum text NOT NULL/);
  assert.match(migrationSql, /Variance must compare against a locked forecast version/);
  assert.match(migrationSql, /Variance comparator must carry a lock version and checksum/);
  assert.match(migrationSql, /Variance can only be calculated from posted actuals/);
});

test('locked variance reports are immutable and supersession is the only path to a new current report', () => {
  assert.match(migrationSql, /Locked variance reports are immutable/);
  assert.match(migrationSql, /CREATE UNIQUE INDEX variance_reports_one_current_locked_per_context[\s\S]*?WHERE is_current_locked = true/);
  assert.match(migrationSql, /Only draft variance reports can be recalculated/);
  assert.match(migrationSql, /Only draft variance reports can be locked/);
  assert.match(migrationSql, /A deterministic lock checksum is required to lock a variance report/);
  assert.match(migrationSql, /BEFORE UPDATE OR DELETE ON public\.variance_reports/);
  assert.match(migrationSql, /BEFORE UPDATE OR DELETE ON public\.variance_lines/);
});

test('Phase 7 RPCs are service-role-only and audit every material action', () => {
  const signatures = [
    'create_actuals_batch\\(uuid, uuid, jsonb, jsonb, text\\)',
    'update_actuals_batch_draft\\(uuid, uuid, uuid, jsonb, jsonb, text\\)',
    'transition_actuals_batch_status\\(uuid, uuid, uuid, text, text\\)',
    'supersede_actuals_batch\\(uuid, uuid, uuid, jsonb, jsonb, text\\)',
    'create_variance_report\\(uuid, uuid, jsonb, jsonb, text\\)',
    'recalculate_variance_report\\(uuid, uuid, uuid, jsonb, text\\)',
    'lock_variance_report\\(uuid, uuid, uuid, text, text\\)',
    'void_variance_report\\(uuid, uuid, uuid, text\\)'
  ];
  for (const signature of signatures) {
    assert.match(migrationSql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature} FROM anon, authenticated;`));
    assert.match(migrationSql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO service_role;`));
  }
  for (const eventName of [
    'actuals.batch_created',
    'actuals.batch_updated',
    'actuals.batch_validated',
    'actuals.batch_reverted_to_draft',
    'actuals.batch_posted',
    'actuals.batch_superseded',
    'actuals.correction_batch_posted',
    'actuals.batch_voided',
    'variance.report_created',
    'variance.report_recalculated',
    'variance.report_locked',
    'variance.report_superseded',
    'variance.report_voided'
  ]) {
    assert.ok(migrationSql.includes(`'${eventName}'`), `audit event ${eventName} must be written by the RPC layer`);
  }
});

test('the live RLS isolation smoke script exists and is environment-gated, not part of the build gate', () => {
  const scriptUrl = new URL('../scripts/smoke-rls-phase7.mjs', import.meta.url);
  assert.equal(existsSync(scriptUrl), true);
  const script = readFileSync(scriptUrl, 'utf8');
  assert.match(script, /SUPABASE_URL/);
  assert.match(script, /SERVICE_ROLE/);
  assert.match(script, /process\.exit\(0\)/, 'script exits cleanly when env vars are absent');
  const packageJson = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const verifyChain = JSON.parse(packageJson).scripts.verify;
  assert.ok(!verifyChain.includes('smoke-rls'), 'live RLS smoke test never blocks the hermetic gate');
});

test('phase boundary: Phase 7 migration adds no waterfall/AI database objects', () => {
  const lowered = migrationSql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').toLowerCase();
  const createdObjects = lowered.match(/create (?:table|or replace function|index|trigger|policy)[^(\n]*/g) ?? [];
  for (const forbidden of ['waterfall', 'executive_bridge', '_ai', 'ai_advisory', 'commentary']) {
    for (const statement of createdObjects) {
      assert.ok(!statement.includes(forbidden), `Phase 7 migration must not create ${forbidden} objects: ${statement}`);
    }
  }
});
