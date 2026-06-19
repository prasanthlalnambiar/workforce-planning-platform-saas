import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = new URL('../supabase/migrations/', import.meta.url);
const PHASE7_READ_TABLES = ['actuals_batches', 'actuals_lines', 'variance_reports', 'variance_lines'];

const grantMigration = readFileSync(new URL('013_phase7_read_grant_fix.sql', MIGRATIONS), 'utf8');
const phase7Migration = readFileSync(new URL('010_phase7_actuals_variance.sql', MIGRATIONS), 'utf8');

function noComments(sql: string): string {
  return sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
}

const grantSql = noComments(grantMigration);
const phase7Sql = noComments(phase7Migration);

// 1. authenticated has SELECT on the four Phase 7 read tables.
test('013 grants SELECT on the Phase 7 read tables to authenticated', () => {
  const grantBlock = grantSql.match(/GRANT SELECT ON TABLE([\s\S]*?)TO authenticated;/i);
  assert.ok(grantBlock, 'a GRANT SELECT ... TO authenticated statement exists');
  for (const table of PHASE7_READ_TABLES) {
    assert.match(grantBlock![1], new RegExp(`public\\.${table}\\b`), `grants SELECT on ${table}`);
  }
});

// 2. authenticated does NOT get INSERT/UPDATE/DELETE on those tables.
test('013 grants no write privilege to authenticated (and re-asserts the revoke)', () => {
  // No GRANT of a write privilege to authenticated anywhere in the patch.
  assert.ok(!/GRANT[^;]*\b(INSERT|UPDATE|DELETE)\b[^;]*TO\s+authenticated/i.test(grantSql),
    'no INSERT/UPDATE/DELETE granted to authenticated');
  // And writes are explicitly revoked from anon + authenticated.
  const revokeBlock = grantSql.match(/REVOKE INSERT, UPDATE, DELETE ON([\s\S]*?)FROM anon, authenticated;/i);
  assert.ok(revokeBlock, 'writes are revoked from anon, authenticated');
  for (const table of PHASE7_READ_TABLES) {
    assert.match(revokeBlock![1], new RegExp(`public\\.${table}\\b`), `revokes writes on ${table}`);
  }
});

// 3. RLS remains enabled on those tables (013 does not disable it; 010 enabled it).
test('RLS remains enabled on the Phase 7 read tables and 013 does not touch it', () => {
  for (const table of PHASE7_READ_TABLES) {
    assert.match(phase7Sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`),
      `${table} has RLS enabled (migration 010)`);
  }
  assert.ok(!/DISABLE ROW LEVEL SECURITY/i.test(grantSql), '013 never disables RLS');
  assert.ok(!/ENABLE ROW LEVEL SECURITY/i.test(grantSql), '013 does not re-toggle RLS');
});

// 4. Tenant-scoped select policies remain in place (013 does not drop/alter them).
test('tenant-scoped select_member policies remain and 013 does not alter any policy', () => {
  for (const table of PHASE7_READ_TABLES) {
    assert.match(phase7Sql, new RegExp(`CREATE POLICY ${table}_select_member ON public\\.${table}`),
      `${table} keeps its org-scoped select policy`);
    assert.match(phase7Sql, new RegExp(`${table}_select_member[\\s\\S]*?is_org_member\\(organisation_id\\)`),
      `${table} select policy is scoped by org membership`);
  }
  assert.ok(!/CREATE POLICY|DROP POLICY|ALTER POLICY/i.test(grantSql), '013 creates/drops/alters no policy');
});

// 6. The fix adds no new tables, RPCs, or Phase 10+ modules.
test('013 adds no table, function/RPC, or Phase 10+ surface', () => {
  assert.ok(!/CREATE TABLE/i.test(grantSql), 'no new table');
  assert.ok(!/CREATE (OR REPLACE )?FUNCTION/i.test(grantSql), 'no new function/RPC');
  assert.ok(!/CREATE TRIGGER|CREATE INDEX|CREATE TYPE|CREATE SCHEMA/i.test(grantSql), 'no other new objects');
  // Only GRANT/REVOKE/NOTIFY statements are present (the intended surface).
  const statements = grantSql.split(';').map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    assert.match(stmt, /^(GRANT|REVOKE|NOTIFY)\b/i, `only grant/revoke/notify statements: got "${stmt.slice(0, 40)}"`);
  }
});

// Supporting: the patch triggers a PostgREST schema reload (so the table leaves
// the stale "not found in schema cache" state when applied manually).
test('013 triggers a PostgREST schema reload', () => {
  assert.match(grantSql, /NOTIFY pgrst, 'reload schema'/);
});

// Migration set sanity: exactly one 013, and it is the read-grant fix.
test('exactly one 013 migration exists and it is the read-grant fix', () => {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'));
  const thirteen = files.filter((f) => /^013/.test(f));
  assert.equal(thirteen.length, 1);
  assert.match(thirteen[0], /read_grant|grant/);
});

// 5. /actuals and /variance surface read failures as controlled errors, never
//    as a false empty / "not started" state. (This is why the original bug
//    showed "could not load the actuals register" rather than an empty table —
//    the fix restores access without weakening that surfacing.)
test('actuals and variance reads surface DB failures (no false empty states)', () => {
  const actualsRepo = readFileSync(new URL('../lib/repositories/actuals.ts', import.meta.url), 'utf8');
  const varianceRepo = readFileSync(new URL('../lib/repositories/variance.ts', import.meta.url), 'utf8');
  // Reads go through the error-surfacing rows() helper, which throws on a DB
  // error instead of returning [] (which would render a misleading empty list).
  assert.match(actualsRepo, /rows</, 'actuals repo uses error-surfacing rows()');
  assert.match(varianceRepo, /rows</, 'variance repo uses error-surfacing rows()');
  assert.match(actualsRepo, /from '\.\/read-result'|read-result/, 'imports the rows() helper');
});

test('actuals and variance have controlled error boundaries', () => {
  const actualsErr = readFileSync(new URL('../app/actuals/error.tsx', import.meta.url), 'utf8');
  const varianceErr = readFileSync(new URL('../app/variance/error.tsx', import.meta.url), 'utf8');
  assert.match(actualsErr, /'use client'/);
  assert.match(varianceErr, /'use client'/);
  assert.match(actualsErr, /could not load/i);
});
