import Link from 'next/link';
import { createBaselineFromHandoffAction, createManualBaselineAction } from './actions';
import { AppShell } from '../../components/app-shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { requireUserContext } from '../../lib/auth/session';
import { getBudgetBaselineDashboard, canCreateBaseline } from '../../lib/repositories/budget-baselines';
import { BaselineSubnav, SourceBadge, StatCard, StatusBadge, displayDate, firstFiscalYearLabel, firstPlanName, money, num, summariseList, text } from './_components/baseline-shared';

export default async function BudgetBaselinePage() {
  const context = await requireUserContext();
  const data = await getBudgetBaselineDashboard(context);
  const userCanCreate = canCreateBaseline(context);
  const lockedBaselines = data.baselines.filter((baseline) => String(baseline.status) === 'locked');
  const draftBaselines = data.baselines.filter((baseline) => String(baseline.status) !== 'locked');
  const activeBaseline = lockedBaselines[0] ?? null;

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Phase 4 budget governance" title="Budget Baseline" badge="Phase 4">
          Convert a ready Layer 1 handoff into a fixed annual OPEX and labour budget reference. This module stops at the locked baseline. Drivers, reforecasting, actuals and variance come later.
        </PageHeader>
        <BaselineSubnav />

        <section className="grid-4">
          <StatCard label="Ready Layer 1 handoffs" value={data.readyHandoffs.length} note="Eligible for baseline creation" />
          <StatCard label="Draft baselines" value={draftBaselines.length} note="Can still be phased and reviewed" />
          <StatCard label="Locked baselines" value={lockedBaselines.length} note="Immutable annual references" tone={activeBaseline ? 'green' : undefined} />
          <StatCard label="Snapshots" value={data.snapshots.length} note="Preserved lock evidence" />
        </section>

        <section id="active" className="card cockpit-card">
          <div className="split-row">
            <div>
              <p className="eyebrow">Annual reference</p>
              <h2>{activeBaseline ? text(activeBaseline.baseline_name) : 'No locked baseline yet'}</h2>
              <p>{activeBaseline ? 'This is the current immutable budget reference for its plan and fiscal year.' : 'Create a draft baseline from a ready Layer 1 handoff or manually, then review and lock it.'}</p>
            </div>
            {activeBaseline ? <Link className="button button-link" href={`/baseline/${String(activeBaseline.id)}`}>View locked baseline</Link> : null}
          </div>
          {activeBaseline ? (
            <div className="grid-4">
              <StatCard label="Annual budget" value={money(activeBaseline.annual_budget_amount)} />
              <StatCard label="Annual labour cost" value={money(activeBaseline.annual_labour_cost)} />
              <StatCard label="Required FTE" value={num(activeBaseline.annual_required_fte)} />
              <StatCard label="Workload hours" value={num(activeBaseline.annual_workload_hours)} />
            </div>
          ) : null}
        </section>

        <section id="create" className="grid-2">
          <article className="card governance-action">
            <p className="eyebrow">Preferred path</p>
            <h2>Create from Layer 1 handoff</h2>
            <p>Only handoffs marked <strong>ready for Layer 2</strong> are available. Imported values come from the immutable handoff payload, not from recalculating Layer 1 inputs.</p>
            <form className="form-grid single" action={createBaselineFromHandoffAction}>
              <label className="field">
                <span>Ready handoff</span>
                <select name="handoff_id" required disabled={!userCanCreate || data.readyHandoffs.length === 0}>
                  <option value="">Select a ready Layer 1 handoff</option>
                  {data.readyHandoffs.map((handoff) => (
                    <option key={String(handoff.id)} value={String(handoff.id)}>
                      {firstPlanName(data.plans, handoff.plan_id)} · {firstFiscalYearLabel(data.fiscalYears, handoff.fiscal_year_id)} · confidence {num(handoff.confidence_score, 0)}%
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Baseline name</span>
                <input name="baseline_name" placeholder="FY2027 Labour Budget Baseline" />
              </label>
              <label className="field">
                <span>Fallback fiscal year</span>
                <select name="fiscal_year_id" disabled={!userCanCreate}>
                  <option value="">Use handoff fiscal year</option>
                  {data.fiscalYears.map((fy) => <option key={String(fy.id)} value={String(fy.id)}>{text(fy.fiscal_year_label)}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Notes</span>
                <textarea name="notes" placeholder="Why is this being converted into the annual baseline?" />
              </label>
              <button className="button" disabled={!userCanCreate || data.readyHandoffs.length === 0} type="submit">Create baseline from handoff</button>
            </form>
          </article>

          <article className="card governance-action">
            <p className="eyebrow">Alternative path</p>
            <h2>Create manual baseline</h2>
            <p>Use this when a Finance-approved annual budget exists without a governed Layer 1 handoff. Manual baselines remain clearly labelled.</p>
            <form className="form-grid" action={createManualBaselineAction}>
              <label className="field wide"><span>Baseline name</span><input name="baseline_name" required placeholder="FY2027 Manual OPEX Baseline" /></label>
              <label className="field"><span>Plan</span><select name="plan_id" required disabled={!userCanCreate}>{data.plans.map((plan) => <option key={String(plan.id)} value={String(plan.id)}>{text(plan.plan_name)}</option>)}</select></label>
              <label className="field"><span>Fiscal year</span><select name="fiscal_year_id" required disabled={!userCanCreate}>{data.fiscalYears.map((fy) => <option key={String(fy.id)} value={String(fy.id)}>{text(fy.fiscal_year_label)}</option>)}</select></label>
              <label className="field"><span>Annual budget amount</span><input name="annual_budget_amount" required type="number" min="0" step="1000" /></label>
              <label className="field"><span>Annual labour cost</span><input name="annual_labour_cost" type="number" min="0" step="1000" placeholder="Defaults to budget" /></label>
              <label className="field"><span>Annual required FTE</span><input name="annual_required_fte" type="number" min="0" step="0.01" /></label>
              <label className="field"><span>Annual workload hours</span><input name="annual_workload_hours" type="number" min="0" step="0.01" /></label>
              <label className="field wide"><span>Notes / rationale</span><textarea name="notes" placeholder="Budget basis, source and boundaries." /></label>
              <button className="button" disabled={!userCanCreate || data.plans.length === 0 || data.fiscalYears.length === 0} type="submit">Create manual baseline</button>
            </form>
          </article>
        </section>

        <section id="history" className="card">
          <div className="split-row">
            <div><p className="eyebrow">Baseline register</p><h2>Drafts, reviews and locked baselines</h2></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Baseline</th><th>Source</th><th>Status</th><th>Plan/FY</th><th>Budget</th><th>FTE</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {data.baselines.map((baseline) => (
                  <tr key={String(baseline.id)}>
                    <td><strong>{text(baseline.baseline_name)}</strong><br /><span className="small-note">{summariseList(baseline.risk_summary_json)}</span></td>
                    <td><SourceBadge source={baseline.source_type} /></td>
                    <td><StatusBadge status={baseline.status} /></td>
                    <td>{firstPlanName(data.plans, baseline.plan_id)}<br /><span className="small-note">{firstFiscalYearLabel(data.fiscalYears, baseline.fiscal_year_id)}</span></td>
                    <td>{money(baseline.annual_budget_amount)}</td>
                    <td>{num(baseline.annual_required_fte)}</td>
                    <td>{displayDate(baseline.created_at)}</td>
                    <td><Link className="button button-secondary button-link" href={`/baseline/${String(baseline.id)}`}>Open</Link></td>
                  </tr>
                ))}
                {data.baselines.length === 0 ? <tr><td colSpan={8}>No budget baselines yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
