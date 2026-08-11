import 'server-only';

import { rows, maybe } from './read-result';
import { createClient } from '../supabase/server';
import { createAdminClient } from '../supabase/admin';
import { hasPermission, requirePermission } from '../permissions/permissions';
import {
  detectHeaders,
  validateRows,
  deriveRows,
  buildMappingSpec,
  validateMappingCompleteness,
  findDuplicatesAtGrain,
  grainForMapping,
  type RawRow,
  type MappingSpec,
  type UserMapping
} from '../intake/intake-engine';
import type { UserContext } from '../../types/models';
import type { Json } from '../../types/database';

type JsonRecord = Record<string, unknown>;

export interface InputSourceDashboardData {
  plans: JsonRecord[];
  sources: JsonRecord[];
  customDimensions: JsonRecord[];
}

/** Dashboard: plans + all input sources for the org (read-only, error-surfacing). */
export async function getInputSourceDashboard(context: UserContext): Promise<InputSourceDashboardData> {
  requirePermission(context.roles, 'input:read');
  const supabase = await createClient();
  const plansRes = await supabase
    .from('plans')
    .select('id, plan_name, status')
    .eq('organisation_id', context.organisationId)
    .order('created_at', { ascending: false });
  const sourcesRes = await supabase
    .from('input_sources')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .order('created_at', { ascending: false });
  const dimsRes = await supabase
    .from('custom_dimensions')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .order('display_name', { ascending: true });
  return {
    plans: rows<JsonRecord>('plans', plansRes as never),
    sources: rows<JsonRecord>('input sources', sourcesRes as never),
    customDimensions: rows<JsonRecord>('custom dimensions', dimsRes as never)
  };
}

export function canReadInput(context: UserContext): boolean {
  return hasPermission(context.roles, 'input:read');
}

export function canWriteInput(context: UserContext): boolean {
  return hasPermission(context.roles, 'input:write');
}

export interface InputSourceListData {
  sources: JsonRecord[];
}

/** Draft input sources for a plan. Read-only; errors surface (no false empty). */
export async function listInputSources(context: UserContext, planId: string): Promise<InputSourceListData> {
  requirePermission(context.roles, 'input:read');
  const supabase = await createClient();
  const res = await supabase
    .from('input_sources')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .eq('plan_id', planId)
    .order('created_at', { ascending: false });
  return { sources: rows<JsonRecord>('input sources', res as never) };
}

export interface InputSourceDetailData {
  source: JsonRecord | null;
  versions: JsonRecord[];
  currentVersion: JsonRecord | null;
  currentVersionRows: JsonRecord[];
  currentMapping: JsonRecord | null;
  latestDraftMapping: JsonRecord | null;
  detectedHeaders: string[];
}

/** One source with its versions, the current version's raw rows, and mapping. */
export async function getInputSourceDetail(context: UserContext, sourceId: string): Promise<InputSourceDetailData> {
  requirePermission(context.roles, 'input:read');
  const supabase = await createClient();

  const sourceRes = await supabase
    .from('input_sources')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .eq('id', sourceId)
    .maybeSingle();
  const source = maybe<JsonRecord>('input source', sourceRes as never);

  if (!source) {
    return { source: null, versions: [], currentVersion: null, currentVersionRows: [], currentMapping: null, latestDraftMapping: null, detectedHeaders: [] };
  }

  const versionsRes = await supabase
    .from('input_source_versions')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .eq('input_source_id', sourceId)
    .order('version_number', { ascending: false });
  const versions = rows<JsonRecord>('input source versions', versionsRes as never);

  const currentVersionId = source.current_version_id as string | null;
  let currentVersion: JsonRecord | null = null;
  let currentVersionRows: JsonRecord[] = [];
  let currentMapping: JsonRecord | null = null;
  let latestDraftMapping: JsonRecord | null = null;
  let detectedHeaders: string[] = [];

  if (currentVersionId) {
    currentVersion = versions.find((v) => String(v.id) === String(currentVersionId)) ?? null;
    if (currentVersion && Array.isArray(currentVersion.detected_headers)) {
      detectedHeaders = (currentVersion.detected_headers as { header?: string }[])
        .map((h) => (typeof h === 'string' ? h : h?.header ?? ''))
        .filter(Boolean);
    }

    const rowsRes = await supabase
      .from('input_source_rows')
      .select('*')
      .eq('organisation_id', context.organisationId)
      .eq('input_source_version_id', currentVersionId)
      .order('row_index', { ascending: true });
    currentVersionRows = rows<JsonRecord>('input source rows', rowsRes as never);

    // Prefer the latest ACCEPTED mapping as the official interpretation. A newer
    // draft must NOT be treated as current.
    const acceptedRes = await supabase
      .from('field_mapping_versions')
      .select('*')
      .eq('organisation_id', context.organisationId)
      .eq('input_source_version_id', currentVersionId)
      .eq('mapping_status', 'accepted')
      .order('mapping_version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    currentMapping = maybe<JsonRecord>('accepted field mapping', acceptedRes as never);

    // The latest draft (if any) is exposed separately for the editing UI.
    const draftRes = await supabase
      .from('field_mapping_versions')
      .select('*')
      .eq('organisation_id', context.organisationId)
      .eq('input_source_version_id', currentVersionId)
      .eq('mapping_status', 'draft')
      .order('mapping_version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    latestDraftMapping = maybe<JsonRecord>('draft field mapping', draftRes as never);
  }

  return { source, versions, currentVersion, currentVersionRows, currentMapping, latestDraftMapping, detectedHeaders };
}

/**
 * Lightweight read of a single input source version's status. Used by the write
 * actions to fail gracefully (redirect back) when a version is accepted/frozen,
 * instead of letting the DB immutability error surface as a module crash.
 */
export async function getInputSourceVersionStatus(context: UserContext, versionId: string): Promise<string | null> {
  const supabase = await createClient();
  const res = await supabase
    .from('input_source_versions')
    .select('version_status')
    .eq('organisation_id', context.organisationId)
    .eq('id', versionId)
    .maybeSingle();
  const row = maybe<JsonRecord>('input source version status', res as never);
  return row ? String(row.version_status) : null;
}

export interface CustomDimensionData {
  dimensions: JsonRecord[];
}

export async function listCustomDimensions(context: UserContext, planId: string): Promise<CustomDimensionData> {
  requirePermission(context.roles, 'input:read');
  const supabase = await createClient();
  const res = await supabase
    .from('custom_dimensions')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .eq('plan_id', planId)
    .order('display_name', { ascending: true });
  return { dimensions: rows<JsonRecord>('custom dimensions', res as never) };
}

// ---------------------------------------------------------------------------
// Writes — service-role RPCs only (never client-direct). Draft-only.
// ---------------------------------------------------------------------------

export interface ImportInputSourceInput {
  planId: string;
  sourceName: string;
  description?: string;
  sourceInventoryId?: string | null;
  importMethod: 'paste' | 'csv' | 'tsv' | 'manual';
  rawPayload: string;            // original pasted/uploaded text, retained verbatim
  headers: string[];
  mapping: MappingSpec;          // header -> canonical field
  rawRows: RawRow[];             // parsed raw rows (every row retained)
  dateFormat?: 'iso' | 'dd_mm_yyyy' | 'mm_dd_yyyy';
  weekStartDay?: 'monday' | 'sunday';
  coverageWeekStart?: string | null;
  coverageWeekEnd?: string | null;
  reason?: string;
}

/** Import a new immutable source version with its raw rows, via service-role RPC. */
export async function importInputSourceVersion(
  context: UserContext,
  input: ImportInputSourceInput
): Promise<{ inputSourceId: string; versionId: string; versionNumber: number; rowCount: number }> {
  requirePermission(context.roles, 'input:write');
  if (!input.sourceName.trim()) throw new Error('Source name is required');

  // Validate/parse rows deterministically (retains every row; flags invalid ones).
  const parsed = validateRows(input.rawRows, input.mapping);
  const rowPayloads = parsed.map((r) => ({
    row_index: r.rowIndex,
    raw_values: r.raw,
    week_commencing: r.weekCommencing ?? '',
    workflow_name: r.workflowName ?? '',
    weekly_volume: r.weeklyVolume ?? '',
    weekly_aht: r.weeklyAht ?? '',
    aht_unit: r.ahtUnit ?? '',
    volume_state: r.volumeState,
    validation_status: r.validationStatus,
    validation_messages: r.validationMessages
  }));

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('import_input_source_version', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    target_plan_id: input.planId,
    source_payload: {
      source_name: input.sourceName,
      description: input.description ?? '',
      source_inventory_id: input.sourceInventoryId ?? '',
      import_method: input.importMethod,
      declared_aht_unit: input.mapping.defaultAhtUnit ?? '',
      date_format: input.dateFormat ?? 'iso',
      week_start_day: input.weekStartDay ?? 'monday',
      detected_headers: detectHeadersList(input.headers),
      raw_payload: input.rawPayload,
      coverage_week_start: input.coverageWeekStart ?? '',
      coverage_week_end: input.coverageWeekEnd ?? ''
    } as unknown as Json,
    row_payloads: rowPayloads as unknown as Json,
    import_reason: input.reason ?? null
  });
  if (error) throw new Error(`Could not import input source version: ${error.message}`);
  const result = data as JsonRecord;
  return {
    inputSourceId: String(result.input_source_id),
    versionId: String(result.version_id),
    versionNumber: Number(result.version_number),
    rowCount: Number(result.row_count)
  };
}

function detectHeadersList(headers: string[]): { header: string; suggested: string | null }[] {
  return detectHeaders(headers).map((h) => ({ header: h.header, suggested: h.suggested }));
}

export interface CreateMappingInput {
  versionId: string;
  // header -> role chosen by the user (the canonical-field mapping)
  roleByHeader: Record<string, string>;
  defaultAhtUnit?: 'seconds' | 'minutes' | 'hours' | null;
  dateFormat?: 'iso' | 'dd_mm_yyyy' | 'mm_dd_yyyy';
  accept: boolean;
  reason?: string;
}

/**
 * Create (optionally accept) an immutable field-mapping version from the user's
 * canonical-field mapping. On accept, required-field completeness is validated
 * server-side (not just in the UI). The full role map is persisted so the
 * interpretation can be re-derived from raw rows + this mapping version.
 */
export async function createFieldMappingVersion(
  context: UserContext,
  input: CreateMappingInput
): Promise<{ mappingVersionId: string; mappingVersionNumber: number; accepted: boolean }> {
  requirePermission(context.roles, 'input:write');

  const userMapping: UserMapping = {
    roleByHeader: input.roleByHeader as UserMapping['roleByHeader'],
    defaultAhtUnit: input.defaultAhtUnit ?? null,
    dateFormat: input.dateFormat ?? 'iso'
  };

  // Server-side guard: an accepted mapping MUST satisfy required canonical fields.
  if (input.accept) {
    const validation = validateMappingCompleteness(userMapping);
    if (!validation.ok) {
      throw new Error(`Mapping cannot be accepted: ${validation.errors.join('; ')}`);
    }
  }

  const { calcDrivingDimensions } = buildMappingSpec(userMapping);

  const admin = createAdminClient();
  const { data, error } = await admin.rpc('create_field_mapping_version', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    target_version_id: input.versionId,
    mapping_payload: ({
      mappings: input.roleByHeader,
      calc_driving_dimensions: calcDrivingDimensions,
      aggregation_decision: { default_aht_unit: input.defaultAhtUnit ?? null, date_format: input.dateFormat ?? 'iso' },
      accept: input.accept,
      canonical_grain: ['week_commencing', 'workflow', ...calcDrivingDimensions]
    }) as unknown as Json,
    mapping_reason: input.reason ?? null
  });
  if (error) throw new Error(`Could not create field mapping version: ${error.message}`);
  const result = data as JsonRecord;
  return {
    mappingVersionId: String(result.mapping_version_id),
    mappingVersionNumber: Number(result.mapping_version_number),
    accepted: Boolean(result.accepted)
  };
}

export interface MappingPreview {
  derivedRows: { rowIndex: number; weekCommencing: string | null; workflowName: string | null; weeklyVolume: number | null; weeklyAht: number | null; ahtUnit: string | null; volumeState: string; validationStatus: string; validationMessages: string[] }[];
  canonicalGrain: string[];
  duplicateGroups: { key: string; rowIndexes: number[] }[];
  validRows: number;
  invalidRows: number;
  mappingValid: boolean;
  mappingErrors: string[];
}

/**
 * Preview the consequence of a candidate mapping against the version's immutable
 * raw rows: re-derive interpreted rows and compute duplicates at the selected
 * canonical grain. This is what the UI shows BEFORE acceptance. Read-only; it
 * derives dynamically and never mutates stored rows.
 */
export async function previewMapping(
  context: UserContext,
  versionId: string,
  userMapping: UserMapping
): Promise<MappingPreview> {
  requirePermission(context.roles, 'input:read');
  const supabase = await createClient();
  const res = await supabase
    .from('input_source_rows')
    .select('*')
    .eq('organisation_id', context.organisationId)
    .eq('input_source_version_id', versionId)
    .order('row_index', { ascending: true });
  const storedRows = rows<JsonRecord>('input source rows', res as never);

  // Reconstruct raw rows from the immutable raw_values and re-derive.
  const rawRows: RawRow[] = storedRows.map((r) => ({
    rowIndex: Number(r.row_index),
    values: (r.raw_values ?? {}) as Record<string, string>
  }));
  const derived = deriveRows(rawRows, userMapping);
  const grain = grainForMapping(userMapping);
  const duplicates = findDuplicatesAtGrain(derived, grain);
  const validation = validateMappingCompleteness(userMapping);

  return {
    derivedRows: derived.map((d) => ({
      rowIndex: d.rowIndex,
      weekCommencing: d.weekCommencing,
      workflowName: d.workflowName,
      weeklyVolume: d.weeklyVolume,
      weeklyAht: d.weeklyAht,
      ahtUnit: d.ahtUnit,
      volumeState: d.volumeState,
      validationStatus: d.validationStatus,
      validationMessages: d.validationMessages
    })),
    canonicalGrain: ['week_commencing', 'workflow', ...grain.calcDrivingDimensions],
    duplicateGroups: duplicates,
    validRows: derived.filter((d) => d.validationStatus === 'valid').length,
    invalidRows: derived.filter((d) => d.validationStatus === 'invalid').length,
    mappingValid: validation.ok,
    mappingErrors: validation.errors
  };
}

export async function registerCustomDimension(
  context: UserContext,
  input: { planId: string; dimensionKey: string; displayName: string; promotionStatus: 'retained' | 'reportable'; reason?: string }
): Promise<JsonRecord> {
  requirePermission(context.roles, 'input:write');
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('register_custom_dimension', {
    target_organisation_id: context.organisationId,
    target_actor_user_id: context.userId,
    target_plan_id: input.planId,
    dimension_payload: ({
      dimension_key: input.dimensionKey,
      display_name: input.displayName,
      promotion_status: input.promotionStatus
    }) as unknown as Json,
    register_reason: input.reason ?? null
  });
  if (error) throw new Error(`Could not register custom dimension: ${error.message}`);
  return data as JsonRecord;
}
