import Link from 'next/link';
import { createActualsBatchAction } from './actions';
import { AppShell } from '../../components/app-shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { requireUserContext } from '../../lib/auth/session';
import { canCreateActuals, getActualsDashboard } from '../../lib/repositories/actuals';
import {
  ActualsBoundaryNote,
  StatCard,
  StatusBadge,
  displayDate,
  fiscalYearLabel,
  planName,
  text
} from './_components/actuals-shared';


export const dynamic = 'force-dynamic';
export default async function ActualsPage() {
  const context = await requireUserContext();
  const data = await getActualsDashboard(context);
  const userCanCreate = canCreateActuals(context);

  const drafts = data.batches.filter((batch) => ['draft', 'validated'].includes(String(batch.status)));
  const posted = data.batches.filter((batch) => String(batch.status) === 'posted');
  const history = data.batches.filter((batch) => ['superseded', 'voided'].includes(String(batch.status)));

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Actuals" title="Actuals" badge="Track">
          Actual results are loaded against a locked budget baseline, validated against existing planning periods,
          and posted as immutable versions. Corrections supersede; they never edit posted numbers.
          Waterfall and Planning Advisor are available in Track.
        </PageHeader>

        <section className="grid-4">
          <StatCard label="Posted batches" value={posted.length} note="Immutable actuals versions" tone={posted.length > 0 ? 'green' : undefined} />
          <StatCard label="In progress" value={drafts.length} note="Draft and validated batches" tone={drafts.length > 0 ? 'warm' : undefined} />
          <StatCard label="History" value={history.length} note="Superseded and voided versions" />
          <StatCard label="Locked baselines" value={data.lockedBaselines.length} note="Available actuals contexts" />
        </section>

        <section className="card governance-action">
          <p className="eyebrow">Load actual results</p>
          <h2>New actuals batch (CSV)</h2>
          <p>
            Paste one row per month as <code>YYYY-MM,cost,fte,workload_hours</code>. Each month must exactly match a
            planning period in the baseline&apos;s fiscal year — unknown months, duplicates, and malformed rows are
            rejected with the reason, never silently mapped.
          </p>
          <form className="form-grid" action={createActualsBatchAction}>
            <label className="field wide">
              <span>Locked baseline</span>
              <select name="baseline_id" required disabled={!userCanCreate || data.lockedBaselines.length === 0}>
                <option value="">Select the locked baseline these actuals belong to</option>
                {data.lockedBaselines.map((baseline) => (
                  <option key={String(baseline.id)} value={String(baseline.id)}>
                    {text(baseline.baseline_name)} · {planName(data.plans, baseline.plan_id)} · {fiscalYearLabel(data.fiscalYears, baseline.fiscal_year_id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field wide">
              <span>Forecast context (optional — must match the selected baseline)</span>
              <select name="reforecast_id" disabled={!userCanCreate}>
                <option value="">No specific forecast context</option>
                {data.lockedBaselines.map((baseline) => {
                  const baselineForecasts = data.lockedReforecasts.filter(
                    (reforecast) => String(reforecast.budget_baseline_id) === String(baseline.id)
                  );
                  if (baselineForecasts.length === 0) return null;
                  return (
                    <optgroup key={String(baseline.id)} label={`Baseline: ${text(baseline.baseline_name)}`}>
                      {baselineForecasts.map((reforecast) => (
                        <option key={String(reforecast.id)} value={String(reforecast.id)}>
                          {text(reforecast.reforecast_code)} · {text(reforecast.reforecast_name)}
                        </option>
                      ))}
                    </optgroup>
                  );
                })}
              </select>
            </label>
            <label className="field wide"><span>Batch name</span><input name="batch_name" required placeholder="FY27 actuals — July to September" disabled={!userCanCreate} /></label>
            <label className="field wide">
              <span>Actuals rows (CSV)</span>
              <textarea name="csv_text" rows={6} required placeholder={'2027-07,102500,51.5,8240\n2027-08,98750,50.0,7980'} disabled={!userCanCreate} />
            </label>
            <label className="field wide"><span>Reason (audit trail)</span><input name="reason" placeholder="Why are these actuals being loaded?" disabled={!userCanCreate} /></label>
            <button className="button" type="submit" disabled={!userCanCreate || data.lockedBaselines.length === 0}>Create draft actuals batch</button>
          </form>
          <ActualsBoundaryNote />
        </section>

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Actuals register</p><h2>All batches</h2></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Batch</th><th>Status</th><th>Version</th><th>Source</th><th>Plan / FY</th><th>Posted</th><th></th></tr>
              </thead>
              <tbody>
                {data.batches.map((batch) => {
                  const latest = data.latestPostedByBaseline.get(String(batch.baseline_id));
                  const isLatestPosted = latest && String(latest.id) === String(batch.id);
                  return (
                    <tr key={String(batch.id)}>
                      <td><strong>{text(batch.batch_code)}</strong> · {text(batch.batch_name)}</td>
                      <td><StatusBadge status={batch.status} extra={isLatestPosted ? 'latest posted' : undefined} /></td>
                      <td>v{String(batch.version_number ?? 1)}</td>
                      <td>{text(batch.source_type)}</td>
                      <td>{planName(data.plans, batch.plan_id)}<br /><span className="small-note">{fiscalYearLabel(data.fiscalYears, batch.fiscal_year_id)}</span></td>
                      <td>{batch.posted_at ? displayDate(batch.posted_at) : '—'}</td>
                      <td><Link className="button button-secondary button-link" href={`/actuals/${String(batch.id)}`}>Open</Link></td>
                    </tr>
                  );
                })}
                {data.batches.length === 0 ? <tr><td colSpan={7}>No actuals batches yet. Load actuals against a locked baseline above.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        {data.lockedBaselines.length === 0 ? (
          <section className="card">
            <p className="eyebrow">No locked baseline yet</p>
            <h2>Lock a budget baseline first</h2>
            <p>Actuals are loaded against a locked baseline. Lock one in the <Link href="/baseline">Budget Baseline</Link> module, then return here.</p>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
