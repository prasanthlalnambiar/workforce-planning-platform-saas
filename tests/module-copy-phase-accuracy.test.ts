import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// After Phase 7, actuals and variance are SHIPPED modules. Upstream module
// copy (drivers, reforecast) must not describe them as future/later phases.
// Only waterfall and AI may be described as future phases.

const upstreamCopyFiles = [
  'app/reforecasts/page.tsx',
  'app/reforecasts/_components/reforecast-shared.tsx',
  'app/drivers/page.tsx'
];

// Phrases that would wrongly imply actuals or variance are not yet built.
const staleActualsVariancePatterns: RegExp[] = [
  /actuals\s+(?:ingestion\s+)?(?:and\s+variance\s+)?(?:analysis\s+)?(?:are|come\s+in|is)\s+(?:a\s+)?(?:future|later)\s+phase/i,
  /variance\s+(?:analysis\s+)?(?:and\s+waterfall\s+(?:reporting\s+)?)?(?:are|come\s+in|is)\s+(?:a\s+)?(?:future|later)\s+phase/i,
  /actuals,?\s+variance\s+and\s+waterfall\s+come\s+in\s+later/i,
  /Actuals\s+and\s+variance\s+are\s+future\s+phases/i
];

test('upstream module copy does not describe actuals or variance as future phases', () => {
  for (const file of upstreamCopyFiles) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const pattern of staleActualsVariancePatterns) {
      assert.doesNotMatch(source, pattern, `${file} still contains stale actuals/variance future-phase copy`);
    }
  }
});

test('reforecast copy points actuals and variance to job areas, not phases (UX 1.0)', () => {
  const page = readFileSync(new URL('../app/reforecasts/page.tsx', import.meta.url), 'utf8');
  const shared = readFileSync(new URL('../app/reforecasts/_components/reforecast-shared.tsx', import.meta.url), 'utf8');
  assert.ok(!/Phase \d/.test(page), 'reforecast register shows no Phase N');
  assert.ok(!/Phase \d/.test(shared), 'reforecast detail shows no Phase N');
  assert.match(page, /Track/, 'reforecast register points to Track');
});

test('variance copy no longer scopes waterfall/AI as future phases (UX 1.0)', () => {
  const variancePage = readFileSync(new URL('../app/variance/page.tsx', import.meta.url), 'utf8');
  assert.ok(!/Phase \d/.test(variancePage), 'variance copy shows no Phase N');
  assert.match(variancePage, /Track/, 'variance copy points waterfall/advisor to Track');
});
