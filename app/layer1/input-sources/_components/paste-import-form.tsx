'use client';

import { useState } from 'react';
import { importPastedSourceAction } from '../actions';

type PlanRecord = Record<string, unknown>;

export function PasteImportForm({ plans }: { plans: PlanRecord[] }) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <section className="card">
      <p className="eyebrow">Paste a weekly source</p>
      <form
        action={async (formData) => {
          setSubmitting(true);
          try {
            await importPastedSourceAction(formData);
          } finally {
            setSubmitting(false);
          }
        }}
        className="stack"
      >
        <div className="split-row">
          <label className="field">
            <span>Plan</span>
            <select name="plan_id" required defaultValue="">
              <option value="" disabled>Select a plan…</option>
              {plans.map((p) => (
                <option key={String(p.id)} value={String(p.id)}>{String(p.plan_name)}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Source name</span>
            <input name="source_name" required placeholder="e.g. Weekly contact extract" />
          </label>
          <label className="field">
            <span>Default AHT unit</span>
            <select name="default_aht_unit" defaultValue="minutes">
              <option value="seconds">seconds</option>
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
            </select>
          </label>
        </div>
        <div className="split-row">
          <label className="field">
            <span>Date format (no guessing)</span>
            <select name="date_format" defaultValue="iso">
              <option value="iso">ISO (YYYY-MM-DD)</option>
              <option value="dd_mm_yyyy">DD/MM/YYYY</option>
              <option value="mm_dd_yyyy">MM/DD/YYYY</option>
            </select>
          </label>
          <label className="field">
            <span>Week starts on</span>
            <select name="week_start_day" defaultValue="monday">
              <option value="monday">Monday</option>
              <option value="sunday">Sunday</option>
            </select>
          </label>
        </div>
        <label className="field">
          <span>Description (optional)</span>
          <input name="description" placeholder="Where this came from" />
        </label>
        <label className="field">
          <span>Paste rows from Excel or a tab-separated extract (CSV with quoted fields is also supported). First line = headers.</span>
          <textarea
            name="pasted_data"
            required
            rows={8}
            placeholder={'Week\tWorkflow\tChannel\tVolume\tAHT unit\tAHT\n2027-07-05\tSales Calls\tVoice\t1200\tminutes\t6'}
          />
        </label>
        <div>
          <button className="button" type="submit" disabled={submitting}>
            {submitting ? 'Importing…' : 'Import as draft source'}
          </button>
        </div>
        <p className="small-note">
          Every pasted row is retained verbatim and immutably. Invalid rows are flagged, not discarded.
        </p>
      </form>
    </section>
  );
}
