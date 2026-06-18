import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supersedeActualsBatchAction, transitionActualsBatchStatusAction, updateActualsBatchAction } from '../actions';
import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import {
  canPostActuals,
  canSupersedeActuals,
  canValidateActuals,
  canVoidActuals,
  canWriteActuals,
  getActualsBatchDetail
} from '../../../lib/repositories/actuals';
import {
  ActualsBoundaryNote,
  StatCard,
  StatusBadge,
  displayDate,
  money,
  num,
  periodLabel,
  statusLabel,
  text,
  type JsonRecord
} from '../_components/actuals-shared';


export const dynamic = 'force-dynamic';
export default async function ActualsBatchDetailPage({ params }: { params: Promise<{ actualsBatchId: string }> }) {
  const { actualsBatchId } = await params;
  const context = await requireUserContext();
  const data = await getActualsBatchDetail(context, actualsBatchId);
  if (!data.batch) notFound();

  const batch = data.batch;
  const status = String(batch.status);
  const isDraft = status === 'draft';
  const isValidated = status === 'validated';
  const isPosted = status === 'posted';
  const userCanWrite = canWriteActuals(context);
  const userCanValidate = canValidateActuals(context);
  const userCanPost = canPostActuals(context);
  const userCanSupersede = canSupersedeActuals(context);
  const userCanVoid = canVoidActuals(context);

  const lineByPeriod = new Map(data.lines.map((line) => [String(line.planning_period_id), line]));
  const totalCost = data.lines.reduce((total, line) => total + Number(line.actual_cost ?? 0), 0);

  function EditableGrid({ action, submitLabel, withName }: { action: (formData: FormData) => Promise<void>; submitLabel: string; withName?: boolean }) {
    return (
      <form className="form-grid" action={action}>
        <input type="hidden" name="actuals_batch_id" value={String(batch.id)} />
        {withName ? <label className="field wide"><span>Correction batch name</span><input name="batch_name" placeholder={`${text(batch.batch_name)} (correction)`} /></label> : null}
        <div className="table-wrap wide">
          <table>
            <thead><tr><th>Period</th><th>Actual cost</th><th>Actual FTE</th><th>Actual workload hours</th></tr></thead>
            <tbody>
              {data.periods.map((period) => {
                const existing = lineByPeriod.get(period.id) as JsonRecord | undefined;
                return (
                  <tr key={period.id}>
                    <td>{period.periodLabel}</td>
                    <td><input name={`cost_${period.id}`} inputMode="decimal" defaultValue={existing ? String(existing.actual_cost) : ''} placeholder="leave blank to exclude" /></td>
                    <td><input name={`fte_${period.id}`} inputMode="decimal" defaultValue={existing ? String(existing.actual_fte) : ''} /></td>
                    <td><input name={`hours_${period.id}`} inputMode="decimal" defaultValue={existing ? String(existing.actual_workload_hours) : ''} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <label className="field wide"><span>Reason (audit trail)</span><input name="reason" required placeholder="What changed and why?" /></label>
        <button className="button" type="submit">{submitLabel}</button>
      </form>
    );
  }

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Actuals" title={`${text(batch.batch_code)} · ${text(batch.batch_name)}`} badge="Track">
          {isPosted
            ? 'These actuals are posted and immutable. Corrections create a new superseding version; the old version remains readable.'
            : status === 'superseded'
              ? 'This version has been corrected by a newer posted batch. It remains readable as history.'
              : status === 'voided'
                ? 'This batch was voided and is excluded from current reporting, preserved for audit.'
                : isValidated
                  ? 'This batch passed validation and can be posted, reverted to draft, or voided.'
                  : 'This is an editable draft batch.'}
        </PageHeader>

        <section className="grid-4">
          <StatCard label="Status" value={statusLabel(batch.status)} tone={isPosted ? 'green' : isDraft || isValidated ? 'warm' : undefined} />
          <StatCard label="Version" value={`v${String(batch.version_number ?? 1)}`} note={`Source: ${text(batch.source_type)}`} />
          <StatCard label="Periods covered" value={data.lines.length} note={`of ${data.periods.length} in the fiscal year`} />
          <StatCard label="Total actual cost" value={money(totalCost)} note={data.baseline ? `Baseline: ${text(data.baseline.baseline_name)}` : undefined} />
        </section>

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Actual results by month</p><h2>Actuals rows</h2></div>
            <div><StatusBadge status={batch.status} /></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Period</th><th>Actual cost</th><th>Actual FTE</th><th>Actual workload hours</th><th>Source row</th><th>Immutable</th></tr></thead>
              <tbody>
                {data.lines.map((line) => (
                  <tr key={String(line.id)}>
                    <td>{periodLabel(line.period_start)}</td>
                    <td>{money(line.actual_cost)}</td>
                    <td>{num(line.actual_fte)}</td>
                    <td>{num(line.actual_workload_hours)}</td>
                    <td>{text(line.source_row_reference, '—')}</td>
                    <td>{line.is_immutable === true ? 'yes' : 'no'}</td>
                  </tr>
                ))}
                {data.lines.length === 0 ? <tr><td colSpan={6}>No rows in this batch.</td></tr> : null}
              </tbody>
            </table>
          </div>
          <p className="small-note">Checksum <code>{text(batch.checksum, '—').slice(0, 16)}…</code> — changes whenever any actual value changes.</p>
          <ActualsBoundaryNote />
        </section>

        {isDraft && userCanWrite ? (
          <section className="card governance-action">
            <p className="eyebrow">Editable draft</p>
            <h2>Edit actuals rows</h2>
            <p>Draft actuals are editable. Rows left fully blank are excluded; every included row must map to a planning period.</p>
            <EditableGrid action={updateActualsBatchAction} submitLabel="Save draft actuals" />
          </section>
        ) : null}

        {(isDraft || isValidated) ? (
          <section className="grid-2">
            {isDraft && userCanValidate ? (
              <article className="card governance-action">
                <p className="eyebrow">Governance</p>
                <h2>Validate batch</h2>
                <p>Validation re-checks period mapping and duplicates, and moves the batch to a controlled state ready for posting.</p>
                <form className="form-grid single" action={transitionActualsBatchStatusAction}>
                  <input type="hidden" name="actuals_batch_id" value={String(batch.id)} />
                  <input type="hidden" name="next_status" value="validated" />
                  <label className="field"><span>Reason</span><input name="reason" placeholder="Checked against the GL because…" /></label>
                  <button className="button" type="submit">Validate actuals</button>
                </form>
              </article>
            ) : null}
            {isValidated ? (
              <article className="card governance-action">
                <p className="eyebrow">Governance</p>
                <h2>Post or revert</h2>
                <p>Posting makes this batch the latest immutable actuals version for its baseline. Reverting returns it to an editable draft.</p>
                {userCanPost ? (
                  <form className="form-grid single" action={transitionActualsBatchStatusAction}>
                    <input type="hidden" name="actuals_batch_id" value={String(batch.id)} />
                    <input type="hidden" name="next_status" value="posted" />
                    <label className="field"><span>Post reason</span><input name="reason" placeholder="Approved for posting because…" /></label>
                    <button className="button" type="submit">Post actuals</button>
                  </form>
                ) : <p className="small-note">Your role cannot post actuals.</p>}
                {userCanValidate ? (
                  <form className="form-grid single" action={transitionActualsBatchStatusAction}>
                    <input type="hidden" name="actuals_batch_id" value={String(batch.id)} />
                    <input type="hidden" name="next_status" value="draft" />
                    <label className="field"><span>Revert reason</span><input name="reason" placeholder="What needs rework?" /></label>
                    <button className="button button-secondary" type="submit">Revert to draft</button>
                  </form>
                ) : null}
              </article>
            ) : null}
            {userCanVoid ? (
              <article className="card governance-action">
                <p className="eyebrow">Admin control</p>
                <h2>Void batch</h2>
                <p>Voiding excludes this batch from current reporting. The record is preserved for audit.</p>
                <form className="form-grid single" action={transitionActualsBatchStatusAction}>
                  <input type="hidden" name="actuals_batch_id" value={String(batch.id)} />
                  <input type="hidden" name="next_status" value="voided" />
                  <label className="field"><span>Void reason</span><input name="reason" required placeholder="Why is this batch being withdrawn?" /></label>
                  <button className="button button-secondary" type="submit">Void batch</button>
                </form>
              </article>
            ) : null}
          </section>
        ) : null}

        {isPosted && userCanSupersede ? (
          <section className="card governance-action">
            <p className="eyebrow">Correction</p>
            <h2>Create correction version</h2>
            <p>
              Posted actuals are immutable. This form creates a new posted version (v{Number(batch.version_number ?? 1) + 1})
              that supersedes this one atomically. Values are prefilled with the current version for editing.
              Existing variance reports stay pinned to the version they used.
            </p>
            <EditableGrid action={supersedeActualsBatchAction} submitLabel={`Post correction (v${Number(batch.version_number ?? 1) + 1})`} withName />
          </section>
        ) : null}

        {isPosted && userCanVoid ? (
          <section className="card governance-action">
            <p className="eyebrow">Admin control</p>
            <h2>Void posted batch</h2>
            <p>Admin-controlled withdrawal of a posted batch. Its values remain immutable and readable; it stops being used for new variance reports.</p>
            <form className="form-grid single" action={transitionActualsBatchStatusAction}>
              <input type="hidden" name="actuals_batch_id" value={String(batch.id)} />
              <input type="hidden" name="next_status" value="voided" />
              <label className="field"><span>Void reason</span><input name="reason" required placeholder="Why is this posted batch being voided?" /></label>
              <button className="button button-secondary" type="submit">Void posted batch</button>
            </form>
          </section>
        ) : null}

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Version lineage</p><h2>Correction history</h2></div>
          </div>
          <div className="grid-2">
            <p><strong>Validated:</strong> {batch.validated_at ? displayDate(batch.validated_at) : 'Not yet'}</p>
            <p><strong>Posted:</strong> {batch.posted_at ? displayDate(batch.posted_at) : 'Not yet'}</p>
            {data.supersedes ? <p><strong>Corrects:</strong> <Link href={`/actuals/${String(data.supersedes.id)}`}>{text(data.supersedes.batch_code)} (v{String(data.supersedes.version_number)})</Link></p> : null}
            {data.supersededBy ? <p><strong>Corrected by:</strong> <Link href={`/actuals/${String(data.supersededBy.id)}`}>{text(data.supersededBy.batch_code)} (v{String(data.supersededBy.version_number)})</Link></p> : null}
          </div>
        </section>

        <section className="card">
          <div className="split-row">
            <div><p className="eyebrow">Audit trail</p><h2>Actuals governance events</h2></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Event</th><th>Reason</th><th>When</th></tr></thead>
              <tbody>
                {data.auditEvents.map((event) => (
                  <tr key={String(event.id)}>
                    <td><strong>{text(event.event_type)}</strong></td>
                    <td>{text(event.reason, '—')}</td>
                    <td>{displayDate(event.created_at)}</td>
                  </tr>
                ))}
                {data.auditEvents.length === 0 ? <tr><td colSpan={3}>No audit events recorded yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <p><Link className="button button-secondary button-link" href="/actuals">Back to actuals register</Link></p>
      </div>
    </AppShell>
  );
}
