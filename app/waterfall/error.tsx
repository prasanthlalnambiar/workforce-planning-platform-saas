'use client';

import Link from 'next/link';

export default function WaterfallModuleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="stack">
      <section className="card">
        <p className="eyebrow">Module unavailable</p>
        <h2>The waterfall module could not load</h2>
        <p>
          This is a controlled module error, not an empty bridge. The waterfall source data could not be read —
          most often because the database migrations have not been applied to this environment yet, or a
          read was rejected by row-level security. A failed read is never hidden behind an empty &ldquo;no locked
          variance&rdquo; state.
        </p>
        <p className="small-note">Details: {error.message}</p>
        <div className="split-row" style={{ marginTop: 18 }}>
          <button className="button" type="button" onClick={() => reset()}>Try again</button>
          <Link className="button button-secondary button-link" href="/workspace">Back to workspace</Link>
        </div>
      </section>
    </div>
  );
}
