import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const guardedFiles = [
  'lib/supabase/admin.ts',
  'lib/audit/audit-service.ts',
  'lib/repositories/onboarding.ts'
];

test('sensitive server-only modules are guarded', () => {
  for (const file of guardedFiles) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /^import 'server-only';/m, `${file} must import server-only`);
  }
});

test('middleware does not import Supabase client packages into Edge runtime', () => {
  const source = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /@supabase\/ssr|@supabase\/supabase-js|lib\/supabase/);
});
