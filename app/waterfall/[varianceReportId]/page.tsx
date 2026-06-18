import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import { getWaterfallDetail } from '../../../lib/repositories/waterfall';
import { DRIVER_CATEGORY_LABELS, DRIVER_CATEGORY_ORDER } from '../../../lib/waterfall/waterfall-engine';
import { buildWaterfallAdvisory } from '../../../lib/advisory/advisory-engine';
import { hasPermission } from '../../../lib/permissions/permissions';
import { AdvisoryCompact } from '../../ai/_components/advisory-shared';
import {
  ControlledState,
  StatCard,
  WaterfallBoundaryNote,
  money,
  signedMoney,
  text
} from '../_components/waterfall-shared';


export const dynamic = 'force-dynamic';
export default async function WaterfallDetailPage({ params }: { params: Promise<{ varianceReportId: string }> }) {
  const { varianceReportId } = await params;
  const context = await requireUserContext();
  const data = await getWaterfallDetail(context, varianceReportId);

  if (data.readiness === 'no_locked_variance' && !data.context.varianceReport) {
    notFound();
  }

  const ctx = data.context;

  if (data.readiness !== 'ready' || !data.bridge) {
    return (
      <AppShell context={context}>
        <div className="stack">
          <PageHeader eyebrow="Waterfall" title="Waterfall bridge" badge="Track">
            This waterfall could not be built from locked, complete inputs.
          </PageHeader>
          <ControlledState
            readiness={data.readiness === 'ready' ? 'incomplete_inputs' : data.readiness}
            detail={data.reconciliationError}
            issues={data.pinnedSourceIssues}
          />
          <p><Link className="button button-secondary button-link" href="/waterfall">Back to waterfall</Link></p>
        </div>
      </AppShell>
    );
  }

  const bridge = data.bridge;
  const report = ctx.varianceReport;

  // Phase 9: build the read-only advisory from the SAME deterministic bridge
  // already loaded above — no second computation, no extra DB read, no writes.
  const canSeeAdvisory = hasPermission(context.roles, 'ai:read');
  const advisory = canSeeAdvisory
    ? buildWaterfallAdvisory({
        bridge,
        context: {
          reportCode: text(report?.report_code, 'variance report'),
          reportName: text(report?.report_name),
          planName: text(ctx.plan?.plan_name),
          fiscalYearLabel: text(ctx.fiscalYear?.fiscal_year_label)
        }
      })
    : null;

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader
          eyebrow="Waterfall"
          title={`${text(report?.report_code)} · ${text(report?.report_name)}`}
          badge="Track"
        >
          Baseline to forecast to actuals, explained deterministically for the {bridge.periods.length} covered
          period{bridge.periods.length === 1 ? '' : 's'}. Every figure is read from locked, immutable records.
        </PageHeader>

        <section className="grid-4">
          <StatCard label="Locked baseline" value={money(bridge.totals.baselineCost)} note={ctx.baseline ? text(ctx.baseline.baseline_name) : undefined} tone="green" />
          <StatCard label="Locked forecast" value={money(bridge.totals.forecastCost)} note={ctx.reforecast ? text(ctx.reforecast.reforecast_code) : undefined} tone="green" />
          <StatCard label="Actual result" value={money(bridge.totals.actualCost)} note={ctx.actualsBatch ? text(ctx.actualsBatch.batch_code) : undefined} tone="green" />
          <StatCard
            label="Variance to forecast"
            value={signedMoney(bridge.totals.varianceToForecast)}
            note={`${signedMoney(bridge.totals.varianceToBaseline)} vs baseline`}
          />
        </section>

        {/* What changed, from budget to forecast to actuals */}
        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Budget → forecast → actuals</p><h2>Full-year bridge</h2></div>
          </div>
          <p>
            Sign convention: positive driver impacts increase cost; a positive variance means actual cost ran above
            the locked forecast. Each row is a movement; the bold rows are the baseline, forecast and actual anchors.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Step</th><th>Category</th><th>Movement</th><th>Running total</th></tr>
              </thead>
              <tbody>
                {bridge.steps.map((step) => (
                  <tr key={step.key}>
                    <td>{step.isSubtotal ? <strong>{step.label}</strong> : step.label}</td>
                    <td>{step.category ? text(DRIVER_CATEGORY_LABELS[step.category]) : '—'}</td>
                    <td>{step.isSubtotal ? <strong>{money(step.amount)}</strong> : signedMoney(step.amount)}</td>
                    <td><strong>{money(step.runningTotal)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            <strong>What changed from budget to forecast?</strong> Approved drivers moved cost by{' '}
            {signedMoney(bridge.totals.driverImpactTotal)} ({money(bridge.totals.baselineCost)} →{' '}
            {money(bridge.totals.forecastCost)}). <strong>From forecast to actuals?</strong>{' '}
            {signedMoney(bridge.totals.varianceToForecast)} ({money(bridge.totals.forecastCost)} →{' '}
            {money(bridge.totals.actualCost)}).
          </p>
          <WaterfallBoundaryNote />
        </section>

        {/* Which driver categories caused the movement */}
        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Drivers of the budget-to-forecast move</p><h2>By driver category</h2></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Driver category</th><th>Cost impact</th><th>Share of total move</th></tr></thead>
              <tbody>
                {DRIVER_CATEGORY_ORDER.map((category) => {
                  const impact = bridge.totals.categoryImpacts[category];
                  const share = bridge.totals.driverImpactTotal !== 0
                    ? `${Math.round((impact / bridge.totals.driverImpactTotal) * 100)}%`
                    : '—';
                  return (
                    <tr key={category}>
                      <td>{DRIVER_CATEGORY_LABELS[category]}</td>
                      <td>{signedMoney(impact)}</td>
                      <td>{share}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td><strong>Total approved driver impact</strong></td>
                  <td><strong>{signedMoney(bridge.totals.driverImpactTotal)}</strong></td>
                  <td><strong>100%</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="small-note">Only approved drivers, as captured in the locked forecast, appear here. Proposed (scenario) drivers are excluded.</p>
        </section>

        {/* Which months are causing the variance */}
        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Period breakdown</p><h2>Monthly bridge</h2></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Period</th><th>Baseline</th>
                  {DRIVER_CATEGORY_ORDER.map((category) => <th key={category}>{DRIVER_CATEGORY_LABELS[category].replace(' driver impact', '').replace(' impact', '')}</th>)}
                  <th>Forecast</th><th>Variance</th><th>Actual</th>
                </tr>
              </thead>
              <tbody>
                {bridge.periods.map((period) => (
                  <tr key={period.planningPeriodId}>
                    <td>{period.periodLabel}</td>
                    <td>{money(period.baselineCost)}</td>
                    {DRIVER_CATEGORY_ORDER.map((category) => <td key={category}>{signedMoney(period.categoryImpacts[category])}</td>)}
                    <td>{money(period.forecastCost)}</td>
                    <td><strong>{signedMoney(period.varianceToForecast)}</strong></td>
                    <td>{money(period.actualCost)}</td>
                  </tr>
                ))}
                <tr>
                  <td><strong>FY total</strong></td>
                  <td><strong>{money(bridge.totals.baselineCost)}</strong></td>
                  {DRIVER_CATEGORY_ORDER.map((category) => <td key={category}><strong>{signedMoney(bridge.totals.categoryImpacts[category])}</strong></td>)}
                  <td><strong>{money(bridge.totals.forecastCost)}</strong></td>
                  <td><strong>{signedMoney(bridge.totals.varianceToForecast)}</strong></td>
                  <td><strong>{money(bridge.totals.actualCost)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="small-note">Which months are causing the variance? Scan the variance column — the largest absolute movements are the periods driving the full-year result.</p>
        </section>

        {/* Reconciliation panel */}
        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Reconciliation</p><h2>The bridge reconciles exactly</h2></div>
          </div>
          <div className="grid-2">
            <p><strong>Baseline + approved drivers = forecast:</strong> {bridge.reconciliation.baselinePlusDriversEqualsForecast ? 'Reconciled' : 'Does not reconcile'} ({money(bridge.totals.baselineCost)} + {signedMoney(bridge.totals.driverImpactTotal)} = {money(bridge.totals.forecastCost)})</p>
            <p><strong>Forecast + variance = actual:</strong> {bridge.reconciliation.forecastPlusVarianceEqualsActual ? 'Reconciled' : 'Does not reconcile'} ({money(bridge.totals.forecastCost)} + {signedMoney(bridge.totals.varianceToForecast)} = {money(bridge.totals.actualCost)})</p>
            <p><strong>Periods reconcile to FY total:</strong> {bridge.reconciliation.periodsReconcileToTotal ? 'Reconciled' : 'Does not reconcile'}</p>
            <p><strong>Maximum residual:</strong> {money(bridge.reconciliation.maxResidual)}</p>
          </div>
          {!bridge.reconciliation.allReconciled ? (
            <p className="small-note">One or more checks did not reconcile within tolerance. This indicates the pinned sources are inconsistent and should be reviewed before relying on the bridge.</p>
          ) : null}
        </section>

        {/* Pinned sources */}
        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Pinned immutable sources</p><h2>What this bridge reads</h2></div>
          </div>
          <div className="grid-2">
            <p><strong>Locked baseline:</strong> {ctx.baseline ? text(ctx.baseline.baseline_name) : 'Pinned baseline'}</p>
            <p><strong>Locked forecast:</strong> {ctx.reforecast ? `${text(ctx.reforecast.reforecast_code)} · ${text(ctx.reforecast.lock_version_id)}` : 'Pinned forecast'}</p>
            <p><strong>Posted actuals:</strong> {ctx.actualsBatch ? `${text(ctx.actualsBatch.batch_code)} v${text(ctx.actualsBatch.version_number)}` : 'Pinned actuals'}</p>
            <p><strong>Locked variance:</strong> {text(report?.report_code)} (lock {text(report?.lock_version_id)})</p>
          </div>
          <p className="small-note">The waterfall never modifies any of these records. It is a read-only explanation of their relationship.</p>
        </section>

        {advisory ? <AdvisoryCompact advisory={advisory} varianceReportId={varianceReportId} /> : null}

        <p><Link className="button button-secondary button-link" href="/waterfall">Back to waterfall</Link></p>
      </div>
    </AppShell>
  );
}
