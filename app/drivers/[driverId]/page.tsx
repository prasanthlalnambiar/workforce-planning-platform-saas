import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supersedeDriverAction, transitionDriverStatusAction, updateDriverDraftAction } from '../actions';
import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import {
  canApproveDrivers,
  canProposeDrivers,
  canSupersedeDrivers,
  canWriteDrivers,
  getDriverDetail
} from '../../../lib/repositories/forecast-drivers';
import {
  CategoryBadge,
  DriverStatusBadge,
  StatCard,
  displayDate,
  impactDisplay,
  impactTypeLabel,
  periodLabel,
  phasingLabel,
  text
} from '../_components/driver-shared';


export const dynamic = 'force-dynamic';
export default async function DriverDetailPage({ params }: { params: Promise<{ driverId: string }> }) {
  const { driverId } = await params;
  const context = await requireUserContext();
  const data = await getDriverDetail(context, driverId);
  if (!data.driver) notFound();

  const driver = data.driver;
  const status = String(driver.status);
  const editable = status === 'draft' || status === 'proposed';
  const userCanWrite = canWriteDrivers(context);
  const userCanPropose = canProposeDrivers(context);
  const userCanApprove = canApproveDrivers(context);
  const userCanSupersede = canSupersedeDrivers(context);
  const activeLines = data.lines.filter((line) => Number(line.impact_amount) !== 0);

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Phase 5 driver governance" title={`${text(driver.driver_code)} · ${text(driver.driver_name)}`} badge="Phase 5">
          {status === 'approved'
            ? 'This driver is approved and immutable. It feeds the official forecast position. Changes require the controlled supersede workflow.'
            : status === 'proposed'
              ? 'This driver is proposed. It feeds scenarios only until it is approved.'
              : status === 'superseded'
                ? 'This driver has been superseded and is preserved for audit.'
                : status === 'voided'
                  ? 'This driver has been voided and is preserved for audit.'
                  : 'This driver is a draft. Phase it, review it, then propose it for approval.'}
        </PageHeader>

        <section className="grid-4">
          <StatCard label="Status" value={text(driver.status).replaceAll('_', ' ')} tone={status === 'approved' ? 'green' : editable ? 'warm' : undefined} />
          <StatCard label="Annual impact" value={impactDisplay(driver.impact_type, driver.annual_impact_amount)} note={impactTypeLabel(driver.impact_type)} />
          <StatCard label="Phasing" value={phasingLabel(driver.phasing_model)} note={`Confidence ${text(driver.confidence_rating)}`} />
          <StatCard label="Baseline" value={data.baseline ? text(data.baseline.baseline_name) : 'Unknown'} note="Locked annual reference" />
        </section>

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Identity</p><h2>Driver record</h2></div>
            <div><CategoryBadge category={driver.category} /> <DriverStatusBadge status={driver.status} /></div>
          </div>
          <div className="grid-2">
            <p><strong>Commentary:</strong> {text(driver.commentary, 'None recorded')}</p>
            <p><strong>Created:</strong> {displayDate(driver.created_at)}</p>
            <p><strong>Proposed:</strong> {driver.proposed_at ? displayDate(driver.proposed_at) : 'Not yet proposed'}</p>
            <p><strong>Approved:</strong> {driver.approved_at ? displayDate(driver.approved_at) : 'Not yet approved'}</p>
            {data.supersedes ? <p><strong>Supersedes:</strong> <Link href={`/drivers/${String(data.supersedes.id)}`}>{text(data.supersedes.driver_code)}</Link></p> : null}
            {data.supersededBy ? <p><strong>Superseded by:</strong> <Link href={`/drivers/${String(data.supersededBy.id)}`}>{text(data.supersededBy.driver_code)}</Link></p> : null}
          </div>
        </section>

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Deterministic phasing</p><h2>Monthly impact lines</h2></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Period</th><th>Impact</th><th>Immutable</th></tr></thead>
              <tbody>
                {data.lines.map((line) => (
                  <tr key={String(line.id)}>
                    <td>{periodLabel(line.period_start)}</td>
                    <td>{impactDisplay(driver.impact_type, line.impact_amount)}</td>
                    <td>{line.is_immutable ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
                {data.lines.length === 0 ? <tr><td colSpan={3}>No phased lines.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <p className="small-note">{activeLines.length} of {data.lines.length} periods carry impact. Lines always reconcile to the annual amount; residual rounding sits in the final active period.</p>
        </section>

        {editable ? (
          <section className="grid-2">
            {status === 'draft' && userCanPropose ? (
              <article className="card governance-action">
                <p className="eyebrow">Governance</p>
                <h2>Propose for approval</h2>
                <p>Proposing moves this driver into scenario modelling and signals it is ready for Finance review. It does not feed the official forecast.</p>
                <form className="form-grid single" action={transitionDriverStatusAction}>
                  <input type="hidden" name="forecast_driver_id" value={String(driver.id)} />
                  <input type="hidden" name="next_status" value="proposed" />
                  <label className="field"><span>Reason</span><input name="reason" placeholder="Why is this ready to propose?" /></label>
                  <button className="button" type="submit">Propose driver</button>
                </form>
              </article>
            ) : null}
            {status === 'proposed' ? (
              <article className="card governance-action">
                <p className="eyebrow">Governance</p>
                <h2>Approve or revert</h2>
                <p>Approval makes this driver immutable and adds it to the official forecast position. Reverting returns it to draft for rework.</p>
                {userCanApprove ? (
                  <form className="form-grid single" action={transitionDriverStatusAction}>
                    <input type="hidden" name="forecast_driver_id" value={String(driver.id)} />
                    <input type="hidden" name="next_status" value="approved" />
                    <label className="field"><span>Approval reason</span><input name="reason" placeholder="Approval basis and evidence reviewed" /></label>
                    <button className="button" type="submit">Approve driver</button>
                  </form>
                ) : <p className="small-note">Your role cannot approve drivers.</p>}
                {userCanPropose ? (
                  <form className="form-grid single" action={transitionDriverStatusAction}>
                    <input type="hidden" name="forecast_driver_id" value={String(driver.id)} />
                    <input type="hidden" name="next_status" value="draft" />
                    <label className="field"><span>Revert reason</span><input name="reason" placeholder="What needs rework?" /></label>
                    <button className="button button-secondary" type="submit">Revert to draft</button>
                  </form>
                ) : null}
              </article>
            ) : null}
            {userCanSupersede ? (
              <article className="card governance-action">
                <p className="eyebrow">Governance</p>
                <h2>Void driver</h2>
                <p>Voiding withdraws a draft or proposed driver. The record is preserved for audit and cannot be reactivated.</p>
                <form className="form-grid single" action={transitionDriverStatusAction}>
                  <input type="hidden" name="forecast_driver_id" value={String(driver.id)} />
                  <input type="hidden" name="next_status" value="voided" />
                  <label className="field"><span>Void reason</span><input name="reason" required placeholder="Why is this driver being withdrawn?" /></label>
                  <button className="button button-secondary" type="submit">Void driver</button>
                </form>
              </article>
            ) : null}
          </section>
        ) : null}

        {editable && userCanWrite ? (
          <section className="card governance-action">
            <p className="eyebrow">Edit while editable</p>
            <h2>Update draft values</h2>
            <p>Editing re-runs deterministic phasing server-side. Approved drivers cannot be edited.</p>
            <form className="form-grid" action={updateDriverDraftAction}>
              <input type="hidden" name="forecast_driver_id" value={String(driver.id)} />
              <input type="hidden" name="budget_baseline_id" value={String(driver.budget_baseline_id)} />
              <label className="field wide"><span>Driver name</span><input name="driver_name" defaultValue={text(driver.driver_name, '')} required /></label>
              <label className="field">
                <span>Category</span>
                <select name="category" defaultValue={String(driver.category)} required>
                  <option value="growth">Growth</option>
                  <option value="efficiency">Efficiency</option>
                  <option value="cost_change">Cost change</option>
                  <option value="supply_change">Supply change</option>
                  <option value="management_adjustment">Management adjustment</option>
                </select>
              </label>
              <label className="field">
                <span>Impact type</span>
                <select name="impact_type" defaultValue={String(driver.impact_type)} required>
                  <option value="cost_delta">Cost impact (currency)</option>
                  <option value="fte_delta">FTE impact</option>
                  <option value="workload_hours_delta">Workload hours impact</option>
                </select>
              </label>
              <label className="field"><span>Annual impact (signed)</span><input name="annual_impact_amount" type="number" step="0.01" defaultValue={String(driver.annual_impact_amount)} required /></label>
              <label className="field">
                <span>Phasing model</span>
                <select name="phasing_model" defaultValue={String(driver.phasing_model)} required>
                  <option value="straight_line">Straight line</option>
                  <option value="ramp_up">Ramp up</option>
                  <option value="ramp_down">Ramp down</option>
                  <option value="one_off">One-off</option>
                </select>
              </label>
              <label className="field">
                <span>Start period</span>
                <select name="start_period_id" defaultValue={String(driver.start_period_id)} required>
                  {data.periods.map((period) => <option key={String(period.id)} value={String(period.id)}>{periodLabel(period.period_start)}</option>)}
                </select>
              </label>
              <label className="field">
                <span>End period</span>
                <select name="end_period_id" defaultValue={String(driver.end_period_id)} required>
                  {data.periods.map((period) => <option key={String(period.id)} value={String(period.id)}>{periodLabel(period.period_start)}</option>)}
                </select>
              </label>
              <label className="field">
                <span>One-off period</span>
                <select name="one_off_period_id" defaultValue={String(driver.one_off_period_id ?? '')}>
                  <option value="">Not a one-off driver</option>
                  {data.periods.map((period) => <option key={String(period.id)} value={String(period.id)}>{periodLabel(period.period_start)}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Confidence</span>
                <select name="confidence_rating" defaultValue={String(driver.confidence_rating)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="field wide"><span>Commentary</span><textarea name="commentary" defaultValue={text(driver.commentary, '')} /></label>
              <label className="field wide"><span>Reason (audit trail)</span><input name="reason" placeholder="Why are these values changing?" /></label>
              <button className="button" type="submit">Update draft</button>
            </form>
          </section>
        ) : null}

        {status === 'approved' && userCanSupersede ? (
          <section className="card governance-action">
            <p className="eyebrow">Controlled change</p>
            <h2>Supersede this approved driver</h2>
            <p>Creates a replacement draft linked to this driver and marks this one superseded, atomically, with audit events on both records. The approved values themselves are never edited.</p>
            <form className="form-grid" action={supersedeDriverAction}>
              <input type="hidden" name="forecast_driver_id" value={String(driver.id)} />
              <input type="hidden" name="budget_baseline_id" value={String(driver.budget_baseline_id)} />
              <label className="field wide"><span>Replacement name</span><input name="driver_name" defaultValue={`${text(driver.driver_name, '')} (revised)`} required /></label>
              <label className="field">
                <span>Category</span>
                <select name="category" defaultValue={String(driver.category)} required>
                  <option value="growth">Growth</option>
                  <option value="efficiency">Efficiency</option>
                  <option value="cost_change">Cost change</option>
                  <option value="supply_change">Supply change</option>
                  <option value="management_adjustment">Management adjustment</option>
                </select>
              </label>
              <label className="field">
                <span>Impact type</span>
                <select name="impact_type" defaultValue={String(driver.impact_type)} required>
                  <option value="cost_delta">Cost impact (currency)</option>
                  <option value="fte_delta">FTE impact</option>
                  <option value="workload_hours_delta">Workload hours impact</option>
                </select>
              </label>
              <label className="field"><span>Annual impact (signed)</span><input name="annual_impact_amount" type="number" step="0.01" defaultValue={String(driver.annual_impact_amount)} required /></label>
              <label className="field">
                <span>Phasing model</span>
                <select name="phasing_model" defaultValue={String(driver.phasing_model)} required>
                  <option value="straight_line">Straight line</option>
                  <option value="ramp_up">Ramp up</option>
                  <option value="ramp_down">Ramp down</option>
                  <option value="one_off">One-off</option>
                </select>
              </label>
              <label className="field">
                <span>Start period</span>
                <select name="start_period_id" defaultValue={String(driver.start_period_id)} required>
                  {data.periods.map((period) => <option key={String(period.id)} value={String(period.id)}>{periodLabel(period.period_start)}</option>)}
                </select>
              </label>
              <label className="field">
                <span>End period</span>
                <select name="end_period_id" defaultValue={String(driver.end_period_id)} required>
                  {data.periods.map((period) => <option key={String(period.id)} value={String(period.id)}>{periodLabel(period.period_start)}</option>)}
                </select>
              </label>
              <label className="field">
                <span>One-off period</span>
                <select name="one_off_period_id" defaultValue={String(driver.one_off_period_id ?? '')}>
                  <option value="">Not a one-off driver</option>
                  {data.periods.map((period) => <option key={String(period.id)} value={String(period.id)}>{periodLabel(period.period_start)}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Confidence</span>
                <select name="confidence_rating" defaultValue={String(driver.confidence_rating)}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="field wide"><span>Commentary</span><textarea name="commentary" defaultValue={text(driver.commentary, '')} /></label>
              <label className="field wide"><span>Supersede reason (audit trail)</span><input name="reason" required placeholder="Why is the approved driver being replaced?" /></label>
              <button className="button" type="submit">Create replacement and supersede</button>
            </form>
          </section>
        ) : null}

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Audit trail</p><h2>Driver governance events</h2></div>
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

        <p><Link className="button button-secondary button-link" href="/drivers">Back to driver register</Link></p>
      </div>
    </AppShell>
  );
}
