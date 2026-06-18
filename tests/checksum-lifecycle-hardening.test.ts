import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const checksumSql = readFileSync(new URL('../supabase/migrations/012_phase7_1_checksum_lifecycle_hardening.sql', import.meta.url), 'utf8');
const engineSource = readFileSync(new URL('../lib/variance/variance-engine.ts', import.meta.url), 'utf8');
const packageJson = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

test('the actuals checksum is database-derived from stored rows and submitted mismatches are rejected', () => {
  assert.match(checksumSql, /CREATE OR REPLACE FUNCTION public\.compute_actuals_checksum/);
  assert.match(checksumSql, /CREATE OR REPLACE FUNCTION public\.verify_and_store_actuals_checksum/);
  assert.match(checksumSql, /Actuals checksum mismatch: submitted % does not match the database-derived checksum %/);
  assert.match(checksumSql, /extensions\.digest\(convert_to\(canonical, 'UTF8'\), 'sha256'\)/);
  // Every actuals write path verifies and stores the database-derived value.
  for (const rpc of ['create_actuals_batch', 'update_actuals_batch_draft', 'supersede_actuals_batch']) {
    const fnIndex = checksumSql.indexOf(`CREATE OR REPLACE FUNCTION public.${rpc}(`);
    assert.ok(fnIndex >= 0, `${rpc} re-emitted in checksum hardening migration`);
    const body = checksumSql.slice(fnIndex, checksumSql.indexOf('$$;', fnIndex));
    assert.ok(body.includes('verify_and_store_actuals_checksum'), `${rpc} verifies the checksum in the database`);
  }
  // The draft-update path no longer stores a caller-supplied checksum.
  const updateBody = checksumSql.slice(
    checksumSql.indexOf('CREATE OR REPLACE FUNCTION public.update_actuals_batch_draft('),
    checksumSql.indexOf('$$;', checksumSql.indexOf('CREATE OR REPLACE FUNCTION public.update_actuals_batch_draft('))
  );
  assert.ok(!updateBody.includes("checksum = COALESCE(batch_payload->>'checksum'"), 'caller checksum is never stored');
});

test('the baseline checksum in variance is read from budget_baselines, never from the caller payload', () => {
  const fnIndex = checksumSql.indexOf('CREATE OR REPLACE FUNCTION public.create_variance_report(');
  assert.ok(fnIndex >= 0);
  const body = checksumSql.slice(fnIndex, checksumSql.indexOf('$$;', fnIndex));
  assert.ok(body.includes('target_baseline.checksum'), 'baseline checksum read from the stored baseline row');
  assert.ok(!body.includes("report_payload->>'baseline_checksum'"), 'caller-provided baseline checksum is ignored');
  assert.match(body, /Locked baseline is missing its checksum/);
});

test('the variance lock checksum is database-recomputed from stored lines and pinned inputs, and mismatches are rejected', () => {
  assert.match(checksumSql, /CREATE OR REPLACE FUNCTION public\.compute_variance_lock_checksum/);
  assert.match(checksumSql, /Variance lock checksum mismatch: submitted % does not match the database-derived checksum %/);
  const fnIndex = checksumSql.indexOf('CREATE OR REPLACE FUNCTION public.compute_variance_lock_checksum(');
  const body = checksumSql.slice(fnIndex, checksumSql.indexOf('$$;', fnIndex));
  // The DB canonical input includes every pinned artifact reference.
  for (const pin of ['comparator_lock_version_id', 'comparator_checksum', 'baseline_checksum', 'actuals_checksum', 'actuals_version_number', 'planning_period_id']) {
    assert.ok(body.includes(pin), `DB checksum input includes ${pin}`);
  }
  const lockIndex = checksumSql.indexOf('CREATE OR REPLACE FUNCTION public.lock_variance_report(');
  const lockBody = checksumSql.slice(lockIndex, checksumSql.indexOf('$$;', lockIndex));
  assert.ok(lockBody.includes('compute_variance_lock_checksum'), 'lock recomputes in the database');
  assert.ok(lockBody.includes('checksum = derived_lock_checksum'), 'the stored value is the database-derived checksum');
});

test('the server variance checksum explicitly includes the baseline checksum and actuals version', () => {
  assert.match(engineSource, /baselineChecksum: string \| null;/);
  assert.match(engineSource, /actualsVersionNumber: number;/);
  assert.match(engineSource, /\$\{pins\.baselineChecksum \?\? ''\}/);
  assert.match(engineSource, /\$\{pins\.actualsVersionNumber\}/);
});

test('invalid numeric actuals payloads are rejected at the database contract level', () => {
  assert.match(checksumSql, /jsonb_typeof\(line_item->'actual_cost'\) <> 'number'/);
  assert.match(checksumSql, /must be present JSON numbers/);
  assert.match(checksumSql, /value outside the numeric bounds of the product model/);
});

test('voided pinned input policy: variance cannot be created from voided inputs', () => {
  assert.match(checksumSql, /Variance cannot be created from a voided actuals batch/);
  assert.match(checksumSql, /Variance cannot be created from a voided forecast/);
});

test('voided pinned input policy: a draft variance cannot be locked if its pinned inputs were voided after creation', () => {
  const lockIndex = checksumSql.indexOf('CREATE OR REPLACE FUNCTION public.lock_variance_report(');
  const lockBody = checksumSql.slice(lockIndex, checksumSql.indexOf('$$;', lockIndex));
  assert.match(lockBody, /Cannot lock: the pinned actuals batch has been voided since this variance report was created/);
  assert.match(lockBody, /Cannot lock: the pinned forecast has been voided since this variance report was created/);
});

test('voided pinned input policy: locked variance reports remain readable history', () => {
  // Locked/superseded reports are protected by the Phase 7 immutability
  // triggers and the actuals/forecast FKs carry no cascade, so voiding a
  // pinned input never deletes or mutates an existing locked report.
  const phase7Sql = readFileSync(new URL('../supabase/migrations/010_phase7_actuals_variance.sql', import.meta.url), 'utf8');
  assert.match(phase7Sql, /Variance report is in a terminal state and remains readable for history only/);
  assert.doesNotMatch(phase7Sql, /variance_reports_actuals_same_org_fk[\s\S]{0,200}ON DELETE CASCADE/);
});

test('the new checksum helpers receive no client grants', () => {
  for (const signature of [
    'format_checksum_amount\\(numeric\\)',
    'compute_actuals_checksum\\(uuid, uuid\\)',
    'verify_and_store_actuals_checksum\\(uuid, uuid, text\\)',
    'compute_variance_lock_checksum\\(uuid, uuid\\)'
  ]) {
    assert.match(checksumSql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${signature} FROM PUBLIC;`));
    assert.match(checksumSql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${signature} FROM anon;`));
    assert.match(checksumSql, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${signature} FROM authenticated;`));
    assert.doesNotMatch(checksumSql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature} TO (anon|authenticated)`));
  }
});

test('re-emitted RPCs preserve their service-role guards and prior hardening', () => {
  const guardCount = (checksumSql.match(/IF auth\.role\(\) <> 'service_role' THEN/g) ?? []).length;
  assert.equal(guardCount, 5, 'all five re-emitted service RPCs keep their guards');
  // create_variance_report keeps context guard + source-of-truth validation.
  const cvrIndex = checksumSql.indexOf('CREATE OR REPLACE FUNCTION public.create_variance_report(');
  const cvrBody = checksumSql.slice(cvrIndex, checksumSql.indexOf('$$;', cvrIndex));
  assert.ok(cvrBody.includes('assert_variance_lines_consistent'));
  assert.ok(cvrBody.includes('target_reforecast.budget_baseline_id <> target_batch.baseline_id'));
  assert.ok(cvrBody.includes('PERFORM public.insert_variance_lines'));
});

test('the RLS smoke script remains environment-gated and outside the hermetic verify chain', () => {
  const smokeSource = readFileSync(new URL('../scripts/smoke-rls-phase7.mjs', import.meta.url), 'utf8');
  assert.match(smokeSource, /process\.exit\(0\)/);
  const verifyChain = JSON.parse(packageJson).scripts.verify;
  assert.ok(!verifyChain.includes('smoke-rls'));
});

test('the final hardening round stays inside the Phase 7 boundary', () => {
  const lowered = checksumSql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').toLowerCase();
  const createdObjects = lowered.match(/create (?:table|or replace function|index|trigger|policy|schema|extension)[^(\n]*/g) ?? [];
  for (const forbidden of ['waterfall', '_ai', 'ai_advisory', 'commentary', 'recommendation']) {
    for (const statement of createdObjects) {
      assert.ok(!statement.includes(forbidden), `hardening must not create ${forbidden} objects: ${statement}`);
    }
  }
});
