# Build Verification

This project must pass a full clean verification loop before any new feature phase starts.

The production build previously failed or hung during Next.js App Router page-data collection because protected routes were not explicitly marked as dynamic. Protected pages call Supabase auth, tenant context and server-only repositories, so they must not be statically prerendered.

## Protected route rule

Protected App Router pages and auth route handlers must include:

```ts
export const dynamic = 'force-dynamic';
```

This keeps protected pages request-time only while preserving authentication, tenant scoping and Supabase Row Level Security assumptions.

Middleware must remain lightweight and must not import Supabase client packages.

## Clean verification loop

From a clean checkout or extracted ZIP:

```bash
rm -rf .next
rm -rf node_modules
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm audit --audit-level=low
```

Or after `npm ci`, run the combined command:

```bash
npm run verify
```

The build only passes if `npm run build` fully exits back to the terminal. It is not enough for the build to say `Compiled successfully`.

The build must not hang at:

```text
Collecting page data ...
Collecting build traces ...
```

A local macOS SWC code-signing warning may appear on some machines. That warning is not a failure if the build fully exits successfully.

## ZIP verification

External ZIPs should exclude generated files and secrets:

- `node_modules/`
- `.next/`
- `.git/`
- `.env`
- `.env.*`
- `coverage/`
- `test-results/`
- `playwright-report/`
- `supabase/.temp/`
- `supabase/.branches/`

After extracting the ZIP, run the clean verification loop above.

## Phase approval rule

This build verification file is paired with `QUALITY_GATE.md`.

For every future phase, run the full clean verification loop and the commercial quality gate before approving the phase or starting the next one. Do not treat a successful local development server as sufficient proof.

A future phase is blocked if any of these fail:

- clean install
- tests
- typecheck
- lint
- production build
- dependency audit
- migration verification
- tenant isolation checks
- role permission checks
- governance/immutability checks
- workflow/E2E checks
- external ZIP testing

