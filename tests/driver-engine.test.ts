import test from 'node:test';
import assert from 'node:assert/strict';
import { phaseDriverImpact, signedDriverValue, summariseDriverImpacts, type DriverPlanningPeriod } from '../lib/drivers/driver-engine';

function periods(): DriverPlanningPeriod[] {
  return Array.from({ length: 12 }, (_, index) => ({
    periodId: `period-${index + 1}`,
    budgetBaselineLineId: `line-${index + 1}`,
    periodStart: `2027-${String(index + 1).padStart(2, '0')}-01`,
    periodEnd: `2027-${String(index + 1).padStart(2, '0')}-28`
  }));
}

test('driver impact phasing allocates annual deltas across 12 baseline periods', () => {
  const impacts = phaseDriverImpact(periods(), {
    annualBudgetDelta: 120_000,
    annualLabourCostDelta: 96_000,
    annualRequiredFteDelta: 2.4,
    annualWorkloadHoursDelta: 1800
  });

  assert.equal(impacts.length, 12);
  assert.equal(impacts[0].budgetDelta, 10_000);
  assert.equal(impacts[0].requiredFteDelta, 0.2);
  assert.deepEqual(summariseDriverImpacts(impacts), {
    totalBudgetDelta: 120_000,
    totalLabourCostDelta: 96_000,
    totalRequiredFteDelta: 2.4,
    totalWorkloadHoursDelta: 1800
  });
});

test('driver phasing preserves residual cents and fractional FTE on the final period', () => {
  const impacts = phaseDriverImpact(periods(), {
    annualBudgetDelta: 100_000,
    annualLabourCostDelta: 33_333.33,
    annualRequiredFteDelta: 1,
    annualWorkloadHoursDelta: 100
  });
  const summary = summariseDriverImpacts(impacts);

  assert.equal(summary.totalBudgetDelta, 100_000);
  assert.equal(summary.totalLabourCostDelta, 33_333.33);
  assert.equal(summary.totalRequiredFteDelta, 1);
  assert.equal(summary.totalWorkloadHoursDelta, 100);
});

test('driver direction is explicit and controls sign', () => {
  assert.equal(signedDriverValue(250_000, 'increase'), 250_000);
  assert.equal(signedDriverValue(250_000, 'decrease'), -250_000);
  assert.equal(signedDriverValue(-250_000, 'decrease'), -250_000);
});
