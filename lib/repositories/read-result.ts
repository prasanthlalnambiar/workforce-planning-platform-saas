import 'server-only';

/**
 * A Supabase read result whose error must never be silently swallowed.
 *
 * UAT hardening (DEF-UAT-003): when a governed module's tables or RPCs are
 * missing — for example a Supabase project that has not had the Phase 7
 * migrations applied — read queries return an error rather than rows. Coalescing
 * that error to an empty array (`data ?? []`) produces a FALSE EMPTY STATE: the
 * register looks empty and trustworthy when it is actually broken. Routing every
 * read through `rows()` / `maybe()` converts such failures into a controlled
 * module error that the route's error boundary renders honestly.
 */
export interface ReadResult<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

export class ModuleDataError extends Error {
  readonly cause?: string;
  constructor(message: string, cause?: string) {
    super(message);
    this.name = 'ModuleDataError';
    this.cause = cause;
  }
}

function describe(label: string, error: { message: string; code?: string }): never {
  // 42P01 = undefined_table, 42883 = undefined_function: the usual signature of
  // an unmigrated database. Any read error is surfaced, not just these.
  const hint = error.code === '42P01' || error.code === '42883'
    ? ' The module database objects may not be present yet (migrations not applied).'
    : '';
  throw new ModuleDataError(`Could not load ${label}.${hint}`, error.message);
}

/** Return array rows, or throw a controlled module error if the read failed. */
export function rows<T>(label: string, result: ReadResult<T[]>): T[] {
  if (result.error) describe(label, result.error);
  return result.data ?? [];
}

/** Return a single row or null, or throw a controlled module error if the read failed. */
export function maybe<T>(label: string, result: ReadResult<T>): T | null {
  if (result.error) describe(label, result.error);
  return result.data ?? null;
}
