import Link from 'next/link';
import { AppShell } from '../../../components/app-shell/app-shell';
import { PageHeader } from '../../../components/ui/page-header';
import { requireUserContext } from '../../../lib/auth/session';
import { getInputSourceDashboard, canWriteInput } from '../../../lib/repositories/input-sources';
import { PasteImportForm } from './_components/paste-import-form';

export const dynamic = 'force-dynamic';

function text(value: unknown): string {
  return value === null || value === undefined ? '—' : String(value);
}

export default async function InputSourcesPage() {
  const context = await requireUserContext();
  const data = await getInputSourceDashboard(context);
  const userCanWrite = canWriteInput(context);

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Inputs" title="Operational Demand Data" badge="Draft only">
          Paste a weekly aggregated source file. Each row is one workflow for one week.
          Imported sources are retained immutably and stay in draft — they never change an
          official forecast, budget, or any locked record in this release.
        </PageHeader>

        <section className="card">
          <p className="eyebrow">How this works</p>
          <ul className="small-note" style={{ lineHeight: 1.8 }}>
            <li>Required columns: Week commencing, Workflow name, Weekly volume, Weekly AHT, AHT unit.</li>
            <li>The pasted Weekly AHT is kept as-is and validated — it is never recalculated.</li>
            <li>Optional columns (Channel, Product, Queue, …) are retained and never change a calculation here.</li>
            <li>Rows sharing Week + Workflow are kept as a breakdown; true duplicates are assessed only after mapping, at the canonical grain.</li>
            <li>Missing extract weeks are reported as gaps — never silently treated as zero.</li>
          </ul>
        </section>

        {userCanWrite ? (
          <PasteImportForm plans={data.plans} />
        ) : (
          <section className="card"><p className="small-note">You have read-only access to input sources.</p></section>
        )}

        <section className="card">
          <p className="eyebrow">Draft input sources</p>
          {data.sources.length === 0 ? (
            <p className="small-note">No input sources yet. Paste a weekly source above to create the first draft.</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Source</th><th>Status</th><th>Current version</th><th></th></tr>
              </thead>
              <tbody>
                {data.sources.map((s) => (
                  <tr key={String(s.id)}>
                    <td>{text(s.source_name)}<br /><span className="small-note">{text(s.description)}</span></td>
                    <td>{text(s.status)}</td>
                    <td>{s.current_version_id ? 'v' + text(s.current_version_id).slice(0, 8) : '—'}</td>
                    <td><Link className="button button-secondary button-link" href={`/layer1/input-sources/${String(s.id)}`}>Inspect</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {data.customDimensions.length > 0 && (
          <section className="card">
            <p className="eyebrow">Custom dimensions (reporting-only)</p>
            <table className="table">
              <thead><tr><th>Display name</th><th>Key</th><th>Status</th></tr></thead>
              <tbody>
                {data.customDimensions.map((d) => (
                  <tr key={String(d.id)}>
                    <td>{text(d.display_name)}</td>
                    <td>{text(d.dimension_key)}</td>
                    <td>{text(d.promotion_status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </AppShell>
  );
}
