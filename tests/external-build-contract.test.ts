import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nextConfig = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/quality-gate.yml', import.meta.url), 'utf8');
const verifyScript = readFileSync(new URL('../scripts/verify.mjs', import.meta.url), 'utf8');
const rootLayout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
const rootPage = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const loginPage = readFileSync(new URL('../app/login/page.tsx', import.meta.url), 'utf8');

test('external build avoids duplicate Next validation while quality gate still enforces lint and typecheck', () => {
  assert.match(nextConfig, /eslint:\s*{\s*ignoreDuringBuilds:\s*true\s*}/s);
  assert.match(nextConfig, /typescript:\s*{\s*ignoreBuildErrors:\s*true\s*}/s);
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm run build/);
  assert.match(verifyScript, /TypeScript typecheck/);
  assert.match(verifyScript, /Lint/);
  assert.match(verifyScript, /Production build/);
});

test('root, redirect and login routes are dynamic to avoid build-time auth/login execution', () => {
  for (const file of [rootLayout, rootPage, loginPage]) {
    assert.match(file, /export const dynamic = 'force-dynamic';/);
    assert.match(file, /export const runtime = 'nodejs';/);
  }
});
