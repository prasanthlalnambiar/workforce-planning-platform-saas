// Phase 9 AI Advisory — deterministic, read-only, advisory-only engine.
//
// GOVERNANCE BOUNDARY (structural, not aspirational):
//   * This engine NEVER calculates an official number. It consumes a
//     `WaterfallBridge` whose figures were already computed by the deterministic
//     waterfall engine from locked/pinned records, and it emits only PROSE plus
//     references to those existing figures.
//   * Every monetary value that appears in advisory text is copied verbatim from
//     the bridge (via `formatMoney` on a bridge field). The engine has no
//     arithmetic that could originate a new official figure: it may compute
//     presentational quantities (a percentage share, a ranking order) purely to
//     describe the deterministic numbers, clearly labelled as descriptive, never
//     written back and never treated as official.
//   * No mutation, no network, no model call. The provider seam below lets a
//     future LLM implementation supply richer wording, but it is handed only
//     finished numbers and may only return text — it can never introduce or
//     alter a figure.
//
// The result is fully deterministic and unit-testable today.

import {
  DRIVER_CATEGORY_LABELS,
  DRIVER_CATEGORY_ORDER,
  type WaterfallBridge
} from '../waterfall/waterfall-engine';
import type { DriverCategory } from '../drivers/driver-engine';

// ---------------------------------------------------------------------------
// Output shape — prose and references only. No field here is an official
// figure that the system would store or treat as authoritative.
// ---------------------------------------------------------------------------

export interface AdvisoryReference {
  /** A human label for a figure that already exists in the bridge. */
  label: string;
  /** The pre-formatted value, copied from the deterministic bridge. */
  value: string;
}

export interface AdvisoryNarrativeSection {
  heading: string;
  /** Paragraphs of plain-language explanation. */
  paragraphs: string[];
  /** Figures referenced in this section — all copied from the bridge. */
  references: AdvisoryReference[];
}

export interface AdvisoryRisk {
  severity: 'info' | 'attention' | 'high';
  title: string;
  detail: string;
}

export interface AdvisorySuggestedQuestion {
  question: string;
  /** Why this question is worth asking, in plain language. */
  rationale: string;
}

export interface WaterfallAdvisory {
  /** Always true: this output is advisory and non-authoritative. */
  advisoryOnly: true;
  /** Provider that produced the wording (deterministic by default). */
  provider: string;
  /** One-line plain-language headline. */
  headline: string;
  narrative: AdvisoryNarrativeSection[];
  risks: AdvisoryRisk[];
  suggestedQuestions: AdvisorySuggestedQuestion[];
  /** A standing reminder rendered with the advisory on every surface. */
  disclaimer: string;
}

const ADVISORY_DISCLAIMER =
  'Planning Advisor explains figures already calculated by the deterministic planning engine. ' +
  'It does not calculate, change, approve, override, or write official forecast, budget, actuals, variance, or waterfall numbers. ' +
  'Governed records remain the source of truth.';

// ---------------------------------------------------------------------------
// Presentation helpers (describe existing numbers; never originate official ones)
// ---------------------------------------------------------------------------

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? value : 0
  );
}

function formatSignedMoney(value: number): string {
  if (!Number.isFinite(value) || value === 0) return formatMoney(0);
  return `${value > 0 ? '+' : '-'}${formatMoney(Math.abs(value))}`;
}

/** Descriptive share of a movement — labelled as descriptive, never official. */
function descriptiveSharePct(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole === 0) return null;
  return Math.round((part / whole) * 100);
}

function direction(value: number): 'increase' | 'decrease' | 'no change' {
  if (value > 0) return 'increase';
  if (value < 0) return 'decrease';
  return 'no change';
}

// ---------------------------------------------------------------------------
// Provider seam — deterministic today; an LLM provider could implement this
// later. The provider is handed ONLY finished numbers (the bridge) and may
// only return the advisory prose object. It can never write a record or
// originate an official figure.
// ---------------------------------------------------------------------------

export interface AdvisoryInput {
  bridge: WaterfallBridge;
  context: {
    reportCode: string;
    reportName: string;
    planName: string;
    fiscalYearLabel: string;
  };
}

export interface AdvisoryProvider {
  readonly name: string;
  generate(input: AdvisoryInput): WaterfallAdvisory;
}

// ---------------------------------------------------------------------------
// Deterministic provider
// ---------------------------------------------------------------------------

function rankedCategories(bridge: WaterfallBridge): { category: DriverCategory; amount: number }[] {
  return DRIVER_CATEGORY_ORDER
    .map((category) => ({ category, amount: bridge.totals.categoryImpacts[category] }))
    .filter((entry) => entry.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

function topVariancePeriods(bridge: WaterfallBridge): typeof bridge.periods {
  return [...bridge.periods]
    .filter((period) => period.varianceToForecast !== 0)
    .sort((a, b) => Math.abs(b.varianceToForecast) - Math.abs(a.varianceToForecast))
    .slice(0, 3);
}

function buildNarrative(input: AdvisoryInput): AdvisoryNarrativeSection[] {
  const { bridge } = input;
  const sections: AdvisoryNarrativeSection[] = [];

  // 1. Budget to forecast — what the approved drivers did.
  const driverDir = direction(bridge.totals.driverImpactTotal);
  const ranked = rankedCategories(bridge);
  const driverParagraphs: string[] = [];
  if (driverDir === 'no change') {
    driverParagraphs.push(
      `Approved drivers did not move the budget: the locked forecast equals the baseline at ${formatMoney(bridge.totals.baselineCost)}.`
    );
  } else {
    driverParagraphs.push(
      `Approved drivers produced a net ${driverDir} of ${formatSignedMoney(bridge.totals.driverImpactTotal)} ` +
      `from the baseline of ${formatMoney(bridge.totals.baselineCost)} to the locked forecast of ${formatMoney(bridge.totals.forecastCost)}.`
    );
    if (ranked.length > 0) {
      const lead = ranked[0];
      const sharePct = descriptiveSharePct(lead.amount, bridge.totals.driverImpactTotal);
      driverParagraphs.push(
        `The largest contributor was ${DRIVER_CATEGORY_LABELS[lead.category].toLowerCase()} at ${formatSignedMoney(lead.amount)}` +
        (sharePct !== null ? ` (about ${sharePct}% of the total approved-driver movement, descriptive only).` : '.')
      );
    }
  }
  sections.push({
    heading: 'From budget to forecast',
    paragraphs: driverParagraphs,
    references: [
      { label: 'Baseline', value: formatMoney(bridge.totals.baselineCost) },
      { label: 'Approved driver impact', value: formatSignedMoney(bridge.totals.driverImpactTotal) },
      { label: 'Locked forecast', value: formatMoney(bridge.totals.forecastCost) }
    ]
  });

  // 2. Forecast to actuals — the variance.
  const varDir = direction(bridge.totals.varianceToForecast);
  const varParagraphs: string[] = [];
  if (varDir === 'no change') {
    varParagraphs.push(`Actual cost matched the locked forecast exactly at ${formatMoney(bridge.totals.forecastCost)}.`);
  } else {
    const overUnder = bridge.totals.varianceToForecast > 0 ? 'above' : 'below';
    varParagraphs.push(
      `Actual cost came in ${overUnder} the locked forecast by ${formatSignedMoney(bridge.totals.varianceToForecast)}, ` +
      `moving from ${formatMoney(bridge.totals.forecastCost)} to an actual result of ${formatMoney(bridge.totals.actualCost)}.`
    );
    varParagraphs.push(
      `Against the original baseline, the actual result is ${formatSignedMoney(bridge.totals.varianceToBaseline)}.`
    );
  }
  sections.push({
    heading: 'From forecast to actuals',
    paragraphs: varParagraphs,
    references: [
      { label: 'Locked forecast', value: formatMoney(bridge.totals.forecastCost) },
      { label: 'Variance to forecast', value: formatSignedMoney(bridge.totals.varianceToForecast) },
      { label: 'Actual result', value: formatMoney(bridge.totals.actualCost) },
      { label: 'Variance to baseline', value: formatSignedMoney(bridge.totals.varianceToBaseline) }
    ]
  });

  // 3. Which periods drove the variance.
  const top = topVariancePeriods(bridge);
  if (top.length > 0) {
    const periodParagraphs = [
      `The periods contributing most to the variance to forecast were ` +
      top.map((period) => `${period.periodLabel} (${formatSignedMoney(period.varianceToForecast)})`).join(', ') + '.'
    ];
    sections.push({
      heading: 'Which periods drove the variance',
      paragraphs: periodParagraphs,
      references: top.map((period) => ({ label: period.periodLabel, value: formatSignedMoney(period.varianceToForecast) }))
    });
  }

  return sections;
}

function buildRisks(input: AdvisoryInput): AdvisoryRisk[] {
  const { bridge } = input;
  const risks: AdvisoryRisk[] = [];

  // Reconciliation integrity is the most important signal.
  if (!bridge.reconciliation.allReconciled) {
    risks.push({
      severity: 'high',
      title: 'Bridge does not fully reconcile',
      detail:
        `One or more reconciliation checks did not balance within tolerance (maximum residual ${formatMoney(bridge.reconciliation.maxResidual)}). ` +
        'Review the pinned sources before relying on this explanation; the figures themselves come from the deterministic engine.'
    });
  }

  // Large variance to forecast (descriptive threshold on existing numbers).
  const varToForecast = bridge.totals.varianceToForecast;
  const forecast = bridge.totals.forecastCost;
  const variancePct = forecast !== 0 ? Math.abs((varToForecast / forecast) * 100) : 0;
  if (variancePct >= 10) {
    risks.push({
      severity: 'attention',
      title: 'Material variance to forecast',
      detail:
        `The actual result differs from the locked forecast by ${formatSignedMoney(varToForecast)} ` +
        `(${Math.round(variancePct)}% of forecast, descriptive). This is a sizeable movement worth explaining to stakeholders.`
    });
  }

  // Concentrated single-period variance.
  const top = topVariancePeriods(bridge);
  if (top.length > 0 && varToForecast !== 0) {
    const leadShare = descriptiveSharePct(top[0].varianceToForecast, varToForecast);
    if (leadShare !== null && leadShare >= 60) {
      risks.push({
        severity: 'info',
        title: 'Variance concentrated in one period',
        detail:
          `${top[0].periodLabel} accounts for roughly ${leadShare}% of the variance to forecast (descriptive). ` +
          'A single-period concentration is often worth a closer look at that period’s drivers and actuals.'
      });
    }
  }

  if (risks.length === 0) {
    risks.push({
      severity: 'info',
      title: 'No advisory flags',
      detail: 'The bridge reconciles and the variance is within ordinary ranges. Nothing stands out for special attention.'
    });
  }

  return risks;
}

function buildQuestions(input: AdvisoryInput): AdvisorySuggestedQuestion[] {
  const { bridge } = input;
  const questions: AdvisorySuggestedQuestion[] = [];
  const ranked = rankedCategories(bridge);

  if (ranked.length > 0) {
    questions.push({
      question: `What approved decisions sit behind the ${DRIVER_CATEGORY_LABELS[ranked[0].category].toLowerCase()} of ${formatSignedMoney(ranked[0].amount)}?`,
      rationale: 'This is the largest approved-driver movement from baseline to forecast.'
    });
  }
  const top = topVariancePeriods(bridge);
  if (top.length > 0) {
    questions.push({
      question: `Why did ${top[0].periodLabel} vary from forecast by ${formatSignedMoney(top[0].varianceToForecast)}?`,
      rationale: 'It is the single largest period contributor to the variance to forecast.'
    });
  }
  if (bridge.totals.varianceToForecast !== 0) {
    questions.push({
      question: 'Is the variance to forecast expected to persist, or is it timing that will reverse in later periods?',
      rationale: 'Distinguishing permanent from timing variance changes the management response.'
    });
  }
  if (!bridge.reconciliation.allReconciled) {
    questions.push({
      question: 'Which pinned source is causing the bridge not to reconcile?',
      rationale: 'A non-reconciling bridge points to an inconsistency in the pinned inputs that should be resolved first.'
    });
  }

  return questions;
}

function buildHeadline(input: AdvisoryInput): string {
  const { bridge } = input;
  const varDir = direction(bridge.totals.varianceToForecast);
  if (varDir === 'no change') {
    return `Actuals landed on the locked forecast of ${formatMoney(bridge.totals.forecastCost)}.`;
  }
  const overUnder = bridge.totals.varianceToForecast > 0 ? 'over' : 'under';
  return `Actuals came in ${overUnder} the locked forecast by ${formatSignedMoney(bridge.totals.varianceToForecast)}.`;
}

export const deterministicAdvisoryProvider: AdvisoryProvider = {
  name: 'deterministic-v1',
  generate(input: AdvisoryInput): WaterfallAdvisory {
    return {
      advisoryOnly: true,
      provider: 'deterministic-v1',
      headline: buildHeadline(input),
      narrative: buildNarrative(input),
      risks: buildRisks(input),
      suggestedQuestions: buildQuestions(input),
      disclaimer: ADVISORY_DISCLAIMER
    };
  }
};

/**
 * Public entry point used by both surfaces (the /ai workspace and the waterfall
 * detail panel). Defaults to the deterministic provider; a future LLM provider
 * can be injected here without changing callers, and is still bound by the
 * prose-only contract above.
 */
export function buildWaterfallAdvisory(
  input: AdvisoryInput,
  provider: AdvisoryProvider = deterministicAdvisoryProvider
): WaterfallAdvisory {
  return provider.generate(input);
}
