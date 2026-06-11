import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const isWindows = process.platform === 'win32';
const bin = (name) => join(process.cwd(), 'node_modules', '.bin', `${name}${isWindows ? '.cmd' : ''}`);
const deterministicEnv = {
  ...process.env,
  CI: process.env.CI ?? 'true',
  NEXT_TELEMETRY_DISABLED: '1',
  npm_config_audit_level: 'low',
  npm_config_fund: 'false',
  npm_config_update_notifier: 'false'
};

function run(label, command, args, options = {}) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, env: deterministicEnv, ...options });
  if (result.error) {
    console.error(`\n${label} failed to start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n${label} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

function runLocalBin(label, name, args, options = {}) {
  const command = bin(name);
  if (!existsSync(command)) {
    console.error(`${label} cannot run because ${command} does not exist. Run npm ci first.`);
    process.exit(1);
  }
  run(label, command, args, options);
}

function runCaptured(label, command, args, options = {}) {
  console.log(`\n▶ ${label}`);
  const result = spawnSync(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: false,
    timeout: 120_000,
    env: deterministicEnv,
    ...options
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    console.error(`\n${label} failed to start or finish deterministically: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`\n${label} failed with exit code ${result.status}`);
    process.exit(result.status ?? 1);
  }
}

function runNpmAudit() {
  const npmCommand = isWindows ? 'npm.cmd' : 'npm';
  runCaptured('Dependency audit', npmCommand, ['audit', '--audit-level=low']);
}

const testFiles = readdirSync(join(process.cwd(), 'tests'))
  .filter((file) => file.endsWith('.test.ts'))
  .sort()
  .map((file) => join('tests', file));

run('Unit and contract tests', process.execPath, ['--import', 'tsx', '--test', ...testFiles]);
runLocalBin('TypeScript typecheck', 'tsc', ['--noEmit']);
runLocalBin('Lint', 'eslint', ['.', '--max-warnings=0']);
console.log('\n▶ Production build');
const buildResult = spawnSync(process.execPath, ['scripts/build.mjs'], {
  encoding: 'utf8',
  shell: false,
  env: deterministicEnv,
  maxBuffer: 1024 * 1024 * 50
});
const buildOutput = `${buildResult.stdout || ''}${buildResult.stderr || ''}`;
writeFileSync(join(process.cwd(), 'build-output.log'), buildOutput);
if (buildResult.stdout) process.stdout.write(buildResult.stdout);
if (buildResult.stderr) process.stderr.write(buildResult.stderr);
if (buildResult.error) {
  console.error(`\nProduction build failed to start: ${buildResult.error.message}`);
  process.exit(1);
}
if (buildResult.status !== 0) {
  console.error(`\nProduction build failed with exit code ${buildResult.status}`);
  process.exit(buildResult.status ?? 1);
}
run('Route diagnostics', process.execPath, ['scripts/inspect-routes.mjs', '--build-output', 'build-output.log']);
runNpmAudit();
process.exit(0);
