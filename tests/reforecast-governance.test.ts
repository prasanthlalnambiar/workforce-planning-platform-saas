import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { hasPermission } from '../lib/permissions/permissions';
import type { RoleName } from '../types/roles';

test('reforecast permissions follow the Phase 6 governance model per role', () => {
  const expectations: Array<[RoleName, { read: boolean; create: boolean; write: boolean; submit: boolean; lock: boolean; voidIt: boolean }]> = [
    ['owner', { read: true, create: true, write: true, submit: true, lock: true, voidIt: true }],
    ['admin', { read: true, create: true, write: true, submit: true, lock: true, voidIt: true }],
    ['finance_admin', { read: true, create: true, write: true, submit: true, lock: true, voidIt: true }],
    ['planner', { read: true, create: true, write: true, submit: true, lock: false, voidIt: false }],
    ['reviewer', { read: true, create: false, write: false, submit: false, lock: false, voidIt: false }],
    ['viewer', { read: true, create: false, write: false, submit: false, lock: false, voidIt: false }],
    ['auditor', { read: true, create: false, write: false, submit: false, lock: false, voidIt: false }]
  ];
  for (const [role, expected] of expectations) {
    assert.equal(hasPermission([role], 'reforecast:read'), expected.read, `${role} reforecast:read`);
    assert.equal(hasPermission([role], 'reforecast:create'), expected.create, `${role} reforecast:create`);
    assert.equal(hasPermission([role], 'reforecast:write'), expected.write, `${role} reforecast:write`);
    assert.equal(hasPermission([role], 'reforecast:submit'), expected.submit, `${role} reforecast:submit`);
    assert.equal(hasPermission([role], 'reforecast:lock'), expected.lock, `${role} reforecast:lock`);
    assert.equal(hasPermission([role], 'reforecast:void'), expected.voidIt, `${role} reforecast:void`);
  }
});

const migrationSql = readFileSync(new URL('../supabase/migrations/009_phase6_reforecast_module.sql', import.meta.url), 'utf8');

test('Phase 6 migration scopes reforecast tables to the organisation with RLS and same-org guards', () => {
  for (const table of ['reforecasts', 'reforecast_lines', 'reforecast_driver_impacts', 'reforecast_snapshots']) {
    assert.match(migrationSql, new RegExp(`CREATE TABLE public\\.${table}[\\s\\S]*?organisation_id uuid NOT NULL`), `${table} tenant scope`);
    assert.match(migrationSql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`), `${table} RLS`);
    assert.match(migrationSql, new RegExp(`REVOKE INSERT, UPDATE, DELETE ON public\\.${table} FROM anon, authenticated;`), `${table} direct writes revoked`);
  }
  assert.match(migrationSql, /FOREIGN KEY \(organisation_id, budget_baseline_id\) REFERENCES public\.budget_baselines\(organisation_id, id\)/, 'same-org baseline guard');
  assert.match(migrationSql, /FOREIGN KEY \(organisation_id, forecast_driver_id\) REFERENCES public\.forecast_drivers\(organisation_id, id\)/, 'same-org driver guard');
  assert.match(migrationSql, /FOREIGN KEY \(organisation_id, reforecast_id\) REFERENCES public\.reforecasts\(organisation_id, id\)/, 'same-org forecast guard');
});

test('Phase 6 enforces a single current locked forecast per baseline context', () => {
  assert.match(migrationSql, /CREATE UNIQUE INDEX reforecasts_one_current_locked_per_context[\s\S]*?WHERE is_current_locked = true/);
});

test('locked reforecasts are immutable at the database level and snapshots are append-only', () => {
  assert.match(migrationSql, /Locked reforecasts are immutable/);
  assert.match(migrationSql, /terminal state and remains readable for history/);
  assert.match(migrationSql, /Reforecast detail rows are immutable once the forecast is locked/);
  assert.match(migrationSql, /Reforecast lock snapshots are append-only audit evidence/);
  assert.match(migrationSql, /BEFORE UPDATE OR DELETE ON public\.reforecasts/);
  assert.match(migrationSql, /BEFORE UPDATE OR DELETE ON public\.reforecast_lines/);
  assert.match(migrationSql, /BEFORE UPDATE OR DELETE ON public\.reforecast_driver_impacts/);
  assert.match(migrationSql, /BEFORE UPDATE OR DELETE ON public\.reforecast_snapshots/);
});

test('locking supersedes the previous current locked forecast and captures a checksummed snapshot', () => {
  assert.match(migrationSql, /is_current_locked = true[\s\S]*?AND id <> target_reforecast_id/, 'previous current locked forecast is found');
  assert.match(migrationSql, /SET status = 'superseded',\s*\n\s*is_current_locked = false,\s*\n\s*superseded_by_reforecast_id = target_reforecast_id/);
  assert.match(migrationSql, /INSERT INTO public\.reforecast_snapshots/);
  assert.match(migrationSql, /A deterministic lock checksum is required/);
  assert.match(migrationSql, /Only reforecasts in review can be locked/);
  assert.match(migrationSql, /Reforecasts can only be created from a locked budget baseline/);
  assert.match(migrationSql, /Only draft reforecasts can be recalculated/);
});

test('only approved drivers can be recorded as feeding the official forecast', () => {
  assert.match(migrationSql, /Only approved drivers can feed the official forecast/);
  assert.match(migrationSql, /driver_status_at_calculation/);
});

test('Phase 6 reforecast RPCs are service-role-only and audit every material action', () => {
  const signatures = [
    'create_reforecast\\(uuid, uuid, jsonb, jsonb, jsonb, text\\)',
    'recalculate_reforecast\\(uuid, uuid, uuid, jsonb, jsonb, jsonb, text\\)',
    'transition_reforecast_status\\(uuid, uuid, uuid, text, text\\)',
    'lock_reforecast\\(uuid, uuid, uuid, jsonb, text, text\\)'
  ];
  for (const signature of signatures) {
    assert.match(migrationSql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature} FROM anon, authenticated;`));
    assert.match(migrationSql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO service_role;`));
  }
  for (const eventName of [
    'reforecast.created',
    'reforecast.recalculated',
    'reforecast.submitted_for_review',
    'reforecast.reverted_to_draft',
    'reforecast.locked',
    'reforecast.superseded',
    'reforecast.voided',
    'reforecast.driver_inclusion_snapshot_created',
    'reforecast.lock_snapshot_created'
  ]) {
    assert.ok(migrationSql.includes(`'${eventName}'`), `audit event ${eventName} must be written by the RPC layer`);
  }
});

test('phase boundary: no waterfall, executive bridge or AI database objects (actuals/variance allowed since Phase 7)', () => {
  const allMigrations = readdirSync(new URL('../supabase/migrations', import.meta.url))
    .filter((file) => file.endsWith('.sql'))
    .map((file) => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'))
    .join('\n');
  const withoutComments = allMigrations.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').toLowerCase();
  const createdObjects = withoutComments.match(/create (?:table|or replace function|index|trigger|policy)[^(\n]*/g) ?? [];
  for (const forbidden of ['waterfall', 'executive_bridge', '_ai', 'ai_advisory']) {
    for (const statement of createdObjects) {
      assert.ok(!statement.includes(forbidden), `migrations must not create ${forbidden} objects: ${statement}`);
    }
  }
});

test('phase boundary: waterfall and AI pages remain placeholders (future phases)', () => {
  for (const file of ['app/waterfall/page.tsx', 'app/ai/page.tsx']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /PlaceholderPage/, `${file} must remain a placeholder — that module is a future phase`);
  }
});

test('the legacy /reforecast placeholder now redirects to the Phase 6 module and stays dynamic', () => {
  const source = readFileSync(new URL('../app/reforecast/page.tsx', import.meta.url), 'utf8');
  assert.match(source, /redirect\('\/reforecasts'\)/);
  assert.match(source, /export const dynamic = 'force-dynamic';/);
});
