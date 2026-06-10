import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const protectedPages = [
  'app/workspace/page.tsx',
  'app/fiscal-years/page.tsx',
  'app/dimensions/page.tsx',
  'app/settings/page.tsx',
  'app/audit/page.tsx',
  'app/onboarding/page.tsx',
  'app/layer1/page.tsx',
  'app/layer1/brief/page.tsx',
  'app/layer1/sources/page.tsx',
  'app/layer1/demand/page.tsx',
  'app/layer1/assumptions/page.tsx',
  'app/layer1/output/page.tsx',
  'app/layer1/scenarios/page.tsx',
  'app/layer1/review/page.tsx',
  'app/baseline/page.tsx',
  'app/baseline/[baselineId]/page.tsx',
  'app/drivers/page.tsx',
  'app/reforecast/page.tsx',
  'app/actuals/page.tsx',
  'app/variance/page.tsx',
  'app/waterfall/page.tsx',
  'app/ai/page.tsx'
];

const protectedRouteHandlers = [
  'app/auth/sign-out/route.ts'
];

test('all protected App Router pages explicitly force dynamic rendering', () => {
  for (const file of protectedPages) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /export const dynamic = 'force-dynamic';/, `${file} must not be statically prerendered`);
  }
});

test('protected route handlers using server auth explicitly force dynamic rendering', () => {
  for (const file of protectedRouteHandlers) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(source, /export const dynamic = 'force-dynamic';/, `${file} must not be statically evaluated`);
  }
});

test('pages that call requireUserContext are covered by protected dynamic rendering list', () => {
  for (const file of protectedPages) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    if (source.includes('requireUserContext')) {
      assert.match(source, /export const dynamic = 'force-dynamic';/, `${file} calls requireUserContext and must force dynamic rendering`);
    }
  }
});
