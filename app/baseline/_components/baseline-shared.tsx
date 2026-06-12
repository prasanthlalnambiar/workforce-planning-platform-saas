import Link from 'next/link';
import { Badge } from '../../../components/ui/badge';

export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

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

export function displayDate(value: unknown): string {
  if (!value) return 'Not set';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

export function statusTone(status: unknown): 'green' | 'warm' | undefined {
  const value = String(status ?? '');
  if (['locked', 'ready_for_layer2', 'imported_to_baseline', 'reconciled'].includes(value)) return 'green';
  if (['draft', 'reviewed', 'needs_review'].includes(value)) return 'warm';
  return undefined;
}

export function StatusBadge({ status }: { status: unknown }) {
  const value = text(status, 'draft').replaceAll('_', ' ');
  return <Badge tone={statusTone(status)}>{value}</Badge>;
}

export function SourceBadge({ source }: { source: unknown }) {
  const value = text(source, 'manual').replaceAll('_', ' ');
  return <Badge tone={String(source) === 'layer1_handoff' ? 'green' : 'warm'}>{value}</Badge>;
}

export function StatCard({ label, value, note, tone }: { label: string; value: string | number; note?: string; tone?: 'green' | 'warm' }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <p className="small-note">{note}</p> : null}
      {tone ? <Badge tone={tone}>{tone === 'green' ? 'Reconciled' : 'Review'}</Badge> : null}
    </article>
  );
}

export function BaselineSubnav() {
  return (
    <nav className="subnav" aria-label="Budget baseline navigation">
      <Link href="/baseline">Dashboard</Link>
      <a href="#create">Create baseline</a>
      <a href="#active">Active baseline</a>
      <a href="#history">History</a>
    </nav>
  );
}

export function summariseList(value: unknown, fallback = 'No risk summary captured.'): string {
  const items = asArray(value);
  if (items.length === 0) return fallback;
  return items
    .slice(0, 3)
    .map((item) => {
      const record = asRecord(item);
      return text(record.message ?? record.label ?? record.code ?? item, 'Risk item');
    })
    .join(' · ');
}

export function firstPlanName(plans: JsonRecord[], planId: unknown): string {
  return text(plans.find((plan) => String(plan.id) === String(planId))?.plan_name, 'Plan not found');
}

export function firstFiscalYearLabel(fiscalYears: JsonRecord[], fiscalYearId: unknown): string {
  return text(fiscalYears.find((fy) => String(fy.id) === String(fiscalYearId))?.fiscal_year_label, 'Fiscal year not found');
}
