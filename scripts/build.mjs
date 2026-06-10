import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const isWindows = process.platform === 'win32';
const nextBin = join(process.cwd(), 'node_modules', '.bin', `next${isWindows ? '.cmd' : ''}`);

if (!existsSync(nextBin)) {
  console.error(`Cannot run production build because ${nextBin} does not exist. Run npm ci first.`);
  process.exit(1);
}

process.env.NEXT_TELEMETRY_DISABLED = '1';

const result = spawnSync(nextBin, ['build'], {
  stdio: 'inherit',
  shell: false,
  env: process.env
});

if (result.error) {
  console.error(`Production build failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
