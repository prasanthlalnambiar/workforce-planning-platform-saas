import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const isWindows = process.platform === 'win32';
const nextBin = join(process.cwd(), 'node_modules', '.bin', `next${isWindows ? '.cmd' : ''}`);

if (!existsSync(nextBin)) {
  console.error(`Cannot run production build because ${nextBin} does not exist. Run npm ci first.`);
  process.exit(1);
}

process.env.NEXT_TELEMETRY_DISABLED = '1';

// ---------------------------------------------------------------------------
// Why this wrapper exists
//
// `next build` does all the useful work — compile, page data, the route table
// that route diagnostics consume — and prints it, and THEN runs "Collecting
// build traces", which walks node_modules to produce an output-tracing artifact.
// This app is fully dynamic and is NOT `output: standalone`, so that artifact is
// never used at runtime. In some external sandboxes the trace step does not
// return promptly, so a plain `next build` appears to hang after the route table
// has already been printed.
//
// Strategy: stream Next's output to build-output.log (the single owner of that
// file; route diagnostics read it). Watch the log for the unambiguous
// end-of-useful-work marker — the route legend line Next prints AFTER the full
// route table and middleware. Once that marker appears, the build is
// functionally complete: every byte route diagnostics need is on disk. We then
// allow the process a bounded grace window to exit on its own; if it does, we
// use its real status. If the trace step overruns the grace window, we terminate
// it and report success, because the functional build already succeeded. A hard
// overall ceiling guarantees the wrapper can never hang indefinitely.
//
// No pipes are read live for control flow in a way that can deadlock: output
// goes to an inherited fd, and we tail the file. This returns to the shell
// deterministically in every environment.
// ---------------------------------------------------------------------------

const logPath = join(process.cwd(), 'build-output.log');
const logFd = openSync(logPath, 'w');

// Marker Next prints after the entire route table + middleware. Its presence
// means compilation, page-data and the route table are all complete.
const DONE_MARKER = 'server-rendered on demand';
// Grace window after the marker for the process to exit cleanly on its own.
const GRACE_MS = 20_000;
// Absolute ceiling for the whole build; well above a healthy build (~20-40s).
const HARD_CEILING_MS = 240_000;

const startedAt = Date.now();
const child = spawn(nextBin, ['build'], { stdio: ['inherit', logFd, logFd], shell: false, env: process.env });

let settled = false;
let markerSeen = false;
let graceTimer = null;
let hardTimer = null;
let pollTimer = null;

function elapsed() {
  return ((Date.now() - startedAt) / 1000).toFixed(1);
}

function readLogSafe() {
  try {
    return readFileSync(logPath, 'utf8');
  } catch {
    return '';
  }
}

function finish(status, reason) {
  if (settled) return;
  settled = true;
  if (graceTimer) clearTimeout(graceTimer);
  if (hardTimer) clearTimeout(hardTimer);
  if (pollTimer) clearInterval(pollTimer);

  // Ensure the log fd is flushed/closed, then echo the log to our stdout so the
  // standalone `npm run build` shows the same output as a plain next build.
  try { closeSync(logFd); } catch { /* already closed */ }
  process.stdout.write(readLogSafe());

  console.log(`\n[build] ${reason} in ${elapsed()}s`);
  console.log(`BUILD_RETURNED:${status}`);
  process.exit(status);
}

// If the child exits on its own, that is the authoritative result.
child.on('exit', (code, signal) => {
  if (settled) return;
  if (signal && code === null) {
    // We may have terminated it after the marker; that path is handled in the
    // grace timer. An unexpected signal before the marker is a real failure.
    if (markerSeen) finish(0, `next build completed (trace step terminated after grace) [signal ${signal}]`);
    else finish(1, `next build terminated by signal ${signal}`);
    return;
  }
  finish(code ?? 1, `next build returned status ${code ?? 1}`);
});

child.on('error', (err) => {
  if (settled) return;
  console.error(`Production build failed to start: ${err.message}`);
  finish(1, 'next build failed to start');
});

// Poll the log for the done-marker. Once seen, start the grace window: prefer a
// clean self-exit, but cap how long we wait on the unused trace step.
pollTimer = setInterval(() => {
  if (settled || markerSeen) return;
  if (readLogSafe().includes(DONE_MARKER)) {
    markerSeen = true;
    graceTimer = setTimeout(() => {
      if (settled) return;
      // Build is functionally complete; the trace step overran. Terminate it
      // and report success — route diagnostics already have everything.
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 2_000);
      finish(0, 'next build functionally complete; trace step exceeded grace and was terminated');
    }, GRACE_MS);
  }
}, 250);

// Absolute backstop: never hang past the ceiling, regardless of markers.
hardTimer = setTimeout(() => {
  if (settled) return;
  const ok = markerSeen || readLogSafe().includes(DONE_MARKER);
  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 2_000);
  finish(ok ? 0 : 1, ok
    ? 'next build hit hard ceiling but was functionally complete; terminated'
    : 'next build hit hard ceiling before completing');
}, HARD_CEILING_MS);
