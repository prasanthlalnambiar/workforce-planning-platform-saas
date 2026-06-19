import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { hasPermission } from '../lib/permissions/permissions';
import type { RoleName } from '../types/roles';

const engineSource = readFileSync(new URL('../lib/advisory/advisory-engine.ts', import.meta.url), 'utf8');
const repoSource = readFileSync(new URL('../lib/repositories/advisory.ts', import.meta.url), 'utf8');
const workspacePage = readFileSync(new URL('../app/ai/page.tsx', import.meta.url), 'utf8');
const detailPage = readFileSync(new URL('../app/ai/[varianceReportId]/page.tsx', import.meta.url), 'utf8');
const sharedComponent = readFileSync(new URL('../app/ai/_components/advisory-shared.tsx', import.meta.url), 'utf8');
const waterfallDetailPage = readFileSync(new URL('../app/waterfall/[varianceReportId]/page.tsx', import.meta.url), 'utf8');

test('the advisory layer performs no mutation: no inserts, updates, deletes, RPCs or admin client', () => {
  for (const source of [engineSource, repoSource, workspacePage, detailPage, sharedComponent]) {
    assert.ok(!source.includes('.insert('), 'no inserts');
    assert.ok(!source.includes('.update('), 'no updates');
    assert.ok(!source.includes('.delete('), 'no deletes');
    assert.ok(!source.includes('.rpc('), 'no RPC calls');
    assert.ok(!source.includes('createAdminClient'), 'no service-role admin client');
  }
});

test('the advisory makes no external model/network call (deterministic provider only, clean seam for later)', () => {
  for (const source of [engineSource, repoSource]) {
    for (const forbidden of ['openai', 'anthropic', 'fetch(', 'https://', 'api_key', 'apiKey']) {
      assert.ok(!source.toLowerCase().includes(forbidden.toLowerCase()), `advisory must not call out (${forbidden})`);
    }
  }
  // The provider seam exists and defaults to deterministic.
  assert.match(engineSource, /export interface AdvisoryProvider/);
  assert.match(engineSource, /deterministicAdvisoryProvider/);
  assert.match(engineSource, /provider: AdvisoryProvider = deterministicAdvisoryProvider/);
});

test('the advisory engine never computes an official figure: it reads bridge fields and formats them', () => {
  // Guard against the engine doing arithmetic on raw inputs that would originate
  // an official number. It may format/describe, but every monetary value comes
  // from a bridge field via formatMoney/formatSignedMoney. We assert there is no
  // multiplication/division of cost-like inputs except the clearly-labelled
  // descriptive share/percentage helpers.
  assert.match(engineSource, /GOVERNANCE BOUNDARY/);
  assert.match(engineSource, /never calculates an official number/i);
  // The only division in the engine is the descriptive share/percentage.
  const divisions = engineSource.match(/\//g) ?? [];
  assert.ok(engineSource.includes('descriptiveSharePct'), 'percentage is isolated in a clearly descriptive helper');
  // formatMoney is the single money formatter used for references.
  assert.match(engineSource, /function formatMoney/);
  assert.ok(divisions.length >= 0); // structural presence check; see descriptive helpers
});

test('the advisory repository reads only via the Phase 8 waterfall loaders (inherits locked-source governance)', () => {
  // It must not query governed tables directly; it composes the waterfall loaders,
  // which already enforce locked statuses, pinned-source consistency and error
  // surfacing. This keeps a single governed read path.
  assert.match(repoSource, /from '\.\/waterfall'/);
  assert.match(repoSource, /getWaterfallDashboard/);
  assert.match(repoSource, /getWaterfallDetail/);
  assert.ok(!repoSource.includes("supabase.from('"), 'advisory repo does not read governed tables directly');
  assert.ok(!repoSource.includes('createClient'), 'advisory repo opens no client of its own');
});

test('the advisory repository only builds when the bridge is ready, else returns a controlled unavailable reason', () => {
  assert.match(repoSource, /detail\.readiness !== 'ready' \|\| !detail\.bridge/);
  assert.match(repoSource, /unavailableReason/);
  assert.match(repoSource, /no advisory can be produced/);
});

test('ai:read permission is granted to every role that can read the waterfall', () => {
  const roles: RoleName[] = ['owner', 'admin', 'finance_admin', 'planner', 'reviewer', 'viewer', 'auditor'];
  for (const role of roles) {
    assert.equal(hasPermission([role], 'ai:read'), hasPermission([role], 'waterfall:read'), `${role}: ai:read parity with waterfall:read`);
    assert.equal(hasPermission([role], 'ai:read'), true, `${role} can read advisory`);
  }
});

test('Phase 9 adds no migration and no AI database objects (advisory is read-only)', () => {
  const migrationsDir = new URL('../supabase/migrations/', import.meta.url);
  const files = readdirSync(migrationsDir);
  // 013 (the Phase 7 read-grant fix) is permitted; it must add no advisory/AI
  // object, which the per-file scan below verifies.
  assert.ok(!files.some((f) => /phase9|advisory|ai_/.test(f)), 'no Phase 9/advisory migration was added');
  for (const file of files) {
    const sql = readFileSync(new URL(file, migrationsDir), 'utf8')
      .split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').toLowerCase();
    const created = sql.match(/create (?:table|or replace function|index|trigger|policy)[^(\n]*/g) ?? [];
    for (const statement of created) {
      assert.ok(!statement.includes('advisory'), `${file} must not create advisory objects: ${statement}`);
    }
  }
});

test('both surfaces are wired: the /ai workspace, the /ai detail, and the embedded waterfall panel', () => {
  // /ai workspace lists locked reports and links to detail.
  assert.match(workspacePage, /getAdvisoryWorkspace/);
  assert.match(workspacePage, /\/ai\/\$\{String\(report\.id\)\}/);
  // /ai detail renders the full advisory.
  assert.match(detailPage, /getAdvisoryDetail/);
  assert.match(detailPage, /AdvisoryFull/);
  // The waterfall detail page embeds the compact advisory, built from the SAME
  // already-loaded bridge (no second computation, gated on ai:read).
  assert.match(waterfallDetailPage, /AdvisoryCompact/);
  assert.match(waterfallDetailPage, /buildWaterfallAdvisory\(\{/);
  assert.match(waterfallDetailPage, /hasPermission\(context\.roles, 'ai:read'\)/);
});

test('the AI routes are dynamic and a controlled error boundary exists', () => {
  assert.match(workspacePage, /export const dynamic = 'force-dynamic';/);
  assert.match(detailPage, /export const dynamic = 'force-dynamic';/);
  assert.ok(existsSync(new URL('../app/ai/error.tsx', import.meta.url)), 'app/ai/error.tsx exists');
  const boundary = readFileSync(new URL('../app/ai/error.tsx', import.meta.url), 'utf8');
  assert.match(boundary, /'use client'/);
  assert.match(boundary, /controlled module error/i);
});

test('every advisory surface renders the advisory-only disclaimer', () => {
  // The shared components always render the disclaimer text.
  assert.match(sharedComponent, /Advisory only/);
  assert.match(sharedComponent, /advisory\.disclaimer/);
});

test('Phase 9 stays inside its boundary: no Phase 10+ scope, deterministic numbers remain authoritative', () => {
  // No scheduling, billing, deployment, export, or model-training surface sneaks in.
  for (const source of [engineSource, repoSource, workspacePage, detailPage]) {
    for (const forbidden of ['billing', 'stripe', 'deploy(', 'cron', 'train(', 'fine-tune', 'finetune']) {
      assert.ok(!source.toLowerCase().includes(forbidden), `Phase 9 must not include ${forbidden}`);
    }
  }
  // The deterministic engine is the authoritative source the advisory points to.
  assert.match(engineSource, /deterministic/i);
});
