# Commercial Hardening Specification — Workforce Planning Platform SaaS

## Operating rules

- Execute one work package at a time, in order.
- Do not start the next work package until the current work package acceptance criteria pass and are reported.
- Do not add product features during hardening work.
- Do not build drivers, reforecasting, actuals, variance, waterfall or AI during hardening.
- Do not start Phase 5 until Phase 4.1 / WP0 passes external ZIP testing.
- Do not modify the Layer 1 calculation engine, governance logic or business logic unless a work package explicitly says so.
- Do not create a `pages/` directory or any file inside it.
- Do not remove `export const dynamic = 'force-dynamic'` from `app/layout.tsx` once added.
- Every work package ends with the full gate from a clean state:

```bash
rm -rf .next node_modules
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm audit --audit-level=low
npm run verify
```

The build must fully exit. The route table must contain zero static rows.

---

## WP0 — Build fix and regression guard

Target branch:

`phase4-1-commercial-qa-hardening-gate`

1. Confirm `pages/` does not exist. If it exists, delete it.
2. In `app/layout.tsx`, immediately after imports, add:

```ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
```

3. Make build hermetic by disabling Next telemetry during production build. Prefer a cross-platform Node wrapper script.
4. Add a CI guard so static route regressions fail.
5. Confirm `/`, `/_not-found` and `/login` all show as dynamic.
6. Run full gate from clean state, with and without dummy Supabase env values.

Acceptance:

- Route table shows zero static rows.
- Build fully exits from clean directory with no Supabase env vars.
- Build fully exits with dummy Supabase env vars.
- CI quality gate passes and would fail if a static route is reintroduced.

---

## WP1 — Centralised, validated environment config

Goal: one module owns environment reads; misconfiguration fails loudly at runtime/startup paths, never silently.

- Create `lib/env.ts`.
- Validate Supabase URL and anon key when needed.
- Validate service role key lazily inside admin-client creation.
- Avoid top-level validation that breaks build hermeticity.
- Replace scattered `process.env.NEXT_PUBLIC_SUPABASE_*` reads with env helper calls.
- Add tests for valid, missing and malformed config.

Acceptance:

- Env reads are centralised.
- Build still fully exits with no env set.
- Full gate passes.

---

## WP2 — Runtime smoke test in CI

Goal: prove the built app boots and serves, not just compiles.

- Add `/api/health` returning `{ status: 'ok' }`.
- Add `scripts/smoke.mjs` to run `next start`, test health, login and unauthenticated protected redirect.
- Add smoke script to verify and CI.

Acceptance:

- Smoke test passes and kills server cleanly.
- Full gate passes.

---

## WP3 — Tenant isolation proof / RLS test suite

Goal: prove one organisation cannot read or write another organisation's data.

- Add Supabase CLI/Postgres CI job.
- Apply migrations to clean local Supabase.
- Add RLS isolation test suite gated by `RLS_TESTS=1`.
- Test org A cannot access org B across tenant-scoped tables.
- Test org A can access its own rows.
- Test audit events are append-only.

Acceptance:

- RLS job green in CI against fresh local Supabase.
- Weakening a policy locally fails the suite, then revert.
- Plain `npm test` still passes without RLS env.

---

## WP4 — Optimistic concurrency on mutable planning data

Goal: prevent silent last-write-wins on planning/budget data.

- Add version column to mutable planning entities only.
- Repository updates require expected version.
- Stale update returns conflict result.
- UI surfaces non-destructive conflict message.

Acceptance:

- Current version succeeds and increments.
- Stale version conflicts.
- Full gate passes.

---

## WP5 — Security headers and auth rate limiting

- Add security headers in `next.config.mjs`.
- Add CSP in report-only mode.
- Add simple in-memory rate limiting for auth/login POSTs.
- Extend smoke test to verify headers and 429 behaviour.

Acceptance:

- Headers present.
- 11th rapid POST returns 429.
- Full gate passes.

---

## WP6 — Structured logging

- Add minimal JSON logger.
- Add request ID in middleware.
- Replace bare server-side `console.error` calls where practical.
- Sentry is optional later only, not part of this work package unless explicitly requested.

Acceptance:

- Logs are valid JSON one per line.
- Build remains hermetic.
- Full gate passes.

---

## WP7 — Audit trail hardening

- Deny non-service UPDATE/DELETE on audit events.
- Ensure audit events include actor, org, action, entity, before/after, request ID and timestamp where available.
- Add CSV export for current organisation audit events, permission-gated.
- Extend RLS tests.

Acceptance:

- Audit append-only is machine-proven.
- CSV serialization covered.
- Full gate passes.

---

## Out of scope

Do not implement or scaffold:

- SSO/SAML
- SCIM
- Stripe/billing
- plan limits
- i18n
- retention tooling
- backup automation
- multi-currency
- Phase 5 functional module

---

## Final deliverable per work package

Create a ZIP named:

`workforce-planning-platform-saas-<branch>-wp<N>.zip`

Exclude:

- `node_modules/`
- `.next/`
- `.git/`
- `.env`
- `.env.*`
- coverage/test artefacts
- Supabase temp folders
- TypeScript build info

Report branch, SHA, CI status, files changed, command summary and scope compliance.
