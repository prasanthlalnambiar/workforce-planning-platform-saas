import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// User-facing scan scope (per spec): page.tsx, _components, shared UI components.
// Internal-only references (migrations, tests, comments, docs) are excluded.
function userFacingFiles(): string[] {
  const appDir = fileURLToPath(new URL('../app', import.meta.url));
  const compDir = fileURLToPath(new URL('../components', import.meta.url));
  const out: string[] = [];
  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.tsx')) continue;
      if (entry.endsWith('.test.tsx')) continue;
      out.push(full);
    }
  }
  walk(appDir);
  walk(compDir);
  return out;
}

// Strip line and block comments so internal notes in comments don't trip the
// user-facing copy scan (the spec excludes comments).
function visibleText(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const files = userFacingFiles();

test('no user-facing "Phase N" label remains in page copy or shared UI', () => {
  const offenders: string[] = [];
  for (const f of files) {
    const text = visibleText(readFileSync(f, 'utf8'));
    if (/Phase\s*\d/.test(text)) offenders.push(path.basename(f));
  }
  assert.deepEqual(offenders, [], `files still showing "Phase N": ${offenders.join(', ')}`);
});

test('no user-facing "Layer 1" / "Layer 2" product language remains', () => {
  const offenders: string[] = [];
  for (const f of files) {
    const text = visibleText(readFileSync(f, 'utf8'));
    // Allow the internal source_type value and code identifiers (canApproveLayer1,
    // governance helpers): only the spaced product phrase "Layer 1"/"Layer 2" is
    // user-facing copy. Identifiers use "Layer1" with no space.
    const stripped = text.replace(/layer1_handoff/g, '').replace(/[A-Za-z]Layer[12]\b/g, '').replace(/Layer[12][A-Za-z(]/g, '');
    if (/Layer\s+[12]\b/.test(stripped)) offenders.push(path.basename(f));
  }
  assert.deepEqual(offenders, [], `files still showing "Layer 1/2": ${offenders.join(', ')}`);
});

test('"AI Advisory" no longer appears as user-facing copy', () => {
  const offenders: string[] = [];
  for (const f of files) {
    const text = visibleText(readFileSync(f, 'utf8'));
    if (/AI Advisory/.test(text)) offenders.push(path.basename(f));
  }
  assert.deepEqual(offenders, [], `files still showing "AI Advisory": ${offenders.join(', ')}`);
});

test('no user-facing "AI commentary" / "future phase(s)" / "future capability" language remains', () => {
  // The previous sweep replaced "AI Advisory" but left these adjacent build-era
  // phrases in visible copy. End users must never see future-phase framing or
  // "AI commentary" — they should see "Planning Advisor" and concrete locations
  // (e.g. "available in Track").
  const forbidden = [/AI commentary/i, /future phase\b/i, /future phases\b/i, /future capabilit/i];
  const offenders: string[] = [];
  for (const f of files) {
    const text = visibleText(readFileSync(f, 'utf8'));
    if (forbidden.some((re) => re.test(text))) offenders.push(path.basename(f));
  }
  assert.deepEqual(offenders, [], `files still showing build-phase/future copy: ${offenders.join(', ')}`);
});

test('"Planning Advisor" appears in the advisory surfaces', () => {
  const aiPage = readFileSync(new URL('../app/ai/page.tsx', import.meta.url), 'utf8');
  const aiDetail = readFileSync(new URL('../app/ai/[varianceReportId]/page.tsx', import.meta.url), 'utf8');
  assert.match(aiPage, /Planning Advisor/);
  assert.match(aiDetail, /Planning Advisor/);
});

test('the navigation shows the five job tabs, not module/phase names', () => {
  const nav = readFileSync(new URL('../lib/navigation/planning-cockpit.ts', import.meta.url), 'utf8');
  for (const tab of ['Home', 'Inputs', 'Assumptions', 'Forecast & Budget', 'Track']) {
    assert.ok(nav.includes(`'${tab}'`), `nav defines ${tab}`);
  }
});
