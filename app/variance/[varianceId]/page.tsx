import Link from 'next/link';
import { notFound } from 'next/navigation';
import { lockVarianceReportAction, recalculateVarianceReportAction, voidVarianceReportAction } from '../actions';
import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import {
  canLockVariance,
  canVoidVariance,
  canWriteVariance,
  getVarianceDetail
} from '../../../lib/repositories/variance';
import {
  StatCard,
  StatusBadge,
  VarianceBoundaryNote,
  displayDate,
  money,
  pct,
  periodLabel,
  signedMoney,
  signedNum,
  statusLabel,
  text
} from '../../actuals/_components/actuals-shared';


export const dynamic = 'force-dynamic';
export default async function VarianceDetailPage({ params }: { params: Promise<{ varianceId: string }> }) {
  const { varianceId } = await params;
  const context = await requireUserContext();
  const data = await getVarianceDetail(context, varianceId);
  if (!data.report) notFound();

  const report = data.report;
  const status = String(report.status);
  const isDraft = status === 'draft';
  const isLocked = status === 'locked';
  const userCanWrite = canWriteVariance(context);
  const userCanLock = canLockVariance(context);
  const userCanVoid = canVoidVariance(context);
  const totals = data.totals;

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Phase 7 variance analysis" title={`${text(report.report_code)} · ${text(report.report_name)}`} badge="Phase 7">
          {isLocked
            ? 'This variance report is locked and immutable, pinned to the actuals version and forecast lock version it was created with.'
            : status === 'superseded'
              ? 'This variance report has been superseded by a newer locked report. It remains readable as history.'
              : status === 'voided'
                ? 'This variance report was voided and is excluded from current reporting, preserved for audit.'
                : 'This is a recalculable draft variance report. Its comparators are already pinned.'}
        </PageHeader>

        <section className="grid-4">
          <StatCard label="Status" value={statusLabel(report.status)} tone={isLocked ? 'green' : isDraft ? 'warm' : undefined} note={report.is_current_locked === true ? 'Current variance position' : undefined} />
          <StatCard label="Cost variance vs forecast" value={totals ? signedMoney(totals.costVarianceToForecast) : '—'} note={totals ? `${pct(totals.costVarianceToForecastPct)} of forecast` : undefined} />
          <StatCard label="Cost variance vs baseline" value={totals ? signedMoney(totals.costVarianceToBaseline) : '—'} note={totals ? `${pct(totals.costVarianceToBaselinePct)} of baseline` : undefined} />
          <StatCard label="FTE / workload vs forecast" value={totals ? signedNum(totals.fteVarianceToForecast) : '—'} note={totals ? `${signedNum(totals.workloadVarianceToForecast, 0)} hours` : undefined} />
        </section>

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Pinned comparators</p><h2>What this report compares against</h2></div>
            <div><StatusBadge status={report.status} extra={report.is_current_locked === true ? 'current' : undefined} /></div>
          </div>
          <div className="grid-2">
            <p><strong>Actuals batch:</strong> {data.batch ? <Link href={`/actuals/${String(data.batch.id)}`}>{text(data.batch.batch_code)} v{String(data.batch.version_number)}</Link> : `v${String(report.actuals_version_number)}`}</p>
            <p><strong>Actuals checksum:</strong> <code>{text(report.actuals_checksum, '—').slice(0, 24)}…</code></p>
            <p><strong>Forecast:</strong> {data.reforecast ? <Link href={`/reforecasts/${String(data.reforecast.id)}`}>{text(data.reforecast.reforecast_code)}</Link> : 'Pinned forecast'} · lock version <code>{text(report.comparator_lock_version_id)}</code></p>
            <p><strong>Forecast checksum:</strong> <code>{text(report.comparator_checksum, '—').slice(0, 24)}…</code></p>
            <p><strong>Baseline:</strong> {data.baseline ? text(data.baseline.baseline_name) : 'Locked baseline'}</p>
            <p><strong>Baseline checksum:</strong> <code>{text(report.baseline_checksum, '—').slice(0, 24)}{report.baseline_checksum ? '…' : ''}</code></p>
          </div>
          <p className="small-note">
            Variance is pinned to the selected locked forecast version. Later forecast locks do not rewrite this
            variance report. {data.reforecast && String(data.reforecast.status) === 'superseded' ? 'The pinned forecast has since been superseded by a newer lock; this report still truthfully reflects the version it compared against.' : ''}
          </p>
        </section>

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Actual vs locked forecast vs baseline</p><h2>Monthly variance</h2></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Period</th><th>Actual</th><th>Forecast</th><th>Var vs forecast</th><th>%</th><th>Baseline</th><th>Var vs baseline</th><th>%</th><th>FTE var (fcst)</th><th>Hours var (fcst)</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((line) => (
                  <tr key={String(line.id)}>
                    <td>{periodLabel(line.period_start)}</td>
                    <td>{money(line.actual_cost)}</td>
                    <td>{money(line.forecast_cost)}</td>
                    <td><strong>{signedMoney(line.cost_variance_to_forecast)}</strong></td>
                    <td>{pct(line.cost_variance_to_forecast_pct)}</td>
                    <td>{money(line.baseline_cost)}</td>
                    <td>{signedMoney(line.cost_variance_to_baseline)}</td>
                    <td>{pct(line.cost_variance_to_baseline_pct)}</td>
                    <td>{signedNum(line.fte_variance_to_forecast)}</td>
                    <td>{signedNum(line.workload_variance_to_forecast, 0)}</td>
                  </tr>
                ))}
                {data.lines.length === 0 ? <tr><td colSpan={10}>No variance lines.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {totals ? (
            <p>
              <strong>Totals across {totals.periodCount} period{totals.periodCount === 1 ? '' : 's'}:</strong>{' '}
              actual {money(totals.actualCost)} vs forecast {money(totals.forecastCost)} ({signedMoney(totals.costVarianceToForecast)}, {pct(totals.costVarianceToForecastPct)})
              and vs baseline {money(totals.baselineCost)} ({signedMoney(totals.costVarianceToBaseline)}, {pct(totals.costVarianceToBaselinePct)});
              FTE {signedNum(totals.fteVarianceToForecast)} vs forecast, {signedNum(totals.fteVarianceToBaseline)} vs baseline;
              workload {signedNum(totals.workloadVarianceToForecast, 0)} hours vs forecast, {signedNum(totals.workloadVarianceToBaseline, 0)} vs baseline.
            </p>
          ) : null}
          <VarianceBoundaryNote />
        </section>

        {isDraft ? (
          <section className="grid-2">
            {userCanWrite ? (
              <article className="card governance-action">
                <p className="eyebrow">Working draft</p>
                <h2>Recalculate</h2>
                <p>Re-runs the deterministic calculation from the same pinned actuals version and forecast lock. Both inputs are immutable, so the result cannot drift.</p>
                <form className="form-grid single" action={recalculateVarianceReportAction}>
                  <input type="hidden" name="variance_report_id" value={String(report.id)} />
                  <label className="field"><span>Reason</span><input name="reason" placeholder="Why recalculate?" /></label>
                  <button className="button" type="submit">Recalculate variance</button>
                </form>
              </article>
            ) : null}
            {userCanLock ? (
              <article className="card governance-action">
                <p className="eyebrow">Governance</p>
                <h2>Lock report</h2>
                <p>Locking makes this report immutable with a deterministic checksum over its lines and pins, and supersedes the previous current report for the same forecast context.</p>
                <form className="form-grid single" action={lockVarianceReportAction}>
                  <input type="hidden" name="variance_report_id" value={String(report.id)} />
                  <label className="field"><span>Lock reason</span><input name="reason" placeholder="Reviewed and approved because…" /></label>
                  <button className="button" type="submit">Lock variance report</button>
                </form>
              </article>
            ) : null}
          </section>
        ) : null}

        {(isDraft || isLocked) && userCanVoid ? (
          <section className="card governance-action">
            <p className="eyebrow">Admin control</p>
            <h2>Void report</h2>
            <p>Voiding excludes this report from current reporting. It remains readable for audit. Voiding a locked report requires elevated admin rights.</p>
            <form className="form-grid single" action={voidVarianceReportAction}>
              <input type="hidden" name="variance_report_id" value={String(report.id)} />
              <label className="field"><span>Void reason</span><input name="reason" required placeholder="Why is this report being withdrawn?" /></label>
              <button className="button button-secondary" type="submit">Void variance report</button>
            </form>
          </section>
        ) : null}

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Lock evidence</p><h2>Lock metadata</h2></div>
          </div>
          <div className="grid-2">
            <p><strong>Lock version:</strong> {text(report.lock_version_id, '—')}</p>
            <p><strong>Report checksum:</strong> <code>{text(report.checksum, '—').slice(0, 24)}{report.checksum ? '…' : ''}</code></p>
            <p><strong>Locked by/at:</strong> {report.locked_at ? displayDate(report.locked_at) : 'Not locked'}</p>
            {data.supersededBy ? <p><strong>Superseded by:</strong> <Link href={`/variance/${String(data.supersededBy.id)}`}>{text(data.supersededBy.report_code)}</Link></p> : null}
          </div>
        </section>

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Audit trail</p><h2>Variance governance events</h2></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Event</th><th>Reason</th><th>When</th></tr></thead>
              <tbody>
                {data.auditEvents.map((event) => (
                  <tr key={String(event.id)}>
                    <td><strong>{text(event.event_type)}</strong></td>
                    <td>{text(event.reason, '—')}</td>
                    <td>{displayDate(event.created_at)}</td>
                  </tr>
                ))}
                {data.auditEvents.length === 0 ? <tr><td colSpan={3}>No audit events recorded yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <p><Link className="button button-secondary button-link" href="/variance">Back to variance register</Link></p>
      </div>
    </AppShell>
  );
}
