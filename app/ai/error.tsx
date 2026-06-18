'use client';

import Link from 'next/link';

export default function AiModuleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="stack">
      <section className="card">
        <p className="eyebrow">Module unavailable</p>
        <h2>The Planning Advisor module could not load</h2>
        <p>
          This is a controlled module error, not an empty advisory. The underlying waterfall data could not be read —
          most often because the database migrations have not been applied to this environment yet, or a read
          was rejected by row-level security. A failed read is never hidden behind an empty advisory.
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
