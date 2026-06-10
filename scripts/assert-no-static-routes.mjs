import { spawnSync } from 'node:child_process';

const file = process.argv[2] || 'build-output.log';
const result = spawnSync(process.execPath, ['scripts/inspect-routes.mjs', '--build-output', file], {
  stdio: 'inherit',
  shell: false
});

if (result.error) {
  console.error(`Static route guard failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
