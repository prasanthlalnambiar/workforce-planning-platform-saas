import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageJson = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/quality-gate.yml', import.meta.url), 'utf8');
const verifyScript = readFileSync(new URL('../scripts/verify.mjs', import.meta.url), 'utf8');
const buildScript = readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
const inspectRoutesScript = readFileSync(new URL('../scripts/inspect-routes.mjs', import.meta.url), 'utf8');
const nextConfig = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8');

test('Pages Router remains disabled for the App Router SaaS build', () => {
  assert.equal(existsSync(new URL('../pages', import.meta.url)), false);
});

test('production build uses the hermetic Node wrapper and disables Next telemetry', () => {
  assert.match(packageJson, /"build":\s*"node scripts\/build\.mjs"/);
  assert.match(buildScript, /NEXT_TELEMETRY_DISABLED\s*=\s*'1'/);
  assert.match(buildScript, /\['build'\]/);
});

test('route diagnostic script checks source and route-table static risk robustly', () => {
  assert.match(packageJson, /"inspect:routes":\s*"node scripts\/inspect-routes\.mjs"/);
  assert.match(packageJson, /"inspect":\s*"node scripts\/inspect-routes\.mjs"/);
  assert.match(inspectRoutesScript, /root layout dynamic/);
  assert.match(inspectRoutesScript, /static-risk routes/);
  assert.match(inspectRoutesScript, /build static rows/);
  assert.match(inspectRoutesScript, /required dynamic routes missing/);
  assert.match(inspectRoutesScript, /\/login/);
  assert.match(inspectRoutesScript, /\/_not-found/);
});

test('CI captures build output and uses route diagnostics instead of a naive legend grep', () => {
  assert.match(workflow, /tee build-output\.log/);
  assert.match(workflow, /npm run inspect:routes -- --build-output build-output\.log/);
  assert.doesNotMatch(workflow, /grep -q "○"/);
});

test('local verification also checks build output through route diagnostics', () => {
  assert.match(verifyScript, /build-output\.log/);
  assert.match(verifyScript, /scripts\/build\.mjs/);
  assert.match(verifyScript, /scripts\/inspect-routes\.mjs/);
});


test('Next internal build validation is separated from mandatory standalone gates', () => {
  assert.match(nextConfig, /typescript:\s*{\s*ignoreBuildErrors:\s*true\s*}/s);
  assert.match(nextConfig, /eslint:\s*{\s*ignoreDuringBuilds:\s*true\s*}/s);
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm run build/);
  assert.ok(workflow.indexOf('npm run typecheck') < workflow.indexOf('npm run build'));
  assert.ok(workflow.indexOf('npm run lint') < workflow.indexOf('npm run build'));
  assert.match(verifyScript, /TypeScript typecheck/);
  assert.match(verifyScript, /Lint/);
  assert.match(verifyScript, /Production build/);
  assert.ok(verifyScript.indexOf('TypeScript typecheck') < verifyScript.indexOf('Production build'));
  assert.ok(verifyScript.indexOf('Lint') < verifyScript.indexOf('Production build'));
});

test('Next page-data collection uses deterministic single-lane workers', () => {
  assert.match(nextConfig, /experimental:\s*{[^}]*cpus:\s*1/s);
  assert.match(nextConfig, /experimental:\s*{[^}]*staticGenerationMaxConcurrency:\s*1/s);
  assert.match(nextConfig, /experimental:\s*{[^}]*staticGenerationMinPagesPerWorker:\s*1/s);
});
