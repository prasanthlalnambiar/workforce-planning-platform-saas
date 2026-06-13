'use client';

import Link from 'next/link';

export default function ActualsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  console.error(error);

  return (
    <main className="shell">
      <section className="card warning-card">
        <p className="eyebrow">Phase 7 actuals ingestion</p>
        <h1>Actuals data could not be loaded</h1>
        <p>
          The actuals module could not read its governed data tables. Ask an administrator to confirm the
          Phase 7 database migration has been applied, then retry.
        </p>
        {error.digest ? <p className="small-note">Error reference: {error.digest}</p> : null}
        <div className="button-row">
          <button className="button" type="button" onClick={() => reset()}>Retry</button>
          <Link className="button button-secondary button-link" href="/workspace">Back to workspace</Link>
        </div>
      </section>
    </main>
  );
}
