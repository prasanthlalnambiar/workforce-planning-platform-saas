import Link from 'next/link';
import { transitionDriverLifecycleAction } from '../actions';
import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { StatusBadge, StatCard, displayDate, money, num, text } from '../../baseline/_components/baseline-shared';
import { requireUserContext } from '../../../lib/auth/session';
import { canReviewDrivers, canWriteDrivers, getBudgetDriverDetail } from '../../../lib/repositories/budget-drivers-read';

export const dynamic = 'force-dynamic';

function impactTreatment(status: unknown): string {
  if (String(status) === 'approved') return 'Approved drivers feed official driver impact.';
  if (String(status) === 'proposed') return 'Proposed drivers are scenario-only and do not feed official impact.';
  if (String(status) === 'draft') return 'Draft drivers remain editable and do not feed official impact.';
  return 'Superseded and voided drivers are excluded from official impact.';
}

function lifecycleButton(driverId: string, nextStatus: string, label: string, disabled: boolean) {
  return (
    <form action={transitionDriverLifecycleAction}>
      <input type="hidden" name="driver_id" value={driverId} />
      <input type="hidden" name="next_status" value={nextStatus} />
      <label className="field">
        <span>{label} note</span>
        <textarea name="transition_reason" placeholder="Governance rationale" disabled={disabled} />
      </label>
      <button className="button button-secondary" disabled={disabled} type="submit">{label}</button>
    </form>
  );
}

function LifecyclePanel({ driverId, status, userCanWrite, userCanReview }: { driverId: string; status: string; userCanWrite: boolean; userCanReview: boolean }) {
  if (status === 'draft') {
    return (
      <div className="grid-2">
        {lifecycleButton(driverId, 'proposed', 'Propose driver', !userCanWrite)}
        {lifecycleButton(driverId, 'voided', 'Void driver', !userCanWrite)}
      </div>
    );
  }
  if (status === 'proposed') {
    return (
      <div className="grid-2">
        {lifecycleButton(driverId, 'approved', 'Approve driver', !userCanReview)}
        {lifecycleButton(driverId, 'voided', 'Void driver', !userCanReview)}
      </div>
    );
  }
  if (status === 'approved') return <div className="grid-2">{lifecycleButton(driverId, 'superseded', 'Supersede driver', !userCanReview)}</div>;
  return <p className="small-note">This driver has no remaining lifecycle actions.</p>;
}

export default async function DriverDetailPage({ params }: { params: Promise<{ driverId: string }> }) {
  const context = await requireUserContext();
  const { driverId } = await params;
  const data = await getBudgetDriverDetail(context, driverId);
  const driver = data.driver;
  const userCanWrite = canWriteDrivers(context);
  const userCanReview = canReviewDrivers(context);
  const status = String(driver.status ?? 'draft');

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Phase 5 driver detail" title={text(driver.driver_name, 'Driver')} badge="Phase 5">
          Review the governed driver lifecycle, monthly phasing and official-versus-scenario treatment. This is not a reforecast, variance, actuals, waterfall or AI workflow.
        </PageHeader>

        <section className="header governance-hero">
          <div>
            <p className="eyebrow">Driver status</p>
            <h2>{text(driver.driver_category).replaceAll('_', ' ')} · {text(driver.phasing_method).replaceAll('_', ' ')}</h2>
            <p>{impactTreatment(status)}</p>
            <div className="subnav"><Link href="/drivers">Back to drivers</Link><a href="#phasing">Monthly impact</a><a href="#lifecycle">Lifecycle</a><a href="#audit">Audit history</a></div>
          </div>
          <aside className="status-panel">
            <span>Status</span><StatusBadge status={status} />
            <span>Treatment</span><StatusBadge status={data.monthlyImpacts[0]?.impact_treatment ?? 'draft_preview'} />
            <small>{status === 'approved' ? `Approved ${displayDate(driver.approved_at)}` : status === 'proposed' ? `Proposed ${displayDate(driver.proposed_at)}` : 'Not approved'}</small>
          </aside>
        </section>

        <section className="grid-4">
          <StatCard label="Annual budget" value={money(driver.annual_budget_delta)} />
          <StatCard label="Labour cost" value={money(driver.annual_labour_cost_delta)} />
          <StatCard label="Required FTE" value={num(driver.annual_required_fte_delta)} />
          <StatCard label="Workload hours" value={num(driver.annual_workload_hours_delta)} />
        </section>

        <section className="grid-2">
          <article className="card">
            <p className="eyebrow">Evidence</p>
            <h2>Risk and confidence</h2>
            <div className="grid-3">
              <StatCard label="Risk" value={text(driver.risk_rating)} />
              <StatCard label="Confidence" value={`${num(driver.confidence_score, 0)}%`} />
              <StatCard label="Evidence quality" value={`${num(driver.evidence_quality_score, 0)}%`} />
            </div>
            <p className="small-note">{text(driver.rationale, 'No rationale captured.')}</p>
          </article>
          <article className="card">
            <p className="eyebrow">Source baseline</p>
            <h2>{text(data.baseline?.baseline_name, 'Baseline not found')}</h2>
            <p className="small-note"><strong>Driver pack:</strong> {text(data.driverSet?.driver_set_name, 'Pack not found')}</p>
            <p className="small-note"><strong>Impact basis:</strong> {text(driver.impact_basis).replaceAll('_', ' ')}</p>
            <p className="small-note"><strong>Direction:</strong> {text(driver.driver_direction)}</p>
          </article>
        </section>

        <section id="phasing" className="card">
          <div className="split-row"><div><p className="eyebrow">Monthly impact</p><h2>Phased driver effect</h2></div><StatusBadge status={data.monthlyImpacts[0]?.impact_treatment ?? 'draft_preview'} /></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Period</th><th>Budget</th><th>Labour cost</th><th>FTE</th><th>Workload</th><th>Treatment</th></tr></thead>
              <tbody>
                {data.monthlyImpacts.map((impact) => (
                  <tr key={String(impact.id)}>
                    <td>{displayDate(impact.period_start)}<br /><span className="small-note">to {displayDate(impact.period_end)}</span></td>
                    <td>{money(impact.budget_delta)}</td>
                    <td>{money(impact.labour_cost_delta)}</td>
                    <td>{num(impact.required_fte_delta)}</td>
                    <td>{num(impact.workload_hours_delta)}</td>
                    <td><StatusBadge status={impact.impact_treatment} /></td>
                  </tr>
                ))}
                {data.monthlyImpacts.length === 0 ? <tr><td colSpan={6}>No monthly impact rows found.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section id="lifecycle" className="card governance-action">
          <p className="eyebrow">Lifecycle actions</p>
          <h2>Governed transition</h2>
          <LifecyclePanel driverId={String(driver.id)} status={status} userCanWrite={userCanWrite} userCanReview={userCanReview} />
        </section>

        <section id="audit" className="card">
          <p className="eyebrow">Audit history</p>
          <h2>Driver audit trail</h2>
          <div className="timeline-list">
            {data.auditEvents.map((event) => (
              <article key={String(event.id)}>
                <strong>{text(event.event_type)}</strong>
                <span>{displayDate(event.created_at)} · {text(event.reason, 'No reason captured.')}</span>
              </article>
            ))}
            {data.auditEvents.length === 0 ? <p>No audit events found for this driver yet.</p> : null}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
