import test from 'node:test';
import assert from 'node:assert/strict';
import { isDemandCategory, mapAssumptions, mapDemandRows, mapScenarioRows } from '../lib/layer1/row-mappers';

test('Layer 1 demand category allowlist rejects arbitrary values', () => {
  assert.equal(isDemandCategory('measured_contact'), true);
  assert.equal(isDemandCategory('hidden_internal'), true);
  assert.equal(isDemandCategory('audit_events'), false);
});

test('maps Layer 1 rows without crossing tenant context', () => {
  const rows = [{ id: 'd1', demand_category: 'measured_contact', work_type_label: 'Calls', source_id: 's1', demand_volume: 60, processing_minutes: 10, confidence_score: 80 }];
  const sources = [{ id: 's1', source_quality_score: 75 }];
  const mapped = mapDemandRows(rows, sources);
  assert.equal(mapped[0].workTypeLabel, 'Calls');
  assert.equal(mapped[0].sourceQualityScore, 75);
  assert.equal(mapped[0].frequency, 'monthly');
});

test('maps assumption rows into explicit Layer 1 calculation units', () => {
  const assumptions = mapAssumptions(
    { working_days: 21, weeks_per_month: 4.35, hours_per_day: 7.6, utilisation: 0.8, shrinkage: 0.2, current_supply_fte: 12, confidence_score: 65 },
    { annual_loaded_cost_per_fte: 110000, annual_budget_target: 1000000 },
    { budget_target: 900000 }
  );
  assert.equal(assumptions.workingDays, 21);
  assert.equal(assumptions.weeksPerMonth, 4.35);
  assert.equal(assumptions.currentSupplyFte, 12);
  assert.equal(assumptions.annualCostPerFte, 110000);
  assert.equal(assumptions.annualBudgetTarget, 1000000);
});


test('keeps starter scenarios when custom Layer 1 scenarios are added', () => {
  const mapped = mapScenarioRows([{ id: 'custom-1', scenario_name: 'Local custom', scenario_type: 'custom', volume_multiplier: 1.05, processing_multiplier: 0.95, hidden_work_multiplier: 1, utilisation_delta: 0, shrinkage_delta: 0, budget_multiplier: 1 }]);
  assert.equal(mapped.length, 6);
  assert.equal(mapped[0].type, 'base');
  assert.equal(mapped[5].name, 'Local custom');
});
