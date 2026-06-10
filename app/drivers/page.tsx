import { createDriverAction, createDriverSetAction, reviewDriverSetAction } from './actions';
import { AppShell } from '../../components/app-shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard, StatusBadge, displayDate, firstFiscalYearLabel, firstPlanName, money, num, text } from '../baseline/_components/baseline-shared';
import { requireUserContext } from '../../lib/auth/session';
import { canCreateDriverSet, canReviewDrivers, canWriteDrivers, getBudgetDriverDashboard } from '../../lib/repositories/budget-drivers';

export const dynamic = 'force-dynamic';

function baselineName(baselines: Record<string, unknown>[], baselineId: unknown): string {
  return text(baselines.find((baseline) => String(baseline.id) === String(baselineId))?.baseline_name, 'Baseline not found');
}

function driverSetName(driverSets: Record<string, unknown>[], driverSetId: unknown): string {
  return text(driverSets.find((set) => String(set.id) === String(driverSetId))?.driver_set_name, 'Driver set not found');
}

function relatedDrivers(drivers: Record<string, unknown>[], driverSetId: unknown) {
  return drivers.filter((driver) => String(driver.driver_set_id) === String(driverSetId));
}

function DriverSubnav() {
  return (
    <nav className="subnav" aria-label="Driver layer navigation">
      <a href="#active">Active driver set</a>
      <a href="#create">Create and add drivers</a>
      <a href="#history">Driver set register</a>
      <a href="#drivers">Driver register</a>
    </nav>
  );
}

export default async function DriverLayerPage() {
  const context = await requireUserContext();
  const data = await getBudgetDriverDashboard(context);
  const userCanCreateSet = canCreateDriverSet(context);
  const userCanWrite = canWriteDrivers(context);
  const userCanReview = canReviewDrivers(context);
  const draftDriverSets = data.driverSets.filter((set) => String(set.status) === 'draft');
  const reviewedDriverSets = data.driverSets.filter((set) => String(set.status) === 'reviewed');
  const activeSet = draftDriverSets[0] ?? reviewedDriverSets[0] ?? null;
  const totalBudgetDelta = data.driverSets.reduce((sum, set) => sum + Number(set.total_budget_delta ?? 0), 0);

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Phase 5 driver layer" title="Drivers" badge="Phase 5">
          Convert locked budget baselines into governed growth, efficiency and adjustment drivers. This page captures driver evidence and monthly impacts only; it does not create reforecast locks, actuals, variance, waterfall or AI outputs.
        </PageHeader>
        <DriverSubnav />

        <section className="grid-4">
          <StatCard label="Locked baselines" value={data.lockedBaselines.length} note="Eligible driver sources" />
          <StatCard label="Draft driver sets" value={draftDriverSets.length} note="Open for driver edits" />
          <StatCard label="Reviewed driver sets" value={reviewedDriverSets.length} note="Immutable evidence checkpoint" tone={reviewedDriverSets.length > 0 ? 'green' : undefined} />
          <StatCard label="Driver budget delta" value={money(totalBudgetDelta)} note="Across visible driver sets" />
        </section>

        <section id="active" className="card cockpit-card">
          <div className="split-row">
            <div>
              <p className="eyebrow">Driver evidence</p>
              <h2>{activeSet ? text(activeSet.driver_set_name) : 'No driver set yet'}</h2>
              <p>{activeSet ? 'This driver set records monthly planning adjustments against its locked baseline. It remains separate from forecast locks.' : 'Start by creating a driver set from a locked budget baseline.'}</p>
            </div>
            {activeSet ? <StatusBadge status={activeSet.status} /> : null}
          </div>
          {activeSet ? (
            <div className="grid-4">
              <StatCard label="Budget delta" value={money(activeSet.total_budget_delta)} />
              <StatCard label="Labour cost delta" value={money(activeSet.total_labour_cost_delta)} />
              <StatCard label="Required FTE delta" value={num(activeSet.total_required_fte_delta)} />
              <StatCard label="Workload delta" value={num(activeSet.total_workload_hours_delta)} />
            </div>
          ) : null}
        </section>

        <section id="create" className="grid-2">
          <article className="card governance-action">
            <p className="eyebrow">Create driver set</p>
            <h2>Start from locked baseline</h2>
            <p>Driver sets can only be sourced from locked immutable baselines. The baseline remains unchanged.</p>
            <form className="form-grid single" action={createDriverSetAction}>
              <label className="field">
                <span>Locked baseline</span>
                <select name="budget_baseline_id" required disabled={!userCanCreateSet || data.lockedBaselines.length === 0}>
                  <option value="">Select locked baseline</option>
                  {data.lockedBaselines.map((baseline) => (
                    <option key={String(baseline.id)} value={String(baseline.id)}>
                      {text(baseline.baseline_name)} · {firstFiscalYearLabel(data.fiscalYears, baseline.fiscal_year_id)} · {money(baseline.annual_budget_amount)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Driver set name</span>
                <input name="driver_set_name" required placeholder="FY2027 growth and efficiency drivers" />
              </label>
              <label className="field">
                <span>Notes</span>
                <textarea name="notes" placeholder="Scope, decision forum, source packs or planning cycle." />
              </label>
              <button className="button" disabled={!userCanCreateSet || data.lockedBaselines.length === 0} type="submit">Create driver set</button>
            </form>
          </article>

          <article className="card governance-action">
            <p className="eyebrow">Add driver</p>
            <h2>Monthly phased impact</h2>
            <p>Annual impacts are phased across the 12 locked baseline periods. Values are driver assumptions, not official forecast values.</p>
            <form className="form-grid" action={createDriverAction}>
              <label className="field wide">
                <span>Draft driver set</span>
                <select name="driver_set_id" required disabled={!userCanWrite || draftDriverSets.length === 0}>
                  <option value="">Select draft driver set</option>
                  {draftDriverSets.map((set) => (
                    <option key={String(set.id)} value={String(set.id)}>
                      {text(set.driver_set_name)} · {baselineName(data.lockedBaselines, set.budget_baseline_id)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field wide"><span>Driver name</span><input name="driver_name" required placeholder="Digital servicing containment uplift" /></label>
              <label className="field">
                <span>Category</span>
                <select name="driver_category" required disabled={!userCanWrite}>
                  <option value="volume_growth">Volume growth</option>
                  <option value="service_level_change">Service level change</option>
                  <option value="efficiency">Efficiency</option>
                  <option value="workforce_mix">Workforce mix</option>
                  <option value="cost_rate">Cost rate</option>
                  <option value="operating_model">Operating model</option>
                  <option value="management_adjustment">Management adjustment</option>
                </select>
              </label>
              <label className="field">
                <span>Direction</span>
                <select name="driver_direction" required disabled={!userCanWrite}>
                  <option value="increase">Increase</option>
                  <option value="decrease">Decrease</option>
                </select>
              </label>
              <label className="field">
                <span>Impact basis</span>
                <select name="impact_basis" required disabled={!userCanWrite}>
                  <option value="multi_metric">Multi metric</option>
                  <option value="budget_amount">Budget amount</option>
                  <option value="labour_cost">Labour cost</option>
                  <option value="required_fte">Required FTE</option>
                  <option value="workload_hours">Workload hours</option>
                </select>
              </label>
              <label className="field">
                <span>Risk</span>
                <select name="risk_rating" required disabled={!userCanWrite}>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                  <option value="high">High</option>
                </select>
              </label>
              <label className="field"><span>Annual budget impact</span><input name="annual_budget_delta" type="number" min="0" step="1000" /></label>
              <label className="field"><span>Annual labour cost impact</span><input name="annual_labour_cost_delta" type="number" min="0" step="1000" /></label>
              <label className="field"><span>Required FTE impact</span><input name="annual_required_fte_delta" type="number" min="0" step="0.01" /></label>
              <label className="field"><span>Workload hour impact</span><input name="annual_workload_hours_delta" type="number" min="0" step="0.01" /></label>
              <label className="field"><span>Confidence score</span><input name="confidence_score" type="number" min="0" max="100" step="1" defaultValue="70" /></label>
              <label className="field"><span>Evidence quality score</span><input name="evidence_quality_score" type="number" min="0" max="100" step="1" defaultValue="70" /></label>
              <label className="field wide"><span>Rationale</span><textarea name="rationale" placeholder="Evidence, dependency, owner and calculation basis." /></label>
              <button className="button" disabled={!userCanWrite || draftDriverSets.length === 0} type="submit">Add driver</button>
            </form>
          </article>
        </section>

        <section id="history" className="card">
          <div className="split-row">
            <div><p className="eyebrow">Driver set register</p><h2>Draft and reviewed driver packs</h2></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Driver set</th><th>Status</th><th>Plan/FY</th><th>Baseline</th><th>Budget delta</th><th>FTE delta</th><th>Drivers</th><th>Review</th></tr></thead>
              <tbody>
                {data.driverSets.map((set) => (
                  <tr key={String(set.id)}>
                    <td><strong>{text(set.driver_set_name)}</strong><br /><span className="small-note">{text(set.notes, 'No notes captured.')}</span></td>
                    <td><StatusBadge status={set.status} /></td>
                    <td>{firstPlanName(data.plans, set.plan_id)}<br /><span className="small-note">{firstFiscalYearLabel(data.fiscalYears, set.fiscal_year_id)}</span></td>
                    <td>{baselineName(data.lockedBaselines, set.budget_baseline_id)}</td>
                    <td>{money(set.total_budget_delta)}</td>
                    <td>{num(set.total_required_fte_delta)}</td>
                    <td>{relatedDrivers(data.drivers, set.id).length}</td>
                    <td>
                      {String(set.status) === 'draft' ? (
                        <form className="stack" action={reviewDriverSetAction}>
                          <input type="hidden" name="driver_set_id" value={String(set.id)} />
                          <textarea name="review_notes" placeholder="Review note" disabled={!userCanReview} />
                          <button className="button button-secondary" disabled={!userCanReview || relatedDrivers(data.drivers, set.id).length === 0} type="submit">Mark reviewed</button>
                        </form>
                      ) : (
                        <span className="small-note">Reviewed {displayDate(set.reviewed_at)}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {data.driverSets.length === 0 ? <tr><td colSpan={8}>No driver sets yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section id="drivers" className="card">
          <div className="split-row">
            <div><p className="eyebrow">Driver register</p><h2>Structured growth and efficiency assumptions</h2></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Driver</th><th>Set</th><th>Category</th><th>Direction</th><th>Budget</th><th>Labour cost</th><th>FTE</th><th>Risk</th></tr></thead>
              <tbody>
                {data.drivers.map((driver) => (
                  <tr key={String(driver.id)}>
                    <td><strong>{text(driver.driver_name)}</strong><br /><span className="small-note">{text(driver.rationale, 'No rationale captured.')}</span></td>
                    <td>{driverSetName(data.driverSets, driver.driver_set_id)}</td>
                    <td>{text(driver.driver_category).replaceAll('_', ' ')}</td>
                    <td>{text(driver.driver_direction)}</td>
                    <td>{money(driver.annual_budget_delta)}</td>
                    <td>{money(driver.annual_labour_cost_delta)}</td>
                    <td>{num(driver.annual_required_fte_delta)}</td>
                    <td><StatusBadge status={driver.risk_rating} /></td>
                  </tr>
                ))}
                {data.drivers.length === 0 ? <tr><td colSpan={8}>No drivers yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
