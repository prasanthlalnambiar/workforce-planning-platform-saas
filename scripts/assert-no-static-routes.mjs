import { readFileSync } from 'node:fs';

const file = process.argv[2] || 'build-output.log';
const output = readFileSync(file, 'utf8');

if (output.includes('○')) {
  console.error('Static routes detected in production build output. This auth-gated SaaS must not emit static route rows.');
  console.error('Failing rows/context:');
  for (const line of output.split('\n')) {
    if (line.includes('○')) console.error(line);
  }
  process.exit(1);
}

for (const required of ['ƒ /', 'ƒ /_not-found', 'ƒ /login']) {
  if (!output.includes(required)) {
    console.error(`Expected dynamic route marker not found in build output: ${required}`);
    process.exit(1);
  }
}

console.log('No static route rows detected in production build output.');
