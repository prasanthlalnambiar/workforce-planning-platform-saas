// WP-2 Flexible Input Foundation — deterministic intake engine (pure, no I/O).
//
// This module is the testable core of WP-2. It is DRAFT-ONLY: it parses,
// validates and classifies pasted/uploaded weekly source data. It performs NO
// forecast calculation, NO routing, NO mapping-to-knowledge-group, and never
// touches an official path. Per the build brief and Plan v4.1.2:
//   * raw rows are retained verbatim (this module never discards a row);
//   * duplicates are assessed ONLY at the approved canonical grain, after mapping;
//   * rows sharing Week + Workflow are NOT duplicates if a mapped dimension differs;
//   * missing extract weeks are distinguished from reported zero-volume weeks.

export type AhtUnit = 'seconds' | 'minutes' | 'hours';
export type ImportMethod = 'paste' | 'csv' | 'tsv' | 'manual';

// ---------------------------------------------------------------------------
// Delimited parsing — handles quoted fields, delimiters inside quotes, and
// escaped quotes (RFC-4180 style). Supports comma (CSV) and tab (TSV). Replaces
// naive line.split(delimiter).
// ---------------------------------------------------------------------------

export function parseDelimited(text: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

export function detectDelimiter(text: string): ',' | '\t' {
  const firstLine = text.replace(/\r\n/g, '\n').split('\n')[0] ?? '';
  return firstLine.includes('\t') ? '\t' : ',';
}

export interface ParsedTable {
  headers: string[];
  rows: RawRow[];
  method: 'csv' | 'tsv';
}

export function parseTable(text: string): ParsedTable {
  const delimiter = detectDelimiter(text);
  const matrix = parseDelimited(text, delimiter);
  const method: 'csv' | 'tsv' = delimiter === '\t' ? 'tsv' : 'csv';
  if (matrix.length === 0) return { headers: [], rows: [], method };
  const headers = matrix[0].map((h) => h.trim());
  const rows: RawRow[] = matrix.slice(1).map((cells, i) => {
    const values: Record<string, string> = {};
    headers.forEach((h, idx) => { values[h] = (cells[idx] ?? '').trim(); });
    return { rowIndex: i, values };
  });
  return { headers, rows, method };
}

export interface RawRow {
  rowIndex: number;
  values: Record<string, string>;
}

export interface ParsedRow {
  rowIndex: number;
  raw: Record<string, string>;
  weekCommencing: string | null; // ISO yyyy-mm-dd
  workflowName: string | null;
  weeklyVolume: number | null;
  weeklyAht: number | null;
  ahtUnit: AhtUnit | null;
  volumeState: 'reported' | 'reported_zero';
  validationStatus: 'valid' | 'invalid';
  validationMessages: string[];
}

// ---------------------------------------------------------------------------
// Header detection — suggest canonical roles for source headers (planner confirms).
// ---------------------------------------------------------------------------

export type CanonicalField =
  | 'week_commencing' | 'workflow_name' | 'weekly_volume' | 'weekly_aht' | 'aht_unit';

const HEADER_HINTS: { field: CanonicalField; patterns: RegExp[] }[] = [
  { field: 'week_commencing', patterns: [/week\s*comm/i, /^week$/i, /w\/?c/i, /week\s*start/i, /week\s*beginning/i] },
  { field: 'workflow_name', patterns: [/work\s*flow/i, /^workflow$/i, /queue\s*name/i, /work\s*type/i, /^task$/i] },
  { field: 'weekly_volume', patterns: [/volume/i, /^vol$/i, /contacts/i, /^count$/i, /offered/i] },
  { field: 'weekly_aht', patterns: [/^aht$/i, /handle\s*time/i, /handling\s*time/i, /avg.*handle/i, /average\s*handle/i] },
  // AHT unit must be an EXPLICIT time/AHT-unit header. A generic "unit" rule is
  // dangerous: "Business Unit", "Operating Unit", "Support Unit" are dimensions,
  // not the AHT unit. Only these explicit forms map to aht_unit.
  { field: 'aht_unit', patterns: [/aht\s*unit/i, /handling\s*time\s*unit/i, /handle\s*time\s*unit/i, /^time\s*unit$/i, /duration\s*unit/i] }
];

export interface HeaderSuggestion {
  header: string;
  suggested: CanonicalField | null;
}

/** Suggest a canonical field per header. Deterministic; first matching hint wins. */
export function detectHeaders(headers: string[]): HeaderSuggestion[] {
  const used = new Set<CanonicalField>();
  return headers.map((header) => {
    let suggested: CanonicalField | null = null;
    for (const hint of HEADER_HINTS) {
      if (used.has(hint.field)) continue;
      if (hint.patterns.some((p) => p.test(header.trim()))) {
        suggested = hint.field;
        used.add(hint.field);
        break;
      }
    }
    return { header, suggested };
  });
}

// ---------------------------------------------------------------------------
// AHT unit handling — validate/normalise the declared unit. We do NOT recompute
// the source's weekly AHT; we only record and validate it (build brief §product).
// ---------------------------------------------------------------------------

export function normaliseAhtUnit(value: string | null | undefined): AhtUnit | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (['s', 'sec', 'secs', 'second', 'seconds'].includes(v)) return 'seconds';
  if (['m', 'min', 'mins', 'minute', 'minutes'].includes(v)) return 'minutes';
  if (['h', 'hr', 'hrs', 'hour', 'hours'].includes(v)) return 'hours';
  return null;
}

// ---------------------------------------------------------------------------
// Row validation — required fields, numeric checks, week-date validity.
// Validation NEVER discards a row; an invalid row is retained and flagged.
// ---------------------------------------------------------------------------

export interface MappingSpec {
  // header -> canonical field, for the required fields
  fieldByHeader: Record<string, CanonicalField>;
  // import-level AHT unit fallback if no per-row unit column is mapped
  defaultAhtUnit?: AhtUnit | null;
  // EXPLICIT date format — never guessed. Defaults to ISO.
  dateFormat?: DateFormat;
}

// ---------------------------------------------------------------------------
// User-selected mapping (canonical-field mapping). The user maps each detected
// header to one of these roles. The required canonical fields plus the chosen
// calculation-driving dimensions are derived from this — auto-detection only
// SEEDS it; the persisted user mapping is the authority for parsing/validation.
// ---------------------------------------------------------------------------

export type MappingRole =
  | 'week_commencing'
  | 'workflow_name'
  | 'weekly_volume'
  | 'weekly_aht'
  | 'aht_unit'
  | 'calc_dimension'
  | 'reporting'
  | 'custom'
  | 'ignore';

export const CANONICAL_FIELD_ROLES: MappingRole[] = [
  'week_commencing', 'workflow_name', 'weekly_volume', 'weekly_aht', 'aht_unit'
];

export interface UserMapping {
  // header -> role chosen by the user
  roleByHeader: Record<string, MappingRole>;
  defaultAhtUnit?: AhtUnit | null;
  dateFormat?: DateFormat;
}

/**
 * Build the parsing MappingSpec + canonical grain from a USER-selected mapping.
 * This is what drives row interpretation; auto-detection is not the authority.
 */
export function buildMappingSpec(mapping: UserMapping): { spec: MappingSpec; calcDrivingDimensions: string[] } {
  const fieldByHeader: Record<string, CanonicalField> = {};
  const calcDrivingDimensions: string[] = [];
  for (const [header, role] of Object.entries(mapping.roleByHeader)) {
    if ((CANONICAL_FIELD_ROLES as string[]).includes(role)) {
      fieldByHeader[header] = role as CanonicalField;
    } else if (role === 'calc_dimension') {
      calcDrivingDimensions.push(header);
    }
    // reporting / custom / ignore contribute no canonical field and no grain.
  }
  return {
    spec: { fieldByHeader, defaultAhtUnit: mapping.defaultAhtUnit ?? null, dateFormat: mapping.dateFormat ?? 'iso' },
    calcDrivingDimensions
  };
}

export interface MappingValidation {
  ok: boolean;
  errors: string[];
  missingRequired: CanonicalField[];
}

/**
 * Validate that a user mapping can be ACCEPTED. Required canonical fields must be
 * mapped; AHT unit may instead come from a declared default. Rejects all-reporting,
 * all-ignore, or any mapping missing week/workflow/volume/AHT.
 */
export function validateMappingCompleteness(mapping: UserMapping): MappingValidation {
  const roles = Object.values(mapping.roleByHeader);
  const has = (r: MappingRole) => roles.includes(r);
  const errors: string[] = [];
  const missingRequired: CanonicalField[] = [];

  if (!has('week_commencing')) { errors.push('A header must be mapped to Week commencing'); missingRequired.push('week_commencing'); }
  if (!has('workflow_name')) { errors.push('A header must be mapped to Workflow name'); missingRequired.push('workflow_name'); }
  if (!has('weekly_volume')) { errors.push('A header must be mapped to Weekly volume'); missingRequired.push('weekly_volume'); }
  if (!has('weekly_aht')) { errors.push('A header must be mapped to Weekly AHT'); missingRequired.push('weekly_aht'); }
  // AHT unit may come from the declared default if no column is mapped.
  if (!has('aht_unit') && !mapping.defaultAhtUnit) {
    errors.push('Map a header to AHT unit, or select a default AHT unit');
    missingRequired.push('aht_unit');
  }

  // Guard against degenerate mappings even if the above somehow passed.
  const allReporting = roles.length > 0 && roles.every((r) => r === 'reporting');
  const allIgnored = roles.length > 0 && roles.every((r) => r === 'ignore');
  if (allReporting) errors.push('All fields are reporting-only; map the required canonical fields');
  if (allIgnored) errors.push('All fields are ignored; map the required canonical fields');

  return { ok: errors.length === 0, errors, missingRequired };
}

/**
 * Re-derive interpreted rows from immutable raw rows using a selected mapping.
 * Pure: never mutates inputs. This is how a new mapping yields a new
 * interpretation without rewriting stored rows.
 */
export function deriveRows(rawRows: RawRow[], mapping: UserMapping): ParsedRow[] {
  const { spec } = buildMappingSpec(mapping);
  return validateRows(rawRows, spec);
}

/** Canonical grain (week + workflow + chosen calc dimensions) for a user mapping. */
export function grainForMapping(mapping: UserMapping): CanonicalGrain {
  const { calcDrivingDimensions } = buildMappingSpec(mapping);
  return { calcDrivingDimensions };
}

// ---------------------------------------------------------------------------
// Candidate-mapping resolution — the SINGLE source of truth the detail page uses
// for the editable grid, every preview, and the accept payload. Resolution order
// is draft → accepted → auto-detection suggestion, so the form and the preview
// can never diverge.
// ---------------------------------------------------------------------------

export type MappingSource = 'draft' | 'accepted' | 'suggestion';

export interface StoredMapping {
  // role map persisted on a field_mapping_version (header -> role)
  mappings?: Record<string, string> | null;
  // { default_aht_unit, date_format }
  aggregation_decision?: { default_aht_unit?: AhtUnit | null; date_format?: DateFormat } | null;
  // monotonically increasing per source version; used to tell whether a draft is
  // newer than the accepted mapping (a stale older draft must not win).
  mapping_version_number?: number | null;
}

export interface CandidateMapping {
  source: MappingSource;
  mapping: UserMapping;
}

function fromStored(stored: StoredMapping): UserMapping {
  const agg = stored.aggregation_decision ?? {};
  return {
    roleByHeader: (stored.mappings ?? {}) as UserMapping['roleByHeader'],
    defaultAhtUnit: agg.default_aht_unit ?? null,
    dateFormat: agg.date_format ?? 'iso'
  };
}

/**
 * Resolve the one candidate mapping for the detail page.
 * Order: a draft ONLY wins if it is newer than the accepted mapping (created after
 * it — a strictly higher mapping_version_number). Otherwise the accepted mapping is
 * shown. Then falls back to an auto-detection suggestion. This stops a stale older
 * draft (left behind when a later version was accepted) from overriding the
 * accepted view.
 */
export function resolveCandidateMapping(opts: {
  draft?: StoredMapping | null;
  accepted?: StoredMapping | null;
  headers: string[];
  defaultAhtUnit?: AhtUnit | null;
  dateFormat?: DateFormat;
}): CandidateMapping {
  const draftValid = !!(opts.draft && opts.draft.mappings && Object.keys(opts.draft.mappings).length > 0);
  const acceptedValid = !!(opts.accepted && opts.accepted.mappings && Object.keys(opts.accepted.mappings).length > 0);

  if (draftValid && acceptedValid) {
    const draftV = opts.draft!.mapping_version_number ?? 0;
    const acceptedV = opts.accepted!.mapping_version_number ?? 0;
    // Draft wins only when it is strictly newer than the accepted mapping.
    if (draftV > acceptedV) {
      return { source: 'draft', mapping: fromStored(opts.draft!) };
    }
    return { source: 'accepted', mapping: fromStored(opts.accepted!) };
  }
  if (draftValid) {
    return { source: 'draft', mapping: fromStored(opts.draft!) };
  }
  if (acceptedValid) {
    return { source: 'accepted', mapping: fromStored(opts.accepted!) };
  }
  // Auto-detection suggestion (seed only).
  const roleByHeader: Record<string, MappingRole> = {};
  for (const s of detectHeaders(opts.headers)) {
    roleByHeader[s.header] = (s.suggested ?? 'reporting') as MappingRole;
  }
  return {
    source: 'suggestion',
    mapping: { roleByHeader, defaultAhtUnit: opts.defaultAhtUnit ?? null, dateFormat: opts.dateFormat ?? 'iso' }
  };
}

/**
 * Stable hash of a user mapping. The accept action and the preview both compute
 * this from the same candidate so the server can verify previewed === accepted.
 */
export function hashMapping(mapping: UserMapping): string {
  const roleEntries = Object.entries(mapping.roleByHeader).sort(([a], [b]) => a.localeCompare(b));
  const payload = JSON.stringify({
    roles: roleEntries,
    defaultAhtUnit: mapping.defaultAhtUnit ?? null,
    dateFormat: mapping.dateFormat ?? 'iso'
  });
  // Small deterministic non-cryptographic hash (FNV-1a) — stable across server/edge.
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export type DateFormat = 'iso' | 'dd_mm_yyyy' | 'mm_dd_yyyy';
export type WeekStartDay = 'monday' | 'sunday';

/**
 * Parse a week-commencing value using an EXPLICIT date format. Ambiguous dates
 * are never guessed: if the configured format is dd/mm or mm/dd the caller must
 * have selected it. Returns ISO yyyy-mm-dd or null (invalid for the format).
 */
export function parseWeek(value: string | undefined, format: DateFormat): string | null {
  if (!value) return null;
  const t = value.trim();
  if (format === 'iso') {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (!iso) return null;
    const d = new Date(`${t}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? null : t;
  }
  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  if (!slash) return null;
  const a = Number(slash[1]);
  const b = Number(slash[2]);
  const yyyy = slash[3];
  const day = format === 'dd_mm_yyyy' ? a : b;
  const month = format === 'dd_mm_yyyy' ? b : a;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const candidate = `${yyyy}-${mm}-${dd}`;
  const d = new Date(`${candidate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  // Round-trip guard: rejects impossible dates like 31/02.
  if (d.getUTCDate() !== day || d.getUTCMonth() + 1 !== month) return null;
  return candidate;
}

/** True when a parsed ISO week-commencing date falls on the configured week start. */
export function isOnWeekStart(isoDate: string, weekStart: WeekStartDay): boolean {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const dow = d.getUTCDay(); // 0 = Sunday, 1 = Monday
  return weekStart === 'monday' ? dow === 1 : dow === 0;
}

function parseNumber(value: string | undefined): number | null {
  if (value === undefined || value === null || value.trim() === '') return null;
  const n = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

/** Parse + validate one raw row against the mapping. Always returns a row. */
export function validateRow(raw: RawRow, mapping: MappingSpec): ParsedRow {
  const get = (field: CanonicalField): string | undefined => {
    const header = Object.keys(mapping.fieldByHeader).find((h) => mapping.fieldByHeader[h] === field);
    return header ? raw.values[header] : undefined;
  };

  const messages: string[] = [];
  const weekCommencing = parseWeek(get('week_commencing'), mapping.dateFormat ?? 'iso');
  if (get('week_commencing') === undefined) messages.push('Missing Week commencing');
  else if (weekCommencing === null) messages.push('Invalid Week commencing date for the selected date format');

  const workflowRaw = get('workflow_name');
  const workflowName = workflowRaw && workflowRaw.trim() !== '' ? workflowRaw.trim() : null;
  if (!workflowName) messages.push('Missing Workflow name');

  const weeklyVolume = parseNumber(get('weekly_volume'));
  if (get('weekly_volume') === undefined) messages.push('Missing Weekly volume');
  else if (weeklyVolume === null) messages.push('Non-numeric Weekly volume');
  else if (weeklyVolume < 0) messages.push('Negative Weekly volume');

  const weeklyAht = parseNumber(get('weekly_aht'));
  if (get('weekly_aht') === undefined) messages.push('Missing Weekly AHT');
  else if (weeklyAht === null) messages.push('Non-numeric Weekly AHT');
  else if (weeklyAht < 0) messages.push('Negative Weekly AHT');

  const ahtUnit = normaliseAhtUnit(get('aht_unit')) ?? mapping.defaultAhtUnit ?? null;
  if (!ahtUnit) messages.push('Missing or unrecognised AHT unit');

  // Explicitly reported zero-volume week vs a normal reported week. (A missing
  // week is simply an absent row and is handled by detectMissingWeeks, never
  // synthesised here.)
  const volumeState: ParsedRow['volumeState'] = weeklyVolume === 0 ? 'reported_zero' : 'reported';

  return {
    rowIndex: raw.rowIndex,
    raw: raw.values,
    weekCommencing,
    workflowName,
    weeklyVolume,
    weeklyAht,
    ahtUnit,
    volumeState,
    validationStatus: messages.length === 0 ? 'valid' : 'invalid',
    validationMessages: messages
  };
}

export function validateRows(rows: RawRow[], mapping: MappingSpec): ParsedRow[] {
  return rows.map((r) => validateRow(r, mapping));
}

// ---------------------------------------------------------------------------
// Canonical grain + duplicate detection — assessed AFTER mapping. A duplicate
// is an identical row at: week + workflow + approved calc-driving dimensions.
// Rows sharing only week+workflow but differing on a mapped dimension are NOT
// duplicates (legitimate dimensional breakdown).
// ---------------------------------------------------------------------------

export interface CanonicalGrain {
  // approved calculation-driving dimensions beyond week+workflow (e.g. ['channel'])
  calcDrivingDimensions: string[];
}

function grainKey(row: ParsedRow, grain: CanonicalGrain): string {
  const dims = grain.calcDrivingDimensions
    .map((d) => `${d}=${(row.raw[d] ?? '').trim().toLowerCase()}`)
    .join('|');
  return [row.weekCommencing ?? '', (row.workflowName ?? '').toLowerCase(), dims].join('::');
}

export interface DuplicateGroup {
  key: string;
  rowIndexes: number[];
}

/** Find true duplicates at the canonical grain (groups with >1 row). */
export function findDuplicatesAtGrain(rows: ParsedRow[], grain: CanonicalGrain): DuplicateGroup[] {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const key = grainKey(row, grain);
    const list = groups.get(key) ?? [];
    list.push(row.rowIndex);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .filter(([, idxs]) => idxs.length > 1)
    .map(([key, rowIndexes]) => ({ key, rowIndexes }));
}

/** True when two rows share week+workflow but differ on a mapped dimension (a
 *  legitimate breakdown, not a duplicate). Used for UI explanation. */
export function isLegitimateBreakdown(a: ParsedRow, b: ParsedRow, grain: CanonicalGrain): boolean {
  const sameWeekWorkflow =
    a.weekCommencing === b.weekCommencing &&
    (a.workflowName ?? '').toLowerCase() === (b.workflowName ?? '').toLowerCase();
  if (!sameWeekWorkflow) return false;
  if (grain.calcDrivingDimensions.length === 0) return false;
  return grain.calcDrivingDimensions.some(
    (d) => (a.raw[d] ?? '').trim().toLowerCase() !== (b.raw[d] ?? '').trim().toLowerCase()
  );
}

// ---------------------------------------------------------------------------
// Missing-week detection — given the declared coverage window and the reported
// weeks per workflow, list weeks absent from the extract. These are NEVER
// materialised as zero-volume; they are reported as gaps for planner awareness.
// ---------------------------------------------------------------------------

function eachWeek(startIso: string, endIso: string, _weekStart: WeekStartDay): string[] {
  const out: string[] = [];
  const start = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 7)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export interface MissingWeekReport {
  workflowName: string;
  missingWeeks: string[];   // weeks in coverage window with no reported row
  reportedZeroWeeks: string[]; // weeks explicitly reported with zero volume
}

export interface MissingWeekResult {
  ok: boolean;
  weekStartMismatch: boolean;
  offendingWeeks: string[];      // reported weeks not on the configured week start
  reports: MissingWeekReport[];
}

/**
 * Missing-week detection. Refuses to run if any reported week-commencing date is
 * not on the configured week-start day (an inconsistent week-start configuration
 * would make "missing" meaningless). Missing weeks are reported as gaps and are
 * NEVER synthesised as zero-volume rows.
 */
export function detectMissingWeeks(
  rows: ParsedRow[],
  coverageStart: string,
  coverageEnd: string,
  weekStart: WeekStartDay = 'monday'
): MissingWeekResult {
  // Week-start consistency guard runs BEFORE any missing-week logic.
  const offendingWeeks = rows
    .filter((r) => r.weekCommencing && !isOnWeekStart(r.weekCommencing, weekStart))
    .map((r) => r.weekCommencing as string);
  if (offendingWeeks.length > 0) {
    return { ok: false, weekStartMismatch: true, offendingWeeks, reports: [] };
  }

  const expected = eachWeek(coverageStart, coverageEnd, weekStart);
  const byWorkflow = new Map<string, Map<string, ParsedRow>>();
  for (const r of rows) {
    if (!r.workflowName || !r.weekCommencing) continue;
    const wf = r.workflowName;
    const m = byWorkflow.get(wf) ?? new Map<string, ParsedRow>();
    m.set(r.weekCommencing, r);
    byWorkflow.set(wf, m);
  }
  const reports: MissingWeekReport[] = [];
  for (const [workflowName, weekMap] of byWorkflow.entries()) {
    const missingWeeks = expected.filter((w) => !weekMap.has(w));
    const reportedZeroWeeks = [...weekMap.entries()]
      .filter(([, row]) => row.volumeState === 'reported_zero')
      .map(([w]) => w);
    reports.push({ workflowName, missingWeeks, reportedZeroWeeks });
  }
  return { ok: true, weekStartMismatch: false, offendingWeeks: [], reports };
}

// ---------------------------------------------------------------------------
// Import summary — the grain + aggregation view the UI must show before a source
// version can be accepted for draft use.
// ---------------------------------------------------------------------------

export interface ImportSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  canonicalGrain: string[];          // ['week_commencing','workflow', ...calcDims]
  unapprovedOptionalFields: string[]; // retained metadata, available to aggregate
  duplicateGroups: DuplicateGroup[];
}

export function summariseImport(
  rows: ParsedRow[],
  grain: CanonicalGrain,
  allHeaders: string[],
  mappedHeaders: string[]
): ImportSummary {
  const valid = rows.filter((r) => r.validationStatus === 'valid').length;
  const unapproved = allHeaders.filter((h) => !mappedHeaders.includes(h));
  return {
    totalRows: rows.length,
    validRows: valid,
    invalidRows: rows.length - valid,
    canonicalGrain: ['week_commencing', 'workflow', ...grain.calcDrivingDimensions],
    unapprovedOptionalFields: unapproved,
    duplicateGroups: findDuplicatesAtGrain(rows, grain)
  };
}
