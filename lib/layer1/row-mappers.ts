import { DEFAULT_WEEKS_PER_MONTH, starterScenarios } from './calculation-engine';
import type { DemandCategory, DemandFrequency, Layer1Assumptions, Layer1DemandInput, Layer1ScenarioDefinition, ScenarioType } from './calculation-types';

export const demandCategories: { value: DemandCategory; label: string; help: string }[] = [
  { value: 'measured_contact', label: 'Measured contact work', help: 'Calls, chat, email or other contact volumes with observable handling effort.' },
  { value: 'measured_case', label: 'Measured case/back-office work', help: 'Cases, transactions or workflow items visible in systems.' },
  { value: 'hidden_internal', label: 'Hidden/internal work', help: 'Research, huddles, offline tasks and work not fully captured by systems.' },
  { value: 'project_ad_hoc', label: 'Project/ad hoc work', help: 'Temporary or judgement-based workload that still consumes capacity.' }
];

export function numberFrom(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function nullableString(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text || null;
}

export function isScenarioType(value: unknown): value is ScenarioType {
  return ['base', 'high_demand', 'productivity', 'ai_efficiency', 'finance_constrained', 'custom'].includes(String(value));
}

export function isDemandCategory(value: unknown): value is DemandCategory {
  return demandCategories.some((category) => category.value === value);
}


export function isDemandFrequency(value: unknown): value is DemandFrequency {
  return ['monthly', 'weekly', 'daily', 'one_off'].includes(String(value));
}

export function mapDemandRows(rows: Record<string, unknown>[], sources: Record<string, unknown>[] = []): Layer1DemandInput[] {
  const sourceById = new Map(sources.map((source) => [String(source.id), source]));
  return rows.map((row) => {
    const source = row.source_id ? sourceById.get(String(row.source_id)) : undefined;
    const category = isDemandCategory(row.demand_category) ? row.demand_category : 'measured_contact';
    return {
      id: String(row.id ?? ''),
      category,
      workTypeLabel: String(row.work_type_label ?? row.assumption_reference ?? 'Unlabelled work'),
      frequency: isDemandFrequency(row.frequency) ? row.frequency : 'monthly',
      sourceId: nullableString(row.source_id),
      sourceQualityScore: numberFrom(row.source_quality_score, numberFrom(source?.source_quality_score, 0)),
      volume: numberFrom(row.demand_volume),
      effortMinutes: numberFrom(row.processing_minutes),
      hiddenWorkHours: numberFrom(row.hidden_work_hours),
      confidenceScore: numberFrom(row.confidence_score),
      notes: nullableString(row.rationale)
    };
  });
}

export function mapAssumptions(capacity?: Record<string, unknown>, cost?: Record<string, unknown>, brief?: Record<string, unknown>): Layer1Assumptions {
  return {
    workingDays: numberFrom(capacity?.working_days, 20),
    weeksPerMonth: numberFrom(capacity?.weeks_per_month, DEFAULT_WEEKS_PER_MONTH),
    hoursPerDay: numberFrom(capacity?.hours_per_day, 7.5),
    utilisation: numberFrom(capacity?.utilisation, 0.82),
    shrinkage: numberFrom(capacity?.shrinkage, 0.18),
    currentSupplyFte: numberFrom(capacity?.current_supply_fte),
    annualCostPerFte: numberFrom(cost?.annual_loaded_cost_per_fte),
    annualBudgetTarget: numberFrom(cost?.annual_budget_target, numberFrom(brief?.budget_target)),
    confidenceScore: numberFrom(capacity?.confidence_score, numberFrom(cost?.confidence_score, 70)),
    notes: nullableString(capacity?.assumption_notes) ?? nullableString(cost?.assumption_notes)
  };
}

export function mapScenarioRows(rows: Record<string, unknown>[]): Layer1ScenarioDefinition[] {
  const mapped = rows.map((row) => ({
    id: String(row.id ?? ''),
    name: String(row.scenario_name ?? 'Custom scenario'),
    type: isScenarioType(row.scenario_type) ? row.scenario_type : 'custom',
    volumeMultiplier: numberFrom(row.volume_multiplier, 1),
    processingMultiplier: numberFrom(row.processing_multiplier, 1),
    hiddenWorkMultiplier: numberFrom(row.hidden_work_multiplier, 1),
    utilisationDelta: numberFrom(row.utilisation_delta),
    shrinkageDelta: numberFrom(row.shrinkage_delta),
    budgetMultiplier: numberFrom(row.budget_multiplier, 1)
  }));
  return mapped.length > 0 ? [...starterScenarios, ...mapped] : starterScenarios;
}
