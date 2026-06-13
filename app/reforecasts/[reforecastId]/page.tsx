import Link from 'next/link';
import { notFound } from 'next/navigation';
import { lockReforecastAction, recalculateReforecastAction, transitionReforecastStatusAction } from '../actions';
import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import {
  canLockReforecasts,
  canSubmitReforecasts,
  canVoidReforecasts,
  canWriteReforecasts,
  getReforecastDetail
} from '../../../lib/repositories/reforecasts';
import {
  PhaseBoundaryNote,
  ReforecastStatusBadge,
  StatCard,
  displayDate,
  money,
  num,
  periodLabel,
  signedMoney,
  statusLabel,
  text
} from '../_components/reforecast-shared';


export const dynamic = 'force-dynamic';
export default async function ReforecastDetailPage({ params }: { params: Promise<{ reforecastId: string }> }) {
  const { reforecastId } = await params;
  const context = await requireUserContext();
  const data = await getReforecastDetail(context, reforecastId);
  if (!data.reforecast) notFound();

  const reforecast = data.reforecast;
  const status = String(reforecast.status);
  const isDraft = status === 'draft';
  const isInReview = status === 'in_review';
  const isLocked = status === 'locked';
  const userCanWrite = canWriteReforecasts(context);
  const userCanSubmit = canSubmitReforecasts(context);
  const userCanLock = canLockReforecasts(context);
  const userCanVoid = canVoidReforecasts(context);

  const sumOf = (key: string) => data.lines.reduce((total, line) => total + Number(line[key] ?? 0), 0);
  const totalBaseline = sumOf('baseline_budget_amount');
  const totalImpact = sumOf('total_cost_impact');
  const totalForecast = sumOf('forecast_budget_amount');

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Phase 6 forecast governance" title={`${text(reforecast.reforecast_code)} · ${text(reforecast.reforecast_name)}`} badge="Phase 6">
          {isLocked
            ? 'This forecast is locked and immutable. Corrections require a new forecast version; locking a newer forecast supersedes this one.'
            : status === 'superseded'
              ? 'This locked forecast has been superseded by a newer lock. It remains readable as forecast history.'
              : status === 'voided'
                ? 'This forecast was voided under admin control and is preserved for audit.'
                : isInReview
                  ? 'This forecast is in controlled review. It cannot be recalculated; it can be locked, reverted to draft, or voided.'
                  : 'This is a recalculable working draft: locked baseline plus approved drivers.'}
        </PageHeader>

        <section className="grid-4">
          <StatCard label="Status" value={statusLabel(reforecast.status)} tone={isLocked ? 'green' : isDraft || isInReview ? 'warm' : undefined} note={reforecast.is_current_locked === true ? 'Current valid forecast' : undefined} />
          <StatCard label="Baseline annual budget" value={money(totalBaseline)} note={data.baseline ? text(data.baseline.baseline_name) : 'Locked baseline'} />
          <StatCard label="Approved driver impact" value={signedMoney(totalImpact)} note={`${String(reforecast.approved_driver_count ?? 0)} approved drivers included`} />
          <StatCard label="Official forecast" value={money(totalForecast)} note="Baseline + approved driver impacts" tone="green" />
        </section>

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Deterministic monthly calculation</p><h2>Working forecast by period</h2></div>
            <div><ReforecastStatusBadge status={reforecast.status} isCurrent={reforecast.is_current_locked} /></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Period</th><th>Baseline</th><th>Growth</th><th>Efficiency</th><th>Cost change</th><th>Supply change</th><th>Mgmt adj.</th><th>Total impact</th><th>Forecast</th><th>FTE</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((line) => (
                  <tr key={String(line.id)}>
                    <td>{periodLabel(line.period_start)}</td>
                    <td>{money(line.baseline_budget_amount)}</td>
                    <td>{signedMoney(line.growth_cost_impact)}</td>
                    <td>{signedMoney(line.efficiency_cost_impact)}</td>
                    <td>{signedMoney(line.cost_change_cost_impact)}</td>
                    <td>{signedMoney(line.supply_change_cost_impact)}</td>
                    <td>{signedMoney(line.management_adjustment_cost_impact)}</td>
                    <td>{signedMoney(line.total_cost_impact)}</td>
                    <td><strong>{money(line.forecast_budget_amount)}</strong></td>
                    <td>{num(line.forecast_required_fte)}</td>
                  </tr>
                ))}
                {data.lines.length === 0 ? <tr><td colSpan={10}>No forecast lines.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <p className="small-note">Calculated {displayDate(reforecast.calculated_at)} · calculation checksum <code>{text(reforecast.calculation_checksum, '—').slice(0, 16)}…</code></p>
          <PhaseBoundaryNote />
        </section>

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Driver inclusion snapshot</p><h2>Approved drivers in this forecast</h2></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Driver</th><th>Category</th><th>Impact type</th><th>Annual amount</th><th>Status at calculation</th></tr></thead>
              <tbody>
                {data.impacts.map((impact) => (
                  <tr key={String(impact.id)}>
                    <td><strong>{text(impact.driver_code)}</strong> · {text(impact.driver_name)}</td>
                    <td>{text(impact.category).replaceAll('_', ' ')}</td>
                    <td>{text(impact.impact_type).replaceAll('_', ' ')}</td>
                    <td>{String(impact.impact_type) === 'cost_delta' ? signedMoney(impact.annual_impact_amount) : num(impact.annual_impact_amount)}</td>
                    <td>{text(impact.driver_status_at_calculation)}</td>
                  </tr>
                ))}
                {data.impacts.length === 0 ? <tr><td colSpan={5}>No approved drivers were included — the forecast equals the baseline.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Scenario only — not the official forecast</p><h2>Proposed driver overlay</h2></div>
          </div>
          <p>
            {data.proposedDriverCount} proposed driver{data.proposedDriverCount === 1 ? '' : 's'} currently exist for this baseline.
            Proposed drivers are scenario-only: they never feed the official forecast and are shown here purely for what-if context.
          </p>
          {data.scenario.length > 0 && data.proposedDriverCount > 0 ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Period</th><th>Official forecast</th><th>Proposed impact</th><th>Scenario forecast</th><th>Scenario FTE</th></tr></thead>
                <tbody>
                  {data.scenario.map((row) => (
                    <tr key={row.periodId}>
                      <td>{periodLabel(row.periodStart)}</td>
                      <td>{money(row.officialForecastBudget)}</td>
                      <td>{signedMoney(row.scenarioCostImpact)}</td>
                      <td>{money(row.scenarioForecastBudget)}</td>
                      <td>{num(row.scenarioForecastFte)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="small-note">No proposed drivers to overlay.</p>}
        </section>

        {isDraft || isInReview ? (
          <section className="grid-2">
            {isDraft && userCanWrite ? (
              <article className="card governance-action">
                <p className="eyebrow">Working draft</p>
                <h2>Recalculate</h2>
                <p>Re-runs the deterministic calculation against the locked baseline and the approved drivers as they stand now, replacing lines and the inclusion snapshot.</p>
                <form className="form-grid single" action={recalculateReforecastAction}>
                  <input type="hidden" name="reforecast_id" value={String(reforecast.id)} />
                  <label className="field"><span>Reason</span><input name="reason" placeholder="Why recalculate? e.g. new driver approved" /></label>
                  <button className="button" type="submit">Recalculate working forecast</button>
                </form>
              </article>
            ) : null}
            {isDraft && userCanSubmit ? (
              <article className="card governance-action">
                <p className="eyebrow">Governance</p>
                <h2>Submit for review</h2>
                <p>Moves the forecast into controlled review. In-review forecasts cannot be recalculated.</p>
                <form className="form-grid single" action={transitionReforecastStatusAction}>
                  <input type="hidden" name="reforecast_id" value={String(reforecast.id)} />
                  <input type="hidden" name="next_status" value="in_review" />
                  <label className="field"><span>Reason</span><input name="reason" placeholder="Ready for Finance review because…" /></label>
                  <button className="button" type="submit">Submit for review</button>
                </form>
              </article>
            ) : null}
            {isInReview ? (
              <article className="card governance-action">
                <p className="eyebrow">Governance</p>
                <h2>Lock or revert</h2>
                <p>Locking makes this forecast immutable, captures a checksummed snapshot, and supersedes the previous current locked forecast. The latest locked forecast becomes the current valid forecast.</p>
                {userCanLock ? (
                  <form className="form-grid single" action={lockReforecastAction}>
                    <input type="hidden" name="reforecast_id" value={String(reforecast.id)} />
                    <label className="field"><span>Lock reason</span><input name="reason" placeholder="Approved by Finance because…" /></label>
                    <button className="button" type="submit">Lock forecast</button>
                  </form>
                ) : <p className="small-note">Your role cannot lock forecasts.</p>}
                {userCanSubmit ? (
                  <form className="form-grid single" action={transitionReforecastStatusAction}>
                    <input type="hidden" name="reforecast_id" value={String(reforecast.id)} />
                    <input type="hidden" name="next_status" value="draft" />
                    <label className="field"><span>Revert reason</span><input name="reason" placeholder="What needs rework?" /></label>
                    <button className="button button-secondary" type="submit">Revert to draft</button>
                  </form>
                ) : null}
              </article>
            ) : null}
            {userCanVoid ? (
              <article className="card governance-action">
                <p className="eyebrow">Admin control</p>
                <h2>Void forecast</h2>
                <p>Voiding withdraws this forecast. The record is preserved for audit and cannot be reactivated.</p>
                <form className="form-grid single" action={transitionReforecastStatusAction}>
                  <input type="hidden" name="reforecast_id" value={String(reforecast.id)} />
                  <input type="hidden" name="next_status" value="voided" />
                  <label className="field"><span>Void reason</span><input name="reason" required placeholder="Why is this forecast being withdrawn?" /></label>
                  <button className="button button-secondary" type="submit">Void forecast</button>
                </form>
              </article>
            ) : null}
          </section>
        ) : null}

        {isLocked && userCanVoid ? (
          <section className="card governance-action">
            <p className="eyebrow">Admin control</p>
            <h2>Void locked forecast</h2>
            <p>Admin-controlled withdrawal of a locked forecast. Its values remain immutable and readable; it stops being the current valid forecast. Normal corrections should instead lock a newer forecast version.</p>
            <form className="form-grid single" action={transitionReforecastStatusAction}>
              <input type="hidden" name="reforecast_id" value={String(reforecast.id)} />
              <input type="hidden" name="next_status" value="voided" />
              <label className="field"><span>Void reason</span><input name="reason" required placeholder="Why is this locked forecast being voided?" /></label>
              <button className="button button-secondary" type="submit">Void locked forecast</button>
            </form>
          </section>
        ) : null}

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Lock evidence</p><h2>Lock metadata and snapshots</h2></div>
          </div>
          <div className="grid-2">
            <p><strong>Lock version:</strong> {text(reforecast.lock_version_id, '—')}</p>
            <p><strong>Lock checksum:</strong> <code>{text(reforecast.checksum, '—').slice(0, 24)}{reforecast.checksum ? '…' : ''}</code></p>
            <p><strong>Locked by/at:</strong> {reforecast.locked_at ? displayDate(reforecast.locked_at) : 'Not locked'}</p>
            <p><strong>Submitted:</strong> {reforecast.submitted_at ? displayDate(reforecast.submitted_at) : 'Not yet submitted'}</p>
            {data.supersedes ? <p><strong>Supersedes:</strong> <Link href={`/reforecasts/${String(data.supersedes.id)}`}>{text(data.supersedes.reforecast_code)}</Link></p> : null}
            {data.supersededBy ? <p><strong>Superseded by:</strong> <Link href={`/reforecasts/${String(data.supersededBy.id)}`}>{text(data.supersededBy.reforecast_code)}</Link></p> : null}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Snapshot</th><th>Checksum</th><th>Captured</th></tr></thead>
              <tbody>
                {data.snapshots.map((snapshot) => (
                  <tr key={String(snapshot.id)}>
                    <td>{text(snapshot.snapshot_type)}</td>
                    <td><code>{text(snapshot.checksum).slice(0, 24)}…</code></td>
                    <td>{displayDate(snapshot.created_at)}</td>
                  </tr>
                ))}
                {data.snapshots.length === 0 ? <tr><td colSpan={3}>No lock snapshots yet — snapshots are captured when the forecast is locked.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Audit trail</p><h2>Forecast governance events</h2></div>
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

        <p><Link className="button button-secondary button-link" href="/reforecasts">Back to reforecast register</Link></p>
      </div>
    </AppShell>
  );
}
