import {
  approveLayer1CalculationRunAction,
  createLayer1VersionLockAndHandoffAction,
  markLayer1HandoffReadyForLayer2Action,
  submitLayer1ForReviewAction
} from '../actions';
import type { ReactNode } from 'react';
import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { Badge } from '../../../components/ui/badge';
import { requireUserContext } from '../../../lib/auth/session';
import { canApproveLayer1, canLockLayer1, canSubmitLayer1 } from '../../../lib/layer1/governance';
import { getLayer1GovernanceData } from '../../../lib/repositories/layer1';
import { EmptyPlanState, Layer1Subnav, PlanSelector, money, num, selectedPlanId, type Layer1SearchParams } from '../_components/layer1-shared';

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function asArray(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
}

function displayDate(value: unknown): string {
  if (!value) return 'Not set';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function workflowStatus(run: JsonRecord | null, lock: JsonRecord | null, handoff: JsonRecord | null): string {
  if (String(handoff?.handoff_status ?? '') === 'ready_for_layer2') return 'ready_for_layer2';
  if (handoff?.handoff_status) return String(handoff.handoff_status);
  if (lock?.approval_status) return String(lock.approval_status);
  if (run?.run_status) return String(run.run_status);
  return 'draft';
}

function StatusBadge({ status }: { status: string }) {
  const tone: 'green' | 'warm' | undefined = ['approved', 'locked', 'ready_for_layer2'].includes(status) ? 'green' : status === 'submitted_for_review' ? 'warm' : undefined;
  return <Badge tone={tone}>{status.replaceAll('_', ' ')}</Badge>;
}

function ActionPanel({ title, children }: { title: string; children: ReactNode }) {
  return <article className="card governance-action"><h3>{title}</h3>{children}</article>;
}

export default async function Layer1ReviewPage({ searchParams }: { searchParams?: Layer1SearchParams }) {
  const context = await requireUserContext();
  const data = await getLayer1GovernanceData(context, await selectedPlanId(searchParams));
  const run = (data.calculationRuns[0] ?? null) as JsonRecord | null;
  const latestLock = (data.versionLocks[0] ?? null) as JsonRecord | null;
  const latestHandoff = (data.handoffs[0] ?? null) as JsonRecord | null;
  const status = workflowStatus(run, latestLock, latestHandoff);
  const output = asRecord(run?.calculation_output_json);
  const workload = asRecord(output.workload);
  const risks = asArray(run?.risk_flags_json ?? output.riskFlags);
  const scenarios = asArray(run?.scenario_summary_json);
  const approvedSnapshot = asRecord(latestLock?.approved_snapshot_json);
  const userCanSubmit = canSubmitLayer1(context.roles);
  const userCanApprove = canApproveLayer1(context.roles);
  const userCanLock = canLockLayer1(context.roles);

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Layer 1 governance" title="Approval, lock and handoff readiness" badge="Phase 3">
          Review the deterministic Layer 1 model, submit it for approval, lock an immutable version and prepare a governed handoff for future Layer 2 baseline setup.
        </PageHeader>
        <PlanSelector plans={data.plans} selectedPlanIdValue={data.plan?.id} />
        {data.plan ? <Layer1Subnav planId={data.plan.id} /> : <EmptyPlanState />}
        {data.plan ? (
          <>
            <section className="card governance-hero">
              <div>
                <p className="eyebrow">Governed planning input</p>
                <h2>{data.plan.name}</h2>
                <p>
                  Layer 1 is now treated as a controlled input to planning governance. The lock preserves the calculation, assumptions,
                  demand evidence and risk context. Phase 3 stops at <strong>ready for Layer 2</strong>; it does not import a budget baseline yet.
                </p>
              </div>
              <div className="status-panel">
                <span>Current status</span>
                <strong><StatusBadge status={status} /></strong>
                <small>Latest run: {run ? displayDate(run.created_at) : 'No saved run yet'}</small>
              </div>
            </section>

            <section className="grid-4">
              <article className="metric"><span>Required FTE</span><strong>{num(run?.required_fte)}</strong></article>
              <article className="metric"><span>FTE gap</span><strong>{num(run?.supply_gap_fte)}</strong></article>
              <article className="metric"><span>Annual labour cost</span><strong>{money(run?.annual_labour_cost)}</strong></article>
              <article className="metric"><span>Budget variance</span><strong>{money(run?.variance_to_target)}</strong></article>
            </section>

            <section className="grid-2">
              <ActionPanel title="1. Submit for review">
                <p className="small-note">Planner/admin step. Requires at least one demand input, assumptions and a saved calculation run.</p>
                <form className="form-grid single" action={submitLayer1ForReviewAction}>
                  <input type="hidden" name="plan_id" value={data.plan.id} />
                  <input type="hidden" name="calculation_run_id" value={String(run?.id ?? '')} />
                  <label className="field wide"><span>Review notes</span><textarea name="review_notes" placeholder="What should the reviewer pay attention to?" /></label>
                  <button className="button" disabled={!userCanSubmit || String(run?.run_status ?? '') !== 'calculated'} type="submit">Submit for review</button>
                </form>
              </ActionPanel>
              <ActionPanel title="2. Approve calculation run">
                <p className="small-note">Reviewer, finance admin, admin or owner step. Approval still does not lock the model.</p>
                <form className="form-grid single" action={approveLayer1CalculationRunAction}>
                  <input type="hidden" name="plan_id" value={data.plan.id} />
                  <input type="hidden" name="calculation_run_id" value={String(run?.id ?? '')} />
                  <label className="field wide"><span>Approval notes</span><textarea name="approval_notes" placeholder="Approval rationale, caveats or open risks." /></label>
                  <button className="button" disabled={!userCanApprove || String(run?.run_status ?? '') !== 'submitted_for_review'} type="submit">Approve Layer 1 run</button>
                </form>
              </ActionPanel>
              <ActionPanel title="3. Lock approved version">
                <p className="small-note">Creates an immutable snapshot and handoff object. Locked snapshots are not editable or deletable.</p>
                <form className="form-grid single" action={createLayer1VersionLockAndHandoffAction}>
                  <input type="hidden" name="plan_id" value={data.plan.id} />
                  <input type="hidden" name="calculation_run_id" value={String(run?.id ?? '')} />
                  <label className="field wide"><span>Lock notes</span><textarea name="lock_notes" placeholder="Why is this version being locked?" /></label>
                  <button className="button" disabled={!userCanLock || String(run?.run_status ?? '') !== 'approved'} type="submit">Lock version and create handoff</button>
                </form>
              </ActionPanel>
              <ActionPanel title="4. Mark ready for Layer 2">
                <p className="small-note">Governance readiness only. Phase 3 does not build the budget baseline import.</p>
                <form className="form-grid single" action={markLayer1HandoffReadyForLayer2Action}>
                  <input type="hidden" name="plan_id" value={data.plan.id} />
                  <input type="hidden" name="handoff_id" value={String(latestHandoff?.id ?? '')} />
                  <label className="field wide"><span>Readiness notes</span><textarea name="ready_notes" placeholder="What should Layer 2 consume later?" /></label>
                  <button className="button" disabled={!userCanLock || String(latestHandoff?.handoff_status ?? '') !== 'locked'} type="submit">Mark ready for Layer 2</button>
                </form>
              </ActionPanel>
            </section>

            <section className="grid-2">
              <article className="card">
                <h2>Review pack</h2>
                <div className="table-wrap compact-table"><table><tbody>
                  <tr><th>Planning brief</th><td>{String(data.briefs[0]?.planning_horizon ?? 'Not captured')}</td></tr>
                  <tr><th>Sources</th><td>{data.sources.length}</td></tr>
                  <tr><th>Demand inputs</th><td>{data.demandInputs.length}</td></tr>
                  <tr><th>Assumptions</th><td>{data.capacityAssumptions.length > 0 && data.costAssumptions.length > 0 ? 'Captured' : 'Missing'}</td></tr>
                  <tr><th>Source quality</th><td>{num(run?.source_quality_score, 0)}%</td></tr>
                  <tr><th>Confidence</th><td>{num(run?.confidence_score, 0)}%</td></tr>
                  <tr><th>Annualisation note</th><td>{String(output.annualisationNote ?? 'Not available')}</td></tr>
                </tbody></table></div>
              </article>
              <article className="card warning-card">
                <h2>Immutable once locked</h2>
                <p>
                  The locked snapshot stores calculation outputs, scenario summaries, key assumptions, source context, risk flags and approval metadata.
                  Casual update/delete is blocked. Corrections require a new version or a controlled supersede path.
                </p>
                <p className="small-note">Checksum: {String(latestLock?.checksum ?? 'No locked checksum yet')}</p>
              </article>
            </section>

            <section className="grid-2">
              <article className="card">
                <h2>Calculation outputs</h2>
                <div className="kpi-grid">
                  <div className="mini-card"><span>Total workload hours</span><strong>{num(workload.totalWorkloadHours ?? run?.workload_hours)}</strong></div>
                  <div className="mini-card"><span>Measured hours</span><strong>{num(run?.measured_workload_hours)}</strong></div>
                  <div className="mini-card"><span>Estimated hours</span><strong>{num(run?.estimated_workload_hours)}</strong></div>
                  <div className="mini-card"><span>Hidden hours</span><strong>{num(run?.hidden_workload_hours)}</strong></div>
                  <div className="mini-card"><span>Productive hours/FTE</span><strong>{num(run?.productive_hours_per_fte)}</strong></div>
                  <div className="mini-card"><span>Cost/FTE</span><strong>{money(run?.weighted_annual_cost_per_fte)}</strong></div>
                </div>
              </article>
              <article className="card">
                <h2>Risk flags</h2>
                <div className="risk-list">
                  {risks.map((risk, index) => <article key={`${String(risk.code ?? 'risk')}-${index}`} className={`risk risk-${String(risk.severity ?? 'medium')}`}><strong>{String(risk.severity ?? 'risk')}</strong><span>{String(risk.message ?? risk.code ?? 'Risk flag')}</span></article>)}
                  {risks.length === 0 ? <p>No risk flags on the latest run.</p> : null}
                </div>
              </article>
            </section>

            <section className="card">
              <h2>Scenario comparison included in review</h2>
              <div className="table-wrap"><table><thead><tr><th>Scenario</th><th>Total hours</th><th>Required FTE</th><th>FTE gap</th><th>Labour cost</th><th>Budget variance</th><th>Risk flags</th></tr></thead><tbody>
                {scenarios.map((scenario, index) => <tr key={`${String(scenario.scenarioName ?? 'scenario')}-${index}`}><td>{String(scenario.scenarioName ?? 'Scenario')}</td><td>{num(asRecord(scenario.workload).totalWorkloadHours)}</td><td>{num(scenario.requiredFte)}</td><td>{num(scenario.fteGap)}</td><td>{money(scenario.labourCost)}</td><td>{money(scenario.budgetVariance)}</td><td>{asArray(scenario.riskFlags).length}</td></tr>)}
                {scenarios.length === 0 ? <tr><td colSpan={7}>Run a calculation to save scenario comparison outputs.</td></tr> : null}
              </tbody></table></div>
            </section>

            <section className="grid-2">
              <article className="card">
                <h2>Calculation run history</h2>
                <div className="table-wrap"><table><thead><tr><th>Created</th><th>Status</th><th>Required FTE</th><th>Cost</th><th>Confidence</th></tr></thead><tbody>
                  {data.calculationRuns.map((item) => <tr key={String(item.id)}><td>{displayDate(item.created_at)}</td><td><StatusBadge status={String(item.run_status ?? 'draft')} /></td><td>{num(item.required_fte)}</td><td>{money(item.annual_labour_cost)}</td><td>{num(item.confidence_score, 0)}%</td></tr>)}
                  {data.calculationRuns.length === 0 ? <tr><td colSpan={5}>No calculation runs yet.</td></tr> : null}
                </tbody></table></div>
              </article>
              <article className="card">
                <h2>Locked snapshot and handoff</h2>
                <div className="table-wrap compact-table"><table><tbody>
                  <tr><th>Version</th><td>{String(latestLock?.version_id ?? 'Not locked')}</td></tr>
                  <tr><th>Lock status</th><td>{latestLock ? <StatusBadge status={String(latestLock.approval_status)} /> : 'Not locked'}</td></tr>
                  <tr><th>Handoff status</th><td>{latestHandoff ? <StatusBadge status={String(latestHandoff.handoff_status)} /> : 'No handoff yet'}</td></tr>
                  <tr><th>Locked at</th><td>{displayDate(latestLock?.locked_at)}</td></tr>
                  <tr><th>Snapshot run</th><td>{String(approvedSnapshot.approved_calculation_run_id ?? 'Not available')}</td></tr>
                </tbody></table></div>
              </article>
            </section>

            <section className="card">
              <h2>Layer 1 audit trail</h2>
              <div className="timeline-list">
                {data.auditEvents.map((event) => <article key={String(event.id)}><strong>{String(event.event_type)}</strong><span>{displayDate(event.created_at)} · {String(event.reason ?? 'No reason supplied')}</span></article>)}
                {data.auditEvents.length === 0 ? <p>No Layer 1 audit events yet.</p> : null}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
