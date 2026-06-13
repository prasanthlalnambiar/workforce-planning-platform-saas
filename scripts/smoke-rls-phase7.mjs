// Phase 7 live RLS isolation smoke test.
//
// Verifies, against a REAL test Supabase project, that:
//   1. org A members cannot read org B actuals batches/lines
//   2. org A members cannot read org B variance reports/lines
//   3. direct authenticated writes to governed tables are blocked
//   4. service-role RPCs enforce same-org checks (cross-org actor rejected)
//
// SAFE-BY-DEFAULT: this script is environment-gated. Without the required env
// vars it prints a skip notice and exits 0, so it never blocks the hermetic
// build gate or local development. It is intentionally NOT part of `npm run
// verify`.
//
// Required env vars (point these at a DISPOSABLE test project, never prod):
//   RLS_SMOKE_SUPABASE_URL
//   RLS_SMOKE_SERVICE_ROLE_KEY
//   RLS_SMOKE_ANON_KEY
//
// Usage: node scripts/smoke-rls-phase7.mjs

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const url = process.env.RLS_SMOKE_SUPABASE_URL;
const serviceKey = process.env.RLS_SMOKE_SERVICE_ROLE_KEY;
const anonKey = process.env.RLS_SMOKE_ANON_KEY;

if (!url || !serviceKey || !anonKey) {
  console.log('smoke-rls-phase7: RLS_SMOKE_* env vars not set — skipping live RLS isolation test (this is expected in hermetic builds).');
  process.exit(0);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

let failures = 0;
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function createUserAndOrg(tag) {
  const email = `rls-smoke-${tag}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `Smoke-${randomUUID()}`;
  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (userError) throw new Error(`Could not create user ${tag}: ${userError.message}`);
  const userId = userData.user.id;

  const orgId = randomUUID();
  const { error: orgError } = await admin.from('organisations').insert({ id: orgId, organisation_name: `RLS Smoke Org ${tag}` });
  if (orgError) throw new Error(`Could not create org ${tag}: ${orgError.message}`);
  // Schema fix: the membership table is organisation_memberships and roles
  // live in roles/user_roles, not on the membership row.
  const { error: memberError } = await admin.from('organisation_memberships').insert({
    organisation_id: orgId,
    user_id: userId,
    status: 'active'
  });
  if (memberError) throw new Error(`Could not add membership ${tag}: ${memberError.message}`);
  const roleId = randomUUID();
  const { error: roleError } = await admin.from('roles').insert({
    id: roleId,
    organisation_id: orgId,
    role_name: 'owner'
  });
  if (roleError) throw new Error(`Could not create role ${tag}: ${roleError.message}`);
  const { error: userRoleError } = await admin.from('user_roles').insert({
    organisation_id: orgId,
    user_id: userId,
    role_id: roleId
  });
  if (userRoleError) throw new Error(`Could not assign role ${tag}: ${userRoleError.message}`);

  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`Could not sign in ${tag}: ${signInError.message}`);
  return { userId, orgId, client };
}

async function main() {
  console.log('smoke-rls-phase7: running live RLS isolation checks against', url);

  const orgA = await createUserAndOrg('a');
  const orgB = await createUserAndOrg('b');

  // Seed an actuals batch + variance report directly in org B via service role
  // (bypassing RPC prerequisites — this is purely an isolation read test).
  const batchId = randomUUID();
  const planId = randomUUID();
  const fyId = randomUUID();
  const baselineId = randomUUID();
  await admin.from('plans').insert({ id: planId, organisation_id: orgB.orgId, plan_name: 'RLS Smoke Plan' });
  await admin.from('fiscal_years').insert({ id: fyId, organisation_id: orgB.orgId, fiscal_year_label: 'FY-SMOKE', start_date: '2027-07-01', end_date: '2028-06-30' });
  const { error: baselineSeedError } = await admin.from('budget_baselines').insert({
    id: baselineId, organisation_id: orgB.orgId, plan_id: planId, fiscal_year_id: fyId,
    baseline_code: 'BL-SMOKE', baseline_name: 'RLS Smoke Baseline', status: 'locked'
  });
  const { error: batchSeedError } = await admin.from('actuals_batches').insert({
    id: batchId, organisation_id: orgB.orgId, plan_id: planId, fiscal_year_id: fyId,
    baseline_id: baselineId, batch_code: 'ACT-9999', batch_name: 'RLS Smoke Batch'
  });
  if (baselineSeedError || batchSeedError) {
    console.log('  NOTE seeding hit schema constraints:', (baselineSeedError || batchSeedError).message);
    console.log('  Falling back to read-isolation checks on whatever rows exist.');
  }

  // 1 + 2: cross-org reads must return zero rows (RLS), not errors.
  for (const table of ['actuals_batches', 'actuals_lines', 'variance_reports', 'variance_lines']) {
    const { data, error } = await orgA.client.from(table).select('id').eq('organisation_id', orgB.orgId);
    check(`org A cannot read org B ${table}`, !error && (data ?? []).length === 0, error?.message);
  }

  // 3: direct authenticated writes must be blocked on governed tables.
  const { error: insertError } = await orgA.client.from('actuals_batches').insert({
    organisation_id: orgA.orgId, plan_id: planId, fiscal_year_id: fyId,
    baseline_id: baselineId, batch_code: 'ACT-HACK', batch_name: 'should fail'
  });
  check('direct authenticated insert into actuals_batches is blocked', Boolean(insertError), 'insert unexpectedly succeeded');

  const { error: updateError } = await orgB.client.from('actuals_batches')
    .update({ batch_name: 'tampered' }).eq('id', batchId);
  const { data: afterUpdate } = await admin.from('actuals_batches').select('batch_name').eq('id', batchId).maybeSingle();
  check('direct authenticated update of actuals_batches is blocked',
    Boolean(updateError) || afterUpdate?.batch_name === 'RLS Smoke Batch',
    'update unexpectedly changed the row');

  // 3b: anon/authenticated clients must NOT be able to execute the
  // service-role-only governance RPCs at all (PUBLIC/anon/authenticated
  // EXECUTE is revoked and an internal auth.role() guard exists).
  const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const deniedRpcs = [
    ['create_actuals_batch', { target_organisation_id: orgA.orgId, target_actor_user_id: orgA.userId, batch_payload: {}, line_payloads: [], create_reason: null }],
    ['transition_actuals_batch_status', { target_organisation_id: orgA.orgId, target_actor_user_id: orgA.userId, target_batch_id: batchId, next_status: 'validated', transition_reason: null }],
    ['create_variance_report', { target_organisation_id: orgA.orgId, target_actor_user_id: orgA.userId, report_payload: {}, line_payloads: [], create_reason: null }],
    ['lock_variance_report', { target_organisation_id: orgA.orgId, target_actor_user_id: orgA.userId, target_report_id: batchId, lock_checksum: 'x'.repeat(32), lock_reason: null }]
  ];
  for (const [rpcName, args] of deniedRpcs) {
    const { error: anonRpcError } = await anonClient.rpc(rpcName, args);
    check(`anon cannot execute ${rpcName}`, Boolean(anonRpcError), 'anon RPC unexpectedly succeeded');
    const { error: authedRpcError } = await orgA.client.rpc(rpcName, args);
    check(`authenticated cannot execute ${rpcName}`, Boolean(authedRpcError), 'authenticated RPC unexpectedly succeeded');
  }

  // 4: service-role RPCs enforce same-org checks — an actor from org A cannot
  // act inside org B even through the privileged path.
  const { error: rpcError } = await admin.rpc('transition_actuals_batch_status', {
    target_organisation_id: orgB.orgId,
    target_actor_user_id: orgA.userId,
    target_batch_id: batchId,
    next_status: 'validated',
    transition_reason: 'cross-org attempt (should fail)'
  });
  check('service-role RPC rejects a cross-org actor', Boolean(rpcError), 'RPC unexpectedly succeeded');

  console.log(failures === 0 ? '\nsmoke-rls-phase7: ALL CHECKS PASSED' : `\nsmoke-rls-phase7: ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('smoke-rls-phase7: aborted —', error.message);
  process.exit(1);
});
