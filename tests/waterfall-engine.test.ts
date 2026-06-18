import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessWaterfallReadiness,
  buildWaterfallBridge,
  validatePinnedSources,
  DRIVER_CATEGORY_ORDER,
  type BridgeReforecastLine,
  type BridgeVarianceLine,
  type PinnedSourceStatuses,
  type PinnedSourceValues
} from '../lib/waterfall/waterfall-engine';

function reforecastLine(periodNumber: number, opts: Partial<BridgeReforecastLine> = {}): BridgeReforecastLine {
  const baseline = opts.baselineBudgetAmount ?? 100000;
  const growth = opts.growthCostImpact ?? 5000;
  const efficiency = opts.efficiencyCostImpact ?? 0;
  const costChange = opts.costChangeCostImpact ?? 0;
  const supplyChange = opts.supplyChangeCostImpact ?? 0;
  const management = opts.managementAdjustmentCostImpact ?? 0;
  const forecast = opts.forecastBudgetAmount ?? baseline + growth + efficiency + costChange + supplyChange + management;
  return {
    planningPeriodId: `period-${periodNumber}`,
    periodNumber,
    baselineBudgetAmount: baseline,
    growthCostImpact: growth,
    efficiencyCostImpact: efficiency,
    costChangeCostImpact: costChange,
    supplyChangeCostImpact: supplyChange,
    managementAdjustmentCostImpact: management,
    forecastBudgetAmount: forecast
  };
}

function varianceLine(periodNumber: number, opts: Partial<BridgeVarianceLine> = {}): BridgeVarianceLine {
  const baseline = opts.baselineCost ?? 100000;
  const forecast = opts.forecastCost ?? 105000;
  const actual = opts.actualCost ?? 110000;
  return {
    planningPeriodId: `period-${periodNumber}`,
    periodNumber,
    periodLabel: `2027-0${periodNumber}`,
    actualCost: actual,
    forecastCost: forecast,
    baselineCost: baseline,
    costVarianceToForecast: opts.costVarianceToForecast ?? actual - forecast,
    costVarianceToBaseline: opts.costVarianceToBaseline ?? actual - baseline
  };
}

test('the bridge reconciles baseline + approved driver categories = locked forecast', () => {
  const bridge = buildWaterfallBridge({
    reforecastLines: [reforecastLine(1)],
    varianceLines: [varianceLine(1)]
  });
  assert.equal(bridge.totals.baselineCost, 100000);
  assert.equal(bridge.totals.driverImpactTotal, 5000);
  assert.equal(bridge.totals.forecastCost, 105000);
  assert.equal(bridge.reconciliation.baselinePlusDriversEqualsForecast, true);
});

test('the bridge reconciles locked forecast + variance = actual result', () => {
  const bridge = buildWaterfallBridge({
    reforecastLines: [reforecastLine(1)],
    varianceLines: [varianceLine(1)]
  });
  assert.equal(bridge.totals.forecastCost, 105000);
  assert.equal(bridge.totals.varianceToForecast, 5000);
  assert.equal(bridge.totals.actualCost, 110000);
  assert.equal(bridge.reconciliation.forecastPlusVarianceEqualsActual, true);
  assert.equal(bridge.reconciliation.allReconciled, true);
});

test('driver impact is attributed to the correct categories from the pinned reforecast lines', () => {
  const bridge = buildWaterfallBridge({
    reforecastLines: [reforecastLine(1, { growthCostImpact: 4000, efficiencyCostImpact: -1500, costChangeCostImpact: 2000, supplyChangeCostImpact: 500, managementAdjustmentCostImpact: 1000, forecastBudgetAmount: 106000 })],
    varianceLines: [varianceLine(1, { forecastCost: 106000, actualCost: 110000, costVarianceToForecast: 4000 })]
  });
  assert.equal(bridge.totals.categoryImpacts.growth, 4000);
  assert.equal(bridge.totals.categoryImpacts.efficiency, -1500);
  assert.equal(bridge.totals.categoryImpacts.cost_change, 2000);
  assert.equal(bridge.totals.categoryImpacts.supply_change, 500);
  assert.equal(bridge.totals.categoryImpacts.management_adjustment, 1000);
  assert.equal(bridge.totals.driverImpactTotal, 6000);
  assert.equal(bridge.reconciliation.baselinePlusDriversEqualsForecast, true);
});

test('period-level waterfall totals reconcile to the full-year total', () => {
  const bridge = buildWaterfallBridge({
    reforecastLines: [reforecastLine(1), reforecastLine(2), reforecastLine(3)],
    varianceLines: [varianceLine(1), varianceLine(2), varianceLine(3)]
  });
  assert.equal(bridge.periods.length, 3);
  assert.equal(bridge.totals.baselineCost, 300000);
  assert.equal(bridge.totals.forecastCost, 315000);
  assert.equal(bridge.totals.actualCost, 330000);
  // Sum of period baselines/forecasts/actuals equals the FY totals.
  assert.equal(bridge.periods.reduce((t, p) => t + p.baselineCost, 0), bridge.totals.baselineCost);
  assert.equal(bridge.periods.reduce((t, p) => t + p.forecastCost, 0), bridge.totals.forecastCost);
  assert.equal(bridge.periods.reduce((t, p) => t + p.actualCost, 0), bridge.totals.actualCost);
  assert.equal(bridge.reconciliation.periodsReconcileToTotal, true);
  assert.equal(bridge.reconciliation.allReconciled, true);
});

test('the bridge steps run in finance order with correct running totals', () => {
  const bridge = buildWaterfallBridge({
    reforecastLines: [reforecastLine(1)],
    varianceLines: [varianceLine(1)]
  });
  const keys = bridge.steps.map((s) => s.key);
  assert.deepEqual(keys, ['baseline', 'driver_growth', 'driver_efficiency', 'driver_cost_change', 'driver_supply_change', 'driver_management_adjustment', 'forecast', 'variance', 'actual']);
  // Running total at the forecast subtotal equals forecast; at actual equals actual.
  const forecastStep = bridge.steps.find((s) => s.key === 'forecast');
  const actualStep = bridge.steps.find((s) => s.key === 'actual');
  assert.equal(forecastStep?.runningTotal, 105000);
  assert.equal(actualStep?.runningTotal, 110000);
});

test('the bridge surfaces a non-reconciling state rather than silently balancing', () => {
  // Baseline + drivers (105000) does NOT equal the variance line forecast (108000).
  const bridge = buildWaterfallBridge({
    reforecastLines: [reforecastLine(1, { forecastBudgetAmount: 105000 })],
    varianceLines: [varianceLine(1, { forecastCost: 108000, actualCost: 110000, costVarianceToForecast: 2000 })]
  });
  assert.equal(bridge.reconciliation.baselinePlusDriversEqualsForecast, false);
  assert.equal(bridge.reconciliation.allReconciled, false);
  assert.ok(bridge.reconciliation.maxResidual >= 3000);
});

test('a covered period missing from the pinned reforecast lines is rejected, never invented', () => {
  assert.throws(() => buildWaterfallBridge({
    reforecastLines: [reforecastLine(1)],
    varianceLines: [varianceLine(1), varianceLine(2)]
  }), /has no pinned reforecast line/);
});

test('the bridge is read-only over its inputs: building it does not mutate the source arrays', () => {
  const reforecastLines = [reforecastLine(1), reforecastLine(2)];
  const varianceLines = [varianceLine(2), varianceLine(1)];
  const reforecastSnapshot = JSON.stringify(reforecastLines);
  const varianceSnapshot = JSON.stringify(varianceLines);
  buildWaterfallBridge({ reforecastLines, varianceLines });
  assert.equal(JSON.stringify(reforecastLines), reforecastSnapshot, 'reforecast input not mutated');
  assert.equal(JSON.stringify(varianceLines), varianceSnapshot, 'variance input not mutated');
});

test('variance to baseline is carried through from the pinned variance lines', () => {
  const bridge = buildWaterfallBridge({
    reforecastLines: [reforecastLine(1)],
    varianceLines: [varianceLine(1, { baselineCost: 100000, actualCost: 110000, costVarianceToBaseline: 10000 })]
  });
  assert.equal(bridge.totals.varianceToBaseline, 10000);
});

test('readiness assessment requires every locked source, in priority order', () => {
  const ready = { hasLockedBaseline: true, hasLockedForecast: true, hasPostedActuals: true, hasLockedVariance: true, hasReforecastLines: true, hasVarianceLines: true };
  assert.equal(assessWaterfallReadiness(ready), 'ready');
  assert.equal(assessWaterfallReadiness({ ...ready, hasLockedBaseline: false }), 'no_locked_baseline');
  assert.equal(assessWaterfallReadiness({ ...ready, hasLockedForecast: false }), 'no_locked_forecast');
  assert.equal(assessWaterfallReadiness({ ...ready, hasPostedActuals: false }), 'no_posted_actuals');
  assert.equal(assessWaterfallReadiness({ ...ready, hasLockedVariance: false }), 'no_locked_variance');
  assert.equal(assessWaterfallReadiness({ ...ready, hasVarianceLines: false }), 'incomplete_inputs');
  assert.equal(assessWaterfallReadiness({ ...ready, hasReforecastLines: false }), 'incomplete_inputs');
});

test('all five driver categories are represented in the bridge category order', () => {
  assert.deepEqual(DRIVER_CATEGORY_ORDER, ['growth', 'efficiency', 'cost_change', 'supply_change', 'management_adjustment']);
});

function validStatuses(): PinnedSourceStatuses {
  return { baselineStatus: 'locked', reforecastStatus: 'locked', actualsStatus: 'posted', varianceStatus: 'locked' };
}
function validValues(): PinnedSourceValues {
  return {
    comparatorLockVersionId: 'RFL-1', comparatorChecksum: 'fc-1', actualsChecksum: 'act-1', actualsVersionNumber: 1, baselineChecksum: 'bl-1',
    reforecastLockVersionId: 'RFL-1', reforecastChecksum: 'fc-1', actualsBatchChecksum: 'act-1', actualsBatchVersionNumber: 1, budgetBaselineChecksum: 'bl-1'
  };
}

test('validatePinnedSources accepts fully consistent locked/posted/pinned sources', () => {
  assert.deepEqual(validatePinnedSources(validStatuses(), validValues()), []);
  // A superseded forecast or variance anchor is still valid (was locked).
  assert.deepEqual(validatePinnedSources({ ...validStatuses(), reforecastStatus: 'superseded', varianceStatus: 'superseded' }, validValues()), []);
});

test('validatePinnedSources rejects unlocked/draft/voided/missing upstream statuses', () => {
  assert.ok(validatePinnedSources({ ...validStatuses(), baselineStatus: 'draft' }, validValues()).some((i) => /baseline is not locked/.test(i)));
  assert.ok(validatePinnedSources({ ...validStatuses(), baselineStatus: null }, validValues()).some((i) => /baseline is not locked/.test(i)));
  assert.ok(validatePinnedSources({ ...validStatuses(), reforecastStatus: 'in_review' }, validValues()).some((i) => /forecast is not locked/.test(i)));
  assert.ok(validatePinnedSources({ ...validStatuses(), reforecastStatus: 'voided' }, validValues()).some((i) => /forecast is not locked/.test(i)));
  assert.ok(validatePinnedSources({ ...validStatuses(), actualsStatus: 'validated' }, validValues()).some((i) => /actuals batch is not posted/.test(i)));
  assert.ok(validatePinnedSources({ ...validStatuses(), varianceStatus: 'voided' }, validValues()).some((i) => /anchor is not locked/.test(i)));
});

test('validatePinnedSources rejects each kind of pin drift', () => {
  assert.ok(validatePinnedSources(validStatuses(), { ...validValues(), reforecastLockVersionId: 'RFL-2' }).some((i) => /lock version no longer matches/.test(i)));
  assert.ok(validatePinnedSources(validStatuses(), { ...validValues(), reforecastChecksum: 'fc-2' }).some((i) => /Forecast checksum no longer matches/.test(i)));
  assert.ok(validatePinnedSources(validStatuses(), { ...validValues(), actualsBatchChecksum: 'act-2' }).some((i) => /Actuals checksum no longer matches/.test(i)));
  assert.ok(validatePinnedSources(validStatuses(), { ...validValues(), actualsBatchVersionNumber: 2 }).some((i) => /version number no longer matches/.test(i)));
  assert.ok(validatePinnedSources(validStatuses(), { ...validValues(), budgetBaselineChecksum: 'bl-2' }).some((i) => /Baseline checksum no longer matches/.test(i)));
});

test('validatePinnedSources skips the baseline checksum check only when the report pinned none', () => {
  // No pinned baseline checksum: a differing live checksum is not flagged.
  const noPin = { ...validValues(), baselineChecksum: null, budgetBaselineChecksum: 'bl-anything' };
  assert.ok(!validatePinnedSources(validStatuses(), noPin).some((i) => /Baseline checksum/.test(i)));
  // Pinned baseline checksum present but live value missing: flagged.
  const missingLive = { ...validValues(), baselineChecksum: 'bl-1', budgetBaselineChecksum: null };
  assert.ok(validatePinnedSources(validStatuses(), missingLive).some((i) => /Baseline checksum/.test(i)));
});
