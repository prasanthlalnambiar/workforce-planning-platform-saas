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
const repository = readFileSync(new URL('../lib/repositories/budget-baselines.ts', import.meta.url), 'utf8');

test('Phase 4 baseline schema and controlled RPCs are present', () => {
  assert.match(sql, /CREATE TABLE public\.budget_baselines/);
  assert.match(sql, /CREATE TABLE public\.budget_baseline_lines/);
  assert.match(sql, /CREATE TABLE public\.budget_baseline_snapshots/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.create_budget_baseline_draft/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.lock_budget_baseline/);
  assert.match(repository, /\.rpc\('create_budget_baseline_draft'/);
  assert.match(repository, /\.rpc\('lock_budget_baseline'/);
});

test('only ready_for_layer2 Layer 1 handoffs can create a Layer 1-sourced baseline', () => {
  assert.match(sql, /source_handoff\.handoff_status <> 'ready_for_layer2'/);
  assert.match(sql, /Only ready_for_layer2 Layer 1 handoffs can create a budget baseline/);
  assert.match(repository, /Only ready_for_layer2 handoffs can create a budget baseline/);
});

test('Layer 1 handoff import updates status through the controlled transition function', () => {
  assert.match(sql, /PERFORM public\.transition_layer1_handoff_status_controlled\([\s\S]*'imported_to_baseline'/);
  assert.match(sql, /layer1\.handoff\.imported_to_baseline/);
  assert.doesNotMatch(repository, /from\('layer1_handoff_objects'\)\.update\(\{ handoff_status: 'imported_to_baseline' \}\)/);
});

test('baseline lock enforces one active locked baseline per organisation, plan and fiscal year', () => {
  assert.match(sql, /CREATE UNIQUE INDEX budget_baselines_one_locked_per_plan_fy/);
  assert.match(sql, /A locked budget baseline already exists for this plan and fiscal year/);
});

test('baseline lock requires 12 lines and reconciled budget, labour and workload totals', () => {
  assert.match(sql, /line_count <> 12/);
  assert.match(sql, /budget_delta/);
  assert.match(sql, /labour_delta/);
  assert.match(sql, /workload_delta/);
  assert.match(sql, /Budget baseline monthly phasing does not reconcile to annual totals/);
});

test('locked baseline header, lines and snapshots have database-level immutability guards', () => {
  assert.match(sql, /protect_budget_baseline_update/);
  assert.match(sql, /Locked budget baseline header cannot be changed/);
  assert.match(sql, /protect_budget_baseline_line_update/);
  assert.match(sql, /Locked budget baseline lines cannot be edited/);
  assert.match(sql, /protect_budget_baseline_snapshot_update/);
  assert.match(sql, /Budget baseline snapshots are immutable and cannot be updated or deleted/);
});

test('budget baseline writes are not exposed as direct browser RLS policies', () => {
  assert.match(sql, /Budget baseline writes are routed through server-side services and controlled RPCs/);
  assert.doesNotMatch(sql, /CREATE POLICY budget_baselines_finance_write/);
  assert.doesNotMatch(sql, /CREATE POLICY budget_baseline_lines_finance_write/);
  assert.doesNotMatch(sql, /CREATE POLICY budget_baseline_snapshots_finance_insert/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.create_budget_baseline_draft\(uuid, uuid, jsonb, jsonb, text\) FROM anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.lock_budget_baseline\(uuid, uuid, uuid, uuid, uuid, jsonb, text, text\) TO service_role/);
});

test('baseline repository keeps business logic outside UI and blocks locked phasing edits', () => {
  assert.match(repository, /createStraightLineBaselineLines/);
  assert.match(repository, /checkBaselineReconciliation/);
  assert.match(repository, /Locked budget baseline lines cannot be edited/);
  assert.match(repository, /buildBudgetBaselineSnapshot/);
  assert.match(repository, /checksumBudgetBaselineSnapshot/);
});
