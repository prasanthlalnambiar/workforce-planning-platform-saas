import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const actualsRepo = readFileSync(new URL('../lib/repositories/actuals.ts', import.meta.url), 'utf8');
const varianceRepo = readFileSync(new URL('../lib/repositories/variance.ts', import.meta.url), 'utf8');
const readResult = readFileSync(new URL('../lib/repositories/read-result.ts', import.meta.url), 'utf8');

test('the read-result helper surfaces Supabase read errors instead of coalescing to empty', () => {
  assert.match(readResult, /export class ModuleDataError/);
  assert.match(readResult, /export function rows/);
  assert.match(readResult, /export function maybe/);
  // It must throw on error, not swallow.
  assert.match(readResult, /if \(result\.error\) describe\(label, result\.error\);/);
  // It recognises the unmigrated-database signatures.
  assert.match(readResult, /42P01/);
  assert.match(readResult, /42883/);
});

test('the actuals repository routes every read through the error-surfacing helper (no false empty state)', () => {
  // No raw `data ?? []` / `data as JsonRecord) ?? null` empty-coalescing remains
  // on a Supabase read result in the read paths.
  assert.ok(!/\.data \?\? \[\]\) as JsonRecord\[\]/.test(actualsRepo), 'no raw array coalescing remains');
  assert.match(actualsRepo, /rows<JsonRecord>\('the actuals register'/);
  assert.match(actualsRepo, /maybe<JsonRecord>\('this actuals batch'/);
  assert.match(actualsRepo, /rows<JsonRecord>\('the actuals rows'/);
});

test('the variance repository routes every read through the error-surfacing helper (no false empty state)', () => {
  assert.ok(!/\.data \?\? \[\]\) as JsonRecord\[\]/.test(varianceRepo), 'no raw array coalescing remains');
  assert.match(varianceRepo, /rows<JsonRecord>\('the variance register'/);
  assert.match(varianceRepo, /maybe<JsonRecord>\('this variance report'/);
  assert.match(varianceRepo, /rows<JsonRecord>\('the variance rows'/);
});

test('both governed modules have a controlled error boundary that names the missing-migration cause', () => {
  for (const file of ['app/actuals/error.tsx', 'app/variance/error.tsx']) {
    const url = new URL(`../${file}`, import.meta.url);
    assert.equal(existsSync(url), true, `${file} exists`);
    const source = readFileSync(url, 'utf8');
    assert.match(source, /'use client';/, `${file} is a client component`);
    assert.match(source, /controlled module error, not an empty register/, `${file} states it is not an empty state`);
    assert.match(source, /migrations have not been applied/, `${file} names the typical cause`);
    assert.match(source, /reset\(\)/, `${file} offers recovery`);
  }
});
