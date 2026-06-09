import { createFiscalYearAction } from '../actions';
import { AppShell } from '../../components/app-shell/app-shell';
import { Badge } from '../../components/ui/badge';
import { PageHeader } from '../../components/ui/page-header';
import { requireUserContext } from '../../lib/auth/session';
import { listPlans } from '../../lib/repositories/plans';
import { listFiscalYears, listPlanningPeriods } from '../../lib/repositories/fiscal-years';
import { hasPermission } from '../../lib/permissions/permissions';

export default async function FiscalYearsPage() {
  const context = await requireUserContext();
  const [plans, fiscalYears, periods] = await Promise.all([
    listPlans(context),
    listFiscalYears(context),
    listPlanningPeriods(context)
  ]);
  const canWrite = hasPermission(context.roles, 'fiscal_year:write');

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Planning calendar" title="Fiscal Years & Periods" badge="Monthly grain">
          Creates the calendar foundation used by both Layer 1 demand models and Layer 2 forecast governance.
        </PageHeader>
        <section className="card">
          <h2>Create fiscal year</h2>
          <form className="form-grid" action={createFiscalYearAction}>
            <label className="field"><span>Plan</span><select name="plan_id">{plans.map((plan) => <option key={String(plan.id)} value={String(plan.id)}>{String(plan.plan_name)}</option>)}</select></label>
            <label className="field"><span>Fiscal year label</span><input name="fiscal_year_label" required placeholder="FY2027" /></label>
            <label className="field"><span>Start date</span><input type="date" name="start_date" required defaultValue="2026-07-01" /></label>
            <button className="button" disabled={!canWrite || plans.length === 0} type="submit">Create fiscal year</button>
          </form>
        </section>
        <section className="grid-2">
          <div className="card">
            <h2>Fiscal years</h2>
            <div className="table-wrap"><table><thead><tr><th>FY</th><th>Status</th><th>Dates</th></tr></thead><tbody>
              {fiscalYears.map((fy) => <tr key={String(fy.id)}><td>{String(fy.fiscal_year_label)}</td><td><Badge>{String(fy.status)}</Badge></td><td>{String(fy.start_date)} to {String(fy.end_date)}</td></tr>)}
              {fiscalYears.length === 0 ? <tr><td colSpan={3}>No fiscal years yet.</td></tr> : null}
            </tbody></table></div>
          </div>
          <div className="card">
            <h2>Planning periods</h2>
            <div className="table-wrap"><table><thead><tr><th>#</th><th>Period</th><th>Status</th></tr></thead><tbody>
              {periods.map((period) => <tr key={String(period.id)}><td>{String(period.period_number)}</td><td>{String(period.period_label)}</td><td><Badge>{String(period.status)}</Badge></td></tr>)}
              {periods.length === 0 ? <tr><td colSpan={3}>Periods appear after fiscal year creation.</td></tr> : null}
            </tbody></table></div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
