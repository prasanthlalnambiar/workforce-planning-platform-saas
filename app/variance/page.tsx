import Link from 'next/link';
import { createVarianceReportAction } from './actions';
import { AppShell } from '../../components/app-shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { requireUserContext } from '../../lib/auth/session';
import { canCreateVariance, getVarianceDashboard } from '../../lib/repositories/variance';
import {
  StatCard,
  StatusBadge,
  VarianceBoundaryNote,
  fiscalYearLabel,
  planName,
  signedMoney,
  signedNum,
  text
} from '../actuals/_components/actuals-shared';


export const dynamic = 'force-dynamic';
export default async function VariancePage() {
  const context = await requireUserContext();
  const data = await getVarianceDashboard(context);
  const userCanCreate = canCreateVariance(context);

  const locked = data.reports.filter((report) => String(report.status) === 'locked');
  const drafts = data.reports.filter((report) => String(report.status) === 'draft');

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Phase 7 variance analysis" title="Variance" badge="Phase 7">
          Variance compares posted actuals against a pinned locked forecast version and the locked baseline:
          variance = actual − comparator, so positive cost variance means actual cost ran above the comparator.
          Waterfall bridges and AI commentary are future phases.
        </PageHeader>

        <section className="grid-4">
          <StatCard label="Locked reports" value={locked.length} note="Immutable variance positions" tone={locked.length > 0 ? 'green' : undefined} />
          <StatCard label="Draft reports" value={drafts.length} note="Recalculable working reports" tone={drafts.length > 0 ? 'warm' : undefined} />
          <StatCard label="Posted actuals batches" value={data.postedBatches.length} note="Available variance inputs" />
          <StatCard label="Locked forecasts" value={data.lockedReforecasts.length} note="Available pinned comparators" />
        </section>

        <section className="card governance-action">
          <p className="eyebrow">Compare actuals to plan</p>
          <h2>New variance report</h2>
          <p>
            The report pins the selected forecast&apos;s lock version and checksum, the baseline checksum, and the
            actuals batch version at creation. Later forecast locks or actuals corrections never rewrite it.
          </p>
          <form className="form-grid" action={createVarianceReportAction}>
            <label className="field wide">
              <span>Posted actuals batch</span>
              <select name="actuals_batch_id" required disabled={!userCanCreate || data.postedBatches.length === 0}>
                <option value="">Select the posted actuals to analyse</option>
                {data.postedBatches.map((batch) => (
                  <option key={String(batch.id)} value={String(batch.id)}>
                    {text(batch.batch_code)} v{String(batch.version_number)} · {text(batch.batch_name)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field wide">
              <span>Locked forecast version (comparator)</span>
              <select name="reforecast_id" required disabled={!userCanCreate || data.lockedReforecasts.length === 0}>
                <option value="">Select the locked forecast to compare against</option>
                {data.lockedReforecasts.map((reforecast) => (
                  <option key={String(reforecast.id)} value={String(reforecast.id)}>
                    {text(reforecast.reforecast_code)} · {text(reforecast.reforecast_name)} · {text(reforecast.lock_version_id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field wide"><span>Report name</span><input name="report_name" required placeholder="FY27 Q1 variance review" disabled={!userCanCreate} /></label>
            <label className="field wide"><span>Reason (audit trail)</span><input name="reason" placeholder="Why is this variance run happening?" disabled={!userCanCreate} /></label>
            <button className="button" type="submit" disabled={!userCanCreate || data.postedBatches.length === 0 || data.lockedReforecasts.length === 0}>Create variance report</button>
          </form>
          <VarianceBoundaryNote />
        </section>

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Variance register</p><h2>All variance reports</h2></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Report</th><th>Status</th><th>Actuals used</th><th>Forecast lock used</th><th>Cost var vs forecast</th><th>Cost var vs baseline</th><th>FTE var</th><th>Workload var</th><th></th></tr>
              </thead>
              <tbody>
                {data.reports.map((report) => {
                  const totals = data.totalsByReport.get(String(report.id));
                  const batch = data.postedBatches.find((candidate) => String(candidate.id) === String(report.actuals_batch_id));
                  return (
                    <tr key={String(report.id)}>
                      <td>
                        <strong>{text(report.report_code)}</strong> · {text(report.report_name)}<br />
                        <span className="small-note">{planName(data.plans, report.plan_id)} · {fiscalYearLabel(data.fiscalYears, report.fiscal_year_id)}</span>
                      </td>
                      <td><StatusBadge status={report.status} extra={report.is_current_locked === true ? 'current' : undefined} /></td>
                      <td>{batch ? `${text(batch.batch_code)} v${String(batch.version_number)}` : `v${String(report.actuals_version_number)}`}</td>
                      <td><code>{text(report.comparator_lock_version_id).slice(0, 22)}</code></td>
                      <td>{totals ? signedMoney(totals.costVarianceToForecast) : '—'}</td>
                      <td>{totals ? signedMoney(totals.costVarianceToBaseline) : '—'}</td>
                      <td>{totals ? signedNum(totals.fteVarianceToForecast) : '—'}</td>
                      <td>{totals ? signedNum(totals.workloadVarianceToForecast, 0) : '—'}</td>
                      <td><Link className="button button-secondary button-link" href={`/variance/${String(report.id)}`}>Open</Link></td>
                    </tr>
                  );
                })}
                {data.reports.length === 0 ? <tr><td colSpan={9}>No variance reports yet. Post an actuals batch and lock a forecast first.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        {data.postedBatches.length === 0 || data.lockedReforecasts.length === 0 ? (
          <section className="card">
            <p className="eyebrow">Inputs missing</p>
            <h2>Variance needs posted actuals and a locked forecast</h2>
            <p>
              Post an actuals batch in <Link href="/actuals">Actuals</Link> and lock a forecast in{' '}
              <Link href="/reforecasts">Reforecast</Link>, then return here to run variance.
            </p>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
