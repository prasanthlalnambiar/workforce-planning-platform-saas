import Link from 'next/link';
import { createReforecastAction } from './actions';
import { AppShell } from '../../components/app-shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { requireUserContext } from '../../lib/auth/session';
import { canCreateReforecasts, getReforecastDashboard } from '../../lib/repositories/reforecasts';
import {
  PhaseBoundaryNote,
  ReforecastStatusBadge,
  StatCard,
  displayDate,
  fiscalYearLabel,
  planName,
  text
} from './_components/reforecast-shared';


export const dynamic = 'force-dynamic';
export default async function ReforecastsPage() {
  const context = await requireUserContext();
  const data = await getReforecastDashboard(context);
  const userCanCreate = canCreateReforecasts(context);

  const drafts = data.reforecasts.filter((reforecast) => String(reforecast.status) === 'draft');
  const inReview = data.reforecasts.filter((reforecast) => String(reforecast.status) === 'in_review');
  const lockedHistory = data.reforecasts.filter((reforecast) => ['locked', 'superseded'].includes(String(reforecast.status)));

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Phase 6 forecast governance" title="Monthly Reforecast" badge="Phase 6">
          The working forecast is calculated deterministically as the locked budget baseline plus approved drivers,
          then reviewed and locked. The latest locked forecast is the single current valid forecast.
          Actuals ingestion, variance analysis and waterfall reporting are future phases.
        </PageHeader>

        <section className="grid-4">
          <StatCard label="Current valid forecast" value={data.currentLocked ? text(data.currentLocked.reforecast_code) : 'None locked yet'} note={data.currentLocked ? text(data.currentLocked.reforecast_name) : 'Lock a forecast to establish it'} tone={data.currentLocked ? 'green' : undefined} />
          <StatCard label="Drafts" value={drafts.length} note="Recalculable working forecasts" />
          <StatCard label="In review" value={inReview.length} note="Controlled, awaiting lock decision" tone={inReview.length > 0 ? 'warm' : undefined} />
          <StatCard label="Locked history" value={lockedHistory.length} note="Immutable forecast versions" />
        </section>

        <section className="card governance-action">
          <p className="eyebrow">Create working forecast</p>
          <h2>New draft reforecast</h2>
          <p>
            Creates a draft forecast from a locked budget baseline plus all currently approved drivers, with a
            deterministic calculation checksum. Only approved drivers are included in the official forecast;
            proposed drivers are scenario-only.
          </p>
          <form className="form-grid" action={createReforecastAction}>
            <label className="field wide">
              <span>Locked baseline</span>
              <select name="budget_baseline_id" required disabled={!userCanCreate || data.lockedBaselines.length === 0}>
                <option value="">Select the locked baseline to reforecast from</option>
                {data.lockedBaselines.map((baseline) => (
                  <option key={String(baseline.id)} value={String(baseline.id)}>
                    {text(baseline.baseline_name)} · {planName(data.plans, baseline.plan_id)} · {fiscalYearLabel(data.fiscalYears, baseline.fiscal_year_id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field wide"><span>Reforecast name</span><input name="reforecast_name" required placeholder="FY27 Reforecast — June cycle" disabled={!userCanCreate} /></label>
            <label className="field wide"><span>Reason (audit trail)</span><input name="reason" placeholder="Why is this reforecast cycle starting?" disabled={!userCanCreate} /></label>
            <button className="button" type="submit" disabled={!userCanCreate || data.lockedBaselines.length === 0}>Create draft reforecast</button>
          </form>
          <PhaseBoundaryNote />
        </section>

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Forecast version history</p><h2>All reforecasts</h2></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Reforecast</th><th>Status</th><th>Approved drivers</th><th>Plan / FY</th><th>Locked</th><th>Created</th><th></th></tr>
              </thead>
              <tbody>
                {data.reforecasts.map((reforecast) => (
                  <tr key={String(reforecast.id)}>
                    <td><strong>{text(reforecast.reforecast_code)}</strong> · {text(reforecast.reforecast_name)}</td>
                    <td><ReforecastStatusBadge status={reforecast.status} isCurrent={reforecast.is_current_locked} /></td>
                    <td>{String(reforecast.approved_driver_count ?? 0)}</td>
                    <td>{planName(data.plans, reforecast.plan_id)}<br /><span className="small-note">{fiscalYearLabel(data.fiscalYears, reforecast.fiscal_year_id)}</span></td>
                    <td>{reforecast.locked_at ? displayDate(reforecast.locked_at) : '—'}</td>
                    <td>{displayDate(reforecast.created_at)}</td>
                    <td><Link className="button button-secondary button-link" href={`/reforecasts/${String(reforecast.id)}`}>Open</Link></td>
                  </tr>
                ))}
                {data.reforecasts.length === 0 ? <tr><td colSpan={7}>No reforecasts yet. Create a draft from a locked baseline above.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        {data.currentLocked ? (
          <section className="card cockpit-card">
            <p className="eyebrow">Current valid forecast</p>
            <h2>{text(data.currentLocked.reforecast_code)} · {text(data.currentLocked.reforecast_name)}</h2>
            <p>
              Locked {displayDate(data.currentLocked.locked_at)} · lock version {text(data.currentLocked.lock_version_id)} ·
              checksum <code>{text(data.currentLocked.checksum).slice(0, 16)}…</code>
            </p>
            <p>This is the official forecast position until a newer forecast is locked, which will supersede it. Historical locked forecasts remain readable.</p>
            <Link className="button button-link" href={`/reforecasts/${String(data.currentLocked.id)}`}>Open current forecast</Link>
          </section>
        ) : null}

        {data.lockedBaselines.length === 0 ? (
          <section className="card">
            <p className="eyebrow">No locked baseline yet</p>
            <h2>Lock a budget baseline first</h2>
            <p>Reforecasts are created from a locked baseline, so this module opens once a baseline is locked in the <Link href="/baseline">Budget Baseline</Link> module. Total spent on drivers can be reviewed in <Link href="/drivers">Drivers</Link>.</p>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
