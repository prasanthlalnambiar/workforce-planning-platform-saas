import Link from 'next/link';
import { createDriverAction, createDriverSetAction, transitionDriverLifecycleAction } from './actions';
import { AppShell } from '../../components/app-shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { StatCard, StatusBadge, firstFiscalYearLabel, firstPlanName, money, num, text } from '../baseline/_components/baseline-shared';
import { requireUserContext } from '../../lib/auth/session';
import { canCreateDriverSet, canReviewDrivers, canWriteDrivers, getBudgetDriverDashboard } from '../../lib/repositories/budget-drivers-read';

export const dynamic = 'force-dynamic';

const driverStatuses = ['draft', 'proposed', 'approved', 'superseded', 'voided'] as const;

function baselineName(baselines: Record<string, unknown>[], baselineId: unknown): string {
  return text(baselines.find((baseline) => String(baseline.id) === String(baselineId))?.baseline_name, 'Baseline not found');
}

function driverSetName(driverSets: Record<string, unknown>[], driverSetId: unknown): string {
  return text(driverSets.find((set) => String(set.id) === String(driverSetId))?.driver_set_name, 'Driver set not found');
}

function countByStatus(drivers: Record<string, unknown>[], status: string): number {
  return drivers.filter((driver) => String(driver.status) === status).length;
}

function DriverSubnav() {
  return (
    <nav className="subnav" aria-label="Driver layer navigation">
      <a href="#create">Create drivers</a>
      <a href="#drivers">Driver register</a>
      <a href="#sets">Driver packs</a>
      <a href="#impact">Impact split</a>
    </nav>
  );
}

function LifecycleActions({ driver, userCanWrite, userCanReview }: { driver: Record<string, unknown>; userCanWrite: boolean; userCanReview: boolean }) {
  const status = String(driver.status ?? 'draft');
  const driverId = String(driver.id);
  const action = (nextStatus: string, label: string, disabled: boolean) => (
    <form action={transitionDriverLifecycleAction}>
      <input type="hidden" name="driver_id" value={driverId} />
      <input type="hidden" name="next_status" value={nextStatus} />
      <input type="hidden" name="transition_reason" value={`Driver moved to ${nextStatus}`} />
      <button className="button button-secondary" disabled={disabled} type="submit">{label}</button>
    </form>
  );

  if (status === 'draft') {
    return (
      <div className="inline-actions">
        {action('proposed', 'Propose', !userCanWrite)}
        {action('voided', 'Void', !userCanWrite)}
      </div>
    );
  }
  if (status === 'proposed') {
    return (
      <div className="inline-actions">
        {action('approved', 'Approve', !userCanReview)}
        {action('voided', 'Void', !userCanReview)}
      </div>
    );
  }
  if (status === 'approved') {
    return <div className="inline-actions">{action('superseded', 'Supersede', !userCanReview)}</div>;
  }
  return <span className="small-note">No lifecycle action</span>;
}

export default async function DriverLayerPage() {
  const context = await requireUserContext();
  const data = await getBudgetDriverDashboard(context);
  const userCanCreateSet = canCreateDriverSet(context);
  const userCanWrite = canWriteDrivers(context);
  const userCanReview = canReviewDrivers(context);
  const openDriverSets = data.driverSets.filter((set) => ['draft', 'proposed'].includes(String(set.status)));

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Phase 5 driver layer" title="Drivers" badge="Phase 5">
          Convert locked budget baselines into governed driver assumptions with scenario-only proposals and approved official driver impact. This page does not create reforecast locks, actuals, variance, waterfall or AI outputs.
        </PageHeader>
        <DriverSubnav />

        <section className="grid-4">
          <StatCard label="Draft" value={countByStatus(data.drivers, 'draft')} note="Editable drivers" />
          <StatCard label="Proposed" value={countByStatus(data.drivers, 'proposed')} note="Scenario-only preview" tone="warm" />
          <StatCard label="Approved" value={countByStatus(data.drivers, 'approved')} note="Official driver impact" tone="green" />
          <StatCard label="Superseded / voided" value={countByStatus(data.drivers, 'superseded') + countByStatus(data.drivers, 'voided')} note="Excluded from official impact" />
        </section>

        <section id="impact" className="grid-2">
          <article className="card">
            <p className="eyebrow">Approved official impact</p>
            <h2>{money(data.officialSummary.budgetDelta)}</h2>
            <div className="grid-3">
              <StatCard label="Labour cost" value={money(data.officialSummary.labourCostDelta)} />
              <StatCard label="Required FTE" value={num(data.officialSummary.requiredFteDelta)} />
              <StatCard label="Workload hours" value={num(data.officialSummary.workloadHoursDelta)} />
            </div>
          </article>
          <article className="card">
            <p className="eyebrow">Proposed scenario preview</p>
            <h2>{money(data.proposedSummary.budgetDelta)}</h2>
            <div className="grid-3">
              <StatCard label="Labour cost" value={money(data.proposedSummary.labourCostDelta)} />
              <StatCard label="Required FTE" value={num(data.proposedSummary.requiredFteDelta)} />
              <StatCard label="Workload hours" value={num(data.proposedSummary.workloadHoursDelta)} />
            </div>
          </article>
        </section>

        <section id="create" className="grid-2">
          <article className="card governance-action">
            <p className="eyebrow">Driver pack</p>
            <h2>Start from locked baseline</h2>
            <p>Driver packs group evidence only. Individual driver lifecycle controls official impact.</p>
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
              <label className="field"><span>Driver pack name</span><input name="driver_set_name" required placeholder="FY2027 growth and efficiency drivers" /></label>
              <label className="field"><span>Notes</span><textarea name="notes" placeholder="Scope, decision forum, source packs or planning cycle." /></label>
              <button className="button" disabled={!userCanCreateSet || data.lockedBaselines.length === 0} type="submit">Create pack</button>
            </form>
          </article>

          <article className="card governance-action">
            <p className="eyebrow">Draft driver</p>
            <h2>Monthly phased impact</h2>
            <p>Drafts are editable. Proposed drivers are scenario-only until approved.</p>
            <form className="form-grid" action={createDriverAction}>
              <label className="field wide">
                <span>Driver pack</span>
                <select name="driver_set_id" required disabled={!userCanWrite || openDriverSets.length === 0}>
                  <option value="">Select driver pack</option>
                  {openDriverSets.map((set) => (
                    <option key={String(set.id)} value={String(set.id)}>
                      {text(set.driver_set_name)} · {baselineName(data.lockedBaselines, set.budget_baseline_id)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field wide"><span>Driver name</span><input name="driver_name" required placeholder="Digital containment uplift" /></label>
              <label className="field">
                <span>Category</span>
                <select name="driver_category" required disabled={!userCanWrite}>
                  <option value="growth">Growth</option>
                  <option value="efficiency">Efficiency</option>
                  <option value="cost_change">Cost change</option>
                  <option value="supply_change">Supply change</option>
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
                <span>Phasing</span>
                <select name="phasing_method" required disabled={!userCanWrite}>
                  <option value="straight_line">Straight line</option>
                  <option value="ramp_up">Ramp up</option>
                  <option value="ramp_down">Ramp down</option>
                  <option value="one_off">One off</option>
                </select>
              </label>
              <label className="field"><span>One-off period</span><input name="one_off_period_number" type="number" min="1" max="12" step="1" placeholder="1-12" /></label>
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
              <button className="button" disabled={!userCanWrite || openDriverSets.length === 0} type="submit">Create draft driver</button>
            </form>
          </article>
        </section>

        <section id="drivers" className="card">
          <div className="split-row"><div><p className="eyebrow">Driver register</p><h2>Governed driver lifecycle</h2></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Driver</th><th>Status</th><th>Pack</th><th>Category</th><th>Phasing</th><th>Budget</th><th>Official treatment</th><th>Lifecycle</th></tr></thead>
              <tbody>
                {data.drivers.map((driver) => (
                  <tr key={String(driver.id)}>
                    <td><strong><Link href={`/drivers/${String(driver.id)}`}>{text(driver.driver_name)}</Link></strong><br /><span className="small-note">{text(driver.rationale, 'No rationale captured.')}</span></td>
                    <td><StatusBadge status={driver.status} /></td>
                    <td>{driverSetName(data.driverSets, driver.driver_set_id)}</td>
                    <td>{text(driver.driver_category).replaceAll('_', ' ')}</td>
                    <td>{text(driver.phasing_method).replaceAll('_', ' ')}</td>
                    <td>{money(driver.annual_budget_delta)}</td>
                    <td>{driverStatuses.includes(String(driver.status) as (typeof driverStatuses)[number]) && String(driver.status) === 'approved' ? 'official impact' : String(driver.status) === 'proposed' ? 'scenario only' : 'excluded until approved'}</td>
                    <td><LifecycleActions driver={driver} userCanWrite={userCanWrite} userCanReview={userCanReview} /></td>
                  </tr>
                ))}
                {data.drivers.length === 0 ? <tr><td colSpan={8}>No drivers yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section id="sets" className="card">
          <div className="split-row"><div><p className="eyebrow">Driver packs</p><h2>Secondary grouping</h2></div></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pack</th><th>Status</th><th>Plan/FY</th><th>Baseline</th><th>Official budget</th><th>Official FTE</th><th>Drivers</th></tr></thead>
              <tbody>
                {data.driverSets.map((set) => (
                  <tr key={String(set.id)}>
                    <td><strong>{text(set.driver_set_name)}</strong><br /><span className="small-note">{text(set.notes, 'No notes captured.')}</span></td>
                    <td><StatusBadge status={set.status} /></td>
                    <td>{firstPlanName(data.plans, set.plan_id)}<br /><span className="small-note">{firstFiscalYearLabel(data.fiscalYears, set.fiscal_year_id)}</span></td>
                    <td>{baselineName(data.lockedBaselines, set.budget_baseline_id)}</td>
                    <td>{money(set.total_budget_delta)}</td>
                    <td>{num(set.total_required_fte_delta)}</td>
                    <td>{data.drivers.filter((driver) => String(driver.driver_set_id) === String(set.id)).length}</td>
                  </tr>
                ))}
                {data.driverSets.length === 0 ? <tr><td colSpan={7}>No driver packs yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
