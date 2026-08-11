import Link from 'next/link';
import { AppShell } from '../../../../components/app-shell/app-shell';
import { PageHeader } from '../../../../components/ui/page-header';
import { requireUserContext } from '../../../../lib/auth/session';
import { getInputSourceDetail, canWriteInput, previewMapping } from '../../../../lib/repositories/input-sources';
import { resolveCandidateMapping, hashMapping, type StoredMapping } from '../../../../lib/intake/intake-engine';
import { MappingGrid } from '../_components/mapping-grid';

export const dynamic = 'force-dynamic';

function text(value: unknown): string {
  return value === null || value === undefined ? '—' : String(value);
}

export default async function InputSourceDetailPage({ params }: { params: Promise<{ sourceId: string }> }) {
  const { sourceId } = await params;
  const context = await requireUserContext();
  const data = await getInputSourceDetail(context, sourceId);
  const userCanWrite = canWriteInput(context);

  // ONE candidate mapping drives the editable grid, every preview, and the accept
  // payload. Resolution order: latest draft → accepted → auto-detection. This is
  // the single source of truth — the form and the preview can never diverge.
  const officialMapping = data.currentMapping; // accepted = official/current
  const versionAccepted = String(data.currentVersion?.version_status) === 'accepted';
  // When the source version is accepted (frozen), the official accepted mapping is
  // what we show — read-only. A newer draft (e.g. one left over from experimenting)
  // must NOT become the visible candidate on an immutable version. So we suppress
  // the draft input to the resolver in that case.
  const candidate = resolveCandidateMapping({
    draft: versionAccepted ? null : (data.latestDraftMapping as StoredMapping | null),
    accepted: data.currentMapping as StoredMapping | null,
    headers: data.detectedHeaders,
    defaultAhtUnit: (data.currentVersion?.declared_aht_unit as 'seconds' | 'minutes' | 'hours' | null) ?? null,
    dateFormat: (data.currentVersion?.date_format as 'iso' | 'dd_mm_yyyy' | 'mm_dd_yyyy') ?? 'iso'
  });
  const candidateHash = hashMapping(candidate.mapping);

  // Preview is computed from the SAME candidate mapping the grid shows/submits.
  let preview: Awaited<ReturnType<typeof previewMapping>> | null = null;
  if (data.currentVersion) {
    preview = await previewMapping(context, String(data.currentVersion.id), candidate.mapping);
  }

  const stateLabel =
    candidate.source === 'draft'
      ? 'Editing saved draft mapping'
      : candidate.source === 'accepted'
        ? 'Viewing latest accepted mapping'
        : 'Starting from auto-detected suggestion';
  const stateNote =
    candidate.source === 'draft'
      ? 'You are editing a saved draft. It has not replaced the accepted mapping yet.'
      : candidate.source === 'accepted'
        ? 'This is the latest accepted mapping.'
        : 'This is an auto-detected suggestion. Review and save before accepting.';

  if (!data.source) {
    return (
      <AppShell context={context}>
        <div className="stack">
          <section className="card">
            <p className="eyebrow">Not found</p>
            <h2>Input source not found</h2>
            <p className="small-note">This source does not exist for your organisation, or you cannot access it.</p>
            <Link className="button button-secondary button-link" href="/layer1/input-sources">Back to Operational Demand Data</Link>
          </section>
        </div>
      </AppShell>
    );
  }

  const grain = data.currentMapping?.calc_driving_dimensions as unknown[] | undefined;

  return (
    <AppShell context={context}>
      <div className="stack">
        <PageHeader eyebrow="Inputs · Operational Demand Data" title={text(data.source.source_name)} badge="Draft only">
          Immutable source history and the retained raw rows for the current version.
        </PageHeader>

        <section className="card">
          <p className="eyebrow">Version history</p>
          <table className="table">
            <thead><tr><th>Version</th><th>Method</th><th>Rows</th><th>Status</th><th>Coverage</th></tr></thead>
            <tbody>
              {data.versions.map((v) => (
                <tr key={String(v.id)}>
                  <td>v{text(v.version_number)}</td>
                  <td>{text(v.import_method)}</td>
                  <td>{text(v.row_count)}</td>
                  <td>{text(v.version_status)}</td>
                  <td>{text(v.coverage_week_start)} → {text(v.coverage_week_end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small-note">Each import is a new immutable version. Earlier versions are never overwritten.</p>
        </section>

        <section className="card">
          <p className="eyebrow">Canonical grain</p>
          <p>
            {grain && grain.length > 0
              ? `Week + Workflow + ${grain.join(', ')}`
              : 'Week + Workflow (no approved calculation-driving dimension yet)'}
          </p>
          <p className="small-note">
            Duplicates are assessed only at this grain. Rows that share Week + Workflow but differ on an
            approved dimension are legitimate breakdowns, not duplicates.
          </p>
        </section>

        {data.currentVersion && data.detectedHeaders.length > 0 && (
          <MappingGrid
            versionId={String(data.currentVersion.id)}
            sourceId={sourceId}
            headers={data.detectedHeaders}
            candidateRoles={candidate.mapping.roleByHeader}
            candidateDefaultAhtUnit={candidate.mapping.defaultAhtUnit ?? null}
            candidateHash={candidateHash}
            stateLabel={stateLabel}
            stateNote={stateNote}
            hasOfficial={Boolean(officialMapping)}
            dateFormat={String(data.currentVersion.date_format ?? 'iso')}
            canWrite={userCanWrite}
            versionAccepted={versionAccepted}
          />
        )}

        {preview && (
          <section className="card">
            <p className="eyebrow">Consequence preview (at the selected canonical grain)</p>
            <p>
              Canonical grain: <strong>{preview.canonicalGrain.join(' + ')}</strong>.{' '}
              {preview.validRows} valid / {preview.invalidRows} invalid rows.
            </p>
            {preview.duplicateGroups.length === 0 ? (
              <p className="small-note">
                No duplicates at this grain. Rows that share Week + Workflow but differ on a
                selected calculation-driving dimension are valid breakdowns.
              </p>
            ) : (
              <>
                <p className="small-note">
                  {preview.duplicateGroups.length} duplicate group(s) detected at this grain.
                  Rows sharing Week + Workflow collapse to a true duplicate because the
                  distinguishing column is not a calculation-driving dimension.
                </p>
                <table className="table">
                  <thead><tr><th>Grain key</th><th>Duplicate rows</th></tr></thead>
                  <tbody>
                    {preview.duplicateGroups.map((g) => (
                      <tr key={g.key}><td>{g.key}</td><td>{g.rowIndexes.join(', ')}</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {!preview.mappingValid && (
              <p className="small-note">Mapping not yet acceptable: {preview.mappingErrors.join('; ')}</p>
            )}
          </section>
        )}

        <section className="card">
          <p className="eyebrow">Current version rows (retained verbatim)</p>
          {data.currentVersionRows.length === 0 ? (
            <p className="small-note">No rows for the current version.</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>#</th><th>Week</th><th>Workflow</th><th>Volume</th><th>AHT</th><th>Unit</th><th>State</th><th>Validation</th></tr>
              </thead>
              <tbody>
                {data.currentVersionRows.map((r) => (
                  <tr key={String(r.id)}>
                    <td>{text(r.row_index)}</td>
                    <td>{text(r.week_commencing)}</td>
                    <td>{text(r.workflow_name)}</td>
                    <td>{text(r.weekly_volume)}</td>
                    <td>{text(r.weekly_aht)}</td>
                    <td>{text(r.aht_unit)}</td>
                    <td>{text(r.volume_state)}</td>
                    <td>{text(r.validation_status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="small-note">
            A row reported with zero volume shows state <code>reported_zero</code>. A week absent from the
            extract is never shown here as a zero row — it is simply not present.
          </p>
        </section>

        <Link className="button button-secondary button-link" href="/layer1/input-sources">Back to Operational Demand Data</Link>
      </div>
    </AppShell>
  );
}
