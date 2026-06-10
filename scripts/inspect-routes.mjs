import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);
const buildOutputArgIndex = args.indexOf('--build-output');
const buildOutputFile = buildOutputArgIndex >= 0 ? args[buildOutputArgIndex + 1] : undefined;

const appDir = join(root, 'app');
const pagesDir = join(root, 'pages');
const routeFiles = [];
const importGraphCache = new Map();

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walk(path);
      continue;
    }
    if (/\/(page|route)\.(ts|tsx|js|jsx)$/.test(path) || /\/not-found\.(ts|tsx|js|jsx)$/.test(path)) {
      routeFiles.push(path);
    }
  }
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function hasDynamicExport(source) {
  return /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(source);
}

function runtimeExport(source) {
  const match = source.match(/export\s+const\s+runtime\s*=\s*['"]([^'"]+)['"]/);
  return match?.[1] ?? '';
}

function toRoute(path) {
  const rel = relative(appDir, path).replace(/\\/g, '/');
  if (rel === 'page.tsx' || rel === 'page.ts' || rel === 'page.jsx' || rel === 'page.js') return '/';
  if (/^not-found\.(ts|tsx|js|jsx)$/.test(rel)) return '/_not-found';
  return `/${dirname(rel)}`.replace(/\/\.$/, '').replace(/\/page$|\/route$/, '').replace(/\/\(.*?\)/g, '') || '/';
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
  const base = specifier.startsWith('@/') ? join(root, specifier.slice(2)) : join(dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    join(base, 'index.js'),
    join(base, 'index.jsx')
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function importedFiles(file, seen = new Set()) {
  if (seen.has(file)) return [];
  seen.add(file);
  if (importGraphCache.has(file)) return importGraphCache.get(file);

  const source = read(file);
  const imports = [];
  const importRegex = /(?:import|export)\s+(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(source))) {
    const resolved = resolveImport(file, match[1]);
    if (resolved) imports.push(resolved, ...importedFiles(resolved, seen));
  }

  const unique = [...new Set(imports)];
  importGraphCache.set(file, unique);
  return unique;
}

function touchesFor(file) {
  const files = [file, ...importedFiles(file)];
  const aggregate = files.map((candidate) => read(candidate)).join('\n');
  const paths = files.map((candidate) => relative(root, candidate).replace(/\\/g, '/'));
  return {
    requireUserContext: /requireUserContext/.test(aggregate),
    redirect: /\bredirect\s*\(/.test(aggregate),
    cookies: /\bcookies\s*\(/.test(aggregate),
    headers: /\bheaders\s*\(/.test(aggregate),
    supabase: paths.some((path) => path.includes('lib/supabase/')) || /@supabase\//.test(aggregate),
    repositories: paths.some((path) => path.includes('lib/repositories/'))
  };
}

function parseBuildOutput(file) {
  if (!file) return { checked: false, staticRows: [], dynamicRoutes: new Set() };
  const output = read(file);
  const routeRows = output.split('\n').filter((line) => /^[├┌└]\s+[○●ƒ]\s+\//.test(line.trim()));
  const staticRows = routeRows.filter((line) => /^[├┌└]\s+○\s+\//.test(line.trim()));
  const dynamicRoutes = new Set();
  for (const row of routeRows) {
    const match = row.trim().match(/^[├┌└]\s+ƒ\s+(\S+)/);
    if (match) dynamicRoutes.add(match[1]);
  }
  return { checked: true, routeRows, staticRows, dynamicRoutes };
}

if (!existsSync(appDir)) {
  console.error('Route diagnostics failed: app/ directory does not exist.');
  process.exit(1);
}

walk(appDir);
routeFiles.sort((a, b) => toRoute(a).localeCompare(toRoute(b)));

const layoutPath = join(appDir, 'layout.tsx');
const layoutSource = existsSync(layoutPath) ? read(layoutPath) : '';
const rootLayoutDynamic = hasDynamicExport(layoutSource);
const rootLayoutRuntime = runtimeExport(layoutSource);
const pagesExists = existsSync(pagesDir);
const rows = [];
const staticRiskRoutes = [];

for (const file of routeFiles) {
  const source = read(file);
  const route = toRoute(file);
  const dynamic = hasDynamicExport(source);
  const runtime = runtimeExport(source);
  const touches = touchesFor(file);
  const mayStatic = !rootLayoutDynamic && !dynamic;
  if (mayStatic) staticRiskRoutes.push(route);
  rows.push({ route, file: relative(root, file).replace(/\\/g, '/'), dynamic, runtime, mayStatic, touches });
}

const buildOutput = parseBuildOutput(buildOutputFile);
const requiredDynamicRoutes = ['/', '/login', '/_not-found'];
const missingRequiredBuildRoutes = buildOutput.checked
  ? requiredDynamicRoutes.filter((route) => !buildOutput.dynamicRoutes.has(route))
  : [];

console.log('Route diagnostics');
console.log(`pages/ present: ${pagesExists ? 'yes' : 'no'}`);
console.log(`root layout dynamic: ${rootLayoutDynamic ? 'yes' : 'no'}`);
console.log(`root layout runtime: ${rootLayoutRuntime || 'not set'}`);
console.log(`routes inspected: ${rows.length}`);
console.log(`static-risk routes: ${staticRiskRoutes.length}`);
if (buildOutput.checked) {
  console.log(`build route rows inspected: ${buildOutput.routeRows.length}`);
  console.log(`build static rows: ${buildOutput.staticRows.length}`);
}
console.table(rows.map((row) => ({
  route: row.route,
  file: row.file,
  dynamic: row.dynamic || rootLayoutDynamic ? 'yes' : 'no',
  ownDynamic: row.dynamic ? 'yes' : 'no',
  runtime: row.runtime || rootLayoutRuntime || '',
  mayStatic: row.mayStatic ? 'yes' : 'no',
  requireUserContext: row.touches.requireUserContext ? 'yes' : 'no',
  redirect: row.touches.redirect ? 'yes' : 'no',
  cookies: row.touches.cookies ? 'yes' : 'no',
  headers: row.touches.headers ? 'yes' : 'no',
  supabase: row.touches.supabase ? 'yes' : 'no',
  repositories: row.touches.repositories ? 'yes' : 'no'
})));

if (pagesExists) {
  console.error('Route diagnostics failed: pages/ directory must not exist.');
  process.exit(1);
}
if (!rootLayoutDynamic) {
  console.error("Route diagnostics failed: app/layout.tsx must export dynamic = 'force-dynamic'.");
  process.exit(1);
}
if (rootLayoutRuntime !== 'nodejs') {
  console.error("Route diagnostics failed: app/layout.tsx must export runtime = 'nodejs'.");
  process.exit(1);
}
if (staticRiskRoutes.length > 0) {
  console.error(`Route diagnostics failed: static-risk routes detected: ${staticRiskRoutes.join(', ')}`);
  process.exit(1);
}
if (buildOutput.staticRows?.length > 0) {
  console.error('Route diagnostics failed: static route rows detected in build output:');
  for (const row of buildOutput.staticRows) console.error(row);
  process.exit(1);
}
if (missingRequiredBuildRoutes.length > 0) {
  console.error(`Route diagnostics failed: required dynamic routes missing from build table: ${missingRequiredBuildRoutes.join(', ')}`);
  process.exit(1);
}

console.log('Route diagnostics passed: zero static-risk routes.');
