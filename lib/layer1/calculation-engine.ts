import type {
  DemandFrequency,
  Layer1Assumptions,
  Layer1CalculationOutput,
  Layer1DemandInput,
  Layer1RiskFlag,
  Layer1ScenarioDefinition,
  ScenarioType,
  WorkloadBreakdown
} from './calculation-types';

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const DEFAULT_WEEKS_PER_MONTH = 4.33;

export const defaultLayer1Assumptions: Layer1Assumptions = {
  workingDays: 20,
  weeksPerMonth: DEFAULT_WEEKS_PER_MONTH,
  hoursPerDay: 7.5,
  utilisation: 0.82,
  shrinkage: 0.18,
  currentSupplyFte: 0,
  annualCostPerFte: 0,
  annualBudgetTarget: 0,
  confidenceScore: 70
};

export const starterScenarios: Layer1ScenarioDefinition[] = [
  {
    name: 'Base case',
    type: 'base',
    volumeMultiplier: 1,
    processingMultiplier: 1,
    hiddenWorkMultiplier: 1,
    utilisationDelta: 0,
    shrinkageDelta: 0,
    budgetMultiplier: 1
  },
  {
    name: 'High demand case',
    type: 'high_demand',
    volumeMultiplier: 1.15,
    processingMultiplier: 1,
    hiddenWorkMultiplier: 1.1,
    utilisationDelta: 0,
    shrinkageDelta: 0,
    budgetMultiplier: 1
  },
  {
    name: 'Productivity case',
    type: 'productivity',
    volumeMultiplier: 1,
    processingMultiplier: 0.9,
    hiddenWorkMultiplier: 0.95,
    utilisationDelta: 0.05,
    shrinkageDelta: 0,
    budgetMultiplier: 1
  },
  {
    name: 'AI efficiency case',
    type: 'ai_efficiency',
    volumeMultiplier: 0.85,
    processingMultiplier: 0.85,
    hiddenWorkMultiplier: 0.9,
    utilisationDelta: 0.03,
    shrinkageDelta: 0,
    budgetMultiplier: 1
  },
  {
    name: 'Finance-constrained case',
    type: 'finance_constrained',
    volumeMultiplier: 1,
    processingMultiplier: 1,
    hiddenWorkMultiplier: 1,
    utilisationDelta: 0,
    shrinkageDelta: 0,
    budgetMultiplier: 0.9
  }
];

export function monthlyFrequencyFactor(frequency: DemandFrequency, assumptions: Layer1Assumptions = defaultLayer1Assumptions): number {
  if (frequency === 'weekly') return Math.max(0, assumptions.weeksPerMonth || DEFAULT_WEEKS_PER_MONTH);
  if (frequency === 'daily') return Math.max(0, assumptions.workingDays);
  return 1;
}

export function calculateMonthlyInputWorkloadHours(
  input: Layer1DemandInput,
  assumptions: Layer1Assumptions = defaultLayer1Assumptions,
  scenario: Layer1ScenarioDefinition = starterScenarios[0]
): number {
  const frequencyFactor = monthlyFrequencyFactor(input.frequency ?? 'monthly', assumptions);
  const volume = Math.max(0, input.volume ?? 0) * scenario.volumeMultiplier;
  const effortMinutes = Math.max(0, input.effortMinutes ?? 0) * scenario.processingMultiplier;
  const effortHours = (volume * frequencyFactor * effortMinutes) / 60;
  const hiddenHours = Math.max(0, input.hiddenWorkHours ?? 0) * frequencyFactor * scenario.hiddenWorkMultiplier;

  if (input.category === 'hidden_internal' || input.category === 'project_ad_hoc') {
    return round2(hiddenHours || effortHours);
  }

  return round2(effortHours);
}

export function calculateWorkloadHours(
  demandInputs: Layer1DemandInput[],
  assumptions: Layer1Assumptions = defaultLayer1Assumptions,
  scenario: Layer1ScenarioDefinition = starterScenarios[0]
): WorkloadBreakdown {
  let measuredContactHours = 0;
  let measuredCaseHours = 0;
  let estimatedWorkHours = 0;
  let hiddenInternalHours = 0;
  let oneOffWorkloadHours = 0;

  for (const input of demandInputs) {
    const workloadHours = calculateMonthlyInputWorkloadHours(input, assumptions, scenario);

    if (input.category === 'measured_contact') measuredContactHours += workloadHours;
    if (input.category === 'measured_case') measuredCaseHours += workloadHours;
    if (input.category === 'project_ad_hoc') estimatedWorkHours += workloadHours;
    if (input.category === 'hidden_internal') hiddenInternalHours += workloadHours;
    if (input.frequency === 'one_off') oneOffWorkloadHours += workloadHours;
  }

  const measuredWorkloadHours = measuredContactHours + measuredCaseHours;
  const estimatedWorkloadHours = estimatedWorkHours;
  const hiddenWorkloadHours = hiddenInternalHours;
  const totalWorkloadHours = measuredWorkloadHours + estimatedWorkloadHours + hiddenWorkloadHours;
  const recurringWorkloadHours = totalWorkloadHours - oneOffWorkloadHours;
  const hiddenWorkShare = totalWorkloadHours > 0 ? hiddenWorkloadHours / totalWorkloadHours : 0;
  const oneOffWorkShare = totalWorkloadHours > 0 ? oneOffWorkloadHours / totalWorkloadHours : 0;

  return {
    measuredContactHours: round2(measuredContactHours),
    measuredCaseHours: round2(measuredCaseHours),
    estimatedWorkHours: round2(estimatedWorkHours),
    hiddenInternalHours: round2(hiddenInternalHours),
    measuredWorkloadHours: round2(measuredWorkloadHours),
    estimatedWorkloadHours: round2(estimatedWorkloadHours),
    hiddenWorkloadHours: round2(hiddenWorkloadHours),
    recurringWorkloadHours: round2(recurringWorkloadHours),
    oneOffWorkloadHours: round2(oneOffWorkloadHours),
    totalWorkloadHours: round2(totalWorkloadHours),
    hiddenWorkShare: round2(hiddenWorkShare),
    oneOffWorkShare: round2(oneOffWorkShare)
  };
}

export function calculateProductiveHoursPerFte(
  assumptions: Layer1Assumptions,
  scenario: Layer1ScenarioDefinition = starterScenarios[0]
): number {
  const utilisation = clamp(assumptions.utilisation + scenario.utilisationDelta, 0.01, 1);
  const shrinkage = clamp(assumptions.shrinkage + scenario.shrinkageDelta, 0, 0.95);
  const productiveHours = assumptions.workingDays * assumptions.hoursPerDay * utilisation * (1 - shrinkage);
  return round2(Math.max(0, productiveHours));
}

export function calculateRequiredFte(totalWorkloadHours: number, productiveHoursPerFte: number): number {
  if (productiveHoursPerFte <= 0) throw new Error('Productive hours per FTE must be greater than zero');
  return round2(totalWorkloadHours / productiveHoursPerFte);
}

export function calculateLabourCost(requiredFte: number, annualCostPerFte: number): number {
  return round2(Math.max(0, requiredFte) * Math.max(0, annualCostPerFte));
}

export function calculateBudgetVariance(labourCost: number, budgetTarget: number): number {
  return round2(labourCost - budgetTarget);
}

export function calculateSourceQualityScore(demandInputs: Layer1DemandInput[]): number {
  const scores = demandInputs
    .map((input) => input.sourceQualityScore)
    .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));
  if (scores.length === 0) return 0;
  return round2(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

export function calculateConfidenceScore(demandInputs: Layer1DemandInput[], assumptions: Layer1Assumptions, workload: WorkloadBreakdown): number {
  const inputScores = demandInputs
    .map((input) => input.confidenceScore)
    .filter((score): score is number => typeof score === 'number' && Number.isFinite(score));
  const demandConfidence = inputScores.length > 0 ? inputScores.reduce((sum, score) => sum + score, 0) / inputScores.length : 0;
  const assumptionConfidence = assumptions.confidenceScore ?? 0;
  const hiddenPenalty = workload.hiddenWorkShare > 0.25 ? 10 : 0;
  return round2(clamp(demandConfidence * 0.6 + assumptionConfidence * 0.4 - hiddenPenalty, 0, 100));
}

export function generateRiskFlags(input: {
  demandInputs: Layer1DemandInput[];
  assumptions: Layer1Assumptions;
  workload: WorkloadBreakdown;
  sourceQualityScore: number;
  confidenceScore: number;
  currentSupplyFte: number;
  fteGap: number;
  budgetVariance: number;
}): Layer1RiskFlag[] {
  const flags: Layer1RiskFlag[] = [];
  const missingSourceCount = input.demandInputs.filter((demand) => !demand.sourceId).length;

  if (input.sourceQualityScore > 0 && input.sourceQualityScore < 60) {
    flags.push({ code: 'low_source_confidence', severity: 'medium', message: 'Average source quality is below 60%.' });
  }
  if (input.workload.hiddenWorkShare >= 0.25) {
    flags.push({ code: 'high_hidden_work_share', severity: 'high', message: 'Hidden or internal work is more than 25% of total workload.' });
  }
  if (input.fteGap > Math.max(5, input.currentSupplyFte * 0.1)) {
    flags.push({ code: 'high_fte_gap', severity: 'high', message: 'Required FTE is materially above current supply.' });
  }
  if (input.budgetVariance > 0) {
    flags.push({ code: 'budget_overrun', severity: 'high', message: 'Calculated labour cost is above the annual budget target.' });
  }
  if ((input.assumptions.confidenceScore ?? 0) > 0 && (input.assumptions.confidenceScore ?? 0) < 60) {
    flags.push({ code: 'low_assumption_confidence', severity: 'medium', message: 'Assumption confidence is below 60%.' });
  }
  if (missingSourceCount > 0) {
    flags.push({ code: 'missing_source_evidence', severity: 'medium', message: `${missingSourceCount} demand input(s) do not have source evidence attached.` });
  }

  return flags;
}

export function buildAnnualisationNote(workload: WorkloadBreakdown): string {
  if (workload.oneOffWorkloadHours > 0) {
    return 'One-off workload is included inside the selected model period. Required FTE and annual labour cost show the run-rate if that modelled workload level were sustained; remove or separately phase true one-off work before treating it as permanent budget.';
  }
  return 'Required FTE and annual labour cost assume the normalised monthly workload is an ongoing recurring run-rate.';
}

export function calculateLayer1Output(
  demandInputs: Layer1DemandInput[],
  assumptions: Layer1Assumptions,
  scenario: Layer1ScenarioDefinition = starterScenarios[0]
): Layer1CalculationOutput {
  const workload = calculateWorkloadHours(demandInputs, assumptions, scenario);
  const productiveHoursPerFte = calculateProductiveHoursPerFte(assumptions, scenario);
  const requiredFte = calculateRequiredFte(workload.totalWorkloadHours, productiveHoursPerFte);
  const currentSupplyFte = round2(Math.max(0, assumptions.currentSupplyFte));
  const fteGap = round2(requiredFte - currentSupplyFte);
  const labourCost = calculateLabourCost(requiredFte, assumptions.annualCostPerFte);
  const budgetTarget = round2(Math.max(0, assumptions.annualBudgetTarget * scenario.budgetMultiplier));
  const budgetVariance = calculateBudgetVariance(labourCost, budgetTarget);
  const sourceQualityScore = calculateSourceQualityScore(demandInputs);
  const confidenceScore = calculateConfidenceScore(demandInputs, assumptions, workload);
  const riskFlags = generateRiskFlags({
    demandInputs,
    assumptions,
    workload,
    sourceQualityScore,
    confidenceScore,
    currentSupplyFte,
    fteGap,
    budgetVariance
  });

  return {
    scenarioName: scenario.name,
    scenarioType: scenario.type,
    workload,
    productiveHoursPerFte,
    requiredFte,
    currentSupplyFte,
    fteGap,
    labourCost,
    budgetTarget,
    budgetVariance,
    sourceQualityScore,
    confidenceScore,
    riskFlags,
    annualisationNote: buildAnnualisationNote(workload)
  };
}

export function compareLayer1Scenarios(
  demandInputs: Layer1DemandInput[],
  assumptions: Layer1Assumptions,
  scenarios: Layer1ScenarioDefinition[] = starterScenarios
): Layer1CalculationOutput[] {
  return scenarios.map((scenario) => calculateLayer1Output(demandInputs, assumptions, scenario));
}

export function scenarioTypeLabel(type: ScenarioType): string {
  const labels: Record<ScenarioType, string> = {
    base: 'Base',
    high_demand: 'High demand',
    productivity: 'Productivity',
    ai_efficiency: 'AI efficiency',
    finance_constrained: 'Finance constrained',
    custom: 'Custom'
  };
  return labels[type];
}
