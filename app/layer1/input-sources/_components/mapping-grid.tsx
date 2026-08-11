'use client';

import { acceptMappingAction, saveDraftMappingAction } from '../actions';

// Canonical-field mapping options. The first five ARE the required canonical
// fields; the rest classify optional columns.
const ROLE_OPTIONS = [
  { value: 'week_commencing', label: 'Week commencing (required)' },
  { value: 'workflow_name', label: 'Workflow name / work type (required)' },
  { value: 'weekly_volume', label: 'Weekly volume (required)' },
  { value: 'weekly_aht', label: 'Weekly AHT (required)' },
  { value: 'aht_unit', label: 'AHT unit' },
  { value: 'calc_dimension', label: 'Calculation-driving dimension' },
  { value: 'reporting', label: 'Reporting-only field' },
  { value: 'custom', label: 'Custom field' },
  { value: 'ignore', label: 'Ignore' }
];

export function MappingGrid({
  versionId,
  sourceId,
  headers,
  candidateRoles,
  candidateDefaultAhtUnit,
  candidateHash,
  stateLabel,
  stateNote,
  hasOfficial,
  dateFormat,
  canWrite,
  versionAccepted
}: {
  versionId: string;
  sourceId: string;
  headers: string[];
  // The single candidate mapping (draft → accepted → suggestion) — same object
  // that drives the duplicate/validation preview and the accept payload.
  candidateRoles: Record<string, string>;
  candidateDefaultAhtUnit: string | null;
  candidateHash: string;
  stateLabel: string;
  stateNote: string;
  hasOfficial: boolean;
  dateFormat: string;
  canWrite: boolean;
  // When the source version itself is accepted, its mapping is frozen: the DB
  // rejects any new mapping version against it. The grid must therefore be
  // read-only — offering Save/Accept here only leads to a blocked write.
  versionAccepted: boolean;
}) {
  function roleFor(header: string): string {
    return candidateRoles[header] ?? 'reporting';
  }

  // Editing is only possible when the user can write AND the version is not
  // accepted/frozen. An accepted version is immutable, so no actions are shown.
  const editable = canWrite && !versionAccepted;

  return (
    <section className="card">
      <p className="eyebrow">Field mapping — {stateLabel}</p>

      {versionAccepted ? (
        <p className="small-note">
          This source version is accepted and immutable. Import a new source version to change the
          mapping. The accepted mapping is shown read-only.
        </p>
      ) : (
        <>
          <p className="small-note">{stateNote}{hasOfficial && stateLabel.startsWith('Editing') ? ' The accepted mapping remains the official interpretation until you accept a new one.' : ''}</p>
          <p className="small-note">
            Map the required fields (Week commencing, Workflow, Weekly volume, Weekly AHT) and AHT
            unit (or use the default unit below). Mark any column “Calculation-driving dimension” to
            make it part of the canonical grain used for duplicate detection. The preview below is
            computed from exactly this mapping.
          </p>
        </>
      )}

      <form action={editable ? acceptMappingAction : undefined} className="stack">
        <input type="hidden" name="version_id" value={versionId} />
        <input type="hidden" name="source_id" value={sourceId} />
        <input type="hidden" name="date_format" value={dateFormat} />
        {/* The hash of the candidate the user previewed. The accept action
            recomputes it from the submitted roles and rejects a mismatch, so the
            previewed mapping and the accepted mapping are guaranteed identical. */}
        <input type="hidden" name="candidate_hash" value={candidateHash} />
        <div className="split-row">
          <label className="field">
            <span>Default AHT unit (used if no AHT-unit column is mapped)</span>
            <select name="default_aht_unit" defaultValue={candidateDefaultAhtUnit ?? ''} disabled={!editable}>
              <option value="">none</option>
              <option value="seconds">seconds</option>
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
            </select>
          </label>
        </div>
        <table className="table">
          <thead><tr><th>Header</th><th>Maps to</th></tr></thead>
          <tbody>
            {headers.map((header) => (
              <tr key={header}>
                <td>{header}</td>
                <td>
                  <select name={`role_${header}`} defaultValue={roleFor(header)} disabled={!editable}>
                    {ROLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {editable && (
          <div className="split-row">
            <button className="button" type="submit">Accept mapping &amp; set canonical grain</button>
            <button className="button button-secondary" type="submit" formAction={saveDraftMappingAction}>
              Save draft mapping
            </button>
          </div>
        )}
        {editable && (
          <p className="small-note">
            Accepting validates the required canonical fields and creates an immutable mapping
            version. Saving a draft does not change the current accepted mapping. Duplicates are
            assessed at Week + Workflow + your chosen calculation-driving dimensions.
          </p>
        )}
      </form>
    </section>
  );
}
