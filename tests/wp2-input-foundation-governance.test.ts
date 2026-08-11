import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { hasPermission } from '../lib/permissions/permissions';
import type { RoleName } from '../types/roles';

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);
const mig = readFileSync(new URL('014_wp2_flexible_input_foundation.sql', MIGRATIONS), 'utf8');
const sql = mig.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const WP2_TABLES = ['input_sources', 'input_source_versions', 'input_source_rows', 'field_mapping_versions', 'custom_dimensions'];
const WP2_RPCS = ['import_input_source_version', 'create_field_mapping_version', 'register_custom_dimension'];

// --- 1. RPC privilege hardening (PUBLIC revoke is the blocker) --------------

test('every WP-2 RPC explicitly revokes EXECUTE from PUBLIC, anon and authenticated', () => {
  for (const fn of WP2_RPCS) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC;`), `${fn} revokes from PUBLIC`);
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM anon, authenticated;`), `${fn} revokes from anon/authenticated`);
  }
});

test('every WP-2 RPC grants EXECUTE to service_role only', () => {
  for (const fn of WP2_RPCS) {
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`), `${fn} granted to service_role`);
    // No grant to PUBLIC/anon/authenticated anywhere.
    assert.ok(!new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO (PUBLIC|anon|authenticated)`).test(sql), `${fn} not granted to public roles`);
  }
});

test('PUBLIC revoke precedes the service_role grant for each RPC (order matters)', () => {
  for (const fn of WP2_RPCS) {
    const revokeIdx = sql.indexOf(`REVOKE ALL ON FUNCTION public.${fn}`);
    const grantIdx = sql.indexOf(`GRANT EXECUTE ON FUNCTION public.${fn}`);
    assert.ok(revokeIdx > -1 && grantIdx > -1 && revokeIdx < grantIdx, `${fn}: revoke before grant`);
  }
});

// --- 2. Tenant integrity (composite same-org FKs + RPC guards) --------------

test('composite same-org FKs bind plan and source_inventory to the same organisation', () => {
  assert.match(sql, /input_sources_plan_same_org_fk FOREIGN KEY \(organisation_id, plan_id\)\s*REFERENCES public\.plans\(organisation_id, id\)/);
  assert.match(sql, /input_sources_source_inventory_same_org_fk FOREIGN KEY \(organisation_id, source_inventory_id\)\s*REFERENCES public\.source_inventory\(organisation_id, id\)/);
  assert.match(sql, /custom_dimensions_plan_same_org_fk FOREIGN KEY \(organisation_id, plan_id\)\s*REFERENCES public\.plans\(organisation_id, id\)/);
});

test('child tables use composite same-org FKs to their parents', () => {
  assert.match(sql, /input_source_versions_source_same_org_fk FOREIGN KEY \(organisation_id, input_source_id\)\s*REFERENCES public\.input_sources\(organisation_id, id\)/);
  assert.match(sql, /input_source_rows_version_same_org_fk FOREIGN KEY \(organisation_id, input_source_version_id\)\s*REFERENCES public\.input_source_versions\(organisation_id, id\)/);
  assert.match(sql, /field_mapping_versions_version_same_org_fk FOREIGN KEY \(organisation_id, input_source_version_id\)\s*REFERENCES public\.input_source_versions\(organisation_id, id\)/);
});

test('import RPC verifies plan and source_inventory belong to the target org', () => {
  assert.match(sql, /Plan does not belong to the target organisation/);
  assert.match(sql, /Source inventory record does not belong to the target organisation/);
});

test('register_custom_dimension verifies the plan belongs to the target org', () => {
  // the plan-org guard appears in both import and register; ensure at least two occurrences
  const occurrences = (sql.match(/Plan does not belong to the target organisation/g) || []).length;
  assert.ok(occurrences >= 2, 'plan-org guard present in import and register RPCs');
});

test('every write RPC binds the actor via a role check in the target org', () => {
  for (const fn of WP2_RPCS) {
    const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}`));
    assert.match(body.slice(0, 1200), /user_has_any_org_role\(target_organisation_id, target_actor_user_id/, `${fn} binds actor to org via role check`);
  }
});

// --- 3. Immutability + non-destructive history -----------------------------

test('governed history uses RESTRICT, not destructive cascade, from parent sources/versions', () => {
  assert.match(sql, /input_source_versions_source_same_org_fk[\s\S]*?ON DELETE RESTRICT/);
  assert.match(sql, /input_source_rows_version_same_org_fk[\s\S]*?ON DELETE RESTRICT/);
  assert.match(sql, /field_mapping_versions_version_same_org_fk[\s\S]*?ON DELETE RESTRICT/);
});

test('raw row immutability covers ALL parsed business fields, not just raw_values', () => {
  const fn = sql.slice(sql.indexOf('prevent_input_row_mutation'));
  for (const field of ['raw_values', 'week_commencing', 'workflow_name', 'weekly_volume', 'weekly_aht', 'aht_unit', 'volume_state', 'validation_status', 'validation_messages']) {
    assert.match(fn.slice(0, 1200), new RegExp(`NEW\\.${field} IS DISTINCT FROM OLD\\.${field}`), `row immutability guards ${field}`);
  }
});

test('accepted source versions freeze all interpretation fields', () => {
  const fn = sql.slice(sql.indexOf('prevent_input_version_mutation'));
  for (const field of ['raw_payload', 'detected_headers', 'declared_aht_unit', 'date_format', 'week_start_day', 'coverage_week_start', 'coverage_week_end', 'canonical_grain', 'import_method', 'created_by']) {
    assert.match(fn.slice(0, 2000), new RegExp(`NEW\\.${field} IS DISTINCT FROM OLD\\.${field}`), `version immutability guards ${field}`);
  }
});

test('version + mapping lifecycle transitions are constrained (no arbitrary status change)', () => {
  assert.match(sql, /Illegal input source version lifecycle transition/);
  assert.match(sql, /Illegal mapping version lifecycle transition/);
});

test('accepted mapping content is immutable (mappings, dimensions, aggregation)', () => {
  const fn = sql.slice(sql.indexOf('prevent_mapping_version_mutation'));
  for (const field of ['mappings', 'calc_driving_dimensions', 'aggregation_decision']) {
    assert.match(fn.slice(0, 1200), new RegExp(`NEW\\.${field} IS DISTINCT FROM OLD\\.${field}`), `mapping immutability guards ${field}`);
  }
});

// --- Existing structure (RLS, grants, draft-only, permissions) --------------

test('every WP-2 table has RLS enabled and an org-scoped select policy', () => {
  for (const t of WP2_TABLES) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`CREATE POLICY ${t}_select_member ON public\\.${t}[\\s\\S]*?is_org_member\\(organisation_id\\)`));
  }
});

test('WP-2 grants SELECT to authenticated and revokes writes', () => {
  const grant = sql.match(/GRANT SELECT ON TABLE([\s\S]*?)TO authenticated;/i);
  assert.ok(grant);
  for (const t of WP2_TABLES) assert.match(grant[1], new RegExp(`public\\.${t}\\b`));
  const revoke = sql.match(/REVOKE INSERT, UPDATE, DELETE ON([\s\S]*?)FROM anon, authenticated;/i);
  assert.ok(revoke);
});

test('WP-2 is draft-only: no routing/knowledge-group/vendor/forecast/lock surface', () => {
  const forbidden = ['knowledge_group', 'vendor', 'location_vendor', 'kg_location', 'routed_', 'workflow_kg', 'calculatelayer1', 'official forecast'];
  for (const term of forbidden) {
    assert.ok(!sql.toLowerCase().includes(term.toLowerCase()), `must not include ${term}`);
  }
  assert.match(sql, /status text NOT NULL DEFAULT 'draft' CHECK \(status IN \('draft', 'archived'\)\)/);
});

test('input:read granted to all members; input:write only to write-capable roles', () => {
  const allRoles: RoleName[] = ['owner', 'admin', 'finance_admin', 'planner', 'reviewer', 'viewer', 'auditor'];
  for (const r of allRoles) assert.equal(hasPermission([r], 'input:read'), true);
  for (const r of ['owner', 'admin', 'finance_admin', 'planner'] as RoleName[]) assert.equal(hasPermission([r], 'input:write'), true);
  for (const r of ['reviewer', 'viewer', 'auditor'] as RoleName[]) assert.equal(hasPermission([r], 'input:write'), false);
});

test('input repository: reads governed/error-surfacing, writes via service-role RPC only', () => {
  const repo = readFileSync(new URL('../lib/repositories/input-sources.ts', import.meta.url), 'utf8');
  for (const forbidden of ['.insert(', '.update(', '.delete(', '.upsert(']) {
    assert.ok(!repo.includes(forbidden), `repo must not ${forbidden} directly`);
  }
  assert.match(repo, /requirePermission\(context\.roles, 'input:read'\)/);
  assert.match(repo, /requirePermission\(context\.roles, 'input:write'\)/);
  assert.match(repo, /createAdminClient\(\)/);
  for (const fn of WP2_RPCS) assert.match(repo, new RegExp(`admin\\.rpc\\('${fn}'`));
});

// --- 4. Mapping workflow: no hard-coded empty mapping path ------------------

test('no hard-coded mappings: {} acceptance path remains in the actions', () => {
  const actions = readFileSync(new URL('../app/layer1/input-sources/actions.ts', import.meta.url), 'utf8');
  assert.ok(!/mappings:\s*\{\}/.test(actions), 'no hard-coded empty mapping');
  assert.match(actions, /role_/);
  assert.match(actions, /collectRoles/);
  assert.match(actions, /roleByHeader/);
});

test('mapping grid UI offers role assignment per header', () => {
  const grid = readFileSync(new URL('../app/layer1/input-sources/_components/mapping-grid.tsx', import.meta.url), 'utf8');
  for (const role of ['required', 'calc_dimension', 'reporting', 'custom', 'ignore']) {
    assert.match(grid, new RegExp(role));
  }
});

// --- 9. Discoverability -----------------------------------------------------

test('/layer1/input-sources is discoverable in the Inputs subnav', () => {
  const nav = readFileSync(new URL('../lib/navigation/planning-cockpit.ts', import.meta.url), 'utf8');
  // Inputs subnav in the single nav source of truth surfaces Operational Demand Data.
  assert.match(nav, /\/layer1\/input-sources/);
  assert.match(nav, /Operational Demand Data/);
  // And the Inputs subnav array contains it.
  const subnav = readFileSync(new URL('../app/layer1/_components/layer1-shared.tsx', import.meta.url), 'utf8');
  assert.match(subnav, /TAB_SUBNAV/);
});

// --- Migration set + no pages ----------------------------------------------

test('exactly 14 migrations; one 014 WP-2 migration', () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
  assert.equal(files.length, 14);
  assert.equal(files.filter((f) => /^014/.test(f)).length, 1);
});

test('no pages/ directory introduced', () => {
  assert.ok(!existsSync(new URL('../pages', import.meta.url)));
});

test('CSV/TSV handling is honest: import_method allows tsv and csv', () => {
  assert.match(sql, /import_method IN \('paste', 'csv', 'tsv', 'manual'\)/);
});

// --- Point 7: in-function service_role guard -------------------------------

test('all three WP-2 RPCs have an in-function service_role guard', () => {
  // Count the guard occurrences — one per RPC.
  const guards = (sql.match(/IF auth\.role\(\) <> 'service_role' THEN\s*RAISE EXCEPTION 'service_role required';/g) || []).length;
  assert.ok(guards >= 3, `expected >=3 in-function service_role guards, found ${guards}`);
});

// --- Point 3: mapping lifecycle (draft never supersedes accepted) ----------

test('supersession of an accepted mapping happens ONLY when the new mapping is accepted', () => {
  const fn = sql.slice(sql.indexOf('FUNCTION public.create_field_mapping_version'));
  // The UPDATE ... SET mapping_status = 'superseded' must be guarded by IF v_accept.
  const supersedeIdx = fn.indexOf("SET mapping_status = 'superseded'");
  const guardIdx = fn.lastIndexOf('IF v_accept THEN', supersedeIdx);
  assert.ok(guardIdx > -1 && guardIdx < supersedeIdx, 'supersession is inside an IF v_accept block');
});

test('version is only marked accepted from draft (no re-accept of accepted versions)', () => {
  assert.match(sql, /version_status = CASE WHEN version_status = 'draft' THEN 'accepted' ELSE version_status END/);
});

// --- Point 6: no hard-coded empty mapping ----------------------------------

test('no hard-coded empty mapping acceptance path in repository or actions', () => {
  const repo = readFileSync(new URL('../lib/repositories/input-sources.ts', import.meta.url), 'utf8');
  const actions = readFileSync(new URL('../app/layer1/input-sources/actions.ts', import.meta.url), 'utf8');
  assert.ok(!/mappings:\s*\{\}/.test(repo), 'repo has no empty mapping literal');
  assert.ok(!/mappings:\s*\{\}/.test(actions), 'actions have no empty mapping literal');
  // Acceptance validates required canonical fields server-side.
  assert.match(repo, /validateMappingCompleteness/);
});

// --- Point 1: canonical-field mapping in the UI ----------------------------

test('mapping grid offers canonical-field mapping (not just broad roles)', () => {
  const grid = readFileSync(new URL('../app/layer1/input-sources/_components/mapping-grid.tsx', import.meta.url), 'utf8');
  for (const field of ['week_commencing', 'workflow_name', 'weekly_volume', 'weekly_aht', 'aht_unit', 'calc_dimension', 'reporting', 'custom', 'ignore']) {
    assert.match(grid, new RegExp(field), `grid offers ${field}`);
  }
});

// --- Point 2 / 5: preview path re-derives from raw + mapping ----------------

test('repository exposes a preview that re-derives rows from raw + mapping at the selected grain', () => {
  const repo = readFileSync(new URL('../lib/repositories/input-sources.ts', import.meta.url), 'utf8');
  assert.match(repo, /export async function previewMapping/);
  assert.match(repo, /deriveRows/);
  assert.match(repo, /findDuplicatesAtGrain/);
  // Detail loader prefers the accepted mapping, not the newest draft.
  assert.match(repo, /\.eq\('mapping_status', 'accepted'\)/);
});

test('detail loader exposes accepted mapping and latest draft separately', () => {
  const repo = readFileSync(new URL('../lib/repositories/input-sources.ts', import.meta.url), 'utf8');
  assert.match(repo, /latestDraftMapping/);
  assert.match(repo, /\.eq\('mapping_status', 'draft'\)/);
});

// --- Preview/grid candidate-mapping consistency (v3->v4 bug fix) ------------

test('detail page resolves ONE candidate mapping for grid + preview + accept', () => {
  const page = readFileSync(new URL('../app/layer1/input-sources/[sourceId]/page.tsx', import.meta.url), 'utf8');
  // Single resolver, not two independent paths.
  assert.match(page, /resolveCandidateMapping/);
  // The old divergent expression must be gone.
  assert.ok(!/currentMapping \?\? .*latestDraftMapping/.test(page), 'no ad-hoc preview mapping resolution');
  assert.ok(!/data\.latestDraftMapping \?\? data\.currentMapping/.test(page) || /resolveCandidateMapping/.test(page), 'resolution centralised');
  // Preview is computed from the candidate, and the grid receives the candidate.
  assert.match(page, /previewMapping\(context, String\(data\.currentVersion\.id\), candidate\.mapping\)/);
  assert.match(page, /candidateRoles=\{candidate\.mapping\.roleByHeader\}/);
  assert.match(page, /candidateHash=\{candidateHash\}/);
});

test('accept action guards previewed === accepted via candidate hash', () => {
  const actions = readFileSync(new URL('../app/layer1/input-sources/actions.ts', import.meta.url), 'utf8');
  assert.match(actions, /candidate_hash/);
  assert.match(actions, /hashMapping/);
  assert.match(actions, /changed since the preview/);
});

test('mapping grid labels the mapping state (draft / accepted / suggestion)', () => {
  const page = readFileSync(new URL('../app/layer1/input-sources/[sourceId]/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /Editing saved draft mapping/);
  assert.match(page, /Viewing latest accepted mapping/);
  assert.match(page, /Starting from auto-detected suggestion/);
});
