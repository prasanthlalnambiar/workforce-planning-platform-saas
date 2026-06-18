import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const build = readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
const nextConfig = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8');

test('build wrapper disables Next telemetry', () => {
  assert.match(build, /NEXT_TELEMETRY_DISABLED\s*=\s*'1'/);
});

test('build wrapper prints an explicit BUILD_RETURNED:<status> marker', () => {
  assert.match(build, /BUILD_RETURNED:\$\{status\}/);
});

test('build wrapper does not depend on the trace step returning (has a done-marker + bounded waits)', () => {
  // It must detect functional completion and cap how long it waits, so a hung
  // "Collecting build traces" step cannot make the build hang indefinitely.
  assert.match(build, /server-rendered on demand/, 'watches for the route-table completion marker');
  assert.match(build, /GRACE_MS/, 'has a bounded grace window after completion');
  assert.match(build, /HARD_CEILING_MS/, 'has an absolute hard ceiling');
  assert.match(build, /child\.kill\(/, 'can terminate an overrunning trace step');
});

test('build wrapper still owns build-output.log so route diagnostics can read it', () => {
  assert.match(build, /build-output\.log/);
});

test('next.config.mjs contains no invalid outputFileTracing boolean key', () => {
  // Next 15.5 has no top-level `outputFileTracing` boolean; setting it produces
  // an "Invalid next.config.mjs options" warning and does nothing.
  assert.ok(!/outputFileTracing\s*:/.test(nextConfig), 'no invalid outputFileTracing:<bool> key');
});

test('next.config.mjs keeps the valid output-tracing root/excludes', () => {
  assert.match(nextConfig, /outputFileTracingRoot/);
  assert.match(nextConfig, /outputFileTracingExcludes/);
});
