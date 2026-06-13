import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVarianceLines,
  canTransitionActualsStatus,
  canTransitionVarianceStatus,
  computeActualsChecksum,
  computeVarianceChecksum,
  isActualsBatchEditable,
  isActualsBatchImmutable,
  isVarianceImmutable,
  isVarianceRecalculable,
  mapCsvRowsToActualsLines,
  safeVariancePct,
  summariseVariance,
  validateActualsLines,
  type ActualsBatchStatus,
  type ActualsLineDraft,
  type ComparatorLine,
  type PlanningPeriodRef,
  type VarianceReportStatus
} from '../lib/variance/variance-engine';

function makePeriods(count = 12): PlanningPeriodRef[] {
  return Array.from({ length: count }, (_, index) => {
    const month = index + 1;
    const mm = String(month).padStart(2, '0');
    return {
      id: `period-${mm}`,
      periodNumber: month,
      periodStart: `2027-${mm}-01`,
      periodEnd: `2027-${mm}-28`,
      periodLabel: `2027-${mm}`
    };
  });
}

function actualLine(periodNumber: number, cost: number, fte = 50, hours = 8000): ActualsLineDraft {
  const mm = String(periodNumber).padStart(2, '0');
  return {
    planningPeriodId: `period-${mm}`,
    periodNumber,
    periodStart: `2027-${mm}-01`,
    periodEnd: `2027-${mm}-28`,
    actualCost: cost,
    actualFte: fte,
    actualWorkloadHours: hours,
    sourceRowReference: `row ${periodNumber}`
  };
}

function comparator(periodNumber: number, cost: number, fte = 50, workloadHours = 8000): ComparatorLine {
  return { planningPeriodId: `period-${String(periodNumber).padStart(2, '0')}`, cost, fte, workloadHours };
}

test('actuals map only to valid planning periods inside the horizon', () => {
  const issues = validateActualsLines({
    horizonPeriods: makePeriods(12),
    lines: [actualLine(1, 1000), actualLine(2, 2000)]
  });
  assert.equal(issues.length, 0);
});

test('actuals rows with unknown or out-of-horizon periods are rejected, never silently mapped', () => {
  const outOfHorizon = { ...actualLine(1, 1000), planningPeriodId: 'period-99' };
  const issues = validateActualsLines({ horizonPeriods: makePeriods(12), lines: [outOfHorizon] });
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /does not exist in the selected baseline horizon/);
});

test('duplicate actuals period rows are rejected', () => {
  const issues = validateActualsLines({
    horizonPeriods: makePeriods(12),
    lines: [actualLine(3, 1000), actualLine(3, 2000)]
  });
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /Duplicate planning period/);
});

test('non-finite actual values are rejected', () => {
  const bad = { ...actualLine(4, Number.NaN) };
  const issues = validateActualsLines({ horizonPeriods: makePeriods(12), lines: [bad] });
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /finite number/);
});

test('CSV mapping is strict: exact YYYY-MM match, bad months and formats rejected with row references', () => {
  const periods = makePeriods(12);
  const good = mapCsvRowsToActualsLines({ horizonPeriods: periods, csvText: '2027-01,1000,50,8000\n2027-02,2000,51,8100' });
  assert.equal(good.issues.length, 0);
  assert.equal(good.lines.length, 2);
  assert.equal(good.lines[0].planningPeriodId, 'period-01');

  const badMonth = mapCsvRowsToActualsLines({ horizonPeriods: periods, csvText: '2026-01,1000' });
  assert.equal(badMonth.issues.length, 1);
  assert.match(badMonth.issues[0].message, /no planning period/);

  const badFormat = mapCsvRowsToActualsLines({ horizonPeriods: periods, csvText: 'Jan-2027,1000' });
  assert.match(badFormat.issues[0].message, /cannot be mapped/);

  const duplicate = mapCsvRowsToActualsLines({ horizonPeriods: periods, csvText: '2027-01,1000\n2027-01,2000' });
  assert.ok(duplicate.issues.some((issue) => /Duplicate/.test(issue.message)));
});

test('the actuals lifecycle matrix: draft editable, posted immutable, corrections supersede, voided excluded', () => {
  const expectations: Array<[ActualsBatchStatus, ActualsBatchStatus, boolean]> = [
    ['draft', 'validated', true],
    ['draft', 'posted', false],
    ['draft', 'voided', true],
    ['validated', 'draft', true],
    ['validated', 'posted', true],
    ['validated', 'voided', true],
    ['posted', 'superseded', true],
    ['posted', 'voided', true],
    ['posted', 'draft', false],
    ['posted', 'validated', false],
    ['superseded', 'posted', false],
    ['voided', 'draft', false]
  ];
  for (const [from, to, expected] of expectations) {
    assert.equal(canTransitionActualsStatus(from, to), expected, `${from} -> ${to}`);
  }
  assert.equal(isActualsBatchEditable('draft'), true);
  assert.equal(isActualsBatchEditable('validated'), false);
  assert.equal(isActualsBatchEditable('posted'), false, 'posted actuals are immutable');
  assert.equal(isActualsBatchImmutable('posted'), true);
  assert.equal(isActualsBatchImmutable('superseded'), true);
  assert.equal(isActualsBatchImmutable('voided'), true);
});

test('the actuals checksum changes whenever any value changes and is stable for identical inputs', () => {
  const lines = [actualLine(1, 1000.5), actualLine(2, 2000)];
  const same = [actualLine(1, 1000.5), actualLine(2, 2000)];
  const changed = [actualLine(1, 1000.51), actualLine(2, 2000)];
  assert.equal(computeActualsChecksum(lines), computeActualsChecksum(same));
  assert.notEqual(computeActualsChecksum(lines), computeActualsChecksum(changed));
  assert.match(computeActualsChecksum(lines), /^[0-9a-f]{64}$/);
});

test('variance calculates actual minus forecast: positive means actual cost above forecast', () => {
  const lines = buildVarianceLines({
    actualLines: [actualLine(1, 110000, 52, 8200)],
    forecastLines: [comparator(1, 100000, 50, 8000)],
    baselineLines: [comparator(1, 95000, 49, 7900)]
  });
  assert.equal(lines[0].costVarianceToForecast, 10000, 'actual above forecast is positive');
  assert.equal(lines[0].costVarianceToForecastPct, 10);
  assert.equal(lines[0].fteVarianceToForecast, 2);
  assert.equal(lines[0].workloadVarianceToForecast, 200);
});

test('variance calculates actual minus baseline correctly, including negative (under budget)', () => {
  const lines = buildVarianceLines({
    actualLines: [actualLine(1, 90000, 48, 7800)],
    forecastLines: [comparator(1, 100000)],
    baselineLines: [comparator(1, 95000, 49, 7900)]
  });
  assert.equal(lines[0].costVarianceToBaseline, -5000, 'actual below baseline is negative');
  assert.equal(lines[0].costVarianceToBaselinePct, -5.26);
  assert.equal(lines[0].fteVarianceToBaseline, -1);
  assert.equal(lines[0].workloadVarianceToBaseline, -100);
});

test('cost variance percentage handles a zero comparator safely', () => {
  assert.equal(safeVariancePct(5000, 0), null);
  const lines = buildVarianceLines({
    actualLines: [actualLine(1, 5000)],
    forecastLines: [comparator(1, 0)],
    baselineLines: [comparator(1, 0)]
  });
  assert.equal(lines[0].costVarianceToForecast, 5000);
  assert.equal(lines[0].costVarianceToForecastPct, null);
  assert.equal(lines[0].costVarianceToBaselinePct, null);
  const totals = summariseVariance(lines);
  assert.equal(totals.costVarianceToForecastPct, null);
});

test('variance totals aggregate across the full covered period range', () => {
  const lines = buildVarianceLines({
    actualLines: [actualLine(1, 110000), actualLine(2, 95000)],
    forecastLines: [comparator(1, 100000), comparator(2, 100000)],
    baselineLines: [comparator(1, 95000), comparator(2, 95000)]
  });
  const totals = summariseVariance(lines);
  assert.equal(totals.periodCount, 2);
  assert.equal(totals.actualCost, 205000);
  assert.equal(totals.costVarianceToForecast, 5000);
  assert.equal(totals.costVarianceToForecastPct, 2.5);
  assert.equal(totals.costVarianceToBaseline, 15000);
});

test('variance rejects periods missing from the pinned forecast or baseline', () => {
  assert.throws(() => buildVarianceLines({
    actualLines: [actualLine(5, 1000)],
    forecastLines: [comparator(1, 100000)],
    baselineLines: [comparator(5, 1000)]
  }), /no line in the pinned locked forecast/);
  assert.throws(() => buildVarianceLines({
    actualLines: [actualLine(1, 1000)],
    forecastLines: [comparator(1, 100000)],
    baselineLines: [comparator(2, 1000)]
  }), /no line in the locked baseline/);
});

test('the variance checksum embeds the pinned comparators: a different forecast lock version is a different report', () => {
  const lines = buildVarianceLines({
    actualLines: [actualLine(1, 110000)],
    forecastLines: [comparator(1, 100000)],
    baselineLines: [comparator(1, 95000)]
  });
  const pinsA = { comparatorLockVersionId: 'RFL-20270701-aaaa', comparatorChecksum: 'fc-checksum-a', actualsChecksum: 'act-checksum-1' };
  const pinsB = { comparatorLockVersionId: 'RFL-20270801-bbbb', comparatorChecksum: 'fc-checksum-b', actualsChecksum: 'act-checksum-1' };
  assert.equal(computeVarianceChecksum(lines, pinsA), computeVarianceChecksum(lines, pinsA));
  assert.notEqual(computeVarianceChecksum(lines, pinsA), computeVarianceChecksum(lines, pinsB));
});

test('a locked variance does not change when a newer forecast version exists: same pinned inputs, same result', () => {
  // Simulates the pinning guarantee: the report's lines are a pure function of
  // the PINNED actuals and PINNED forecast lines. A newer forecast (different
  // values) does not enter the calculation unless a NEW report pins it.
  const pinnedForecast = [comparator(1, 100000)];
  const newerForecast = [comparator(1, 120000)];
  const actuals = [actualLine(1, 110000)];
  const baseline = [comparator(1, 95000)];

  const before = buildVarianceLines({ actualLines: actuals, forecastLines: pinnedForecast, baselineLines: baseline });
  // ...a newer forecast is locked elsewhere; recalculating the SAME report
  // still uses the pinned forecast lines:
  const after = buildVarianceLines({ actualLines: actuals, forecastLines: pinnedForecast, baselineLines: baseline });
  assert.deepEqual(before, after, 'recalculation against pinned inputs is identical');

  const differentReport = buildVarianceLines({ actualLines: actuals, forecastLines: newerForecast, baselineLines: baseline });
  assert.notEqual(before[0].costVarianceToForecast, differentReport[0].costVarianceToForecast,
    'comparing against the newer version requires a different report with different pins');
});

test('the variance lifecycle matrix: draft recalculable, locked immutable', () => {
  const expectations: Array<[VarianceReportStatus, VarianceReportStatus, boolean]> = [
    ['draft', 'locked', true],
    ['draft', 'voided', true],
    ['locked', 'superseded', true],
    ['locked', 'voided', true],
    ['locked', 'draft', false],
    ['superseded', 'locked', false],
    ['voided', 'draft', false]
  ];
  for (const [from, to, expected] of expectations) {
    assert.equal(canTransitionVarianceStatus(from, to), expected, `${from} -> ${to}`);
  }
  assert.equal(isVarianceRecalculable('draft'), true);
  assert.equal(isVarianceRecalculable('locked'), false);
  assert.equal(isVarianceImmutable('locked'), true);
  assert.equal(isVarianceImmutable('superseded'), true);
  assert.equal(isVarianceImmutable('voided'), true);
});
