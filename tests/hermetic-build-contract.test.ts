import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageJson = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/quality-gate.yml', import.meta.url), 'utf8');
const verifyScript = readFileSync(new URL('../scripts/verify.mjs', import.meta.url), 'utf8');
const staticRouteGuard = readFileSync(new URL('../scripts/assert-no-static-routes.mjs', import.meta.url), 'utf8');

test('Pages Router remains disabled for the App Router SaaS build', () => {
  assert.equal(existsSync(new URL('../pages', import.meta.url)), false);
});

test('production build disables Next telemetry', () => {
  assert.match(packageJson, /"build":\s*"NEXT_TELEMETRY_DISABLED=1 next build"/);
});

test('CI captures build output and fails if static route rows appear', () => {
  assert.match(workflow, /tee build-output\.log/);
  assert.match(workflow, /grep -q "○" build-output\.log/);
  assert.match(workflow, /Static routes detected/);
});

test('local verification also checks build output for static route rows', () => {
  assert.match(verifyScript, /build-output\.log/);
  assert.match(verifyScript, /assert-no-static-routes\.mjs/);
  assert.match(staticRouteGuard, /output\.includes\('○'\)/);
  assert.match(staticRouteGuard, /ƒ \/_not-found/);
  assert.match(staticRouteGuard, /ƒ \/login/);
});
