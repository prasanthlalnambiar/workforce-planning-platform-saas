import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateBudgetVariance,
  calculateConfidenceScore,
  calculateLabourCost,
  calculateLayer1Output,
  calculateMonthlyInputWorkloadHours,
  calculateProductiveHoursPerFte,
  calculateRequiredFte,
  calculateSourceQualityScore,
  calculateWorkloadHours,
  compareLayer1Scenarios,
  generateRiskFlags,
  starterScenarios
} from '../lib/layer1/calculation-engine';
import type { Layer1Assumptions, Layer1DemandInput } from '../lib/layer1/calculation-types';

const demandInputs: Layer1DemandInput[] = [
  { category: 'measured_contact', frequency: 'monthly', workTypeLabel: 'Calls', sourceId: 'src-1', sourceQualityScore: 90, volume: 1200, effortMinutes: 6, confidenceScore: 85 },
  { category: 'measured_case', frequency: 'monthly', workTypeLabel: 'Cases', sourceId: 'src-2', sourceQualityScore: 80, volume: 300, effortMinutes: 18, confidenceScore: 75 },
  { category: 'hidden_internal', frequency: 'monthly', workTypeLabel: 'Huddles and research', sourceQualityScore: 45, hiddenWorkHours: 180, confidenceScore: 50 },
  { category: 'project_ad_hoc', frequency: 'monthly', workTypeLabel: 'Project support', sourceId: 'src-3', sourceQualityScore: 70, hiddenWorkHours: 80, confidenceScore: 65 }
];

const assumptions: Layer1Assumptions = {
  workingDays: 20,
  weeksPerMonth: 4.33,
  hoursPerDay: 7.5,
  utilisation: 0.82,
  shrinkage: 0.18,
  currentSupplyFte: 8,
  annualCostPerFte: 95000,
  annualBudgetTarget: 850000,
  confidenceScore: 70
};

test('calculates measured, estimated, hidden and total workload hours', () => {
  const workload = calculateWorkloadHours(demandInputs, assumptions);
  assert.equal(workload.measuredContactHours, 120);
  assert.equal(workload.measuredCaseHours, 90);
  assert.equal(workload.estimatedWorkloadHours, 80);
  assert.equal(workload.hiddenWorkloadHours, 180);
  assert.equal(workload.totalWorkloadHours, 470);
});

test('normalises monthly input workload into monthly hours', () => {
  const input: Layer1DemandInput = { category: 'measured_contact', frequency: 'monthly', workTypeLabel: 'Calls', volume: 60, effortMinutes: 10 };
  assert.equal(calculateMonthlyInputWorkloadHours(input, assumptions), 10);
});

test('normalises weekly input workload using weeks per month', () => {
  const input: Layer1DemandInput = { category: 'measured_contact', frequency: 'weekly', workTypeLabel: 'Calls', volume: 60, effortMinutes: 10 };
  assert.equal(calculateMonthlyInputWorkloadHours(input, assumptions), 43.3);
});

test('normalises daily input workload using working days', () => {
  const input: Layer1DemandInput = { category: 'measured_case', frequency: 'daily', workTypeLabel: 'Cases', volume: 60, effortMinutes: 10 };
  assert.equal(calculateMonthlyInputWorkloadHours(input, assumptions), 200);
});

test('treats one-off input as workload inside the selected model period', () => {
  const input: Layer1DemandInput = { category: 'measured_case', frequency: 'one_off', workTypeLabel: 'Migration backlog', volume: 60, effortMinutes: 10 };
  const workload = calculateWorkloadHours([input], assumptions);
  assert.equal(workload.totalWorkloadHours, 10);
  assert.equal(workload.oneOffWorkloadHours, 10);
  assert.equal(workload.recurringWorkloadHours, 0);
});

test('normalises hidden/internal work frequency when using direct hidden hours', () => {
  const input: Layer1DemandInput = { category: 'hidden_internal', frequency: 'weekly', workTypeLabel: 'Huddles', hiddenWorkHours: 10 };
  const workload = calculateWorkloadHours([input], assumptions);
  assert.equal(workload.hiddenWorkloadHours, 43.3);
  assert.equal(workload.totalWorkloadHours, 43.3);
});

test('normalises project/ad hoc work frequency when using direct hidden hours', () => {
  const input: Layer1DemandInput = { category: 'project_ad_hoc', frequency: 'daily', workTypeLabel: 'Daily project support', hiddenWorkHours: 2 };
  const workload = calculateWorkloadHours([input], assumptions);
  assert.equal(workload.estimatedWorkloadHours, 40);
  assert.equal(workload.totalWorkloadHours, 40);
});

test('calculates required FTE using explicit shrinkage and utilisation formula', () => {
  const productiveHours = calculateProductiveHoursPerFte(assumptions);
  assert.equal(productiveHours, 100.86);
  assert.equal(calculateRequiredFte(470, productiveHours), 4.66);
});

test('shrinkage and utilisation materially change required FTE', () => {
  const betterProductivity = calculateLayer1Output(demandInputs, { ...assumptions, utilisation: 0.9, shrinkage: 0.1 });
  const worseProductivity = calculateLayer1Output(demandInputs, { ...assumptions, utilisation: 0.7, shrinkage: 0.3 });
  assert.ok(worseProductivity.requiredFte > betterProductivity.requiredFte);
});

test('calculates labour cost and budget variance', () => {
  assert.equal(calculateLabourCost(4.66, 95000), 442700);
  assert.equal(calculateBudgetVariance(900000, 850000), 50000);
});

test('makes annual labour cost assumption explicit for recurring and one-off work', () => {
  const recurringOutput = calculateLayer1Output([demandInputs[0]], assumptions);
  assert.match(recurringOutput.annualisationNote, /ongoing recurring run-rate/i);

  const oneOffOutput = calculateLayer1Output([{ category: 'project_ad_hoc', frequency: 'one_off', workTypeLabel: 'Backlog clean-up', hiddenWorkHours: 100 }], assumptions);
  assert.match(oneOffOutput.annualisationNote, /One-off workload is included/i);
  assert.match(oneOffOutput.annualisationNote, /run-rate/i);
});

test('calculates source quality and confidence scores', () => {
  const workload = calculateWorkloadHours(demandInputs, assumptions);
  assert.equal(calculateSourceQualityScore(demandInputs), 71.25);
  assert.equal(calculateConfidenceScore(demandInputs, assumptions, workload), 59.25);
});

test('generates deterministic risk flags', () => {
  const output = calculateLayer1Output(demandInputs, assumptions);
  const flags = generateRiskFlags({
    demandInputs,
    assumptions,
    workload: output.workload,
    sourceQualityScore: output.sourceQualityScore,
    confidenceScore: output.confidenceScore,
    currentSupplyFte: output.currentSupplyFte,
    fteGap: output.fteGap,
    budgetVariance: output.budgetVariance
  });
  assert.ok(flags.some((flag) => flag.code === 'high_hidden_work_share'));
  assert.ok(flags.some((flag) => flag.code === 'missing_source_evidence'));
});

test('compares starter scenarios deterministically', () => {
  const scenarios = compareLayer1Scenarios(demandInputs, assumptions);
  assert.equal(scenarios.length, 5);
  assert.equal(scenarios[0].scenarioType, 'base');
  assert.equal(scenarios[1].scenarioType, 'high_demand');
  assert.ok(scenarios[1].requiredFte > scenarios[0].requiredFte);
  assert.ok(scenarios.find((scenario) => scenario.scenarioType === 'ai_efficiency')!.requiredFte < scenarios[0].requiredFte);
  assert.deepEqual(starterScenarios.map((scenario) => scenario.type), ['base', 'high_demand', 'productivity', 'ai_efficiency', 'finance_constrained']);
});

test('scenario comparison still works after frequency normalisation', () => {
  const weeklyDemand: Layer1DemandInput[] = [
    { category: 'measured_contact', frequency: 'weekly', workTypeLabel: 'Weekly calls', volume: 100, effortMinutes: 12, sourceId: 'src-1', sourceQualityScore: 80, confidenceScore: 80 }
  ];
  const scenarios = compareLayer1Scenarios(weeklyDemand, assumptions);
  assert.equal(scenarios[0].workload.totalWorkloadHours, 86.6);
  assert.ok(scenarios[1].workload.totalWorkloadHours > scenarios[0].workload.totalWorkloadHours);
  assert.ok(scenarios.find((scenario) => scenario.scenarioType === 'productivity')!.requiredFte < scenarios[0].requiredFte);
});
