import Link from 'next/link';
import { Badge } from '../../../components/ui/badge';
import { TAB_SUBNAV, type PrimaryTab } from '../../../lib/navigation/planning-cockpit';
import type { Layer1SelectedPlan } from '../../../lib/repositories/layer1';

export type Layer1SearchParams = Promise<{ planId?: string }> | undefined;

export async function selectedPlanId(searchParams: Layer1SearchParams): Promise<string | undefined> {
  const params = await searchParams;
  return params?.planId;
}

/**
 * Per-tab step navigation. The old mixed Layer-1 subnav (Dashboard / Planning
 * brief / Sources / Operational Demand Data / Demand inputs / Assumptions /
 * Output / Scenarios / Review) is gone — it duplicated and contradicted the left
 * nav. This renders only the STEPS within one job, from the single nav source of
 * truth. Defaults to the Inputs job (its historical callers are Inputs pages).
 */
export function Layer1Subnav({ planId, tab = 'Inputs' }: { planId?: string; tab?: PrimaryTab }) {
  const suffix = planId ? `?planId=${planId}` : '';
  const items = TAB_SUBNAV[tab];
  return (
    <nav className="subnav" aria-label={`${tab} navigation`}>
      {items.map((item) => {
        const isAnchor = item.href.includes('#');
        const href = isAnchor ? item.href : `${item.href}${suffix}`;
        return (
          <Link key={item.href} href={href}>
            {item.label}{item.note ? <span className="subnav-note"> · {item.note}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function PlanSelector({ plans, selectedPlanIdValue }: { plans: Layer1SelectedPlan[]; selectedPlanIdValue?: string }) {
  if (plans.length === 0) {
    return <p className="small-note">Create a plan on Home before building a demand model.</p>;
  }
  return (
    <form className="plan-selector" action="/layer1">
      <label className="field compact-field">
        <span>Selected plan</span>
        <select name="planId" defaultValue={selectedPlanIdValue} aria-label="Selected plan">
          {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
        </select>
      </label>
      <button className="button button-secondary" type="submit">Open</button>
    </form>
  );
}

export function EmptyPlanState() {
  return (
    <section className="card placeholder">
      <h2>No plan selected</h2>
      <p>These records belong to a tenant-scoped plan. Create a plan on Home first, then return here to build the demand-to-budget model.</p>
      <Link className="button button-link" href="/workspace">Go to Workspace</Link>
    </section>
  );
}

export function StatCard({ label, value, tone }: { label: string; value: string | number; tone?: 'warm' | 'green' }) {
  return <article className="metric"><span>{label}</span><strong>{value}</strong>{tone ? <Badge tone={tone}>{tone === 'green' ? 'Good' : 'Watch'}</Badge> : null}</article>;
}

export function money(value: unknown): string {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(Number.isFinite(number) ? number : 0);
}

export function num(value: unknown, digits = 2): string {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number.isFinite(number) ? number : 0);
}

export function percent(value: unknown): string {
  const number = Number(value ?? 0);
  return `${num(number * 100, 1)}%`;
}
