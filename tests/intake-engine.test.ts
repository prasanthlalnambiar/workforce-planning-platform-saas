import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectHeaders,
  normaliseAhtUnit,
  parseDelimited,
  parseTable,
  detectDelimiter,
  parseWeek,
  isOnWeekStart,
  validateRow,
  validateRows,
  findDuplicatesAtGrain,
  isLegitimateBreakdown,
  detectMissingWeeks,
  summariseImport,
  type RawRow,
  type MappingSpec,
  type CanonicalGrain
} from '../lib/intake/intake-engine';

const ISO_MAPPING: MappingSpec = {
  fieldByHeader: {
    'Week commencing': 'week_commencing',
    'Workflow': 'workflow_name',
    'Volume': 'weekly_volume',
    'AHT': 'weekly_aht',
    'AHT unit': 'aht_unit'
  },
  dateFormat: 'iso'
};

function row(rowIndex: number, values: Record<string, string>): RawRow {
  return { rowIndex, values };
}

test('quoted CSV fields with embedded commas and escaped quotes parse correctly', () => {
  const csv = 'Week,Workflow,Channel,Business Unit,Volume,AHT Unit,AHT\n2026-07-06,"Sales, Support",Voice,Consumer,1200,seconds,420';
  const table = parseTable(csv);
  assert.equal(table.method, 'csv');
  assert.deepEqual(table.headers, ['Week', 'Workflow', 'Channel', 'Business Unit', 'Volume', 'AHT Unit', 'AHT']);
  assert.equal(table.rows.length, 1);
  assert.equal(table.rows[0].values['Workflow'], 'Sales, Support');
  assert.equal(table.rows[0].values['Volume'], '1200');
  assert.equal(table.rows[0].values['AHT'], '420');
});

test('escaped double-quotes inside a quoted field are preserved', () => {
  const csv = 'Workflow,Note\n"Sales","He said ""hi"" today"';
  const table = parseTable(csv);
  assert.equal(table.rows[0].values['Note'], 'He said "hi" today');
});

test('TSV paste is detected and parsed', () => {
  const tsv = 'Week\tWorkflow\tVolume\n2026-07-06\tSales Calls\t1200';
  assert.equal(detectDelimiter(tsv), '\t');
  const table = parseTable(tsv);
  assert.equal(table.method, 'tsv');
  assert.equal(table.rows[0].values['Workflow'], 'Sales Calls');
});

test('parseDelimited handles a quoted newline inside a field', () => {
  const csv = 'A,B\n"line1\nline2",x';
  const m = parseDelimited(csv, ',');
  assert.equal(m.length, 2);
  assert.equal(m[1][0], 'line1\nline2');
});

test('Business Unit is NOT detected as AHT unit; AHT Unit is', () => {
  const s = detectHeaders(['Week', 'Workflow', 'Business Unit', 'AHT Unit', 'AHT', 'Volume']);
  const byHeader = Object.fromEntries(s.map((x) => [x.header, x.suggested]));
  assert.equal(byHeader['Business Unit'], null);
  assert.equal(byHeader['AHT Unit'], 'aht_unit');
  assert.equal(byHeader['AHT'], 'weekly_aht');
});

test('Operating Unit and Support Unit are not mistaken for AHT unit', () => {
  const s = detectHeaders(['Operating Unit', 'Support Unit', 'Time Unit']);
  const byHeader = Object.fromEntries(s.map((x) => [x.header, x.suggested]));
  assert.equal(byHeader['Operating Unit'], null);
  assert.equal(byHeader['Support Unit'], null);
  assert.equal(byHeader['Time Unit'], 'aht_unit');
});

test('AHT unit normalisation accepts common spellings; rejects unknown', () => {
  assert.equal(normaliseAhtUnit('mins'), 'minutes');
  assert.equal(normaliseAhtUnit('Sec'), 'seconds');
  assert.equal(normaliseAhtUnit('HOURS'), 'hours');
  assert.equal(normaliseAhtUnit('furlongs'), null);
});

test('ISO dates parse; ambiguous slash dates are rejected under ISO format', () => {
  assert.equal(parseWeek('2027-07-05', 'iso'), '2027-07-05');
  assert.equal(parseWeek('05/07/2027', 'iso'), null);
});

test('DD/MM/YYYY parses only when that format is explicitly selected', () => {
  assert.equal(parseWeek('05/07/2027', 'dd_mm_yyyy'), '2027-07-05');
  assert.equal(parseWeek('13/07/2027', 'dd_mm_yyyy'), '2027-07-13');
});

test('MM/DD/YYYY parses only when that format is explicitly selected', () => {
  assert.equal(parseWeek('07/05/2027', 'mm_dd_yyyy'), '2027-07-05');
});

test('impossible dates are rejected (31/02)', () => {
  assert.equal(parseWeek('31/02/2027', 'dd_mm_yyyy'), null);
});

test('week-start membership is computed correctly', () => {
  assert.equal(isOnWeekStart('2027-07-05', 'monday'), true);
  assert.equal(isOnWeekStart('2027-07-05', 'sunday'), false);
  assert.equal(isOnWeekStart('2027-07-04', 'sunday'), true);
});

test('a valid weekly row passes; zero volume is reported_zero', () => {
  const ok = validateRow(row(0, { 'Week commencing': '2027-07-05', 'Workflow': 'Sales Calls', 'Volume': '1200', 'AHT': '6', 'AHT unit': 'minutes' }), ISO_MAPPING);
  assert.equal(ok.validationStatus, 'valid');
  assert.equal(ok.volumeState, 'reported');
  const zero = validateRow(row(1, { 'Week commencing': '2027-07-05', 'Workflow': 'Sales Calls', 'Volume': '0', 'AHT': '6', 'AHT unit': 'minutes' }), ISO_MAPPING);
  assert.equal(zero.volumeState, 'reported_zero');
});

test('validation flags issues but never discards the row', () => {
  const r = validateRow(row(3, { 'Week commencing': '05/07/2027', 'Workflow': '', 'Volume': 'abc', 'AHT': '6', 'AHT unit': 'minutes' }), ISO_MAPPING);
  assert.equal(r.validationStatus, 'invalid');
  assert.ok(r.validationMessages.some((m) => /date format/i.test(m)));
  assert.ok(r.validationMessages.some((m) => /Workflow/.test(m)));
  assert.equal(r.rowIndex, 3);
});

test('same Week+Workflow, different Channel = breakdown when Channel is calc-driving', () => {
  const raw = [
    row(0, { 'Week commencing': '2027-07-05', 'Workflow': 'Sales Calls', 'Volume': '700', 'AHT': '6', 'AHT unit': 'minutes', 'Channel': 'Voice' }),
    row(1, { 'Week commencing': '2027-07-05', 'Workflow': 'Sales Calls', 'Volume': '500', 'AHT': '5', 'AHT unit': 'minutes', 'Channel': 'Webchat' })
  ];
  const parsed = validateRows(raw, ISO_MAPPING);
  const grain: CanonicalGrain = { calcDrivingDimensions: ['Channel'] };
  assert.equal(findDuplicatesAtGrain(parsed, grain).length, 0);
  assert.equal(isLegitimateBreakdown(parsed[0], parsed[1], grain), true);
});

test('same Week+Workflow Voice/Webchat flagged as duplicate when Channel is NOT calc-driving', () => {
  const raw = [
    row(0, { 'Week commencing': '2027-07-05', 'Workflow': 'Sales Calls', 'Volume': '700', 'AHT': '6', 'AHT unit': 'minutes', 'Channel': 'Voice' }),
    row(1, { 'Week commencing': '2027-07-05', 'Workflow': 'Sales Calls', 'Volume': '500', 'AHT': '5', 'AHT unit': 'minutes', 'Channel': 'Webchat' })
  ];
  const parsed = validateRows(raw, ISO_MAPPING);
  const grain: CanonicalGrain = { calcDrivingDimensions: [] };
  assert.equal(findDuplicatesAtGrain(parsed, grain).length, 1);
  assert.equal(isLegitimateBreakdown(parsed[0], parsed[1], grain), false);
});

test('true duplicate at canonical grain is flagged', () => {
  const raw = [
    row(0, { 'Week commencing': '2027-07-05', 'Workflow': 'Sales Calls', 'Volume': '700', 'AHT': '6', 'AHT unit': 'minutes', 'Channel': 'Voice' }),
    row(1, { 'Week commencing': '2027-07-05', 'Workflow': 'Sales Calls', 'Volume': '700', 'AHT': '6', 'AHT unit': 'minutes', 'Channel': 'Voice' })
  ];
  const parsed = validateRows(raw, ISO_MAPPING);
  const grain: CanonicalGrain = { calcDrivingDimensions: ['Channel'] };
  const dups = findDuplicatesAtGrain(parsed, grain);
  assert.equal(dups.length, 1);
  assert.deepEqual(dups[0].rowIndexes.sort(), [0, 1]);
});

test('missing weeks vs reported zero are distinguished; never synthesised as zero', () => {
  const raw = [
    row(0, { 'Week commencing': '2027-07-05', 'Workflow': 'Sales Calls', 'Volume': '0', 'AHT': '6', 'AHT unit': 'minutes' }),
    row(1, { 'Week commencing': '2027-07-19', 'Workflow': 'Sales Calls', 'Volume': '900', 'AHT': '6', 'AHT unit': 'minutes' })
  ];
  const parsed = validateRows(raw, ISO_MAPPING);
  const result = detectMissingWeeks(parsed, '2027-07-05', '2027-07-19', 'monday');
  assert.equal(result.ok, true);
  const sales = result.reports.find((r) => r.workflowName === 'Sales Calls');
  assert.ok(sales);
  assert.deepEqual(sales.missingWeeks, ['2027-07-12']);
  assert.deepEqual(sales.reportedZeroWeeks, ['2027-07-05']);
});

test('missing-week detection refuses to run on a week-start mismatch', () => {
  const raw = [
    row(0, { 'Week commencing': '2027-07-06', 'Workflow': 'Sales Calls', 'Volume': '900', 'AHT': '6', 'AHT unit': 'minutes' })
  ];
  const parsed = validateRows(raw, ISO_MAPPING);
  const result = detectMissingWeeks(parsed, '2027-07-05', '2027-07-19', 'monday');
  assert.equal(result.ok, false);
  assert.equal(result.weekStartMismatch, true);
  assert.deepEqual(result.offendingWeeks, ['2027-07-06']);
  assert.equal(result.reports.length, 0);
});

test('import summary reports grain, unapproved optional fields, duplicates', () => {
  const raw = [
    row(0, { 'Week commencing': '2027-07-05', 'Workflow': 'Sales Calls', 'Volume': '700', 'AHT': '6', 'AHT unit': 'minutes', 'Channel': 'Voice', 'Product': 'Home' }),
    row(1, { 'Week commencing': '2027-07-05', 'Workflow': 'Sales Calls', 'Volume': '500', 'AHT': '5', 'AHT unit': 'minutes', 'Channel': 'Webchat', 'Product': 'Home' })
  ];
  const parsed = validateRows(raw, ISO_MAPPING);
  const grain: CanonicalGrain = { calcDrivingDimensions: ['Channel'] };
  const allHeaders = ['Week commencing', 'Workflow', 'Volume', 'AHT', 'AHT unit', 'Channel', 'Product'];
  const mappedHeaders = ['Week commencing', 'Workflow', 'Volume', 'AHT', 'AHT unit', 'Channel'];
  const summary = summariseImport(parsed, grain, allHeaders, mappedHeaders);
  assert.deepEqual(summary.canonicalGrain, ['week_commencing', 'workflow', 'Channel']);
  assert.deepEqual(summary.unapprovedOptionalFields, ['Product']);
  assert.equal(summary.duplicateGroups.length, 0);
});

// --- Canonical-field mapping (review points 1, 4) --------------------------

import {
  buildMappingSpec,
  validateMappingCompleteness,
  deriveRows,
  grainForMapping,
  type UserMapping
} from '../lib/intake/intake-engine';

const FULL_ROLES: UserMapping = {
  roleByHeader: {
    'WC': 'week_commencing',
    'Stream': 'workflow_name',
    'Vol': 'weekly_volume',
    'Handle': 'weekly_aht',
    'Unit': 'aht_unit'
  },
  dateFormat: 'iso'
};

test('buildMappingSpec turns a user role map into a parsing spec + calc dimensions', () => {
  const m: UserMapping = {
    roleByHeader: { 'WC': 'week_commencing', 'Stream': 'workflow_name', 'Vol': 'weekly_volume', 'Handle': 'weekly_aht', 'Unit': 'aht_unit', 'Channel': 'calc_dimension', 'Product': 'reporting' },
    dateFormat: 'iso'
  };
  const { spec, calcDrivingDimensions } = buildMappingSpec(m);
  assert.equal(spec.fieldByHeader['WC'], 'week_commencing');
  assert.equal(spec.fieldByHeader['Vol'], 'weekly_volume');
  assert.deepEqual(calcDrivingDimensions, ['Channel']);
  assert.equal(spec.fieldByHeader['Product'], undefined); // reporting is not a canonical field
});

test('auto-detection can FAIL while the user mapping succeeds (unusual headers)', () => {
  // Headers auto-detection cannot resolve to Weekly volume.
  const headers = ['WC', 'Stream', 'Qty', 'Handle', 'Unit'];
  const auto = detectHeaders(headers);
  const autoVolume = auto.find((s) => s.suggested === 'weekly_volume');
  assert.equal(autoVolume, undefined, 'auto-detection does not identify Weekly volume here');

  // The user maps "Qty" to weekly_volume manually; rows then parse correctly.
  const userMapping: UserMapping = {
    roleByHeader: { 'WC': 'week_commencing', 'Stream': 'workflow_name', 'Qty': 'weekly_volume', 'Handle': 'weekly_aht', 'Unit': 'aht_unit' },
    dateFormat: 'iso'
  };
  const raw = [{ rowIndex: 0, values: { 'WC': '2027-07-05', 'Stream': 'Sales', 'Qty': '1200', 'Handle': '6', 'Unit': 'minutes' } }];
  const derived = deriveRows(raw, userMapping);
  assert.equal(derived[0].validationStatus, 'valid');
  assert.equal(derived[0].weeklyVolume, 1200);
  assert.equal(derived[0].workflowName, 'Sales');
});

test('mapping acceptance requires all canonical fields', () => {
  assert.equal(validateMappingCompleteness(FULL_ROLES).ok, true);

  const noVolume: UserMapping = { roleByHeader: { 'WC': 'week_commencing', 'Stream': 'workflow_name', 'Handle': 'weekly_aht', 'Unit': 'aht_unit' } };
  const r1 = validateMappingCompleteness(noVolume);
  assert.equal(r1.ok, false);
  assert.ok(r1.missingRequired.includes('weekly_volume'));

  const noWeek: UserMapping = { roleByHeader: { 'Stream': 'workflow_name', 'Vol': 'weekly_volume', 'Handle': 'weekly_aht', 'Unit': 'aht_unit' } };
  assert.equal(validateMappingCompleteness(noWeek).ok, false);

  const noWorkflow: UserMapping = { roleByHeader: { 'WC': 'week_commencing', 'Vol': 'weekly_volume', 'Handle': 'weekly_aht', 'Unit': 'aht_unit' } };
  assert.equal(validateMappingCompleteness(noWorkflow).ok, false);
});

test('AHT unit may come from a default when no column is mapped', () => {
  const noUnitColumn: UserMapping = {
    roleByHeader: { 'WC': 'week_commencing', 'Stream': 'workflow_name', 'Vol': 'weekly_volume', 'Handle': 'weekly_aht' },
    defaultAhtUnit: 'minutes'
  };
  assert.equal(validateMappingCompleteness(noUnitColumn).ok, true);

  const noUnitNoDefault: UserMapping = {
    roleByHeader: { 'WC': 'week_commencing', 'Stream': 'workflow_name', 'Vol': 'weekly_volume', 'Handle': 'weekly_aht' }
  };
  assert.equal(validateMappingCompleteness(noUnitNoDefault).ok, false);
});

test('all-reporting and all-ignore mappings cannot be accepted', () => {
  const allReporting: UserMapping = { roleByHeader: { 'A': 'reporting', 'B': 'reporting' } };
  assert.equal(validateMappingCompleteness(allReporting).ok, false);
  const allIgnore: UserMapping = { roleByHeader: { 'A': 'ignore', 'B': 'ignore' } };
  assert.equal(validateMappingCompleteness(allIgnore).ok, false);
});

test('grainForMapping reflects the chosen calculation-driving dimensions', () => {
  const m: UserMapping = {
    roleByHeader: { 'WC': 'week_commencing', 'Stream': 'workflow_name', 'Vol': 'weekly_volume', 'Handle': 'weekly_aht', 'Unit': 'aht_unit', 'Channel': 'calc_dimension' }
  };
  assert.deepEqual(grainForMapping(m).calcDrivingDimensions, ['Channel']);
});

test('re-deriving with vs without Channel as calc-driving changes duplicate outcome', () => {
  const raw = [
    { rowIndex: 0, values: { 'WC': '2026-07-06', 'Stream': 'Support', 'Vol': '100', 'Handle': '6', 'Unit': 'minutes', 'Channel': 'Voice' } },
    { rowIndex: 1, values: { 'WC': '2026-07-06', 'Stream': 'Support', 'Vol': '80', 'Handle': '5', 'Unit': 'minutes', 'Channel': 'Webchat' } }
  ];
  const withChannel: UserMapping = {
    roleByHeader: { 'WC': 'week_commencing', 'Stream': 'workflow_name', 'Vol': 'weekly_volume', 'Handle': 'weekly_aht', 'Unit': 'aht_unit', 'Channel': 'calc_dimension' }
  };
  const withoutChannel: UserMapping = {
    roleByHeader: { 'WC': 'week_commencing', 'Stream': 'workflow_name', 'Vol': 'weekly_volume', 'Handle': 'weekly_aht', 'Unit': 'aht_unit', 'Channel': 'reporting' }
  };
  const dA = findDuplicatesAtGrain(deriveRows(raw, withChannel), grainForMapping(withChannel));
  assert.equal(dA.length, 0, 'Channel calc-driving -> valid breakdown');
  const dB = findDuplicatesAtGrain(deriveRows(raw, withoutChannel), grainForMapping(withoutChannel));
  assert.equal(dB.length, 1, 'Channel not calc-driving -> duplicate');
});
