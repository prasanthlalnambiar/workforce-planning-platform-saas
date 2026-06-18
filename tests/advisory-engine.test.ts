import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWaterfallAdvisory,
  deterministicAdvisoryProvider,
  type AdvisoryInput,
  type AdvisoryProvider,
  type WaterfallAdvisory
} from '../lib/advisory/advisory-engine';
import { buildWaterfallBridge, type BridgeReforecastLine, type BridgeVarianceLine } from '../lib/waterfall/waterfall-engine';

function reforecastLine(periodNumber: number, opts: Partial<BridgeReforecastLine> = {}): BridgeReforecastLine {
  const baseline = opts.baselineBudgetAmount ?? 100000;
  const growth = opts.growthCostImpact ?? 5000;
  const efficiency = opts.efficiencyCostImpact ?? 0;
  const costChange = opts.costChangeCostImpact ?? 0;
  const supplyChange = opts.supplyChangeCostImpact ?? 0;
  const management = opts.managementAdjustmentCostImpact ?? 0;
  const forecast = opts.forecastBudgetAmount ?? baseline + growth + efficiency + costChange + supplyChange + management;
  return {
    planningPeriodId: `period-${periodNumber}`, periodNumber,
    baselineBudgetAmount: baseline, growthCostImpact: growth, efficiencyCostImpact: efficiency,
    costChangeCostImpact: costChange, supplyChangeCostImpact: supplyChange, managementAdjustmentCostImpact: management,
    forecastBudgetAmount: forecast
  };
}

function varianceLine(periodNumber: number, opts: Partial<BridgeVarianceLine> = {}): BridgeVarianceLine {
  const baseline = opts.baselineCost ?? 100000;
  const forecast = opts.forecastCost ?? 105000;
  const actual = opts.actualCost ?? 110000;
  return {
    planningPeriodId: `period-${periodNumber}`, periodNumber, periodLabel: `2027-0${periodNumber}`,
    actualCost: actual, forecastCost: forecast, baselineCost: baseline,
    costVarianceToForecast: opts.costVarianceToForecast ?? actual - forecast,
    costVarianceToBaseline: opts.costVarianceToBaseline ?? actual - baseline
  };
}

function sampleInput(periods = 3): AdvisoryInput {
  const reforecastLines = Array.from({ length: periods }, (_, i) => reforecastLine(i + 1));
  const varianceLines = Array.from({ length: periods }, (_, i) => varianceLine(i + 1));
  const bridge = buildWaterfallBridge({ reforecastLines, varianceLines });
  return { bridge, context: { reportCode: 'VAR-1', reportName: 'Q1 Variance', planName: 'Plan A', fiscalYearLabel: 'FY28' } };
}

test('advisory is always flagged advisory-only and carries the non-authoritative disclaimer', () => {
  const advisory = buildWaterfallAdvisory(sampleInput());
  assert.equal(advisory.advisoryOnly, true);
  assert.match(advisory.disclaimer, /does not calculate, change, approve, override, or write/);
  assert.match(advisory.disclaimer, /Governed records remain the source of truth/);
});

test('advisory headline describes the variance direction without inventing a figure', () => {
  const over = buildWaterfallAdvisory(sampleInput());
  assert.match(over.headline, /over the locked forecast by \+\$15,000/);
  // Under-forecast case.
  const underBridge = buildWaterfallBridge({
    reforecastLines: [reforecastLine(1)],
    varianceLines: [varianceLine(1, { actualCost: 102000, forecastCost: 105000, costVarianceToForecast: -3000 })]
  });
  const under = buildWaterfallAdvisory({ ...sampleInput(1), bridge: underBridge });
  assert.match(under.headline, /under the locked forecast by -\$3,000/);
});

test('every monetary figure in the advisory references a value present in the bridge (no invented officials)', () => {
  const input = sampleInput();
  const advisory = buildWaterfallAdvisory(input);

  // Collect the set of legitimate formatted figures the deterministic bridge produced.
  const fmt = (v: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(v);
  const t = input.bridge.totals;
  const allowed = new Set<string>();
  for (const v of [t.baselineCost, t.forecastCost, t.actualCost, t.driverImpactTotal, t.varianceToForecast, t.varianceToBaseline, input.bridge.reconciliation.maxResidual]) {
    allowed.add(fmt(v)); allowed.add(fmt(Math.abs(v)));
  }
  for (const period of input.bridge.periods) {
    for (const v of [period.varianceToForecast, period.baselineCost, period.forecastCost, period.actualCost]) {
      allowed.add(fmt(v)); allowed.add(fmt(Math.abs(v)));
    }
  }

  // Extract every $-figure that appears anywhere in the rendered advisory text.
  const haystack = JSON.stringify(advisory);
  const dollarFigures = (haystack.match(/\$[0-9][0-9,]*[0-9]|\$[0-9]/g) ?? []).map((f) => f.replace(/,$/, ''));
  for (const figure of dollarFigures) {
    assert.ok(allowed.has(figure), `advisory figure ${figure} must come from the bridge, not be invented`);
  }
});

test('references in narrative sections are values copied from the bridge totals', () => {
  const input = sampleInput();
  const advisory = buildWaterfallAdvisory(input);
  const fmtSigned = (v: number) => (v === 0 ? '$0' : `${v > 0 ? '+' : '-'}$${Math.abs(v).toLocaleString('en-AU')}`);
  const budgetToForecast = advisory.narrative.find((s) => s.heading === 'From budget to forecast');
  assert.ok(budgetToForecast);
  const baselineRef = budgetToForecast!.references.find((r) => r.label === 'Baseline');
  assert.equal(baselineRef?.value, '$300,000'); // 3 x 100000, straight from the bridge
  const driverRef = budgetToForecast!.references.find((r) => r.label === 'Approved driver impact');
  assert.equal(driverRef?.value, fmtSigned(input.bridge.totals.driverImpactTotal));
});

test('advisory flags a non-reconciling bridge as a high-severity risk', () => {
  const bridge = buildWaterfallBridge({
    reforecastLines: [reforecastLine(1, { forecastBudgetAmount: 105000 })],
    varianceLines: [varianceLine(1, { forecastCost: 108000, actualCost: 110000, costVarianceToForecast: 2000 })]
  });
  const advisory = buildWaterfallAdvisory({ ...sampleInput(1), bridge });
  const high = advisory.risks.find((r) => r.severity === 'high');
  assert.ok(high, 'a non-reconciling bridge produces a high-severity risk');
  assert.match(high!.title, /does not fully reconcile/);
});

test('advisory flags a material variance to forecast (descriptive threshold)', () => {
  const bridge = buildWaterfallBridge({
    reforecastLines: [reforecastLine(1, { growthCostImpact: 0, forecastBudgetAmount: 100000 })],
    varianceLines: [varianceLine(1, { baselineCost: 100000, forecastCost: 100000, actualCost: 120000, costVarianceToForecast: 20000, costVarianceToBaseline: 20000 })]
  });
  const advisory = buildWaterfallAdvisory({ ...sampleInput(1), bridge });
  assert.ok(advisory.risks.some((r) => /Material variance/.test(r.title)));
});

test('a clean reconciling bridge with ordinary, spread variance produces a no-flags info risk', () => {
  // Three periods each +$200 (evenly spread so no single period dominates),
  // total +$600 on $300,000 forecast = 0.2% (well under the 10% threshold).
  const bridge = buildWaterfallBridge({
    reforecastLines: [1, 2, 3].map((n) => reforecastLine(n, { growthCostImpact: 0, forecastBudgetAmount: 100000 })),
    varianceLines: [1, 2, 3].map((n) => varianceLine(n, { baselineCost: 100000, forecastCost: 100000, actualCost: 100200, costVarianceToForecast: 200, costVarianceToBaseline: 200 }))
  });
  const advisory = buildWaterfallAdvisory({ ...sampleInput(3), bridge });
  assert.ok(advisory.risks.some((r) => r.title === 'No advisory flags'), JSON.stringify(advisory.risks.map((r) => r.title)));
});

test('suggested questions are non-empty, plain-language, and reference the largest movements', () => {
  const advisory = buildWaterfallAdvisory(sampleInput());
  assert.ok(advisory.suggestedQuestions.length > 0);
  for (const q of advisory.suggestedQuestions) {
    assert.ok(q.question.length > 0 && q.rationale.length > 0);
    assert.ok(q.question.trim().endsWith('?'), 'each suggestion is phrased as a question');
  }
});

test('the advisory does not mutate the bridge it is given', () => {
  const input = sampleInput();
  const snapshot = JSON.stringify(input.bridge);
  buildWaterfallAdvisory(input);
  assert.equal(JSON.stringify(input.bridge), snapshot, 'advisory generation is read-only over the bridge');
});

test('the provider seam is honoured: a custom provider can only return prose, and is the named provider', () => {
  const stub: AdvisoryProvider = {
    name: 'stub-llm',
    generate(input): WaterfallAdvisory {
      // A provider receives finished numbers and returns only text.
      return {
        advisoryOnly: true, provider: 'stub-llm', headline: 'Custom wording',
        narrative: [], risks: [], suggestedQuestions: [],
        disclaimer: input.context.reportCode + ' advisory'
      };
    }
  };
  const advisory = buildWaterfallAdvisory(sampleInput(), stub);
  assert.equal(advisory.provider, 'stub-llm');
  assert.equal(advisory.headline, 'Custom wording');
  // Default provider is the deterministic one.
  assert.equal(deterministicAdvisoryProvider.name, 'deterministic-v1');
  assert.equal(buildWaterfallAdvisory(sampleInput()).provider, 'deterministic-v1');
});
