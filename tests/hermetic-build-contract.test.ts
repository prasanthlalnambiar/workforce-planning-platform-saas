import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const packageJson = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/quality-gate.yml', import.meta.url), 'utf8');
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

test('verify delegates to a simple shell script that runs the gates and exits explicitly, with audit kept out of verify', () => {
  const packageData = JSON.parse(packageJson);
  const scripts = packageData.scripts;
  // The package verify script delegates to a minimal bash script. `npm audit`
  // is intentionally NOT inside verify: an npm child invoked from within the
  // verify sequence was the external-runner hang. Audit still runs as its own
  // gate step (`npm audit --audit-level=low`) separately from verify. Tests run
  // last so nothing is sequenced after the test process.
  assert.equal(scripts.verify, 'bash scripts/verify.sh');
  // The Node verify wrapper must NOT exist — it was part of an earlier hang.
  assert.equal(existsSync(new URL('../scripts/verify.mjs', import.meta.url)), false);

  const verifyShell = readFileSync(new URL('../scripts/verify.sh', import.meta.url), 'utf8');
  // Strict bash so any failing step aborts the script with its own non-zero code.
  assert.match(verifyShell, /set -euo pipefail/);
  // npm audit must NOT run inside verify.
  assert.ok(!verifyShell.includes('npm audit'), 'npm audit is not run inside verify');
  // The five verify steps are present, in order: typecheck, lint, build (never
  // skipped), route diagnostics against build-output.log, tests (never skipped).
  const orderedFragments = [
    'node_modules/.bin/tsc --noEmit',
    'node_modules/.bin/eslint . --max-warnings=0',
    'node scripts/build.mjs',
    'node scripts/inspect-routes.mjs --build-output build-output.log',
    'node --import tsx --test tests/*.test.ts'
  ];
  let lastIndex = -1;
  for (const fragment of orderedFragments) {
    const index = verifyShell.indexOf(fragment);
    assert.ok(index > lastIndex, `verify step present and ordered: ${fragment}`);
    lastIndex = index;
  }
  // Tests are the final gate; nothing runs after them except the success exit.
  assert.ok(verifyShell.indexOf('node --import tsx --test') > verifyShell.indexOf('inspect-routes.mjs'), 'tests run last');
  // Build precedes route diagnostics, which consume the build output file.
  assert.ok(verifyShell.indexOf('node scripts/build.mjs') < verifyShell.indexOf('inspect-routes.mjs'), 'diagnostics run after the build');
  assert.match(verifyShell, /exit 0/, 'explicit success exit');
  // No nested `npm run build` (npm-in-npm) and no Node spawn wrapper.
  assert.ok(!verifyShell.includes('npm run build'), 'no nested npm run build');
  assert.ok(!verifyShell.includes('spawnSync'), 'no Node spawn wrapper');
});

test('the production build wrapper owns build-output.log without captured pipes', () => {
  // build.mjs writes Next's output via a file descriptor: no pipes are created
  // and no parent reads a live child stream, so the build cannot block on
  // captured output. Standalone build and verify share this single path.
  assert.match(buildScript, /build-output\.log/);
  assert.match(buildScript, /openSync\(logPath, 'w'\)/);
  assert.match(buildScript, /stdio: \['inherit', logFd, logFd\]/);
  assert.doesNotMatch(buildScript, /stdio:\s*'pipe'/);
  assert.doesNotMatch(buildScript, /encoding:\s*'utf8'/);
  assert.doesNotMatch(buildScript, /maxBuffer/);
});


test('Next internal build validation is separated from mandatory standalone gates', () => {
  assert.match(nextConfig, /typescript:\s*{\s*ignoreBuildErrors:\s*true\s*}/s);
  assert.match(nextConfig, /eslint:\s*{\s*ignoreDuringBuilds:\s*true\s*}/s);
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm run build/);
  assert.ok(workflow.indexOf('npm run typecheck') < workflow.indexOf('npm run build'));
  assert.ok(workflow.indexOf('npm run lint') < workflow.indexOf('npm run build'));
  const verifyShell = readFileSync(new URL('../scripts/verify.sh', import.meta.url), 'utf8');
  // Typecheck and lint run before the build inside verify; the standalone
  // typecheck and lint gates (run separately and in CI) remain authoritative.
  assert.ok(verifyShell.includes('node_modules/.bin/tsc --noEmit'));
  assert.ok(verifyShell.includes('node_modules/.bin/eslint . --max-warnings=0'));
  assert.ok(verifyShell.includes('node scripts/build.mjs'));
  assert.ok(verifyShell.indexOf('node_modules/.bin/tsc') < verifyShell.indexOf('node scripts/build.mjs'));
  assert.ok(verifyShell.indexOf('node_modules/.bin/eslint') < verifyShell.indexOf('node scripts/build.mjs'));
});

test('Next page-data collection uses deterministic single-lane workers', () => {
  assert.match(nextConfig, /experimental:\s*{[^}]*cpus:\s*1/s);
  assert.match(nextConfig, /experimental:\s*{[^}]*staticGenerationMaxConcurrency:\s*1/s);
  assert.match(nextConfig, /experimental:\s*{[^}]*staticGenerationMinPagesPerWorker:\s*1/s);
});
