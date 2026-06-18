import Link from 'next/link';
import { createDriverAction } from './actions';
import { AppShell } from '../../components/app-shell/app-shell';
import { PageHeader } from '../../components/ui/page-header';
import { requireUserContext } from '../../lib/auth/session';
import { canWriteDrivers, getDriverDashboard } from '../../lib/repositories/forecast-drivers';
import {
  CategoryBadge,
  DriverStatusBadge,
  StatCard,
  displayDate,
  firstFiscalYearLabel,
  firstPlanName,
  impactDisplay,
  impactTypeLabel,
  money,
  periodLabel,
  phasingLabel,
  signedNum,
  text
} from './_components/driver-shared';


export const dynamic = 'force-dynamic';
export default async function DriversPage() {
  const context = await requireUserContext();
  const data = await getDriverDashboard(context);
  const userCanWrite = canWriteDrivers(context);

  const activeDrivers = data.drivers.filter((driver) => !['superseded', 'voided'].includes(String(driver.status)));
  const approvedDrivers = activeDrivers.filter((driver) => String(driver.status) === 'approved');
  const proposedDrivers = activeDrivers.filter((driver) => String(driver.status) === 'proposed');
  const draftDrivers = activeDrivers.filter((driver) => String(driver.status) === 'draft');
  const previewBaseline = data.previewBaseline;
  const previewPeriods = previewBaseline
    ? data.periods.filter((period) => String(period.fiscal_year_id) === String(previewBaseline.fiscal_year_id))
    : [];
  const lastPreviewPeriodId = previewPeriods.length > 0 ? String(previewPeriods[previewPeriods.length - 1].id) : undefined;

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Change drivers" title="Driver Layer" badge="Assumptions">
          Register, phase and govern the named drivers that explain movement away from the locked budget baseline.
          Only approved drivers feed the official forecast position. Proposed drivers feed scenarios only.
          This view stops at the governed change-driver register. Reforecast locks, actuals and variance are handled in Forecast & Budget and Track.
        </PageHeader>

        <section className="grid-4">
          <StatCard label="Approved drivers" value={approvedDrivers.length} note="Feed the official forecast position" tone={approvedDrivers.length > 0 ? 'green' : undefined} />
          <StatCard label="Proposed drivers" value={proposedDrivers.length} note="Scenario impact only until approved" tone={proposedDrivers.length > 0 ? 'warm' : undefined} />
          <StatCard label="Draft drivers" value={draftDrivers.length} note="Editable working entries" />
          <StatCard label="Locked baselines" value={data.lockedBaselines.length} note="Drivers attach to a locked baseline" />
        </section>

        {previewBaseline && data.preview ? (
          <section id="impact" className="card cockpit-card">
            <div className="split-row">
              <div>
                <p className="eyebrow">Indicative impact — not a locked forecast</p>
                <h2>{text(previewBaseline.baseline_name)}</h2>
                <p>
                  Deterministic view of the locked baseline plus approved drivers (official position) and plus proposed drivers (scenario).
                  The governed reforecast and forecast locks are built in Forecast & Budget.
                </p>
              </div>
            </div>
            <div className="grid-4">
              <StatCard label="Baseline annual budget" value={money(data.preview.totals.baselineBudget)} />
              <StatCard label="With approved drivers" value={money(data.preview.totals.approvedBudget)} note={`Movement ${signedNum(data.preview.totals.approvedBudgetDelta, 0)}`} tone="green" />
              <StatCard label="Scenario with proposed" value={money(data.preview.totals.scenarioBudget)} note={`Movement ${signedNum(data.preview.totals.scenarioBudgetDelta, 0)}`} tone="warm" />
              <StatCard label="FTE movement" value={signedNum(data.preview.totals.approvedFteDelta)} note={`Scenario ${signedNum(data.preview.totals.scenarioFteDelta)}`} />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Period</th><th>Baseline budget</th><th>Official (approved)</th><th>Scenario (incl. proposed)</th><th>Baseline FTE</th><th>Official FTE</th><th>Scenario FTE</th></tr>
                </thead>
                <tbody>
                  {data.preview.rows.map((row) => (
                    <tr key={row.periodId}>
                      <td>{periodLabel(row.periodStart)}</td>
                      <td>{money(row.baselineBudget)}</td>
                      <td>{money(row.approvedBudget)}</td>
                      <td>{money(row.scenarioBudget)}</td>
                      <td>{row.baselineRequiredFte.toFixed(2)}</td>
                      <td>{row.approvedRequiredFte.toFixed(2)}</td>
                      <td>{row.scenarioRequiredFte.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : (
          <section className="card">
            <p className="eyebrow">No locked baseline yet</p>
            <h2>Lock a budget baseline first</h2>
            <p>Drivers explain movement away from a locked baseline, so the driver register opens once a baseline is locked in the <Link href="/baseline">Budget Baseline</Link> module.</p>
          </section>
        )}

        <section id="create" className="card governance-action">
          <p className="eyebrow">Register a driver</p>
          <h2>New forecast driver</h2>
          <p>Drivers are created as drafts, phased deterministically server-side, then proposed and approved through governed transitions. Every step writes an audit event.</p>
          <form className="form-grid" action={createDriverAction}>
            <label className="field wide">
              <span>Locked baseline</span>
              <select name="budget_baseline_id" required disabled={!userCanWrite || data.lockedBaselines.length === 0}>
                <option value="">Select the locked baseline this driver moves</option>
                {data.lockedBaselines.map((baseline) => (
                  <option key={String(baseline.id)} value={String(baseline.id)}>
                    {text(baseline.baseline_name)} · {firstPlanName(data.plans, baseline.plan_id)} · {firstFiscalYearLabel(data.fiscalYears, baseline.fiscal_year_id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field wide"><span>Driver name</span><input name="driver_name" required placeholder="AI deflection program — Tier 1 chat" disabled={!userCanWrite} /></label>
            <label className="field">
              <span>Category</span>
              <select name="category" required disabled={!userCanWrite}>
                <option value="growth">Growth</option>
                <option value="efficiency">Efficiency</option>
                <option value="cost_change">Cost change</option>
                <option value="supply_change">Supply change</option>
                <option value="management_adjustment">Management adjustment</option>
              </select>
            </label>
            <label className="field">
              <span>Impact type</span>
              <select name="impact_type" required disabled={!userCanWrite}>
                <option value="cost_delta">Cost impact (currency)</option>
                <option value="fte_delta">FTE impact</option>
                <option value="workload_hours_delta">Workload hours impact</option>
              </select>
            </label>
            <label className="field"><span>Annual impact (signed)</span><input name="annual_impact_amount" required type="number" step="0.01" placeholder="-250000 for a reduction" disabled={!userCanWrite} /></label>
            <label className="field">
              <span>Phasing model</span>
              <select name="phasing_model" required disabled={!userCanWrite}>
                <option value="straight_line">Straight line</option>
                <option value="ramp_up">Ramp up</option>
                <option value="ramp_down">Ramp down</option>
                <option value="one_off">One-off</option>
              </select>
            </label>
            <label className="field">
              <span>Start period</span>
              <select name="start_period_id" required disabled={!userCanWrite}>
                {previewPeriods.map((period) => <option key={String(period.id)} value={String(period.id)}>{periodLabel(period.period_start)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>End period</span>
              <select name="end_period_id" required disabled={!userCanWrite} defaultValue={lastPreviewPeriodId}>
                {previewPeriods.map((period) => <option key={String(period.id)} value={String(period.id)}>{periodLabel(period.period_start)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>One-off period (one-off only)</span>
              <select name="one_off_period_id" disabled={!userCanWrite}>
                <option value="">Not a one-off driver</option>
                {previewPeriods.map((period) => <option key={String(period.id)} value={String(period.id)}>{periodLabel(period.period_start)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Confidence</span>
              <select name="confidence_rating" defaultValue="medium" disabled={!userCanWrite}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="field wide"><span>Commentary</span><textarea name="commentary" placeholder="What is driving this movement, what evidence supports it, and who owns delivery?" disabled={!userCanWrite} /></label>
            <label className="field wide"><span>Reason (audit trail)</span><input name="reason" placeholder="Why is this driver being registered?" disabled={!userCanWrite} /></label>
            <button className="button" disabled={!userCanWrite || data.lockedBaselines.length === 0} type="submit">Register draft driver</button>
          </form>
        </section>

        <section id="register" className="card">
          <div className="split-row">
            <div><p className="eyebrow">Driver register</p><h2>All drivers</h2></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Driver</th><th>Category</th><th>Status</th><th>Impact</th><th>Phasing</th><th>Plan/FY</th><th>Created</th><th></th></tr>
              </thead>
              <tbody>
                {data.drivers.map((driver) => (
                  <tr key={String(driver.id)}>
                    <td><strong>{text(driver.driver_code)}</strong> · {text(driver.driver_name)}<br /><span className="small-note">{impactTypeLabel(driver.impact_type)} · confidence {text(driver.confidence_rating)}</span></td>
                    <td><CategoryBadge category={driver.category} /></td>
                    <td><DriverStatusBadge status={driver.status} /></td>
                    <td>{impactDisplay(driver.impact_type, driver.annual_impact_amount)}</td>
                    <td>{phasingLabel(driver.phasing_model)}</td>
                    <td>{firstPlanName(data.plans, driver.plan_id)}<br /><span className="small-note">{firstFiscalYearLabel(data.fiscalYears, driver.fiscal_year_id)}</span></td>
                    <td>{displayDate(driver.created_at)}</td>
                    <td><Link className="button button-secondary button-link" href={`/drivers/${String(driver.id)}`}>Open</Link></td>
                  </tr>
                ))}
                {data.drivers.length === 0 ? <tr><td colSpan={8}>No forecast drivers yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
