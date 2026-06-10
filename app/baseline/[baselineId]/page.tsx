import Link from 'next/link';
import { lockBaselineAction, markBaselineReviewedAction, updateBaselinePhasingAction } from '../actions';
import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import { hasPermission } from '../../../lib/permissions/permissions';
import { canLockBaseline, canReviewBaseline, getBudgetBaselineDetail } from '../../../lib/repositories/budget-baselines';
import { SourceBadge, StatCard, StatusBadge, asArray, asRecord, displayDate, money, num, summariseList, text } from '../_components/baseline-shared';

export default async function BudgetBaselineDetailPage({ params }: { params: Promise<{ baselineId: string }> }) {
  const context = await requireUserContext();
  const { baselineId } = await params;
  const data = await getBudgetBaselineDetail(context, baselineId);
  const baseline = data.baseline;
  if (!baseline) {
    return (
      <AppShell context={context}>
        <section className="card placeholder"><h1>Budget baseline not found</h1><p>The requested baseline either does not exist or is outside your organisation scope.</p><Link className="button button-link" href="/baseline">Back to baselines</Link></section>
      </AppShell>
    );
  }

  const locked = String(baseline.status) === 'locked' || baseline.is_immutable === true;
  const canEditPhasing = hasPermission(context.roles, 'baseline:write') && !locked;
  const userCanReview = canReviewBaseline(context) && !locked;
  const userCanLock = canLockBaseline(context) && !locked && data.reconciliation?.reconciles;
  const snapshotJson = asRecord(data.snapshot?.snapshot_json);
  const sourceHandoff = data.sourceHandoff;
  const riskItems = asArray(baseline.risk_summary_json);

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Budget baseline control" title={text(baseline.baseline_name, 'Budget baseline')} badge="Phase 4">
          Review the annual baseline, monthly phasing and reconciliation before locking the immutable Finance reference. This is still not a reforecast.
        </PageHeader>

        <section className="header governance-hero">
          <div>
            <p className="eyebrow">Governance status</p>
            <h2>{locked ? 'Locked annual reference' : 'Draft baseline under review'}</h2>
            <p>{locked ? 'Header, lines and snapshot are immutable. Any correction will require a future controlled supersede workflow.' : 'Phasing can still be adjusted. Lock only when annual totals reconcile and review is complete.'}</p>
            <div className="subnav"><Link href="/baseline">Back to dashboard</Link><a href="#phasing">Monthly phasing</a><a href="#lock">Review & lock</a><a href="#audit">Audit history</a></div>
          </div>
          <aside className="status-panel">
            <span>Status</span><StatusBadge status={baseline.status} />
            <span>Source</span><SourceBadge source={baseline.source_type} />
            <small>{locked ? `Locked ${displayDate(baseline.locked_at)}` : 'Not locked yet'}</small>
          </aside>
        </section>

        <section className="grid-4">
          <StatCard label="Annual budget" value={money(baseline.annual_budget_amount)} tone={data.reconciliation?.budgetDifference === 0 ? 'green' : undefined} />
          <StatCard label="Annual labour cost" value={money(baseline.annual_labour_cost)} />
          <StatCard label="Required FTE" value={num(baseline.annual_required_fte)} />
          <StatCard label="Workload hours" value={num(baseline.annual_workload_hours)} />
        </section>

        <section className="grid-2">
          <article className="card cockpit-card">
            <p className="eyebrow">Source evidence</p>
            <h2>{String(baseline.source_type) === 'layer1_handoff' ? 'Layer 1 approved planning input' : 'Manual Finance baseline'}</h2>
            {String(baseline.source_type) === 'layer1_handoff' ? (
              <p>Imported from an approved and locked Layer 1 handoff. Values are drawn from the handoff JSON and are not recalculated during baseline creation.</p>
            ) : (
              <p>This baseline was manually entered. It remains separate from Layer 1-derived baselines and must be supported by the notes and audit trail.</p>
            )}
            <div className="kpi-grid">
              <div className="mini-card"><span>Source quality</span><strong>{num(baseline.source_quality_score, 0)}%</strong></div>
              <div className="mini-card"><span>Confidence</span><strong>{num(baseline.confidence_score, 0)}%</strong></div>
            </div>
            {sourceHandoff ? <p className="small-note"><strong>Source handoff:</strong> {text(sourceHandoff.id)} · {text(sourceHandoff.handoff_status)}</p> : null}
          </article>
          <article className="card">
            <p className="eyebrow">Risk and annualisation</p>
            <h2>What carries forward</h2>
            <p>{summariseList(riskItems)}</p>
            <p className="small-note"><strong>Annualisation note:</strong> {text(baseline.annualisation_note, 'No annualisation note captured.')}</p>
            <p className="small-note"><strong>Notes:</strong> {text(baseline.notes, 'No notes captured.')}</p>
          </article>
        </section>

        <section id="phasing" className="card">
          <div className="split-row">
            <div>
              <p className="eyebrow">Monthly phasing</p>
              <h2>Annual baseline spread across planning periods</h2>
              <p>Budget, labour cost and workload hours must reconcile to the annual baseline totals before lock.</p>
            </div>
            <StatusBadge status={data.reconciliation?.reconciles ? 'reconciled' : 'needs_review'} />
          </div>
          <div className="grid-4">
            <StatCard label="Budget difference" value={money(data.reconciliation?.budgetDifference)} tone={data.reconciliation?.budgetDifference === 0 ? 'green' : 'warm'} />
            <StatCard label="Labour cost difference" value={money(data.reconciliation?.labourCostDifference)} tone={data.reconciliation?.labourCostDifference === 0 ? 'green' : 'warm'} />
            <StatCard label="Workload difference" value={num(data.reconciliation?.workloadDifference)} tone={data.reconciliation?.workloadDifference === 0 ? 'green' : 'warm'} />
            <StatCard label="Lines" value={data.lines.length} note="12 monthly periods expected" />
          </div>
          <form className="stack" action={updateBaselinePhasingAction}>
            <input type="hidden" name="budget_baseline_id" value={String(baseline.id)} />
            <div className="table-wrap">
              <table>
                <thead><tr><th>Period</th><th>Workload hours</th><th>Required FTE</th><th>Supply gap</th><th>Labour cost</th><th>Budget amount</th><th>Method</th></tr></thead>
                <tbody>
                  {data.lines.map((line) => (
                    <tr key={String(line.id)}>
                      <td><input type="hidden" name="line_id" value={String(line.id)} />{displayDate(line.period_start)}<br /><span className="small-note">to {displayDate(line.period_end)}</span></td>
                      <td><input name="workload_hours" type="number" step="0.01" min="0" defaultValue={String(line.workload_hours ?? 0)} disabled={!canEditPhasing} /></td>
                      <td><input name="required_fte" type="number" step="0.01" min="0" defaultValue={String(line.required_fte ?? 0)} disabled={!canEditPhasing} /></td>
                      <td><input name="supply_gap_fte" type="number" step="0.01" defaultValue={String(line.supply_gap_fte ?? 0)} disabled={!canEditPhasing} /></td>
                      <td><input name="labour_cost" type="number" step="0.01" min="0" defaultValue={String(line.labour_cost ?? 0)} disabled={!canEditPhasing} /></td>
                      <td><input name="budget_amount" type="number" step="0.01" min="0" defaultValue={String(line.budget_amount ?? 0)} disabled={!canEditPhasing} /></td>
                      <td>{text(line.phasing_method)}</td>
                    </tr>
                  ))}
                  {data.lines.length === 0 ? <tr><td colSpan={7}>No monthly lines have been generated yet.</td></tr> : null}
                </tbody>
              </table>
            </div>
            <label className="field"><span>Phasing notes</span><textarea name="phasing_notes" placeholder="Why were monthly values adjusted?" disabled={!canEditPhasing} /></label>
            <button className="button" disabled={!canEditPhasing} type="submit">Save monthly phasing</button>
          </form>
        </section>

        <section id="lock" className="grid-2">
          <article className="card governance-action">
            <p className="eyebrow">Review checkpoint</p>
            <h2>Mark reviewed</h2>
            <p>This confirms the baseline has been checked but does not lock it. Phasing remains editable until the lock step.</p>
            <form className="form-grid single" action={markBaselineReviewedAction}>
              <input type="hidden" name="budget_baseline_id" value={String(baseline.id)} />
              <label className="field"><span>Review notes</span><textarea name="review_notes" placeholder="What was reviewed and by whom?" disabled={!userCanReview} /></label>
              <button className="button button-secondary" disabled={!userCanReview} type="submit">Mark baseline reviewed</button>
            </form>
          </article>
          <article className="card governance-action warning-card">
            <p className="eyebrow">Immutable lock</p>
            <h2>Lock annual baseline</h2>
            <p>Locking creates the fixed annual Finance reference and immutable snapshot. This cannot be casually edited or deleted.</p>
            <form className="form-grid single" action={lockBaselineAction}>
              <input type="hidden" name="budget_baseline_id" value={String(baseline.id)} />
              <label className="field"><span>Lock notes</span><textarea name="lock_notes" placeholder="Lock rationale and governance notes" disabled={!userCanLock} /></label>
              <button className="button" disabled={!userCanLock} type="submit">Lock budget baseline</button>
            </form>
            {!data.reconciliation?.reconciles ? <p className="small-note">Baseline cannot be locked until monthly phasing reconciles to annual totals.</p> : null}
          </article>
        </section>

        {data.snapshot ? (
          <section className="card">
            <div className="split-row"><div><p className="eyebrow">Locked snapshot</p><h2>Immutable baseline evidence</h2></div><StatusBadge status="locked" /></div>
            <div className="grid-4">
              <StatCard label="Checksum" value={text(data.snapshot.checksum).slice(0, 12)} note="SHA-256 prefix" />
              <StatCard label="Locked by" value={text(data.snapshot.locked_by).slice(0, 12)} />
              <StatCard label="Locked at" value={displayDate(data.snapshot.locked_at)} />
              <StatCard label="Snapshot lines" value={asArray(snapshotJson.lines).length} />
            </div>
          </section>
        ) : null}

        <section id="audit" className="card">
          <p className="eyebrow">Audit history</p>
          <h2>Budget baseline audit trail</h2>
          <div className="timeline-list">
            {data.auditEvents.map((event) => (
              <article key={String(event.id)}>
                <strong>{text(event.event_type)}</strong>
                <span>{displayDate(event.created_at)} · {text(event.reason, 'No reason captured.')}</span>
              </article>
            ))}
            {data.auditEvents.length === 0 ? <p>No audit events found for this baseline yet.</p> : null}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
