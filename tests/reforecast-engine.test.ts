import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDriverInclusionSnapshot,
  buildReforecastLines,
  buildScenarioOverlay,
  canTransitionReforecastStatus,
  computeReforecastChecksum,
  isReforecastImmutable,
  isReforecastRecalculable,
  reconcileReforecastLines,
  summariseReforecast,
  type ReforecastBaselineLine,
  type ReforecastDriverInput,
  type ReforecastStatus
} from '../lib/reforecast/reforecast-engine';

function makeBaseline(count = 12): ReforecastBaselineLine[] {
  return Array.from({ length: count }, (_, index) => {
    const month = index + 1;
    const mm = String(month).padStart(2, '0');
    return {
      periodId: `period-${mm}`,
      periodNumber: month,
      periodStart: `2027-${mm}-01`,
      periodEnd: `2027-${mm}-28`,
      budgetAmount: 100000,
      labourCost: 90000,
      requiredFte: 50,
      workloadHours: 8000
    };
  });
}

function driver(partial: Partial<ReforecastDriverInput> & Pick<ReforecastDriverInput, 'id' | 'lines'>): ReforecastDriverInput {
  return {
    driverCode: `DRV-${partial.id}`,
    driverName: `Driver ${partial.id}`,
    category: 'growth',
    impactType: 'cost_delta',
    status: 'approved',
    annualImpactAmount: partial.lines.reduce((sum, line) => sum + line.impactAmount, 0),
    ...partial
  };
}

const everyPeriod = (amount: number) => makeBaseline().map((line) => ({ periodId: line.periodId, impactAmount: amount }));

test('reforecast calculates from locked baseline plus approved drivers, period by period', () => {
  const lines = buildReforecastLines({
    baselineLines: makeBaseline(),
    approvedDrivers: [
      driver({ id: 'g1', category: 'growth', impactType: 'cost_delta', lines: everyPeriod(5000) }),
      driver({ id: 'e1', category: 'efficiency', impactType: 'cost_delta', lines: everyPeriod(-2000) })
    ]
  });
  assert.equal(lines.length, 12);
  for (const line of lines) {
    assert.equal(line.growthCostImpact, 5000);
    assert.equal(line.efficiencyCostImpact, -2000);
    assert.equal(line.totalCostImpact, 3000);
    assert.equal(line.forecastBudgetAmount, 103000);
    assert.equal(line.forecastLabourCost, 93000);
  }
  const totals = summariseReforecast(lines);
  assert.equal(totals.baselineBudget, 1200000);
  assert.equal(totals.totalCostImpact, 36000);
  assert.equal(totals.forecastBudget, 1236000);
  assert.equal(totals.categoryCostImpacts.growth, 60000);
  assert.equal(totals.categoryCostImpacts.efficiency, -24000);
});

test('all five driver categories are broken down separately in the forecast lines', () => {
  const lines = buildReforecastLines({
    baselineLines: makeBaseline(1),
    approvedDrivers: [
      driver({ id: 'g', category: 'growth', lines: [{ periodId: 'period-01', impactAmount: 100 }] }),
      driver({ id: 'e', category: 'efficiency', lines: [{ periodId: 'period-01', impactAmount: -50 }] }),
      driver({ id: 'c', category: 'cost_change', lines: [{ periodId: 'period-01', impactAmount: 25 }] }),
      driver({ id: 's', category: 'supply_change', lines: [{ periodId: 'period-01', impactAmount: 10 }] }),
      driver({ id: 'm', category: 'management_adjustment', lines: [{ periodId: 'period-01', impactAmount: -5 }] })
    ]
  });
  const line = lines[0];
  assert.equal(line.growthCostImpact, 100);
  assert.equal(line.efficiencyCostImpact, -50);
  assert.equal(line.costChangeCostImpact, 25);
  assert.equal(line.supplyChangeCostImpact, 10);
  assert.equal(line.managementAdjustmentCostImpact, -5);
  assert.equal(line.totalCostImpact, 80);
  assert.equal(line.forecastBudgetAmount, 100080);
  assert.equal(reconcileReforecastLines(lines).reconciles, true);
});

test('fte and workload drivers move their own forecast measures, not the budget', () => {
  const lines = buildReforecastLines({
    baselineLines: makeBaseline(1),
    approvedDrivers: [
      driver({ id: 'f', impactType: 'fte_delta', lines: [{ periodId: 'period-01', impactAmount: 4 }] }),
      driver({ id: 'w', impactType: 'workload_hours_delta', lines: [{ periodId: 'period-01', impactAmount: -300 }] })
    ]
  });
  const line = lines[0];
  assert.equal(line.forecastBudgetAmount, 100000);
  assert.equal(line.totalFteImpact, 4);
  assert.equal(line.forecastRequiredFte, 54);
  assert.equal(line.totalWorkloadHoursImpact, -300);
  assert.equal(line.forecastWorkloadHours, 7700);
});

test('proposed and draft drivers are rejected from the official forecast calculation', () => {
  assert.throws(() => buildReforecastLines({
    baselineLines: makeBaseline(1),
    approvedDrivers: [driver({ id: 'p', status: 'proposed', lines: everyPeriod(100) })]
  }), /Only approved drivers can feed the official forecast/);
  assert.throws(() => buildReforecastLines({
    baselineLines: makeBaseline(1),
    approvedDrivers: [driver({ id: 'd', status: 'draft', lines: everyPeriod(100) })]
  }), /Only approved drivers can feed the official forecast/);
  assert.throws(() => buildDriverInclusionSnapshot([driver({ id: 'p', status: 'proposed', lines: [] })]), /Only approved drivers/);
});

test('proposed drivers can appear only in the scenario overlay, leaving the official forecast untouched', () => {
  const officialLines = buildReforecastLines({ baselineLines: makeBaseline(2), approvedDrivers: [] });
  const overlay = buildScenarioOverlay({
    officialLines,
    proposedDrivers: [driver({ id: 'p', status: 'proposed', lines: [{ periodId: 'period-01', impactAmount: 7000 }] })]
  });
  assert.equal(overlay[0].officialForecastBudget, 100000, 'official forecast is unchanged by proposed drivers');
  assert.equal(overlay[0].scenarioForecastBudget, 107000);
  assert.equal(overlay[1].scenarioForecastBudget, 100000);
  assert.equal(officialLines[0].forecastBudgetAmount, 100000);
  assert.throws(() => buildScenarioOverlay({ officialLines, proposedDrivers: [driver({ id: 'a', status: 'approved', lines: [] })] }), /proposed drivers only/);
});

test('recalculation is deterministic: identical inputs produce an identical checksum', () => {
  const drivers = [driver({ id: 'g1', lines: everyPeriod(1234.56) })];
  const first = buildReforecastLines({ baselineLines: makeBaseline(), approvedDrivers: drivers });
  const second = buildReforecastLines({ baselineLines: makeBaseline(), approvedDrivers: drivers });
  const checksumA = computeReforecastChecksum(first, buildDriverInclusionSnapshot(drivers));
  const checksumB = computeReforecastChecksum(second, buildDriverInclusionSnapshot(drivers));
  assert.equal(checksumA, checksumB);
  assert.match(checksumA, /^[0-9a-f]{64}$/);
});

test('the lock checksum changes when any line value or included driver changes', () => {
  const base = [driver({ id: 'g1', lines: everyPeriod(1000) })];
  const changedAmount = [driver({ id: 'g1', lines: everyPeriod(1000.01) })];
  const extraDriver = [...base, driver({ id: 'e1', category: 'efficiency', lines: everyPeriod(-1) })];
  const checksum = (drivers: ReforecastDriverInput[]) =>
    computeReforecastChecksum(buildReforecastLines({ baselineLines: makeBaseline(), approvedDrivers: drivers }), buildDriverInclusionSnapshot(drivers));
  assert.notEqual(checksum(base), checksum(changedAmount));
  assert.notEqual(checksum(base), checksum(extraDriver));
});

test('reconciliation rejects forecast lines that do not equal baseline plus impact', () => {
  const lines = buildReforecastLines({ baselineLines: makeBaseline(1), approvedDrivers: [] });
  lines[0].forecastBudgetAmount = 999999;
  assert.equal(reconcileReforecastLines(lines).reconciles, false);
});

test('the reforecast lifecycle matrix matches the governance design', () => {
  const expectations: Array<[ReforecastStatus, ReforecastStatus, boolean]> = [
    ['draft', 'in_review', true],
    ['draft', 'locked', false],
    ['draft', 'voided', true],
    ['in_review', 'draft', true],
    ['in_review', 'locked', true],
    ['in_review', 'voided', true],
    ['locked', 'superseded', true],
    ['locked', 'voided', true],
    ['locked', 'draft', false],
    ['locked', 'in_review', false],
    ['superseded', 'locked', false],
    ['voided', 'draft', false]
  ];
  for (const [from, to, expected] of expectations) {
    assert.equal(canTransitionReforecastStatus(from, to), expected, `${from} -> ${to}`);
  }
  assert.equal(isReforecastRecalculable('draft'), true);
  assert.equal(isReforecastRecalculable('in_review'), false, 'in-review forecasts are controlled, not recalculable');
  assert.equal(isReforecastRecalculable('locked'), false);
  assert.equal(isReforecastImmutable('locked'), true);
  assert.equal(isReforecastImmutable('superseded'), true);
  assert.equal(isReforecastImmutable('voided'), true);
  assert.equal(isReforecastImmutable('draft'), false);
});

test('a baseline with no approved drivers produces a forecast equal to the baseline', () => {
  const lines = buildReforecastLines({ baselineLines: makeBaseline(3), approvedDrivers: [] });
  for (const line of lines) {
    assert.equal(line.forecastBudgetAmount, line.baselineBudgetAmount);
    assert.equal(line.totalCostImpact, 0);
  }
  assert.throws(() => buildReforecastLines({ baselineLines: [], approvedDrivers: [] }), /locked baseline with phased lines is required/);
});
