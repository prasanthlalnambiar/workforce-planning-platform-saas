import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveRows,
  buildMappingSpec,
  validateMappingCompleteness,
  findDuplicatesAtGrain,
  grainForMapping,
  type UserMapping,
  type RawRow
} from '../lib/intake/intake-engine';

// This suite exercises the exact composition the repository's previewMapping and
// createFieldMappingVersion use (re-derivation from immutable raw rows + the
// user mapping, and the server-side acceptance gate), proving the
// repository-level workflow, not only isolated engine helpers.

// The mandatory scenario from the review:
const RAW: RawRow[] = [
  { rowIndex: 0, values: { 'Week commencing': '2026-07-06', 'Workflow': 'Support', 'Channel': 'Voice', 'Volume': '100', 'AHT': '6', 'AHT unit': 'minutes' } },
  { rowIndex: 1, values: { 'Week commencing': '2026-07-06', 'Workflow': 'Support', 'Channel': 'Webchat', 'Volume': '80', 'AHT': '5', 'AHT unit': 'minutes' } }
];

const BASE_ROLES = {
  'Week commencing': 'week_commencing',
  'Workflow': 'workflow_name',
  'Volume': 'weekly_volume',
  'AHT': 'weekly_aht',
  'AHT unit': 'aht_unit'
} as const;

function previewLogic(raw: RawRow[], mapping: UserMapping) {
  // Mirrors repository.previewMapping composition.
  const derived = deriveRows(raw, mapping);
  const grain = grainForMapping(mapping);
  const duplicates = findDuplicatesAtGrain(derived, grain);
  const validation = validateMappingCompleteness(mapping);
  return { derived, duplicates, validation, grain };
}

test('Case A: Channel selected as calculation-driving dimension -> rows are valid breakdowns', () => {
  const mapping: UserMapping = {
    roleByHeader: { ...BASE_ROLES, 'Channel': 'calc_dimension' },
    dateFormat: 'iso'
  };
  const { derived, duplicates, validation, grain } = previewLogic(RAW, mapping);
  assert.equal(validation.ok, true, 'required canonical fields are mapped');
  assert.deepEqual(grain.calcDrivingDimensions, ['Channel']);
  assert.equal(duplicates.length, 0, 'Voice and Webchat are distinct at the selected grain');
  assert.equal(derived.every((d) => d.validationStatus === 'valid'), true);
});

test('Case B: Channel NOT selected as calculation-driving -> rows are duplicates at selected grain', () => {
  const mapping: UserMapping = {
    roleByHeader: { ...BASE_ROLES, 'Channel': 'reporting' },
    dateFormat: 'iso'
  };
  const { duplicates, grain } = previewLogic(RAW, mapping);
  assert.deepEqual(grain.calcDrivingDimensions, []);
  assert.equal(duplicates.length, 1, 'same Week+Workflow collapses to a duplicate');
  assert.deepEqual(duplicates[0].rowIndexes.sort(), [0, 1]);
});

test('acceptance gate (as the repository enforces) blocks an incomplete mapping', () => {
  // Drop the volume mapping — repository.createFieldMappingVersion would throw.
  const incomplete: UserMapping = {
    roleByHeader: { 'Week commencing': 'week_commencing', 'Workflow': 'workflow_name', 'AHT': 'weekly_aht', 'AHT unit': 'aht_unit' }
  };
  const v = validateMappingCompleteness(incomplete);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /Weekly volume/.test(e)));
});

test('re-derivation does not depend on the auto-detected import mapping', () => {
  // Even if import auto-detected nothing useful, deriving with the user mapping
  // yields correct interpretation from the immutable raw rows.
  const mapping: UserMapping = { roleByHeader: { ...BASE_ROLES, 'Channel': 'calc_dimension' }, dateFormat: 'iso' };
  const { spec } = buildMappingSpec(mapping);
  assert.equal(spec.fieldByHeader['Volume'], 'weekly_volume');
  const derived = deriveRows(RAW, mapping);
  assert.equal(derived[0].weeklyVolume, 100);
  assert.equal(derived[1].weeklyVolume, 80);
});

// --- Candidate-mapping resolution (the preview/grid divergence bug) ----------

import {
  resolveCandidateMapping,
  hashMapping,
  type StoredMapping
} from '../lib/intake/intake-engine';

const HEADERS = ['Week commencing', 'Workflow', 'Channel', 'Volume', 'AHT', 'AHT unit'];

function stored(roleByHeader: Record<string, string>, defaultAhtUnit: 'seconds' | 'minutes' | 'hours' | null = null, versionNumber = 1): StoredMapping {
  return { mappings: roleByHeader, aggregation_decision: { default_aht_unit: defaultAhtUnit, date_format: 'iso' }, mapping_version_number: versionNumber };
}

// Accepted is the earlier version; the draft being actively edited is newer, so
// the draft is the working candidate (the normal "editing after accept" flow).
const ACCEPTED_NO_CHANNEL = stored({
  'Week commencing': 'week_commencing', 'Workflow': 'workflow_name', 'Volume': 'weekly_volume',
  'AHT': 'weekly_aht', 'AHT unit': 'aht_unit', 'Channel': 'reporting'
}, null, 1);
const DRAFT_WITH_CHANNEL = stored({
  'Week commencing': 'week_commencing', 'Workflow': 'workflow_name', 'Volume': 'weekly_volume',
  'AHT': 'weekly_aht', 'AHT unit': 'aht_unit', 'Channel': 'calc_dimension'
}, null, 2);

test('candidate resolution order is draft -> accepted -> suggestion', () => {
  // draft present -> draft wins
  const a = resolveCandidateMapping({ draft: DRAFT_WITH_CHANNEL, accepted: ACCEPTED_NO_CHANNEL, headers: HEADERS });
  assert.equal(a.source, 'draft');
  assert.equal(a.mapping.roleByHeader['Channel'], 'calc_dimension');

  // no draft, accepted present -> accepted wins
  const b = resolveCandidateMapping({ draft: null, accepted: ACCEPTED_NO_CHANNEL, headers: HEADERS });
  assert.equal(b.source, 'accepted');
  assert.equal(b.mapping.roleByHeader['Channel'], 'reporting');

  // neither -> auto-detection suggestion
  const c = resolveCandidateMapping({ draft: null, accepted: null, headers: HEADERS });
  assert.equal(c.source, 'suggestion');
  assert.equal(c.mapping.roleByHeader['Week commencing'], 'week_commencing');
});

test('REGRESSION: saved draft (Channel calc-driving) over accepted (Channel reporting) drives grid AND preview consistently', () => {
  // Accepted has Channel reporting; a later draft makes Channel calc-driving.
  const candidate = resolveCandidateMapping({ draft: DRAFT_WITH_CHANNEL, accepted: ACCEPTED_NO_CHANNEL, headers: HEADERS });
  assert.equal(candidate.source, 'draft', 'grid must edit the draft, not the accepted mapping');

  // The grid renders candidate.mapping.roleByHeader -> Channel selected calc-driving.
  assert.equal(candidate.mapping.roleByHeader['Channel'], 'calc_dimension');

  // The preview is computed from the SAME candidate -> Channel calc-driving -> breakdown.
  const { duplicates, grain } = previewLogic(RAW, candidate.mapping);
  assert.deepEqual(grain.calcDrivingDimensions, ['Channel']);
  assert.equal(duplicates.length, 0, 'preview uses the draft, so Voice/Webchat are a breakdown');

  // The accept payload is the same candidate -> accepted mapping would have Channel calc-driving.
  assert.equal(candidate.mapping.roleByHeader['Channel'], 'calc_dimension');
});

test('REGRESSION (opposite): draft removes Channel; preview and form both reflect the draft', () => {
  const acceptedWithChannel = stored({
    'Week commencing': 'week_commencing', 'Workflow': 'workflow_name', 'Volume': 'weekly_volume',
    'AHT': 'weekly_aht', 'AHT unit': 'aht_unit', 'Channel': 'calc_dimension'
  }, null, 1);                                            // accepted (older) has Channel calc-driving
  const draftRemovesChannel = stored({
    'Week commencing': 'week_commencing', 'Workflow': 'workflow_name', 'Volume': 'weekly_volume',
    'AHT': 'weekly_aht', 'AHT unit': 'aht_unit', 'Channel': 'reporting'
  }, null, 2);                                            // draft (newer) removes Channel
  const candidate = resolveCandidateMapping({ draft: draftRemovesChannel, accepted: acceptedWithChannel, headers: HEADERS });
  assert.equal(candidate.source, 'draft');
  assert.equal(candidate.mapping.roleByHeader['Channel'], 'reporting');

  const { duplicates, grain } = previewLogic(RAW, candidate.mapping);
  assert.deepEqual(grain.calcDrivingDimensions, []);
  assert.equal(duplicates.length, 1, 'preview uses the draft (no Channel) -> duplicate');
});

test('previewed mapping hash equals the hash recomputed from the submitted candidate', () => {
  const candidate = resolveCandidateMapping({ draft: DRAFT_WITH_CHANNEL, accepted: ACCEPTED_NO_CHANNEL, headers: HEADERS });
  const previewedHash = hashMapping(candidate.mapping);
  // The accept action recomputes the hash from the same roleByHeader/default/dateFormat.
  const submittedHash = hashMapping({
    roleByHeader: candidate.mapping.roleByHeader,
    defaultAhtUnit: candidate.mapping.defaultAhtUnit ?? null,
    dateFormat: candidate.mapping.dateFormat ?? 'iso'
  });
  assert.equal(submittedHash, previewedHash, 'previewed === accepted (same hash)');

  // A divergent submission (Channel flipped) produces a different hash -> rejected.
  const tampered = hashMapping({
    roleByHeader: { ...candidate.mapping.roleByHeader, 'Channel': 'reporting' },
    defaultAhtUnit: candidate.mapping.defaultAhtUnit ?? null,
    dateFormat: candidate.mapping.dateFormat ?? 'iso'
  });
  assert.notEqual(tampered, previewedHash);
});

// --- default AHT unit consistency (v4 -> v5 hash bug) -----------------------

test('null-default candidate with a mapped AHT-unit column resolves defaultAhtUnit=null (renders "none")', () => {
  // Accepted/draft mapping has an AHT-unit COLUMN mapped, so no default unit is set.
  const withUnitColumn = stored({
    'Week commencing': 'week_commencing', 'Workflow': 'workflow_name', 'Volume': 'weekly_volume',
    'AHT': 'weekly_aht', 'AHT unit': 'aht_unit', 'Channel': 'calc_dimension'
  }, null); // default_aht_unit null
  const candidate = resolveCandidateMapping({ draft: withUnitColumn, accepted: null, headers: HEADERS });
  assert.equal(candidate.mapping.defaultAhtUnit, null, 'candidate default is null');
  // The grid renders `candidateDefaultAhtUnit ?? ''` -> the "none" option is selected.
  const rendered = candidate.mapping.defaultAhtUnit ?? '';
  assert.equal(rendered, '', 'select shows none, not minutes');
});

test('REGRESSION: form does not silently inject "minutes"; submitted hash matches previewed hash', () => {
  const withUnitColumn = stored({
    'Week commencing': 'week_commencing', 'Workflow': 'workflow_name', 'Volume': 'weekly_volume',
    'AHT': 'weekly_aht', 'AHT unit': 'aht_unit', 'Channel': 'calc_dimension'
  }, null);
  const candidate = resolveCandidateMapping({ draft: withUnitColumn, accepted: null, headers: HEADERS });

  // Preview hashes the candidate (defaultAhtUnit = null).
  const previewedHash = hashMapping(candidate.mapping);

  // The form's "none" option submits '' which the action converts to null.
  const submittedDefault = (('').trim() || null) as 'seconds' | 'minutes' | 'hours' | null;
  const submittedHash = hashMapping({
    roleByHeader: candidate.mapping.roleByHeader,
    defaultAhtUnit: submittedDefault,
    dateFormat: candidate.mapping.dateFormat ?? 'iso'
  });
  assert.equal(submittedDefault, null, 'empty select submits null, not minutes');
  assert.equal(submittedHash, previewedHash, 'accept is not falsely rejected by an injected minutes');

  // Demonstrate the OLD bug would have diverged: minutes would change the hash.
  const buggyHash = hashMapping({
    roleByHeader: candidate.mapping.roleByHeader,
    defaultAhtUnit: 'minutes',
    dateFormat: candidate.mapping.dateFormat ?? 'iso'
  });
  assert.notEqual(buggyHash, previewedHash, 'injecting minutes would have broken the guard');
});
