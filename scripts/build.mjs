import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const isWindows = process.platform === 'win32';
const nextBin = join(process.cwd(), 'node_modules', '.bin', `next${isWindows ? '.cmd' : ''}`);

if (!existsSync(nextBin)) {
  console.error(`Cannot run production build because ${nextBin} does not exist. Run npm ci first.`);
  process.exit(1);
}

process.env.NEXT_TELEMETRY_DISABLED = '1';

// Route diagnostics consume build-output.log, so this wrapper is the single
// owner of that file: Next's output is written directly to an inherited file
// descriptor. No pipes are created and the parent never reads from a live
// child stream, so the build cannot block on captured output and returns to
// the shell exactly like a plain `next build`. Standalone `npm run build` and
// `npm run verify` both execute this identical path.
const logPath = join(process.cwd(), 'build-output.log');
const logFd = openSync(logPath, 'w');

const result = spawnSync(nextBin, ['build'], {
  stdio: ['inherit', logFd, logFd],
  shell: false,
  env: process.env
});

closeSync(logFd);

try {
  process.stdout.write(readFileSync(logPath, 'utf8'));
} catch {
  // The log is diagnostic convenience; absence must not mask the build result.
}

if (result.error) {
  console.error(`Production build failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
