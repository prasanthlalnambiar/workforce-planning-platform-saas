import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { hasPermission } from '../lib/permissions/permissions';
import type { RoleName } from '../types/roles';

const repoSource = readFileSync(new URL('../lib/repositories/waterfall.ts', import.meta.url), 'utf8');
const engineSource = readFileSync(new URL('../lib/waterfall/waterfall-engine.ts', import.meta.url), 'utf8');
const registerPage = readFileSync(new URL('../app/waterfall/page.tsx', import.meta.url), 'utf8');
const detailPage = readFileSync(new URL('../app/waterfall/[varianceReportId]/page.tsx', import.meta.url), 'utf8');

test('the waterfall reads only LOCKED upstream records, never draft/unlocked objects', () => {
  // Baseline: locked. Forecast: locked/superseded (a superseded report was locked).
  // Actuals: posted. Variance anchor: locked/superseded only.
  assert.match(repoSource, /from\('budget_baselines'\)[\s\S]*?\.eq\('status', 'locked'\)/);
  assert.match(repoSource, /from\('reforecasts'\)[\s\S]*?\.in\('status', \['locked', 'superseded'\]\)/);
  assert.match(repoSource, /from\('actuals_batches'\)[\s\S]*?\.eq\('status', 'posted'\)/);
  assert.match(repoSource, /from\('variance_reports'\)[\s\S]*?\.in\('status', \['locked', 'superseded'\]\)/);
  // The detail loader rejects any anchor that is not locked/superseded.
  assert.match(repoSource, /\['locked', 'superseded'\]\.includes\(text\(report\.status\)\)/);
});

test('approved drivers only: the bridge consumes category impacts captured in the locked forecast lines', () => {
  // Category impacts come from reforecast_lines (the locked forecast), which by
  // construction contain only APPROVED driver impacts — proposed (scenario)
  // drivers never enter a locked reforecast. The engine reads those columns and
  // invents nothing.
  for (const column of ['growth_cost_impact', 'efficiency_cost_impact', 'cost_change_cost_impact', 'supply_change_cost_impact', 'management_adjustment_cost_impact']) {
    assert.ok(repoSource.includes(column), `bridge reads ${column} from the locked forecast line`);
  }
  // The bridge BUILDER does not read any driver lifecycle status: it consumes
  // only the numeric category-impact columns finalised in the locked forecast.
  // (The separate validatePinnedSources function does check upstream statuses —
  // that is the governance gate, not the calculation.)
  const builderStart = engineSource.indexOf('export function buildWaterfallBridge');
  const builderEnd = engineSource.indexOf('export type WaterfallReadiness');
  const builderBody = engineSource.slice(builderStart, builderEnd);
  assert.ok(!builderBody.includes('status'), 'the bridge builder reads no status field — only locked numeric inputs');
  assert.ok(!builderBody.includes('proposed'), 'the bridge builder never references proposed drivers');
});

test('the waterfall is read-only: the module contains no writes, RPCs, or mutations of upstream records', () => {
  for (const source of [repoSource, engineSource]) {
    assert.ok(!source.includes('.insert('), 'no inserts');
    assert.ok(!source.includes('.update('), 'no updates');
    assert.ok(!source.includes('.delete('), 'no deletes');
    assert.ok(!source.includes('.rpc('), 'no RPC calls');
    assert.ok(!source.includes('createAdminClient'), 'no service-role admin client');
  }
});

test('Phase 8 adds no migration and no waterfall database objects', () => {
  // Read-only architecture: no 013 migration, and migrations 010-012 are untouched
  // (asserted structurally by the absence of any waterfall object in the SQL).
  const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
  const files = readdirSync(migrationsDir);
  assert.ok(!files.some((f) => /013/.test(f)), 'no 013 migration was added');
  for (const file of files) {
    const sql = readFileSync(new URL(file, migrationsDir), 'utf8')
      .split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').toLowerCase();
    const created = sql.match(/create (?:table|or replace function|index|trigger|policy)[^(\n]*/g) ?? [];
    for (const statement of created) {
      assert.ok(!statement.includes('waterfall'), `${file} must not create waterfall objects: ${statement}`);
    }
  }
});

test('waterfall permissions: every role that can read variance can read the waterfall', () => {
  const roles: RoleName[] = ['owner', 'admin', 'finance_admin', 'planner', 'reviewer', 'viewer', 'auditor'];
  for (const role of roles) {
    // All these roles have variance:read in the accepted model, so all get waterfall:read.
    assert.equal(hasPermission([role], 'waterfall:read'), true, `${role} can read the waterfall`);
  }
});

test('the waterfall page renders controlled states for every missing locked source', () => {
  // Register page delegates to ControlledState when not ready; the shared
  // component covers all five readiness states.
  assert.match(registerPage, /readiness !== 'ready'/);
  assert.match(registerPage, /ControlledState/);
  const shared = readFileSync(new URL('../app/waterfall/_components/waterfall-shared.tsx', import.meta.url), 'utf8');
  for (const state of ['no_locked_baseline', 'no_locked_forecast', 'no_posted_actuals', 'no_locked_variance', 'incomplete_inputs']) {
    assert.ok(shared.includes(state), `controlled state handles ${state}`);
  }
});

test('the waterfall routes are dynamic and the detail page anchors to a variance report id', () => {
  assert.match(registerPage, /export const dynamic = 'force-dynamic';/);
  assert.match(detailPage, /export const dynamic = 'force-dynamic';/);
  assert.ok(existsSync(new URL('../app/waterfall/[varianceReportId]/page.tsx', import.meta.url)));
});

test('the waterfall answers the four commercial questions in its UI copy', () => {
  assert.match(detailPage, /What changed from budget to forecast/);
  assert.match(detailPage, /From forecast to actuals/);
  assert.match(detailPage, /By driver category/);
  assert.match(detailPage, /Which months are causing the variance/);
});

test('Phase 8 stays inside the boundary: the waterfall engine and repository contain no AI/model surface', () => {
  // The deterministic waterfall layer itself must remain free of any AI/model
  // surface. (The waterfall DETAIL page may render the read-only Phase 9
  // advisory panel, which is governed separately.)
  for (const source of [repoSource, engineSource]) {
    for (const forbidden of ['ai_advisory', 'openai', 'anthropic', 'llm', 'gpt']) {
      assert.ok(!source.toLowerCase().includes(forbidden), `Phase 8 core must not include ${forbidden}`);
    }
  }
  // The AI page is now a real Phase 9 advisory module, no longer a placeholder.
  const aiPage = readFileSync(new URL('../app/ai/page.tsx', import.meta.url), 'utf8');
  assert.ok(!aiPage.includes('PlaceholderPage'), 'the AI page is a Phase 9 module');
  assert.match(aiPage, /source of truth/);
});

test('waterfall reads are routed through rows()/maybe(): DB errors surface, not swallowed into empty states', () => {
  // The repository must use the same error-surfacing helper as actuals/variance,
  // and must NOT coalesce raw query results with `?? []` / `?? null`, which would
  // turn a database/RLS/schema failure into a false empty state.
  assert.match(repoSource, /import \{ maybe, rows \} from '\.\/read-result'/);
  assert.ok(!/\.data \?\? \[\]/.test(repoSource), 'no raw ".data ?? []" coalescing remains');
  assert.ok(!/\.data \?\? null/.test(repoSource), 'no raw ".data ?? null" coalescing remains');
  // Every Supabase read in the repo is wrapped.
  const wrappedCount = (repoSource.match(/(rows|maybe)<JsonRecord>\(/g) ?? []).length;
  assert.ok(wrappedCount >= 12, `expected all reads wrapped in rows()/maybe(), saw ${wrappedCount}`);
});

test('the waterfall module has a controlled error boundary', () => {
  const errorBoundary = new URL('../app/waterfall/error.tsx', import.meta.url);
  assert.ok(existsSync(errorBoundary), 'app/waterfall/error.tsx exists');
  const source = readFileSync(errorBoundary, 'utf8');
  assert.match(source, /'use client'/);
  assert.match(source, /controlled module error/i);
  assert.match(source, /reset\(\)/);
});

test('the read-result helper surfaces DB errors as a ModuleDataError rather than an empty state', () => {
  // read-result.ts is a server-only module (cannot be imported into the test
  // runtime), so assert its error-surfacing contract structurally: it throws on
  // any read error and only returns data when error is null.
  const readResultSource = readFileSync(new URL('../lib/repositories/read-result.ts', import.meta.url), 'utf8');
  assert.match(readResultSource, /export class ModuleDataError/);
  assert.match(readResultSource, /if \(result\.error\) describe\(label, result\.error\)/);
  // rows() and maybe() both guard on error before returning.
  const rowsFn = readResultSource.slice(readResultSource.indexOf('export function rows'), readResultSource.indexOf('export function maybe'));
  assert.match(rowsFn, /if \(result\.error\) describe/);
  const maybeFn = readResultSource.slice(readResultSource.indexOf('export function maybe'));
  assert.match(maybeFn, /if \(result\.error\) describe/);
  // The undefined-table / undefined-function codes (an unmigrated DB) are hinted.
  assert.match(readResultSource, /42P01|42883/);
});

test('the detail loader enforces upstream governed statuses via validatePinnedSources', () => {
  // The repo passes live statuses into validatePinnedSources and returns the
  // inconsistent state when any check fails.
  assert.match(repoSource, /validatePinnedSources\(/);
  assert.match(repoSource, /baselineStatus: textOrNull\(baseline\?\.status\)/);
  assert.match(repoSource, /reforecastStatus: textOrNull\(reforecast\?\.status\)/);
  assert.match(repoSource, /actualsStatus: textOrNull\(actualsBatch\?\.status\)/);
  assert.match(repoSource, /varianceStatus: textOrNull\(report\.status\)/);
  assert.match(repoSource, /readiness: 'inconsistent_pinned_sources'/);
});

test('the detail loader validates pinned lock-version/checksum/version consistency', () => {
  // All five pin fields are passed from both the variance report and the live
  // upstream records into the validator.
  assert.match(repoSource, /comparatorLockVersionId: textOrNull\(report\.comparator_lock_version_id\)/);
  assert.match(repoSource, /reforecastLockVersionId: textOrNull\(reforecast\?\.lock_version_id\)/);
  assert.match(repoSource, /actualsChecksum: textOrNull\(report\.actuals_checksum\)/);
  assert.match(repoSource, /actualsBatchChecksum: textOrNull\(actualsBatch\?\.checksum\)/);
  assert.match(repoSource, /actualsVersionNumber: numOrNull\(report\.actuals_version_number\)/);
  assert.match(repoSource, /actualsBatchVersionNumber: numOrNull\(actualsBatch\?\.version_number\)/);
  assert.match(repoSource, /baselineChecksum: textOrNull\(report\.baseline_checksum\)/);
  assert.match(repoSource, /budgetBaselineChecksum: textOrNull\(baseline\?\.checksum\)/);
});

test('the inconsistent-pinned-sources controlled state is rendered with its issues', () => {
  const shared = readFileSync(new URL('../app/waterfall/_components/waterfall-shared.tsx', import.meta.url), 'utf8');
  assert.ok(shared.includes('inconsistent_pinned_sources'), 'shared component handles the inconsistent state');
  assert.match(shared, /issues\?: string\[\]/);
  assert.match(detailPage, /issues=\{data\.pinnedSourceIssues\}/);
});
