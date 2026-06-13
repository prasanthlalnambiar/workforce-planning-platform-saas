import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const hardeningSql = readFileSync(new URL('../supabase/migrations/011_phase7_1_governance_uat_hardening.sql', import.meta.url), 'utf8');
const sessionSource = readFileSync(new URL('../lib/auth/session.ts', import.meta.url), 'utf8');
const smokeSource = readFileSync(new URL('../scripts/smoke-rls-phase7.mjs', import.meta.url), 'utf8');
const actualsRepoSource = readFileSync(new URL('../lib/repositories/actuals.ts', import.meta.url), 'utf8');

const serviceOnlyRpcSignatures = [
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
  'lock_reforecast\\(uuid, uuid, uuid, jsonb, text, text\\)',
  'create_actuals_batch\\(uuid, uuid, jsonb, jsonb, text\\)',
  'update_actuals_batch_draft\\(uuid, uuid, uuid, jsonb, jsonb, text\\)',
  'transition_actuals_batch_status\\(uuid, uuid, uuid, text, text\\)',
  'supersede_actuals_batch\\(uuid, uuid, uuid, jsonb, jsonb, text\\)',
  'create_variance_report\\(uuid, uuid, jsonb, jsonb, text\\)',
  'recalculate_variance_report\\(uuid, uuid, uuid, jsonb, text\\)',
  'lock_variance_report\\(uuid, uuid, uuid, text, text\\)',
  'void_variance_report\\(uuid, uuid, uuid, text\\)'
];

const internalHelperSignatures = [
  'user_has_any_org_role\\(uuid, uuid, text\\[\\]\\)',
  'assert_actuals_lines_valid\\(uuid, uuid, jsonb\\)',
  'assert_forecast_driver_lines_reconcile\\(numeric, jsonb\\)',
  'assert_reforecast_lines_consistent\\(jsonb\\)',
  'insert_actuals_lines\\(uuid, record, jsonb\\)',
  'insert_forecast_driver_lines\\(uuid, record, jsonb\\)',
  'insert_reforecast_driver_impacts\\(uuid, record, jsonb\\)',
  'insert_reforecast_lines\\(uuid, record, jsonb\\)',
  'derive_planning_period\\(uuid, uuid, uuid\\)',
  'assert_variance_lines_consistent\\(uuid, uuid, uuid, uuid, uuid, jsonb\\)',
  'insert_variance_lines\\(uuid, record, jsonb\\)'
];

test('every service-role-only RPC has PUBLIC, anon and authenticated execute revoked and service_role granted', () => {
  for (const signature of serviceOnlyRpcSignatures) {
    assert.match(hardeningSql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${signature} FROM PUBLIC;`), `${signature} PUBLIC revoke`);
    assert.match(hardeningSql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${signature} FROM anon;`), `${signature} anon revoke`);
    assert.match(hardeningSql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${signature} FROM authenticated;`), `${signature} authenticated revoke`);
    assert.match(hardeningSql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO service_role;`), `${signature} service_role grant`);
  }
});

test('internal helper functions are revoked from PUBLIC/anon/authenticated and receive no client grants', () => {
  for (const signature of internalHelperSignatures) {
    assert.match(hardeningSql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${signature} FROM PUBLIC;`), `${signature} PUBLIC revoke`);
    assert.match(hardeningSql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${signature} FROM anon;`), `${signature} anon revoke`);
    assert.match(hardeningSql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${signature} FROM authenticated;`), `${signature} authenticated revoke`);
    assert.doesNotMatch(hardeningSql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO (anon|authenticated)`), `${signature} no client grant`);
  }
});

test('every service-role-only RPC carries an internal auth.role() service-role guard', () => {
  const guardCount = (hardeningSql.match(/IF auth\.role\(\) <> 'service_role' THEN/g) ?? []).length;
  assert.equal(guardCount, serviceOnlyRpcSignatures.length, 'one guard per service-only RPC');
  assert.match(hardeningSql, /RAISE EXCEPTION 'This RPC may only be executed by the service role';/);
  // Every re-emitted service RPC body in this migration contains the guard.
  for (const name of [
    'create_layer1_lock_and_handoff', 'create_budget_baseline_draft', 'lock_budget_baseline',
    'create_forecast_driver', 'supersede_forecast_driver', 'create_reforecast', 'lock_reforecast',
    'create_actuals_batch', 'supersede_actuals_batch', 'create_variance_report', 'lock_variance_report'
  ]) {
    const fnIndex = hardeningSql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    assert.ok(fnIndex >= 0, `${name} re-emitted in hardening migration`);
    const bodyEnd = hardeningSql.indexOf('$$;', fnIndex);
    const body = hardeningSql.slice(fnIndex, bodyEnd);
    assert.ok(body.includes("auth.role() <> 'service_role'"), `${name} contains the service-role guard`);
  }
});

test('the intentionally user-callable layer1 RPCs lose the PUBLIC grant but keep authenticated', () => {
  assert.match(hardeningSql, /REVOKE EXECUTE ON FUNCTION public\.transition_layer1_handoff_status\(uuid, uuid, text\) FROM PUBLIC;/);
  assert.match(hardeningSql, /GRANT EXECUTE ON FUNCTION public\.transition_layer1_handoff_status\(uuid, uuid, text\) TO authenticated;/);
  assert.match(hardeningSql, /REVOKE EXECUTE ON FUNCTION public\.transition_layer1_version_lock_status\(uuid, uuid, text, text\) FROM PUBLIC;/);
  assert.match(hardeningSql, /GRANT EXECUTE ON FUNCTION public\.transition_layer1_version_lock_status\(uuid, uuid, text, text\) TO authenticated;/);
});

test('the ambiguous Supabase role embed is fixed with the explicit FK constraint', () => {
  assert.match(sessionSource, /roles!user_roles_role_same_org_fk\(role_name\)/, 'explicit FK embed used');
  assert.ok(!sessionSource.includes(".select('roles(role_name)')"), 'no ambiguous roles(role_name) embed remains');
});

test('session/context query errors are surfaced, never silently swallowed', () => {
  assert.match(sessionSource, /profileError/);
  assert.match(sessionSource, /membershipError/);
  assert.match(sessionSource, /roleError/);
  assert.match(sessionSource, /Auth context error: failed to load profile/);
  assert.match(sessionSource, /Auth context error: failed to load organisation membership/);
  assert.match(sessionSource, /Auth context error: failed to load roles/);
  // A failed role query must throw before any role list is derived.
  assert.ok(sessionSource.indexOf('throw new Error(`Auth context error: failed to load roles') < sessionSource.indexOf('const roles = (userRoles ?? [])'));
});

test('create_actuals_batch enforces forecast/baseline context in the database', () => {
  assert.match(hardeningSql, /context_reforecast\.budget_baseline_id <> target_baseline\.id/);
  assert.match(hardeningSql, /Forecast context must belong to the same baseline, plan and fiscal year as the actuals batch/);
  assert.match(hardeningSql, /Forecast context must be a locked forecast version/);
  // ...and the server repository pre-validates with the same rule.
  assert.match(actualsRepoSource, /Forecast context must belong to the same baseline, plan and fiscal year/);
});

test('create_variance_report enforces actuals/forecast baseline context in the database', () => {
  assert.match(hardeningSql, /target_reforecast\.budget_baseline_id <> target_batch\.baseline_id/);
  assert.match(hardeningSql, /target_reforecast\.plan_id <> target_batch\.plan_id/);
  assert.match(hardeningSql, /target_reforecast\.fiscal_year_id <> target_batch\.fiscal_year_id/);
  assert.match(hardeningSql, /actuals batch and forecast must belong to the same baseline, plan and fiscal year/);
});

test('period metadata is derived from planning_periods, never trusted from payloads', () => {
  assert.match(hardeningSql, /CREATE OR REPLACE FUNCTION public\.derive_planning_period/);
  assert.match(hardeningSql, /Planning period does not belong to this organisation and fiscal-year context/);
  // The hardened insert helpers consume derived values...
  for (const helper of ['insert_actuals_lines', 'insert_variance_lines']) {
    const fnIndex = hardeningSql.indexOf(`CREATE OR REPLACE FUNCTION public.${helper}(`);
    assert.ok(fnIndex >= 0, `${helper} re-emitted`);
    const body = hardeningSql.slice(fnIndex, hardeningSql.indexOf('$$;', fnIndex));
    assert.ok(body.includes('derive_planning_period'), `${helper} derives period metadata`);
    assert.ok(!body.includes("(line_item->>'period_number')"), `${helper} ignores caller period_number`);
    assert.ok(!body.includes("(line_item->>'period_start')"), `${helper} ignores caller period_start`);
    assert.ok(!body.includes("(line_item->>'period_end')"), `${helper} ignores caller period_end`);
  }
  // ...and the variance RPCs route inserts through the derived-period helper.
  for (const rpc of ['create_variance_report', 'recalculate_variance_report']) {
    const fnIndex = hardeningSql.indexOf(`CREATE OR REPLACE FUNCTION public.${rpc}(`);
    const body = hardeningSql.slice(fnIndex, hardeningSql.indexOf('$$;', fnIndex));
    assert.ok(body.includes('PERFORM public.insert_variance_lines'), `${rpc} uses the hardened insert helper`);
    assert.ok(!body.includes('INSERT INTO public.variance_lines'), `${rpc} has no inline trusted insert`);
  }
});

test('variance line payloads are validated against source-of-truth rows in the database', () => {
  assert.match(hardeningSql, /CREATE OR REPLACE FUNCTION public\.assert_variance_lines_consistent/);
  assert.match(hardeningSql, /actual values do not match the posted actuals line/);
  assert.match(hardeningSql, /forecast values do not match the pinned reforecast line/);
  assert.match(hardeningSql, /baseline values do not match the locked baseline line/);
  assert.match(hardeningSql, /variance does not equal actual minus comparator/);
  assert.match(hardeningSql, /percentage must be null for a zero forecast comparator/);
  assert.match(hardeningSql, /payload covers % periods but the posted actuals batch covers %/);
  for (const rpc of ['create_variance_report', 'recalculate_variance_report']) {
    const fnIndex = hardeningSql.indexOf(`CREATE OR REPLACE FUNCTION public.${rpc}(`);
    const body = hardeningSql.slice(fnIndex, hardeningSql.indexOf('$$;', fnIndex));
    assert.ok(body.includes('PERFORM public.assert_variance_lines_consistent'), `${rpc} validates lines against source of truth`);
  }
});

test('checksum treatment is honest: server-computed checksums are accepted only after DB source-of-truth validation', () => {
  // The database validates every line row against stored source data before
  // accepting a checksum; full DB-native checksum recomputation is documented
  // as future hardening and is NOT claimed.
  assert.ok(!hardeningSql.toLowerCase().includes('database-verified checksum'));
  assert.match(hardeningSql, /This protects the database\s*\n-- even if the server payload is wrong or tampered with\./);
});

test('the live RLS smoke script uses the correct schema and covers RPC denial', () => {
  assert.ok(!smokeSource.includes("from('organisation_members')"), 'wrong table name removed');
  assert.match(smokeSource, /from\('organisation_memberships'\)/);
  assert.match(smokeSource, /from\('user_roles'\)/, 'roles assigned through user_roles');
  for (const rpc of ['create_actuals_batch', 'transition_actuals_batch_status', 'create_variance_report', 'lock_variance_report']) {
    assert.ok(smokeSource.includes(`'${rpc}'`), `smoke covers ${rpc} denial`);
  }
  assert.match(smokeSource, /anon cannot execute/);
  assert.match(smokeSource, /authenticated cannot execute/);
  assert.match(smokeSource, /process\.exit\(0\)/, 'still environment-gated');
});

test('the hardening patch stays inside the Phase 7 boundary', () => {
  const lowered = hardeningSql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').toLowerCase();
  const createdObjects = lowered.match(/create (?:table|or replace function|index|trigger|policy)[^(\n]*/g) ?? [];
  for (const forbidden of ['waterfall', '_ai', 'ai_advisory', 'commentary', 'recommendation']) {
    for (const statement of createdObjects) {
      assert.ok(!statement.includes(forbidden), `hardening patch must not create ${forbidden} objects: ${statement}`);
    }
  }
});
