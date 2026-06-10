import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const sensitivePatterns = [
  ['requireUserContext', /requireUserContext/],
  ['createClient', /createClient/],
  ['createAdminClient', /createAdminClient/],
  ['Supabase import', /supabase/i],
  ['cookies()', /cookies\s*\(/],
  ['headers()', /headers\s*\(/],
  ['redirect()', /redirect\s*\(/],
  ['server repository import', /lib\/repositories|\.\.\/\.\.\/lib\/repositories|\.\.\/lib\/repositories/]
];

function walk(dir, predicate, results = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (!['node_modules', '.next', '.git'].includes(entry)) walk(full, predicate, results);
    } else if (predicate(full)) {
      results.push(full);
    }
  }
  return results;
}

function readMaybe(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function routeFromFile(file) {
  const rel = relative(root, file).split(sep).join('/');
  return rel
    .replace(/^app\//, '/')
    .replace(/^pages\//, '/')
    .replace(/\/(page|route|layout|not-found|global-error)\.(tsx|ts|jsx|js)$/, '')
    .replace(/\.(tsx|ts|jsx|js)$/, '')
    .replace(/\/index$/, '') || '/';
}

const files = [
  ...walk(join(root, 'app'), (file) => /\/(page|layout|route|not-found|global-error)\.(tsx|ts|jsx|js)$/.test(file)),
  ...walk(join(root, 'pages'), (file) => /\.(tsx|ts|jsx|js)$/.test(file))
].sort();

console.log('Route build-safety inspection');
console.log('=============================');

for (const file of files) {
  const source = readMaybe(file);
  const dynamic = /export const dynamic\s*=\s*['"]([^'"]+)['"]/.exec(source)?.[1] ?? '';
  const runtime = /export const runtime\s*=\s*['"]([^'"]+)['"]/.exec(source)?.[1] ?? '';
  const hasGetInitialProps = /getInitialProps\s*=/.test(source);
  const sensitive = sensitivePatterns.filter(([, pattern]) => pattern.test(source)).map(([label]) => label);
  const maybeStatic = file.includes('/app/') && /page\.(tsx|ts|jsx|js)$/.test(file) && dynamic !== 'force-dynamic';

  console.log(JSON.stringify({
    file: relative(root, file),
    route: routeFromFile(file),
    dynamic: dynamic || null,
    runtime: runtime || null,
    hasGetInitialProps,
    maybeStatic,
    sensitive
  }));
}
