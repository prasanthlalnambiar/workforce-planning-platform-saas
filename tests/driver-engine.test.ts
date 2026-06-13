import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateDriverImpactsByPeriod,
  assertValidDriverInput,
  buildDriverPhasingLines,
  buildImpactPreview,
  canTransitionDriverStatus,
  distributeByWeights,
  feedsOfficialForecast,
  feedsScenariosOnly,
  isDriverEditable,
  reconcileDriverLines,
  round2,
  type DriverPlanningPeriod,
  type DriverStatus
} from '../lib/drivers/driver-engine';

function makePeriods(count = 12): DriverPlanningPeriod[] {
  return Array.from({ length: count }, (_, index) => {
    const month = index + 1;
    const mm = String(month).padStart(2, '0');
    return {
      id: `period-${mm}`,
      periodNumber: month,
      periodStart: `2027-${mm}-01`,
      periodEnd: `2027-${mm}-28`,
      periodLabel: `P${mm}`
    };
  });
}

const sum = (lines: { impactAmount: number }[]) => lines.reduce((total, line) => round2(total + line.impactAmount), 0);

test('straight-line phasing splits the annual amount evenly with the residual in the final active period', () => {
  const lines = buildDriverPhasingLines({
    periods: makePeriods(),
    annualImpactAmount: 100,
    phasingModel: 'straight_line',
    startPeriodNumber: 1,
    endPeriodNumber: 12
  });
  assert.equal(lines.length, 12);
  assert.equal(sum(lines), 100);
  assert.equal(lines[0].impactAmount, 8.33);
  assert.equal(lines[11].impactAmount, round2(100 - 8.33 * 11));
});

test('straight-line phasing over a partial window leaves explicit zeros outside the window', () => {
  const lines = buildDriverPhasingLines({
    periods: makePeriods(),
    annualImpactAmount: -120000,
    phasingModel: 'straight_line',
    startPeriodNumber: 4,
    endPeriodNumber: 9
  });
  assert.equal(lines.length, 12);
  assert.equal(sum(lines), -120000);
  assert.equal(lines[0].impactAmount, 0);
  assert.equal(lines[2].impactAmount, 0);
  assert.equal(lines[3].impactAmount, -20000);
  assert.equal(lines[8].impactAmount, -20000);
  assert.equal(lines[9].impactAmount, 0);
});

test('ramp-up phasing increases monotonically across the window and reconciles exactly', () => {
  const lines = buildDriverPhasingLines({
    periods: makePeriods(),
    annualImpactAmount: 60000,
    phasingModel: 'ramp_up',
    startPeriodNumber: 1,
    endPeriodNumber: 4
  });
  const window = lines.slice(0, 4).map((line) => line.impactAmount);
  assert.equal(sum(lines), 60000);
  assert.ok(window[0] < window[1] && window[1] < window[2] && window[2] <= window[3], `expected increasing ramp, got ${window.join(', ')}`);
  assert.equal(window[0], 6000);
  assert.equal(window[1], 12000);
  assert.equal(window[2], 18000);
  assert.equal(window[3], 24000);
});

test('ramp-down phasing mirrors ramp-up in reverse', () => {
  const up = buildDriverPhasingLines({ periods: makePeriods(), annualImpactAmount: 60000, phasingModel: 'ramp_up', startPeriodNumber: 1, endPeriodNumber: 4 });
  const down = buildDriverPhasingLines({ periods: makePeriods(), annualImpactAmount: 60000, phasingModel: 'ramp_down', startPeriodNumber: 1, endPeriodNumber: 4 });
  assert.equal(down[0].impactAmount, 24000);
  assert.equal(down[3].impactAmount, up[0].impactAmount);
  assert.equal(sum(down), 60000);
});

test('one-off phasing places the full signed amount in the named period only', () => {
  const lines = buildDriverPhasingLines({
    periods: makePeriods(),
    annualImpactAmount: -50000,
    phasingModel: 'one_off',
    startPeriodNumber: 1,
    endPeriodNumber: 12,
    oneOffPeriodNumber: 7
  });
  assert.equal(lines[6].impactAmount, -50000);
  assert.equal(sum(lines), -50000);
  assert.equal(lines.filter((line) => line.impactAmount !== 0).length, 1);
});

test('one-off phasing requires a one-off period inside the window', () => {
  assert.throws(() => buildDriverPhasingLines({
    periods: makePeriods(), annualImpactAmount: 100, phasingModel: 'one_off', startPeriodNumber: 1, endPeriodNumber: 6
  }), /One-off drivers require a one-off period/);
  assert.throws(() => buildDriverPhasingLines({
    periods: makePeriods(), annualImpactAmount: 100, phasingModel: 'one_off', startPeriodNumber: 1, endPeriodNumber: 6, oneOffPeriodNumber: 9
  }), /within the driver phasing window/);
});

test('invalid windows and amounts are rejected deterministically', () => {
  assert.throws(() => buildDriverPhasingLines({ periods: makePeriods(), annualImpactAmount: 100, phasingModel: 'straight_line', startPeriodNumber: 8, endPeriodNumber: 3 }), /start period must not be after/);
  assert.throws(() => buildDriverPhasingLines({ periods: makePeriods(), annualImpactAmount: 100, phasingModel: 'straight_line', startPeriodNumber: 0, endPeriodNumber: 5 }), /within the fiscal year/);
  assert.throws(() => buildDriverPhasingLines({ periods: makePeriods(), annualImpactAmount: 0, phasingModel: 'straight_line', startPeriodNumber: 1, endPeriodNumber: 12 }), /non-zero/);
  assert.throws(() => buildDriverPhasingLines({ periods: [], annualImpactAmount: 100, phasingModel: 'straight_line', startPeriodNumber: 1, endPeriodNumber: 12 }), /Planning periods are required/);
});

test('weight distribution always reconciles, including awkward totals and negative amounts', () => {
  for (const total of [100, -100, 33.33, -99999.97, 1, -0.05]) {
    for (const weights of [[1, 1, 1], [1, 2, 3, 4, 5], [5, 4, 3, 2, 1], [1]]) {
      const values = distributeByWeights(total, weights);
      assert.equal(values.reduce((sum2, value) => round2(sum2 + value), 0), round2(total), `total ${total} weights ${weights.join(',')}`);
    }
  }
});

test('reconcileDriverLines flags drift beyond a cent', () => {
  assert.equal(reconcileDriverLines(100, [{ impactAmount: 50 }, { impactAmount: 50 }]).reconciles, true);
  assert.equal(reconcileDriverLines(100, [{ impactAmount: 50 }, { impactAmount: 49.5 }]).reconciles, false);
  assert.equal(reconcileDriverLines(100, [{ impactAmount: 50 }, { impactAmount: 49.5 }]).difference, 0.5);
});

test('aggregation sums by impact type across drivers per period', () => {
  const totals = aggregateDriverImpactsByPeriod([
    { id: 'a', impactType: 'cost_delta', status: 'approved', lines: [{ periodId: 'p1', impactAmount: 100 }, { periodId: 'p2', impactAmount: 200 }] },
    { id: 'b', impactType: 'cost_delta', status: 'approved', lines: [{ periodId: 'p1', impactAmount: -40 }] },
    { id: 'c', impactType: 'fte_delta', status: 'approved', lines: [{ periodId: 'p1', impactAmount: 2.5 }] }
  ]);
  assert.deepEqual(totals.get('p1'), { fteDelta: 2.5, costDelta: 60, workloadHoursDelta: 0 });
  assert.deepEqual(totals.get('p2'), { fteDelta: 0, costDelta: 200, workloadHoursDelta: 0 });
});

test('impact preview applies approved drivers to the official view and proposed drivers to the scenario view only', () => {
  const baselineLines = [
    { periodId: 'p1', periodStart: '2027-01-01', budgetAmount: 1000, labourCost: 900, requiredFte: 10, workloadHours: 1600 },
    { periodId: 'p2', periodStart: '2027-02-01', budgetAmount: 1000, labourCost: 900, requiredFte: 10, workloadHours: 1600 }
  ];
  const preview = buildImpactPreview({
    baselineLines,
    approvedDrivers: [{ id: 'a', impactType: 'cost_delta', status: 'approved', lines: [{ periodId: 'p1', impactAmount: -100 }, { periodId: 'p2', impactAmount: -100 }] }],
    proposedDrivers: [{ id: 'b', impactType: 'fte_delta', status: 'proposed', lines: [{ periodId: 'p2', impactAmount: 3 }] }]
  });

  assert.equal(preview.rows[0].approvedBudget, 900);
  assert.equal(preview.rows[0].scenarioBudget, 900);
  assert.equal(preview.rows[0].approvedRequiredFte, 10);
  assert.equal(preview.rows[1].approvedRequiredFte, 10, 'proposed FTE driver must not move the official view');
  assert.equal(preview.rows[1].scenarioRequiredFte, 13, 'proposed FTE driver moves the scenario view only');
  assert.equal(preview.totals.baselineBudget, 2000);
  assert.equal(preview.totals.approvedBudget, 1800);
  assert.equal(preview.totals.approvedBudgetDelta, -200);
  assert.equal(preview.totals.scenarioFteDelta, 3);
  assert.equal(preview.totals.approvedFteDelta, 0);
});

test('the status transition matrix matches the governance design', () => {
  const expectations: Array<[DriverStatus, DriverStatus, boolean]> = [
    ['draft', 'proposed', true],
    ['draft', 'approved', false],
    ['draft', 'voided', true],
    ['proposed', 'approved', true],
    ['proposed', 'draft', true],
    ['proposed', 'voided', true],
    ['approved', 'superseded', true],
    ['approved', 'draft', false],
    ['approved', 'proposed', false],
    ['approved', 'voided', false],
    ['superseded', 'draft', false],
    ['voided', 'draft', false]
  ];
  for (const [from, to, expected] of expectations) {
    assert.equal(canTransitionDriverStatus(from, to), expected, `${from} -> ${to}`);
  }
});

test('only approved drivers feed the official forecast; proposed drivers feed scenarios only', () => {
  assert.equal(feedsOfficialForecast('approved'), true);
  assert.equal(feedsOfficialForecast('proposed'), false);
  assert.equal(feedsOfficialForecast('draft'), false);
  assert.equal(feedsScenariosOnly('proposed'), true);
  assert.equal(feedsScenariosOnly('approved'), false);
  assert.equal(isDriverEditable('draft'), true);
  assert.equal(isDriverEditable('proposed'), true);
  assert.equal(isDriverEditable('approved'), false);
  assert.equal(isDriverEditable('superseded'), false);
});

test('driver field validation rejects unknown enums and zero impact', () => {
  const valid = { driverName: 'AI deflection', category: 'efficiency', impactType: 'cost_delta', annualImpactAmount: -100, phasingModel: 'ramp_up', confidenceRating: 'high' };
  assert.doesNotThrow(() => assertValidDriverInput(valid));
  assert.throws(() => assertValidDriverInput({ ...valid, driverName: ' ' }), /name is required/);
  assert.throws(() => assertValidDriverInput({ ...valid, category: 'magic' }), /Unknown driver category/);
  assert.throws(() => assertValidDriverInput({ ...valid, impactType: 'vibes' }), /Unknown driver impact type/);
  assert.throws(() => assertValidDriverInput({ ...valid, phasingModel: 'hockey_stick' }), /Unknown driver phasing model/);
  assert.throws(() => assertValidDriverInput({ ...valid, confidenceRating: 'certain' }), /Unknown driver confidence rating/);
  assert.throws(() => assertValidDriverInput({ ...valid, annualImpactAmount: 0 }), /non-zero/);
  assert.throws(() => assertValidDriverInput({ ...valid, annualImpactAmount: Number.NaN }), /finite/);
});
