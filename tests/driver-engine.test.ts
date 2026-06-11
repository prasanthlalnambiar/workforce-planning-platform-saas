import test from 'node:test';
import assert from 'node:assert/strict';
import {
  driverImpactTreatment,
  phaseDriverImpact,
  signedDriverValue,
  summariseDriverImpacts,
  summariseDriverPortfolio,
  type DriverPlanningPeriod
} from '../lib/drivers/driver-engine';

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

test('monthly phasing supports straight-line, ramp-up, ramp-down and one-off methods', () => {
  const basePeriods = periods();
  const straightLine = phaseDriverImpact(basePeriods, {
    annualBudgetDelta: 1200,
    annualLabourCostDelta: 1200,
    annualRequiredFteDelta: 12,
    annualWorkloadHoursDelta: 120,
    phasingMethod: 'straight_line'
  });
  const rampUp = phaseDriverImpact(basePeriods, {
    annualBudgetDelta: 7800,
    annualLabourCostDelta: 7800,
    annualRequiredFteDelta: 7.8,
    annualWorkloadHoursDelta: 780,
    phasingMethod: 'ramp_up'
  });
  const rampDown = phaseDriverImpact(basePeriods, {
    annualBudgetDelta: 7800,
    annualLabourCostDelta: 7800,
    annualRequiredFteDelta: 7.8,
    annualWorkloadHoursDelta: 780,
    phasingMethod: 'ramp_down'
  });
  const oneOff = phaseDriverImpact(basePeriods, {
    annualBudgetDelta: 5000,
    annualLabourCostDelta: 4000,
    annualRequiredFteDelta: 0.5,
    annualWorkloadHoursDelta: 200,
    phasingMethod: 'one_off',
    oneOffPeriodIndex: 5
  });

  assert.equal(straightLine[0].budgetDelta, 100);
  assert.ok(rampUp[11].budgetDelta > rampUp[0].budgetDelta);
  assert.ok(rampDown[0].budgetDelta > rampDown[11].budgetDelta);
  assert.equal(oneOff.filter((impact) => impact.budgetDelta !== 0).length, 1);
  assert.equal(oneOff[5].budgetDelta, 5000);
  assert.equal(summariseDriverImpacts(rampUp).totalBudgetDelta, 7800);
  assert.equal(summariseDriverImpacts(rampDown).totalBudgetDelta, 7800);
});

test('driver lifecycle separates scenario-only proposed impact from approved official impact', () => {
  const proposedImpacts = phaseDriverImpact(periods(), {
    annualBudgetDelta: 120_000,
    annualLabourCostDelta: 100_000,
    annualRequiredFteDelta: 1,
    annualWorkloadHoursDelta: 900
  });
  const approvedImpacts = phaseDriverImpact(periods(), {
    annualBudgetDelta: -80_000,
    annualLabourCostDelta: -70_000,
    annualRequiredFteDelta: -0.7,
    annualWorkloadHoursDelta: -500
  });
  const portfolio = summariseDriverPortfolio([
    { status: 'draft', impacts: proposedImpacts },
    { status: 'proposed', impacts: proposedImpacts },
    { status: 'approved', impacts: approvedImpacts },
    { status: 'superseded', impacts: approvedImpacts },
    { status: 'voided', impacts: proposedImpacts }
  ]);

  assert.equal(driverImpactTreatment('draft'), 'draft_preview');
  assert.equal(driverImpactTreatment('proposed'), 'scenario_preview');
  assert.equal(driverImpactTreatment('approved'), 'official_impact');
  assert.equal(driverImpactTreatment('superseded'), 'excluded');
  assert.equal(driverImpactTreatment('voided'), 'excluded');
  assert.equal(portfolio.proposedBudgetDelta, 120_000);
  assert.equal(portfolio.officialBudgetDelta, -80_000);
});
