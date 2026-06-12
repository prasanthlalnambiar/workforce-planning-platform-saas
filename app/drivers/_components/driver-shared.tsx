import { Badge } from '../../../components/ui/badge';

export type JsonRecord = Record<string, unknown>;

export function text(value: unknown, fallback = 'Not set'): string {
  const candidate = String(value ?? '').trim();
  return candidate || fallback;
}

export function num(value: unknown, digits = 2): string {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number.isFinite(number) ? number : 0);
}

export function money(value: unknown): string {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(Number.isFinite(number) ? number : 0);
}

export function signedNum(value: unknown, digits = 2): string {
  const number = Number(value ?? 0);
  const formatted = num(Math.abs(number), digits);
  if (!Number.isFinite(number) || number === 0) return num(0, digits);
  return number > 0 ? `+${formatted}` : `-${formatted}`;
}

export function displayDate(value: unknown): string {
  if (!value) return 'Not set';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

export function periodLabel(value: unknown): string {
  if (!value) return 'Not set';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' });
}

export function driverStatusTone(status: unknown): 'green' | 'warm' | undefined {
  const value = String(status ?? '');
  if (value === 'approved') return 'green';
  if (value === 'draft' || value === 'proposed') return 'warm';
  return undefined;
}

export function DriverStatusBadge({ status }: { status: unknown }) {
  const value = text(status, 'draft').replaceAll('_', ' ');
  return <Badge tone={driverStatusTone(status)}>{value}</Badge>;
}

const categoryLabels: Record<string, string> = {
  growth: 'Growth',
  efficiency: 'Efficiency',
  cost_change: 'Cost change',
  supply_change: 'Supply change',
  management_adjustment: 'Management adjustment'
};

export function categoryLabel(category: unknown): string {
  return categoryLabels[String(category ?? '')] ?? text(category);
}

export function CategoryBadge({ category }: { category: unknown }) {
  return <Badge tone={String(category) === 'efficiency' ? 'green' : 'warm'}>{categoryLabel(category)}</Badge>;
}

const impactTypeLabels: Record<string, string> = {
  fte_delta: 'FTE impact',
  cost_delta: 'Cost impact',
  workload_hours_delta: 'Workload hours impact'
};

export function impactTypeLabel(impactType: unknown): string {
  return impactTypeLabels[String(impactType ?? '')] ?? text(impactType);
}

const phasingLabels: Record<string, string> = {
  straight_line: 'Straight line',
  ramp_up: 'Ramp up',
  ramp_down: 'Ramp down',
  one_off: 'One-off'
};

export function phasingLabel(model: unknown): string {
  return phasingLabels[String(model ?? '')] ?? text(model);
}

export function impactDisplay(impactType: unknown, value: unknown): string {
  return String(impactType) === 'cost_delta' ? money(value) : signedNum(value);
}

export function StatCard({ label, value, note, tone }: { label: string; value: string | number; note?: string; tone?: 'green' | 'warm' }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <p className="small-note">{note}</p> : null}
      {tone ? <Badge tone={tone}>{tone === 'green' ? 'Official' : 'Scenario'}</Badge> : null}
    </article>
  );
}

export function firstPlanName(plans: JsonRecord[], planId: unknown): string {
  const plan = plans.find((candidate) => String(candidate.id) === String(planId));
  return plan ? text(plan.plan_name) : 'Unknown plan';
}

export function firstFiscalYearLabel(fiscalYears: JsonRecord[], fiscalYearId: unknown): string {
  const fiscalYear = fiscalYears.find((candidate) => String(candidate.id) === String(fiscalYearId));
  return fiscalYear ? text(fiscalYear.fiscal_year_label) : 'Unknown fiscal year';
}
