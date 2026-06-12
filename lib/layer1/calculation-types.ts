export type DemandCategory = 'measured_contact' | 'measured_case' | 'hidden_internal' | 'project_ad_hoc';
export type DemandFrequency = 'monthly' | 'weekly' | 'daily' | 'one_off';
export type ScenarioType = 'base' | 'high_demand' | 'productivity' | 'ai_efficiency' | 'finance_constrained' | 'custom';

export interface Layer1DemandInput {
  id?: string;
  category: DemandCategory;
  workTypeLabel: string;
  frequency: DemandFrequency;
  sourceId?: string | null;
  sourceQualityScore?: number | null;
  volume?: number | null;
  effortMinutes?: number | null;
  hiddenWorkHours?: number | null;
  confidenceScore?: number | null;
  notes?: string | null;
}

export interface Layer1Assumptions {
  workingDays: number;
  weeksPerMonth: number;
  hoursPerDay: number;
  utilisation: number;
  shrinkage: number;
  currentSupplyFte: number;
  annualCostPerFte: number;
  annualBudgetTarget: number;
  confidenceScore?: number | null;
  notes?: string | null;
}

export interface Layer1ScenarioDefinition {
  id?: string;
  name: string;
  type: ScenarioType;
  volumeMultiplier: number;
  processingMultiplier: number;
  hiddenWorkMultiplier: number;
  utilisationDelta: number;
  shrinkageDelta: number;
  budgetMultiplier: number;
}

export interface WorkloadBreakdown {
  measuredContactHours: number;
  measuredCaseHours: number;
  estimatedWorkHours: number;
  hiddenInternalHours: number;
  measuredWorkloadHours: number;
  estimatedWorkloadHours: number;
  hiddenWorkloadHours: number;
  recurringWorkloadHours: number;
  oneOffWorkloadHours: number;
  totalWorkloadHours: number;
  hiddenWorkShare: number;
  oneOffWorkShare: number;
}

export interface Layer1RiskFlag {
  code:
    | 'low_source_confidence'
    | 'high_hidden_work_share'
    | 'high_fte_gap'
    | 'budget_overrun'
    | 'low_assumption_confidence'
    | 'missing_source_evidence';
  severity: 'low' | 'medium' | 'high';
  message: string;
}

export interface Layer1CalculationOutput {
  scenarioName: string;
  scenarioType: ScenarioType;
  workload: WorkloadBreakdown;
  productiveHoursPerFte: number;
  requiredFte: number;
  currentSupplyFte: number;
  fteGap: number;
  labourCost: number;
  budgetTarget: number;
  budgetVariance: number;
  sourceQualityScore: number;
  confidenceScore: number;
  riskFlags: Layer1RiskFlag[];
  annualisationNote: string;
}
