#!/usr/bin/env bash
set -euo pipefail

echo "[verify] running: typecheck"
node_modules/.bin/tsc --noEmit

echo "[verify] running: lint"
node_modules/.bin/eslint . --max-warnings=0

echo "[verify] running: build"
node scripts/build.mjs

echo "[verify] running: route diagnostics"
node scripts/inspect-routes.mjs --build-output build-output.log

echo "[verify] running: tests"
node --import tsx --test tests/*.test.ts

echo "[verify] all steps passed"
exit 0
